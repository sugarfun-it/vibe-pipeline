import { createWriteStream, type WriteStream } from "node:fs";
import { listPipelines, readPipeline } from "../../domain/pipeline";
import * as worktree from "../../io/git/worktree";
import * as notifs from "../../remote/notifs";
import * as orchestrator from "../orchestrator";
import { vibeHome } from "../../io/paths";
import { runCapture } from "../../io/childSpawn";
import type { SyncJob } from "../../../../shared/types";
import type { PipelineLike } from "./state";
import { writeSyncJob } from "./state";

export async function markFailed(
  projectPath: string,
  pipelineId: string,
  reason: string
): Promise<void> {
  const p = (await readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return;
  const job: SyncJob = {
    state: "failed",
    startedAt: p.syncJob?.startedAt ?? Date.now(),
    endedAt: Date.now(),
    behindCount: p.syncJob?.behindCount ?? 0,
    conflictFiles: p.syncJob?.conflictFiles,
    reason,
  };
  await writeSyncJob(projectPath, pipelineId, job);
  notifs.emit(projectPath, {
    type: "sync_failed",
    title: `${p.name || pipelineId} 同步失敗`,
    sub: reason.slice(0, 120),
    pipelineId,
  });
}

export async function waitAndFinish(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  proc: Bun.Subprocess;
  logPath: string;
  adapterName: string;
  pipelineName: string;
}): Promise<void> {
  const { projectPath, projectHash, pipelineId, proc, logPath, adapterName, pipelineName } = opts;
  let logStream: WriteStream | null = null;
  try {
    logStream = createWriteStream(logPath, { flags: "a" });
  } catch {
    // log 寫不到的話也繼續跑(不阻斷)
  }
  let stdoutBuf = "";
  let stderrBuf = "";

  const stdoutPromise = (async () => {
    if (!proc.stdout) return;
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      const s = new TextDecoder().decode(chunk);
      stdoutBuf += s;
      logStream?.write(s);
    }
  })();
  const stderrPromise = (async () => {
    if (!proc.stderr) return;
    for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
      const s = new TextDecoder().decode(chunk);
      stderrBuf += s;
      logStream?.write("[stderr] " + s);
    }
  })();

  let exitCode: number | null = null;
  try {
    await Promise.all([stdoutPromise, stderrPromise]);
    exitCode = await proc.exited;
  } catch (e) {
    console.error(`[syncJob ${pipelineId}] wait error:`, e);
  }
  logStream?.end();

  // 從 running map 卸載(也許 watchdog 已先拔了)
  orchestrator.unregisterRunning(projectHash, pipelineId);

  // 解析結果 — claude --output-format json 包成 {result:"<text>"}
  let resultText = stdoutBuf;
  try {
    const outer = JSON.parse(stdoutBuf);
    if (outer && typeof outer.result === "string") resultText = outer.result;
  } catch {
    // 不是合法 JSON(可能 codex 不同格式)→ 直接看 stdout 字串
  }

  // 不靠 AI 自然語言 — AI 可能把 PASS\nSYNC_DONE 寫在中段或結尾,first-line 判定會誤殺。
  // 改用 git 實際狀態當 ground truth:
  //   1. .git/MERGE_HEAD 不存在(merge 已 commit 收尾)
  //   2. git status --porcelain 沒衝突行(沒 UU/AA 等)
  //   3. behindBaseCount === 0(HEAD 已包含 base)
  // 三條都成立 → 視為成功,完全不看 AI 字串。
  const wtPath = worktree.worktreePath(projectPath, pipelineId);
  const gitOk = async (args: string[]): Promise<{ ok: boolean; out: string }> => {
    const r = await runCapture(["git", ...args], { cwd: wtPath });
    return { ok: r.ok, out: r.out.trim() };
  };
  const statusRes = await gitOk(["status", "--porcelain"]);
  const hasConflictMarkers = statusRes.ok && statusRes.out
    .split(/\r?\n/)
    .some((l) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l));
  const mergeHeadExists = await (async () => {
    try {
      return require("node:fs").existsSync(require("node:path").join(wtPath, ".git", "MERGE_HEAD"));
    } catch {
      return false;
    }
  })();

  const p = (await readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p || !p.syncJob) return;
  const startedAt = p.syncJob.startedAt;
  const baseBranch = p.baseBranch || "main";
  const behindAfter = await worktree.behindBaseCount(projectPath, pipelineId, baseBranch);

  const isPass = !hasConflictMarkers && !mergeHeadExists && behindAfter === 0;

  if (isPass) {
    // 取 merge commit hash
    const headHash = (await runCapture(
      ["git", "rev-parse", "HEAD"],
      { cwd: worktree.worktreePath(projectPath, pipelineId) }
    )).out.trim();
    const headSubject = (await runCapture(
      ["git", "log", "-1", "--format=%s"],
      { cwd: worktree.worktreePath(projectPath, pipelineId) }
    )).out.trim();
    await writeSyncJob(projectPath, pipelineId, {
      state: "done",
      startedAt,
      endedAt: Date.now(),
      behindCount: p.syncJob.behindCount,
      mergeCommit: headHash ? { hash: headHash, subject: headSubject, ts: Date.now() } : undefined,
    });
    notifs.emit(projectPath, {
      type: "sync_succeeded",
      title: `${pipelineName} 同步完成`,
      sub: `AI 解衝突 + merge commit ${headHash.slice(0, 7)}`,
      pipelineId,
    });
  } else {
    // 失敗:abort merge 把 worktree 帶回原狀
    await worktree.mergeAbort(projectPath, pipelineId);
    const gitReason = mergeHeadExists
      ? "AI 沒完成 merge commit(MERGE_HEAD 還在)"
      : hasConflictMarkers
      ? "worktree 仍有未解衝突檔"
      : behindAfter && behindAfter > 0
      ? `worktree 仍落後 base ${behindAfter} commits`
      : null;
    const reason =
      gitReason ||
      stderrBuf.slice(0, 200) ||
      resultText.slice(0, 200) ||
      `${adapterName} 退出 code=${exitCode}`;
    await writeSyncJob(projectPath, pipelineId, {
      state: "failed",
      startedAt,
      endedAt: Date.now(),
      behindCount: p.syncJob.behindCount,
      conflictFiles: p.syncJob.conflictFiles,
      reason,
    });
    notifs.emit(projectPath, {
      type: "sync_failed",
      title: `${pipelineName} 同步失敗`,
      sub: reason.slice(0, 120),
      pipelineId,
    });
  }
}

// Crash recovery:server boot 時掃 pipelines,把 syncJob.state ∈ {merging, ai_running} 的標 failed
// (跟 recoverStale 對稱的補丁,因為 sync AI proc 隨 server 重啟蒸發)
export async function recoverStaleSync(projectPath: string): Promise<void> {
  void vibeHome; // 抑制未用 import
  const pipelines = (await listPipelines(projectPath)) as Array<PipelineLike & {
    id?: string;
  }>;
  for (const p of pipelines) {
    if (!p.id || !p.syncJob) continue;
    if (p.syncJob.state === "merging" || p.syncJob.state === "ai_running") {
      // 嘗試 abort merge(若 worktree 在 mid-merge)
      try {
        await worktree.mergeAbort(projectPath, p.id);
      } catch {
        // ignore
      }
      await writeSyncJob(projectPath, p.id, {
        state: "failed",
        startedAt: p.syncJob.startedAt,
        endedAt: Date.now(),
        behindCount: p.syncJob.behindCount,
        conflictFiles: p.syncJob.conflictFiles,
        reason: "server 重啟,sync AI 蒸發,已 abort merge",
      });
      console.log(`[syncJob] recovered stale syncJob ${p.id} → failed`);
    }
  }
}
