import * as worktree from "../lib/git/worktree";
import * as runLog from "../lib/runner/runLog";
import { ok, err, withProject, withPipeline } from "./_http";

// GET /api/projects/:hash/pipelines/:id/diff-stat
// 給 UI polling 顯示「+N -M / K files」用,讓 user 在 runner 跑大任務時看到 worktree 真的有在改
export async function pipelineDiffStat(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!project.hasGit) return ok(null);
    return withPipeline(hash, pipelineId, async (_p, plRaw) => {
      const baseBranch = (plRaw as { baseBranch?: string }).baseBranch || "main";
      return ok(await worktree.diffStat(project.path, pipelineId, baseBranch));
    }, { requireInit: false });
  }, { requireInit: false });
}

// GET /api/projects/:hash/pipelines/:id/diff
// 完整 diff:檔案列表 + raw unified diff 文字。前端自己 parse 顯示。
export async function pipelineDiff(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!project.hasGit) return ok(null);
    return withPipeline(hash, pipelineId, async (_p, plRaw) => {
      const baseBranch = (plRaw as { baseBranch?: string }).baseBranch || "main";
      return ok(await worktree.fullDiff(project.path, pipelineId, baseBranch));
    }, { requireInit: false });
  }, { requireInit: false });
}

export async function listPipelineRuns(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) => ok(await runLog.listRuns(project.path, pipelineId)), { requireInit: false });
}

export async function getPipelineRun(hash: string, pipelineId: string, filename: string): Promise<Response> {
  return withProject(hash, async (p) => {
    const run = await runLog.getRun(p.path, pipelineId, filename);
    return run ? ok(run) : err("not_found", `Run log not found: ${filename}`, 404);
  }, { requireInit: false });
}
