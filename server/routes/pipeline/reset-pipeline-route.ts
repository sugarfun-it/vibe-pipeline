import * as pipelineDir from '../../lib/pipelineDir';
import * as git from '../../lib/git';
import * as orchestrator from '../../lib/runner/orchestrator';
import * as worktree from '../../lib/git/worktree';
import { ok, err, withPipeline } from '../_http';

// POST /api/projects/:hash/pipelines/:id/reset
// 「重置 pipeline」— 完整 fresh start。三步:
//   1. removeQuiet worktree(刪 disk checkout)
//   2. deleteBranchForce pipeline branch(讓下次 ensure 從 baseBranch -b 新建,不再落後)
//   3. mutatePipeline:state=planning + tickets done/failed 改 draft + 清 iter/commits/liveLog/reason
// running 中擋。pipeline.json 本身保留(name / mode / goal / acceptance / prompt 等),只清 runtime 痕跡。
// 對齊 prune 拔掉的舊邏輯(只刪 disk 不刪 branch 會造成 re-create 時 branch 已落後 base)。
export async function resetPipelineRoute(hash: string, pipelineId: string): Promise<Response> {
  if (orchestrator.isRunning(hash, pipelineId)) {
    return err("invalid_path", "Pipeline 還在跑,先 pause 再重置", 409);
  }
  return withPipeline(hash, pipelineId, async (project, pipelineRaw) => {
    const pipeline = pipelineRaw as {
      branch?: string;
      tickets?: Array<Record<string, unknown>>;
      [k: string]: unknown;
    };

    // 1. 刪 worktree dir(throw-safe)
    const wtRes = await worktree.removeQuiet(project.path, pipelineId);
    if (!wtRes.ok) return err("internal_error", wtRes.error ?? "worktree remove failed", 500);

    // 2. 刪 branch ref(冪等;不存在當成功)
    const branchName = pipeline.branch ?? `pipeline/${pipelineId}`;
    if (project.hasGit) {
      const br = await git.deleteBranchForce(project.path, branchName);
      if (!br.ok) {
        console.warn(`[resetPipeline ${pipelineId}] deleteBranch failed: ${br.error}`);
        // not fatal — branch 刪不掉(可能有 worktree lock 殘留),user 可手動清
      }
    }

    // 3. reset pipeline state + tickets
    await pipelineDir.mutatePipeline(project.path, pipelineId, (p) => {
      const tickets = (p.tickets ?? []).map((t) => {
        const status = t.status;
        const isTerminal =
          status === "done" || status === "failed" ||
          status === "failed_iter_limit" || status === "failed_transient";
        if (!isTerminal) return t;
        const { iter: _i, commits: _c, liveLog: _l, reason: _r, ...rest } = t;
        void _i; void _c; void _l; void _r;
        return { ...rest, status: "draft" };
      });
      return { ...p, state: "planning", tickets };
    }, {
      source: "user-action",
      sourceDetail: "POST /pipelines/:id/reset",
    });

    return ok({ ok: true });
  }, { requireInit: false });
}

// GET /api/projects/:hash/config — 回完整四欄(含 fallback 預設)
