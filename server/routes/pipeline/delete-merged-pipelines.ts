import * as pipelineStore from '../../lib/domain/pipeline';
import * as git from '../../lib/io/git';
import * as worktree from '../../lib/io/git/worktree';
import * as orchestrator from '../../lib/runner/orchestrator';
import { ok, withProject, withUserAudit } from '../_http';

// POST /api/projects/:hash/pipelines/delete-merged
// Bulk:刪掉 project 內所有 state==='merged' 的 pipeline,cascade = worktree + branch + pipeline.json。
// merged 的 commit 都已在 base,刪 branch 安全;但 VP 側 spec/QA/iter 紀錄會一起消失。
// best-effort:單條某步失敗不阻斷其他;running/queued 跳過(skipped_active,跟單條 delete 同 guard)。
// cascade 三步刻意對齊 delete-pipeline.ts(那條另有 404 / notif / partial 語意,bulk 這層不需要)。
// 回 { deleted, partial, skipped_active, failed }:
//   deleted        — pipeline.json 已刪(rail 卡片消失),worktree + branch 也都清乾淨
//   partial        — 卡片已消失,但 worktree / branch 有殘留(多半 Windows file lock,可手動補)
//   skipped_active — running / queued,跳過(先 stop 才能刪)
//   failed         — pipeline.json 刪不掉(卡片還在)
export async function deleteMergedPipelines(hash: string): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "project.pipelines.deleteMerged" }, async () => {
      const pipelines = await pipelineStore.listPipelines(project.path) as Array<{
        id: string;
        state?: string;
        branch?: string;
      }>;
      const deleted: string[] = [];
      const partial: Array<{ pipelineId: string; error: string }> = [];
      const skipped_active: string[] = [];
      const failed: Array<{ pipelineId: string; error: string }> = [];

      for (const p of pipelines) {
        if (p.state !== "merged") continue;
        const pid = p.id;
        if (orchestrator.isRunning(hash, pid) || orchestrator.isQueued(hash, pid)) {
          skipped_active.push(pid);
          continue;
        }
        const branchName = typeof p.branch === "string" ? p.branch : null;
        const cleanupErrs: string[] = [];

        // 1. worktree(dir + prune)
        try {
          const r = await worktree.removeQuiet(project.path, pid);
          if (!r.ok) cleanupErrs.push(`worktree:${r.error}`);
        } catch (e) {
          cleanupErrs.push(`worktree:${String(e)}`);
        }
        // 2. branch -D(沒 git / 沒 branch 名跳過,不算錯)
        if (project.hasGit && branchName) {
          try {
            const r = await git.deleteBranchForce(project.path, branchName);
            if (!r.ok) cleanupErrs.push(`branch:${r.error}`);
          } catch (e) {
            cleanupErrs.push(`branch:${String(e)}`);
          }
        }
        // 3. pipeline.json(卡片本體)
        let jsonOk = false;
        try {
          jsonOk = pipelineStore.deletePipeline(project.path, pid);
          if (!jsonOk) cleanupErrs.push("json:not found");
        } catch (e) {
          cleanupErrs.push(`json:${String(e)}`);
        }

        if (!jsonOk) {
          failed.push({ pipelineId: pid, error: cleanupErrs.join(";") }); // 卡片還在
        } else if (cleanupErrs.length) {
          partial.push({ pipelineId: pid, error: cleanupErrs.join(";") }); // 卡片消失但有殘留
        } else {
          deleted.push(pid);
        }
      }

      return ok({ deleted, partial, skipped_active, failed });
    }), { requireInit: false });
}
