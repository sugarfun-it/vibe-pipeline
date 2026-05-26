import { existsSync } from 'node:fs';
import * as git from '../../lib/git';
import * as worktree from '../../lib/git/worktree';
import { ok, err, withPipeline } from '../_http';

// POST /api/projects/:hash/pipelines/:id/worktree/cleanup
// 清掉「已 merged」pipeline 的 worktree dir(只清磁碟,不動 pipeline.json / branch / state)。
// 用 git worktree remove --force + fallback rmSync + prune(removeQuiet 已包好)。
// 防呆:未 merged 一律 409,避免 user 不小心把還沒落地的改動砍掉。
// 冪等:worktree 已不存在(被砍過 / 沒建過)回 removed:false,200。
export async function cleanupWorktree(hash: string, pipelineId: string): Promise<Response> {
  return withPipeline(hash, pipelineId, async (project, pipelineRaw) => {
    const pipeline = pipelineRaw as { state?: string; branch?: string; baseBranch?: string };
    const wtPath = worktree.worktreePath(project.path, pipelineId);
    const existed = existsSync(wtPath);

    // 未 merged 不准砍 — state SSOT,降一層用 git merge-base --is-ancestor 二次確認
    if (pipeline.state !== "merged") {
      const branchName = pipeline.branch ?? `pipeline/${pipelineId}`;
      const baseBranch = pipeline.baseBranch ?? "main";
      let mergedByGit = false;
      if (project.hasGit) {
        const r = await git.isAncestor(project.path, branchName, baseBranch);
        if (r.ok && r.isAncestor) mergedByGit = true;
      }
      if (!mergedByGit) {
        return err("not_merged", "pipeline 尚未 merge,不能砍 worktree", 409);
      }
    }

    if (!existed) {
      // 冪等:dir 不在,順手 prune 清 git metadata(removeQuiet 內部會處理)
      const r = await worktree.removeQuiet(project.path, pipelineId);
      if (!r.ok) return err("internal_error", r.error ?? "worktree prune failed", 500);
      return ok({ removed: false, path: wtPath });
    }

    const r = await worktree.removeQuiet(project.path, pipelineId);
    if (!r.ok) return err("internal_error", r.error ?? "worktree remove failed", 500);
    return ok({ removed: true, path: wtPath });
  }, { requireInit: false });
}
