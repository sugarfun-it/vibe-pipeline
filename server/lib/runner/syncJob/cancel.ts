import { readPipeline } from "../../domain/pipeline";
import * as worktree from "../../io/git/worktree";
import * as orchestrator from "../orchestrator";
import type { PipelineLike } from "./state";
import { markFailed } from "./cleanup";

// 入口 3:取消 sync。前置:syncJob.state ∈ { conflict_await, ai_running }
export async function cancelSync(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const p = (await readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p || !p.syncJob) return { ok: false, error: "沒有進行中的 sync" };

  // kill AI(若在 running map)。拿 in-memory proc 走 killProcessTree(對齊
  // stopImmediate):Windows taskkill /T 殺整棵,單殺 disk-read PID 的 SIGTERM 殺父不
  // 殺孫,codex/claude sub-agent 會留 orphan 吃 token(雷區 #13 stop = immediate kill)。
  if (orchestrator.runningKind(projectHash, pipelineId) === "sync") {
    const proc = orchestrator.getRunningProc(projectHash, pipelineId);
    const pid = proc?.pid ?? p.syncJob.aiPid;
    try {
      await orchestrator.killProcessTree(pid);
    } catch {
      // already dead — ignore
    }
    orchestrator.unregisterRunning(projectHash, pipelineId);
  }

  // git merge --abort 把 worktree 帶回 merge 前狀態
  await worktree.mergeAbort(projectPath, pipelineId);

  await markFailed(projectPath, pipelineId, "使用者取消");
  return { ok: true };
}
