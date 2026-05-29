import * as pipelineStore from "../lib/domain/pipeline";
import * as orchestrator from "../lib/runner/orchestrator";
import * as syncJob from "../lib/runner/syncJob";
import * as worktree from "../lib/io/git/worktree";
import { ok, err, withProject, withPipeline, withUserAudit } from "./_http";
import { detectVia } from "./projects";

// GET sync 狀態:回 worktree 落後 base 幾個 commit
// 給前端 chip 用,polling 1 次/3s 由前端控
export async function syncStatus(hash: string, pipelineId: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!project.hasGit) return ok({ behind: null });
    return withPipeline(hash, pipelineId, async (_p, plRaw) => {
      const baseBranch = (plRaw as { baseBranch?: string }).baseBranch || "main";
      return ok({ behind: await worktree.behindBaseCount(project.path, pipelineId, baseBranch), baseBranch });
    }, { requireInit: false });
  }, { requireInit: false });
}

// POST /sync:嘗試直接 git merge(<1s,大多狀況不用 AI)
// - 沒落後 → 立即 done
// - clean merge → 立即 done
// - 衝突 → 寫 syncJob.state=conflict_await,前端跳 modal 讓 user 決定要不要 AI 解
// - merge 失敗(非衝突)→ syncJob.failed
// 前置:state ∈ {ready, paused, planning, failed} 才允許,running/queued/merged 擋
export async function syncPipeline(hash: string, pipelineId: string, req?: Request): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.sync", pipelineId, via: detectVia(req) }, async () => {
      if (!project.hasGit) return err("invalid_path", "Project 沒 .git/", 400);
      if (orchestrator.isRunning(hash, pipelineId)) {
        return err("invalid_path", "Pipeline 在跑,先 pause 才能 sync", 409);
      }
      const pipeline = (await pipelineStore.readPipeline(project.path, pipelineId)) as {
        state?: string;
        branch?: string;
        baseBranch?: string;
        [k: string]: unknown;
      } | null;
      if (!pipeline) return err("not_found", `Pipeline not found: ${pipelineId}`, 404);
      if (pipeline.state === "queued") return err("invalid_path", "Pipeline 在排隊,等開跑後 pause 才能 sync", 409);

      const res = await syncJob.startSync({ projectPath: project.path, projectHash: hash, pipelineId });
      if (!res.ok) return err("invalid_path", res.error, 409);
      return ok({ ok: true, state: res.state, behind: res.behind, conflictFiles: res.conflictFiles });
    }), { requireInit: false });
}

// POST /sync/ai:user 在 conflict_await 狀態確認讓 AI 解衝突
export async function syncConfirmAi(hash: string, pipelineId: string, req?: Request): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.sync.confirmAi", pipelineId, via: detectVia(req) }, async () => {
      const res = await syncJob.confirmAi({ projectPath: project.path, projectHash: hash, pipelineId });
      if (!res.ok) return err("invalid_path", res.error, 409);
      return ok({ ok: true });
    }), { requireInit: false });
}

// POST /sync/cancel:取消 sync(conflict_await 階段 = 不解了 / ai_running 階段 = 殺 AI)
export async function syncCancel(hash: string, pipelineId: string, req?: Request): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.sync.cancel", pipelineId, via: detectVia(req) }, async () => {
      const res = await syncJob.cancelSync({ projectPath: project.path, projectHash: hash, pipelineId });
      if (!res.ok) return err("invalid_path", res.error, 409);
      return ok({ ok: true });
    }), { requireInit: false });
}

// POST /sync/dismiss:user 看完 done / failed 狀態後 dismiss(把 syncJob 從 pipeline.json 拿掉)
// 不負責清 git 狀態(done 已經乾淨;failed 已經 abort 過)
export async function syncDismiss(hash: string, pipelineId: string): Promise<Response> {
  return withPipeline(hash, pipelineId, async (project, pRaw) => {
    const p = pRaw as { syncJob?: { state?: string }; [k: string]: unknown };
    if (!p.syncJob) return ok({ ok: true });
    if (p.syncJob.state === "ai_running" || p.syncJob.state === "merging") {
      return err("invalid_path", "Sync 還在跑,先 cancel", 409);
    }
    const { syncJob: _drop, ...rest } = p;
    void _drop;
    await pipelineStore.writePipeline(project.path, pipelineId, rest, {
      source: "api-sync-dismiss",
      sourceDetail: "user dismissed syncJob",
      prevStateHint: typeof (p as { state?: string }).state === "string" ? (p as { state: string }).state : undefined,
    });
    return ok({ ok: true });
  }, { requireInit: false });
}
