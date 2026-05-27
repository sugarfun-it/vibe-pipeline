import * as pipelineDir from "../../pipelineDir";
import * as worktree from "../../git/worktree";
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
