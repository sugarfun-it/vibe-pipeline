// Sync job 編排:把 base branch merge 進 pipeline worktree。
// 跟舊 sync ticket(append synthetic ticket 給 runner 跑)不同,這層直接走 git CLI,
// 只有有衝突時才 spawn AI 解;syncJob 寄生在 Pipeline.syncJob 欄位,不污染 tickets[]。
//
// State machine 見 shared/types.ts:SyncJobState。
//
// 三個 entry point:
//   - startSync(): 試 git merge --no-ff base。乾淨 / FF → done;衝突 → conflict_await
//   - confirmAi(): user 同意 AI 解衝突,spawn claude/codex,註冊進 running map
//   - cancelSync(): kill AI(若有)+ git merge --abort + 標 failed

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import * as pipelineDir from "../pipelineDir";
import * as worktree from "../git/worktree";
import * as notifs from "../notifs/store";
import * as orchestrator from "./orchestrator";
import { vibeHome } from "../paths";
import { getTaskConfigWithAdapter } from "../userConfig";
import { syncAiPrompt } from "./syncAiPrompt";
import { runCapture } from "../spawn";
import type { SyncJob, SyncJobState } from "../../../shared/types";

type PipelineLike = {
  name?: string;
  state?: string;
  branch?: string;
  baseBranch?: string;
  syncJob?: SyncJob;
  [k: string]: unknown;
};

async function writeSyncJob(
  projectPath: string,
  pipelineId: string,
  job: SyncJob | null
): Promise<void> {
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return;
  const prevState = typeof p.state === "string" ? p.state : undefined;
  const source = job === null ? "sync-dismiss" : `sync-${job.state}`;
  if (job === null) {
    const { syncJob: _drop, ...rest } = p;
    void _drop;
    await pipelineDir.writePipeline(projectPath, pipelineId, rest, {
      source,
      prevStateHint: prevState,
    });
  } else {
    await pipelineDir.writePipeline(projectPath, pipelineId, { ...p, syncJob: job }, {
      source,
      sourceDetail: job.reason,
      prevStateHint: prevState,
    });
  }
}

// 入口 1:嘗試 sync。流程:
//   1. read pipeline,確認沒在 running ticket / sync ai
//   2. behindCount === 0 → 直接寫 syncJob.done + return alreadyUpToDate
//   3. 寫 syncJob.state="merging"
//   4. worktree.mergeFromBase
//      - alreadyUpToDate → syncJob.done(理論上 step 2 已擋)
//      - ok + commit → syncJob.done + commit + emit sync_succeeded
//      - conflictFiles → syncJob.conflict_await + emit sync_conflict
//      - error → syncJob.failed + reason + emit sync_failed
export async function startSync(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<
  | { ok: true; state: SyncJobState; behind?: number; conflictFiles?: string[] }
  | { ok: false; error: string }
> {
  const { projectPath, projectHash, pipelineId } = opts;
  if (orchestrator.isRunning(projectHash, pipelineId)) {
    return { ok: false, error: "Pipeline 在跑或同步中,先完成或取消" };
  }
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return { ok: false, error: "Pipeline not found" };
  const baseBranch = p.baseBranch || "main";

  const behind = await worktree.behindBaseCount(projectPath, pipelineId, baseBranch);
  if (behind === null) {
    return { ok: false, error: "worktree 不存在,先跑 pipeline 一次再 sync" };
  }
  if (behind === 0) {
    // 沒落後 → 直接成功 + 短暫 done state(UI 短秒顯示後可以由 frontend 主動清掉)
    const job: SyncJob = {
      state: "done",
      startedAt: Date.now(),
      endedAt: Date.now(),
      behindCount: 0,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    return { ok: true, state: "done", behind: 0 };
  }

  // 寫 merging state 讓前端可看「同步中」(雖然多半 <1s)
  const startedAt = Date.now();
  await writeSyncJob(projectPath, pipelineId, {
    state: "merging",
    startedAt,
    behindCount: behind,
  });
  notifs.emit(projectPath, {
    type: "sync_started",
    title: `${p.name || pipelineId} 同步啟動`,
    sub: `落後 ${behind} commits`,
    pipelineId,
  });

  const mergeRes = await worktree.mergeFromBase(projectPath, pipelineId, baseBranch);

  if (mergeRes.ok && mergeRes.alreadyUpToDate) {
    const job: SyncJob = {
      state: "done",
      startedAt,
      endedAt: Date.now(),
      behindCount: behind,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_succeeded",
      title: `${p.name || pipelineId} 同步完成`,
      sub: "已最新(無需 merge)",
      pipelineId,
    });
    return { ok: true, state: "done", behind: 0 };
  }

  if (mergeRes.ok && "commit" in mergeRes && mergeRes.commit) {
    const job: SyncJob = {
      state: "done",
      startedAt,
      endedAt: Date.now(),
      behindCount: behind,
      mergeCommit: mergeRes.commit,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_succeeded",
      title: `${p.name || pipelineId} 同步完成`,
      sub: `merge commit ${mergeRes.commit.hash.slice(0, 7)}`,
      pipelineId,
    });
    return { ok: true, state: "done", behind };
  }

  if (!mergeRes.ok && "conflictFiles" in mergeRes && mergeRes.conflictFiles) {
    const job: SyncJob = {
      state: "conflict_await",
      startedAt,
      behindCount: behind,
      conflictFiles: mergeRes.conflictFiles,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_conflict",
      title: `${p.name || pipelineId} 同步遇衝突`,
      sub: `${mergeRes.conflictFiles.length} 檔衝突,等使用者決定`,
      pipelineId,
    });
    return { ok: true, state: "conflict_await", behind, conflictFiles: mergeRes.conflictFiles };
  }

  const errMsg =
    !mergeRes.ok && "error" in mergeRes && typeof mergeRes.error === "string"
      ? mergeRes.error
      : "merge failed";
  // 走到這邊 = git merge 失敗但不是衝突。abort 一下確保 worktree 乾淨
  await worktree.mergeAbort(projectPath, pipelineId);
  const job: SyncJob = {
    state: "failed",
    startedAt,
    endedAt: Date.now(),
    behindCount: behind,
    reason: errMsg,
  };
  await writeSyncJob(projectPath, pipelineId, job);
  notifs.emit(projectPath, {
    type: "sync_failed",
    title: `${p.name || pipelineId} 同步失敗`,
    sub: errMsg.slice(0, 120),
    pipelineId,
  });
  return { ok: false, error: errMsg };
}

// 入口 2:user 確認讓 AI 解衝突。前置:syncJob.state === "conflict_await"
// spawn claude/codex,prompt 是 syncAiPrompt 內容。註冊進 running map(kind="sync")。
// child 完成時:
//   - PASS\nSYNC_DONE → syncJob.done + emit sync_succeeded
//   - 其他 → git merge --abort + syncJob.failed + emit sync_failed
export async function confirmAi(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  if (orchestrator.isRunning(projectHash, pipelineId)) {
    return { ok: false, error: "Pipeline 已有別的東西在跑" };
  }
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return { ok: false, error: "Pipeline not found" };
  if (!p.syncJob || p.syncJob.state !== "conflict_await") {
    return { ok: false, error: "syncJob 不在 conflict_await 狀態" };
  }
  const baseBranch = p.baseBranch || "main";
  const branch = p.branch || `pipeline/${p.name || pipelineId}`;
  const conflictFiles = p.syncJob.conflictFiles ?? [];
  const wtPath = worktree.worktreePath(projectPath, pipelineId);

  // log 路徑:.runtime/logs/sync-<pipelineId>-<ts>.log
  const logDir = join(projectPath, ".vibe-pipeline", ".runtime", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `sync-${pipelineId}-${Date.now()}.log`);

  const prompt = syncAiPrompt({
    worktreePath: wtPath,
    branch,
    baseBranch,
    conflictFiles,
  });

  // 用 merge task class 的 model/effort(衝突解算 merge 性質)
  const mergeCfg = await getTaskConfigWithAdapter("merge");
  // sync 衝突解是執行性工作(實際改 code + commit),用 executor cfg 不用 critic
  const subCfg = await getTaskConfigWithAdapter("executor");
  // 跨 provider:codex sub-agent 需要 bypass(同 orchestrator 邏輯)
  const needsBypassPermissions =
    subCfg.provider === "codex" || mergeCfg.provider === "codex";

  let proc: Bun.Subprocess;
  try {
    proc = mergeCfg.adapter.spawn({
      kind: "runner",
      cwd: wtPath,
      sessionId: randomUUID(),
      initialMessage: prompt,
      systemPrompt:
        "你是專門解 git merge 衝突的 AI 助手。在被指定的 worktree 內以 Edit + Bash 完成衝突解決與 merge commit。不可動 main repo。",
      model: mergeCfg.model,
      effort: mergeCfg.effort,
      needsBypassPermissions,
    });
  } catch (e) {
    const reason = `spawn ${mergeCfg.adapter.name} failed: ${String(e)}`;
    await markFailed(projectPath, pipelineId, reason);
    return { ok: false, error: reason };
  }

  orchestrator.registerSyncRunning(projectHash, pipelineId, proc);

  const startedAt = p.syncJob.startedAt ?? Date.now();
  await writeSyncJob(projectPath, pipelineId, {
    state: "ai_running",
    startedAt,
    behindCount: p.syncJob.behindCount,
    conflictFiles,
    aiPid: proc.pid,
  });

  // 啟動非同步 wait,完成後處理結果。caller 不等
  void waitAndFinish({
    projectPath,
    projectHash,
    pipelineId,
    proc,
    logPath,
    adapterName: mergeCfg.adapter.name,
    pipelineName: p.name || pipelineId,
  });

  return { ok: true };
}

// 入口 3:取消 sync。前置:syncJob.state ∈ { conflict_await, ai_running }
export async function cancelSync(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p || !p.syncJob) return { ok: false, error: "沒有進行中的 sync" };

  // kill AI(若在 running map)
  if (orchestrator.runningKind(projectHash, pipelineId) === "sync") {
    // 透過 running map 拿 proc — 但目前 orchestrator 沒露 proc。直接用 OS kill PID
    const pid = p.syncJob.aiPid;
    if (typeof pid === "number") {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already dead — ignore
      }
    }
    orchestrator.unregisterRunning(projectHash, pipelineId);
  }

  // git merge --abort 把 worktree 帶回 merge 前狀態
  await worktree.mergeAbort(projectPath, pipelineId);

  await markFailed(projectPath, pipelineId, "使用者取消");
  return { ok: true };
}

async function markFailed(
  projectPath: string,
  pipelineId: string,
  reason: string
): Promise<void> {
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
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

async function waitAndFinish(opts: {
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
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      const s = new TextDecoder().decode(chunk);
      stdoutBuf += s;
      logStream?.write(s);
    }
  })();
  const stderrPromise = (async () => {
    if (!proc.stderr) return;
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
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

  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
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
  const pipelines = (await pipelineDir.listPipelines(projectPath)) as Array<PipelineLike & {
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
