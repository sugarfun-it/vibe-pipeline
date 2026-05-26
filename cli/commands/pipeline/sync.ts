import * as pipelineDir from "../../../server/lib/pipelineDir";
import * as syncJob from "../../../server/lib/runner/syncJob";
import * as auditLog from "../../../server/lib/auditLog";
import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import { post } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";

// Sync:把 base branch merge 進 pipeline worktree。
//   vbpl pipeline sync <id>           → 啟動(試 git merge,衝突跳 conflict_await)
//   vbpl pipeline sync <id> --ai      → conflict_await 階段確認讓 AI 解
//   vbpl pipeline sync <id> --cancel  → 任 active 狀態取消(merge --abort)
//   vbpl pipeline sync <id> --dismiss → 收尾 done/failed,清 syncJob
export async function pipelineSync(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline sync <id> [--ai|--cancel|--dismiss]");
  await ensureBackend();

  const wantAi = args.flags["ai"] === true;
  const wantCancel = args.flags["cancel"] === true;
  const wantDismiss = args.flags["dismiss"] === true;

  if (wantAi) {
    // spawn AI child → 必須走 HTTP 讓 backend 養 child
    await post(`/api/projects/${proj.hash}/pipelines/${id}/sync/ai`);
    if (isJsonMode()) { okJson({ confirmed: true }); return; }
    print(`AI conflict resolution started for ${id}. Watch: vbpl pipeline status ${id}`);
    return;
  }
  if (wantCancel) {
    // 可能要 kill 已 spawn AI → 必須走 HTTP
    await post(`/api/projects/${proj.hash}/pipelines/${id}/sync/cancel`);
    if (isJsonMode()) { okJson({ cancelled: true }); return; }
    print(`Sync cancelled. worktree restored via git merge --abort.`);
    return;
  }
  if (wantDismiss) {
    const p = (await pipelineDir.readPipeline(proj.path, id)) as { syncJob?: { state?: string }; [k: string]: unknown } | null;
    if (!p) fail("NOT_FOUND", `Pipeline not found: ${id}`);
    if (!p.syncJob) {
      if (isJsonMode()) { okJson({ dismissed: true, noop: true }); return; }
      print("No syncJob to dismiss.");
      return;
    }
    if (p.syncJob.state === "ai_running" || p.syncJob.state === "merging") {
      fail("STATE_GUARD", `Sync still running (state=${p.syncJob.state}); use --cancel first`);
    }
    const { syncJob: _drop, ...rest } = p;
    void _drop;
    await pipelineDir.writePipeline(proj.path, id, rest, {
      source: "cli-sync-dismiss",
      sourceDetail: "dismiss syncJob",
      prevStateHint: typeof (p as { state?: string }).state === "string" ? (p as { state: string }).state : undefined,
    });
    if (isJsonMode()) { okJson({ dismissed: true }); return; }
    print("syncJob dismissed.");
    return;
  }

  // Default action:啟動 sync(CLI 直接呼 lib,不經 backend route → 自己 audit)
  const handle = auditLog.beginUserAction({
    projectPath: proj.path,
    action: "pipeline.sync",
    pipelineId: id,
  });
  let res: Awaited<ReturnType<typeof syncJob.startSync>>;
  try {
    res = await syncJob.startSync({
      projectPath: proj.path,
      projectHash: proj.hash,
      pipelineId: id,
    });
  } catch (e) {
    handle.error(String(e), "thrown");
    throw e;
  }
  if (!res.ok) {
    handle.error(res.error, "state_guard");
    fail("STATE_GUARD", res.error);
  }
  handle.ok();

  if (isJsonMode()) {
    okJson({ state: res.state, behind: res.behind, conflictFiles: res.conflictFiles });
    return;
  }
  if (res.state === "done") {
    print(`✓ Sync done (was ${res.behind ?? 0} commits behind, git merge clean).`);
  } else if (res.state === "conflict_await") {
    print(`⚠ Conflict: ${res.conflictFiles?.length ?? 0} files. Decide:`);
    print(`  vbpl pipeline sync ${id} --ai      (let AI resolve)`);
    print(`  vbpl pipeline sync ${id} --cancel  (abort merge)`);
    if (res.conflictFiles && res.conflictFiles.length > 0) {
      print("Conflicting files:");
      for (const f of res.conflictFiles.slice(0, 12)) print(`  - ${f}`);
      if (res.conflictFiles.length > 12) print(`  …and ${res.conflictFiles.length - 12} more`);
    }
  } else if (res.state === "failed") {
    print(`✕ Sync failed.`);
  } else {
    print(`Sync state: ${res.state}`);
  }
}
