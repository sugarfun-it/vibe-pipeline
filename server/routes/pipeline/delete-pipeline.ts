import * as pipelineStore from '../../lib/domain/pipeline';
import * as git from '../../lib/io/git';
import * as orchestrator from '../../lib/runner/orchestrator';
import * as worktree from '../../lib/io/git/worktree';
import * as notifs from '../../lib/remote/notifs';
import { ok, err, withProject, withUserAudit } from '../_http';

// DELETE /api/projects/:hash/pipelines/:id — cascade 清 worktree + branch + json
// 流程(每步可獨立失敗,partial 結果回給 caller 不靜默吞):
//   1. preflight:running / queued 拒絕(STATE_GUARD「先 stop」)
//   2. worktree.removeQuiet(worktree dir + git worktree prune)
//   3. git branch -D pipeline/<name>
//   4. rm pipeline.json
//   5. emit notif pipeline_deleted
// 任一步失敗 → 仍回 200(部分清完),body.partial=true + body.steps 標哪步壞
// 完全 not_found(連 pipeline.json 都沒)→ 404
export async function deletePipeline(hash: string, id: string): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.delete", pipelineId: id }, async () => {
    // preflight — running / queued 拒絕
    if (orchestrator.isRunning(hash, id)) {
      return err("invalid_path", "Pipeline 在 running,先 stop 才能刪", 409);
    }
    if (orchestrator.isQueued(hash, id)) {
      return err("invalid_path", "Pipeline 在 queued,先 stop(取消排隊)才能刪", 409);
    }

    // 撈 pipeline.json 拿 branch 名 — 若連 pipeline.json 都沒,worktree / branch 也大概沒(走 best-effort)
    const pipeline = (await pipelineStore.readPipeline(project.path, id)) as {
      name?: string;
      branch?: string;
    } | null;
    const branchName = typeof pipeline?.branch === "string" ? pipeline.branch : null;
    const pipelineName = typeof pipeline?.name === "string" ? pipeline.name : id;

    type StepResult = { ok: boolean; error?: string; skipped?: boolean };
    const steps: { worktree: StepResult; branch: StepResult; json: StepResult } = { worktree: { ok: false }, branch: { ok: false }, json: { ok: false } };

    // 1. worktree(dir + prune)— 失敗繼續,後面 branch / json 仍要試
    try {
      const r = await worktree.removeQuiet(project.path, id);
      steps.worktree = r.ok ? { ok: true } : { ok: false, error: r.error };
    } catch (e) {
      steps.worktree = { ok: false, error: String(e) };
    }

    // 2. git branch -D — 沒 .git / 沒 branch name 都 skip(算 ok)
    if (!project.hasGit) {
      steps.branch = { ok: true, skipped: true };
    } else if (!branchName) {
      steps.branch = { ok: true, skipped: true, error: "pipeline.json 沒 branch 欄位,跳過 branch 刪除" };
    } else {
      try {
        const r = await git.deleteBranchForce(project.path, branchName);
        steps.branch = r.ok ? { ok: true } : { ok: false, error: r.error };
      } catch (e) {
        steps.branch = { ok: false, error: String(e) };
      }
    }

    // 3. pipeline.json — 唯一一條「沒就 404」的;前 2 步即使壞了 json 還是要試
    let jsonExisted = false;
    try {
      const removed = pipelineStore.deletePipeline(project.path, id);
      jsonExisted = removed;
      steps.json = removed ? { ok: true } : { ok: false, error: "pipeline.json not found" };
    } catch (e) {
      steps.json = { ok: false, error: String(e) };
    }

    // 若連 pipeline.json 都沒(也許 worktree 也是空),回 404 較直觀;但若 worktree 確實砍掉
    // 也算「有清到」→ 走 partial 路徑(代表 user 救殘留)。判準:三步全 fail / skip 才 404
    if (!jsonExisted && !steps.worktree.ok && (steps.branch.skipped || !steps.branch.ok)) {
      return err("not_found", `Pipeline not found: ${id}`, 404);
    }

    const allOk = steps.worktree.ok && steps.branch.ok && steps.json.ok;
    const partial = !allOk;

    // 4. emit notif — partial 走 warn sev,clean 走預設 muted
    try {
      const failedSteps: string[] = [];
      if (!steps.worktree.ok) failedSteps.push("worktree");
      if (!steps.branch.ok) failedSteps.push("branch");
      if (!steps.json.ok) failedSteps.push("json");
      notifs.emit(project.path, {
        type: "pipeline_deleted",
        title: partial
          ? `Pipeline 刪除部分失敗:${pipelineName}`
          : `Pipeline 已刪除:${pipelineName}`,
        sub: partial ? `失敗步驟:${failedSteps.join(", ")}` : undefined,
        pipelineId: id,
        sev: partial ? "info" : "muted",
      });
    } catch (e) {
      console.warn(`[delete ${id}] notif emit failed:`, e);
    }

    return ok({
      ok: true,
      partial,
      steps,
      ...(partial
        ? {
            message: `部分清理失敗,user 請手動補:${[
              !steps.worktree.ok && `worktree(${steps.worktree.error})`,
              !steps.branch.ok && `branch(${steps.branch.error})`,
              !steps.json.ok && `json(${steps.json.error})`,
            ]
              .filter(Boolean)
              .join(";")}`,
          }
        : {}),
    });
  }));
}
