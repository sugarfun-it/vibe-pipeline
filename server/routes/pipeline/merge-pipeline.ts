import { triggerMerge, autoMergeNoAI } from '../../lib/services/pipelineMerge';
import { ok, err, withProject, withUserAudit } from '../_http';

// AI merge(ticket-based):append 一張 mode=merge synthetic ticket 進 pipeline,
// 然後觸發 runner 接管。merge ticket 由 sub-agent 在 main repo 跑(不在 worktree)。
// 完成後 runner 主 agent 看到 mode=merge done,把 pipeline.state 設 merged + mergeCommit。
// 真實邏輯抽到 lib/services/pipelineMerge.triggerMerge,handler 跟 auto-trigger 共用。
// 2026-05-13:跟 auto-merge 對稱化 — 先試 backend git merge --no-ff
// clean → 回 {mode:"mechanical", mergeCommit};撞衝突 → fallback triggerMerge(AI)回 {mode:"ai", ticketId}
// 其他失敗(dirty/no_git/...)→ 對應 error code
export async function mergePipeline(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.merge", pipelineId }, async () => {

  // 第 1 段:純 git merge
  const mech = await autoMergeNoAI({ projectPath: project.path, projectHash: hash, pipelineId, hasGit: project.hasGit });

  if (mech.ok) {
    // alreadyMerged 是 no-op,mergeCommit 不存在;clean merge 才會有 mergeCommit
    if ("mergeCommit" in mech && mech.mergeCommit) {
      return ok({ ok: true, mode: "mechanical" as const, mergeCommit: mech.mergeCommit, ...(mech.depInstall ? { depInstall: mech.depInstall } : {}) });
    }
    return ok({ ok: true, mode: "mechanical" as const, alreadyMerged: true });
  }

  // 衝突 → fallback AI 走全套 ticket-based merge(同舊 manual /merge 路徑)
  if (mech.reason === "conflict") {
    const ai = await triggerMerge({ projectPath: project.path, projectHash: hash, pipelineId, hasGit: project.hasGit });
    if (ai.ok) {
      return ok({ ok: true, mode: "ai" as const, ticketId: ai.ticketId, conflictFiles: "conflictFiles" in mech ? mech.conflictFiles : [] });
    }
    // AI 升級也失敗 → 把 AI 那條 reason 映射回 HTTP
    switch (ai.reason) {
      case "not_found":  return err("not_found", ai.error, 404);
      case "no_git":     return err("invalid_path", ai.error, 400);
      case "running":    return err("invalid_path", ai.error, 409);
      case "working_tree_dirty":
        return Response.json({ ok: false, error: { code: "invalid_path", message: ai.error, details: ai.details } }, { status: 409 });
      case "append_failed": return err("invalid_path", ai.error, 409);
      case "spawn_failed":  return err("invalid_path", ai.error, 500);
    }
  }

  // mech 其他 reason(dirty / git_error / not_found / running)— 非 AI 能解,直接回錯
  switch (mech.reason) {
    case "not_found":         return err("not_found", mech.error, 404);
    case "no_git":            return err("invalid_path", mech.error, 400);
    case "running":           return err("invalid_path", mech.error, 409);
    case "working_tree_dirty":return err("invalid_path", mech.error, 409);
    case "git_error":         return err("invalid_path", mech.error, 500);
  }
  }));
}
