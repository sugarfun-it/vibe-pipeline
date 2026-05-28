import { existsSync } from 'node:fs';
import * as pipelineStore from '../../lib/domain/pipeline';
import * as git from '../../lib/io/git';
import * as worktree from '../../lib/io/git/worktree';
import { ok, withProject, withUserAudit } from '../_http';

// POST /api/projects/:hash/worktrees/cleanup-merged
// Bulk sweep:掃 project 所有 pipeline,把 state==='merged' 的 worktree 一次清掉。
// best-effort:單條失敗不阻斷其他。回 { cleaned, skipped_not_merged, failed }。
// 只清磁碟,pipeline.json / branch 全不動。冪等:已清過的 worktree 不會出現在 cleaned。
export async function cleanupMergedWorktrees(hash: string): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "project.worktrees.cleanupMerged" }, async () => {
      const pipelines = await pipelineStore.listPipelines(project.path) as Array<{
        id: string;
        state?: string;
        branch?: string;
        baseBranch?: string;
      }>;
      const cleaned: Array<{ pipelineId: string; path: string }> = [];
      const skipped_not_merged: string[] = [];
      const failed: Array<{ pipelineId: string; error: string }> = [];

      for (const p of pipelines) {
        const pid = p.id;
        let isMerged = p.state === "merged";
        if (!isMerged && project.hasGit) {
          const branchName = p.branch ?? `pipeline/${pid}`;
          const baseBranch = p.baseBranch ?? "main";
          const r = await git.isAncestor(project.path, branchName, baseBranch);
          if (r.ok && r.isAncestor) isMerged = true;
        }
        if (!isMerged) {
          skipped_not_merged.push(pid);
          continue;
        }
        const wtPath = worktree.worktreePath(project.path, pid);
        const existed = existsSync(wtPath);
        try {
          const r = await worktree.removeQuiet(project.path, pid);
          if (!r.ok) {
            failed.push({ pipelineId: pid, error: r.error ?? "worktree remove failed" });
            continue;
          }
          if (existed) cleaned.push({ pipelineId: pid, path: wtPath });
          // existed=false 不算 cleaned(磁碟本來就沒東西)
        } catch (e) {
          failed.push({ pipelineId: pid, error: String(e) });
        }
      }

      return ok({ cleaned, skipped_not_merged, failed });
    }), { requireInit: false });
}
