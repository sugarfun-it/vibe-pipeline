import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as pipelineDir from "../../pipelineDir";
import * as worktree from "../../git/worktree";
import * as orchestrator from "../orchestrator";
import { getTaskConfigWithAdapter } from "../../userConfig";
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
