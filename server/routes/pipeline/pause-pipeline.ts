import * as orchestrator from '../../lib/runner/orchestrator';
import { ok, err, withProject, withUserAudit } from '../_http';
import { detectVia } from '../projects';
import type { ApiErrorCode } from '../../../shared/types';

// /pause 跟 /stop 共用本 handler。
// 固定立即停止:running 走 SIGKILL + 標 paused;queued 走 cancelQueued。
// 預期沒 body / 不是 JSON 也容忍。
export async function pausePipeline(
  hash: string,
  pipelineId: string,
  req?: Request
): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.pause", pipelineId, via: detectVia(req) }, async () => {
    // queued 狀態走 cancelQueued(直接從 queue 拔 + 標 paused);running 走立即停止。
    if (orchestrator.isQueued(hash, pipelineId)) {
      const r = await orchestrator.cancelQueued({ projectPath: project.path, projectHash: hash, pipelineId });
      if (!r.ok) return err("invalid_path", r.error, 409);
      return ok({ ok: true, cancelled: true });
    }

    const r = await orchestrator.stopImmediate({ projectPath: project.path, projectHash: hash, pipelineId });
    if (!r.ok) {
      const code: ApiErrorCode = r.code === "not_found" ? "not_found" : "state_guard";
      const status = code === "not_found" ? 404 : 409;
      return err(code, r.error, status);
    }
    return ok({ ok: true });
  }));
}
