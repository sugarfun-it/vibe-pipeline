import { existsSync } from 'node:fs';
import * as auditLog from '../../lib/auditLog';
import * as worktree from '../../lib/git/worktree';
import { revealFolder } from '../../lib/dialog';
import { ok, err, withProject } from '../_http';

// GET /api/projects/:hash/pipelines/:id/audit?limit=50
// 回該 pipeline 最近 N 筆 state_change audit entry(降冪,最新在最前)。
// 給 RunHistory drawer 顯示「狀態變動歷史」timeline。
export async function listPipelineAudit(hash: string, pipelineId: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => {
    const limitRaw = new URL(req.url).searchParams.get("limit");
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? Math.min(500, parseInt(limitRaw, 10)) : 50;
    return ok(auditLog.listAudit(project.path, pipelineId, limit));
  }, { requireInit: false });
}

// GET /api/projects/:hash/audit?type=user_action&action=&pipelineId=&ticketId=&limit=

export async function revealWorktree(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) => {
    const path = worktree.worktreePath(project.path, pipelineId);
    if (!existsSync(path)) {
      return err("not_found", `Worktree 還沒建立(pipeline 還沒跑過)`, 404);
    }
    await revealFolder(path);
    return ok({ ok: true, path });
  }, { requireInit: false });
}
