import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { readPipeline } from "../../domain/pipeline";
import * as worktree from "../../io/git/worktree";
import * as orchestrator from "../orchestrator";
import { getTaskConfigWithAdapter } from "../../domain/userConfig";
import { syncAiPrompt } from "../syncAiPrompt";
import type { PipelineLike } from "./state";
import { writeSyncJob } from "./state";
import { markFailed, waitAndFinish } from "./cleanup";

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
  const p = (await readPipeline(projectPath, pipelineId)) as PipelineLike | null;
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
  // 主 agent 永遠帶 bypass(對齊 orchestrator/spawn.ts:196 + 雷區 #10):跨 provider
  // sub-agent 內部 Bash 在 auto 模式會被 permission_denials 擋(主 agent 還會幻覺成功),
  // 所以不論 provider 一律 bypass。安全邊界:衝突解仍由 sub-agent 在 worktree 內改 code,
  // 主 agent 只 Bash 派發 + 環境工具,risk 跟既有「sub-agent 改 code」同等級。
  const needsBypassPermissions = true;

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
