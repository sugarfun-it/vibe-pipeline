import * as pipelineDir from '../../lib/pipelineDir';
import * as orchestrator from '../../lib/runner/orchestrator';
import { ok, err, withProject, withUserAudit } from '../_http';
import type { ApiErrorCode } from '../../../shared/types';
import { detectVia } from '../projects';
import { isExistingDirectory as validProjectPath } from '../../lib/fs';

export async function runPipeline(hash: string, pipelineId: string, req?: Request): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.run", pipelineId, via: detectVia(req) }, async () => {
    if (!validProjectPath(project.path)) return err("invalid_path", `Path missing: ${project.path}`);
    if (!project.hasGit) return err("invalid_path", "Project 沒 .git/,先 git init 再跑 pipeline");
    // User 顯式按繼續 = 明確要重試:把所有 failed_transient ticket reset 成 paused,
    // 否則 runner 主迴圈規則「遇 failed_transient 立刻暫停」會讓 pipeline 秒退。
    // 設計初衷是「不自動重試燒 token」,但 user 主動點繼續就是 explicit consent。
    try {
      await pipelineDir.mutatePipeline(project.path, pipelineId, (p) => {
        for (const t of p.tickets ?? []) {
          if (t.status === "failed_transient") {
            t.status = "paused";
          }
        }
        return p;
      }, {
        source: "api-run-pipeline",
        sourceDetail: "reset failed_transient → paused on user run",
      });
    } catch (e) {
      console.warn(`[runPipeline] reset failed_transient skipped: ${String(e)}`);
    }
    const r = await orchestrator.start({ projectPath: project.path, projectHash: hash, pipelineId });
    if (!r.ok) {
      // budget_exceeded → 402 Payment Required + body 帶 spent/limit 給前端顯示
      if (r.reason === "budget_exceeded") {
        return Response.json({ ok: false, error: { code: "budget_exceeded" satisfies ApiErrorCode, message: r.error, spent: r.spent, limit: r.limit } }, { status: 402 });
      }
      // 邏輯阻擋(state guard / 已在跑等)用 409 conflict;真正爆炸用 500
      const isConflict = /已在|完成|排隊|merge/.test(r.error);
      return err("invalid_path", r.error, isConflict ? 409 : 500);
    }
    // queued: true 時,前端可立即顯示「排隊中(順位 N)」不等下一輪 poll
    return ok({ ok: true, queued: r.queued ?? false, position: r.position ?? 0 });
  }));
}
