import { resolve } from "node:path";
import { existsSync } from "node:fs";
import * as projectStore from "../lib/projectStore";
import * as pipelineDir from "../lib/pipelineDir";
import * as git from "../lib/git";
import * as orchestrator from "../lib/runner/orchestrator";
import * as worktree from "../lib/git/worktree";
import * as notifs from "../lib/notifs/store";
import * as auditLog from "../lib/auditLog";
import { triggerMerge, autoMergeNoAI } from "../lib/pipelineMerge";
import { pickFolder, revealFolder } from "../lib/dialog";
import { projectHash } from "../lib/hash";
import { isExistingDirectory } from "../lib/fs";
import { ok, err, withProject, withPipeline, withJsonBody, withUserAudit } from "./_http";
import type { ApiErrorCode, Project } from "../../shared/types";

// validProjectPath 是 isExistingDirectory 在 routes 層的 alias,維持原本呼叫點不動。
const validProjectPath = isExistingDirectory;

// 從 Request UA header 判 trigger source。vbpl CLI 自帶 "vbpl-cli";browser 含 "Mozilla"。
// 缺 req(內部 trigger / 老 caller 未傳)= undefined,audit 留空欄。
export function detectVia(req?: Request): auditLog.ViaKind | undefined {
  if (!req) return undefined;
  const ua = req.headers.get("user-agent") || "";
  if (ua.startsWith("vbpl-cli")) return "cli";
  if (ua.includes("Mozilla")) return "browser";
  return "other";
}

// 包 mutation handler:開頭寫 pending 一筆,Response 看 ok 寫 ok / 看 error envelope 寫 error。
// caller 不必手動 finalize。throw 的話 catch 並重 throw 給上層 500。
export async function listRecent(): Promise<Response> {
  const items = await projectStore.listRecent();
  return ok(items);
}

// DELETE /api/projects/:hash — 從 recent list 移除一筆 entry(SSOT 在 state.json)。
// 冪等:hash 不存在仍回 200 + removed:false。只動 state.json,不刪 project fs。
// active project 的「不准刪」由前端把 X disabled 處理,backend 不擋 — 後端只負責 state 操作。
export async function removeRecent(hash: string): Promise<Response> {
  const r = await projectStore.removeRecent(hash);
  return ok({ removed: r.removed });
}

export async function selectFolder(): Promise<Response> {
  let path: string | null;
  try {
    path = await pickFolder();
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
  if (!path) return err("dialog_cancelled", "User cancelled folder selection");
  if (!validProjectPath(path)) return err("invalid_path", `Not a directory: ${path}`);
  return ok({ path: resolve(path) });
}

export async function openProject(req: Request): Promise<Response> {
  return withJsonBody(req, async (body) => {
    const path = body.path as string | undefined;
    if (!path || !validProjectPath(path)) return err("invalid_path", `Invalid path: ${path}`);
    const project = await projectStore.open(path);
    return ok(project);
  });
}

// Client-side folder picker:列當前路徑下的子資料夾 + 系統 drives(Windows)/ home(POSIX)
// 給遠端(Tailscale 手機)用,native picker 跑在 host 上看不到所以靠這個 browse
export async function browseFolder(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const queryPath = url.searchParams.get("path");

  const { homedir } = await import("node:os");
  const { readdirSync, statSync, existsSync } = await import("node:fs");
  const { resolve: pathResolve, dirname, sep } = await import("node:path");

  // 沒帶 path → home dir(Windows / POSIX 都對)
  const target = queryPath && queryPath.trim() ? pathResolve(queryPath.trim()) : homedir();

  if (!existsSync(target)) {
    return err("invalid_path", `路徑不存在:${target}`, 404);
  }
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(target);
  } catch (e) {
    return err("invalid_path", `stat 失敗:${String(e)}`, 400);
  }
  if (!st.isDirectory()) {
    return err("invalid_path", `不是資料夾:${target}`, 400);
  }

  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = readdirSync(target, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".")) // 跳隱藏檔
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (e) {
    return err("permission_denied", `讀目錄失敗(權限?):${String(e)}`, 403);
  }

  // 算 parent;root(C:\ 或 /)沒 parent
  const parent = (() => {
    const p = dirname(target);
    if (p === target) return null;
    return p;
  })();

  // Windows:列可用磁碟給 user 切(C:\ 沒辦法 ↑ 到別的磁碟)
  // POSIX:'/' 是唯一 root,不需要
  const drives: string[] = [];
  if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = letter + ":\\";
      try {
        if (existsSync(root)) drives.push(root);
      } catch {
        // ignore
      }
    }
  }

  return ok({
    path: target,
    parent,
    sep,
    entries,
    home: homedir(),
    drives,
  });
}

export async function status(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    // 順帶夾 config 摘要(base_branch / cost_limit_usd),SettingsPopover 顯目前值用
    let defaultBaseBranch: string | undefined;
    let costLimitUsd: number | undefined;
    if (project.hasInit) {
      try {
        const resolved = await pipelineDir.getResolvedDefaults(project.path);
        defaultBaseBranch = resolved.base_branch;
        costLimitUsd = resolved.cost_limit_usd;
      } catch {
        // ignore — config 讀失敗就 fallback
      }
    }
    return ok({ ...project, defaultBaseBranch, costLimitUsd } satisfies Project & { defaultBaseBranch?: string; costLimitUsd?: number });
  }, { requireInit: false });
}

export async function init(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!validProjectPath(project.path)) return err("invalid_path", `Path missing: ${project.path}`);
    // pipelineDir.init 已 idempotent(2026-05-12 改):.vibe-pipeline/ 已存在但內容缺 → 補齊,不再 throw already_initialized。
    try { await pipelineDir.init(project.path); } catch (e) { return err("internal_error", String(e), 500); }
    return ok(await projectStore.findByHash(hash));
  }, { requireInit: false });
}

export async function listPipelines(hash: string): Promise<Response> {
  return withProject(hash, async (project) => ok(await pipelineDir.listPipelines(project.path)));
}

export async function createPipeline(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const name = (body.name as string) || "pipeline";
  const id = (body.id as string) || pipelineDir.generatePipelineId(name);
  // autoMerge:body 沒帶就讀 project config defaults.auto_merge,有帶就用 body 值(必須是 boolean)
  let autoMerge: boolean;
  if (typeof body.autoMerge === "boolean") {
    autoMerge = body.autoMerge;
  } else {
    const resolved = await pipelineDir.getResolvedDefaults(project.path);
    autoMerge = resolved.auto_merge;
  }
  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch
      : "pipeline/" + name.replace(/[\s/]+/g, "-");
  const state = typeof body.state === "string" && body.state.trim() ? body.state : "planning";
  // createdAt 取 body 值(允許 import 帶舊時間)或 Date.now()
  const data = { ...body, id, name, branch, state, autoMerge, createdAt: typeof body.createdAt === "number" ? body.createdAt : Date.now(), tickets: Array.isArray(body.tickets) ? body.tickets : [] };
  await pipelineDir.writePipeline(project.path, id, data, { source: "api-create-pipeline", sourceDetail: `POST /pipelines name=${name}` });
  return ok(data);
  }));
}

export async function getPipeline(hash: string, id: string): Promise<Response> {
  return withPipeline(hash, id, async (_p, pipeline) => ok(pipeline));
}

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
    const pipeline = (await pipelineDir.readPipeline(project.path, id)) as {
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
      const removed = pipelineDir.deletePipeline(project.path, id);
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

export async function savePipeline(hash: string, id: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const existing = (await pipelineDir.readPipeline(project.path, id)) as {
    state?: string;
  } | null;
  // PUT 不准用來建立新 pipeline(用 POST /pipelines)— 避免 typo 路徑悄悄 upsert
  if (!existing) {
    return err("not_found", `Pipeline not found: ${id}(建立用 POST /pipelines)`, 404);
  }
  // Race guard:running / queued 時禁止 PUT,避免覆蓋 runner 主 agent 正在寫的 iter / commits
  // 或把 queued 狀態踩掉導致 dispatcher 接不到。queued 可走「取消排隊」端點處理。
  if (
    existing.state === "running" ||
    existing.state === "queued"
  ) {
    return err(
      "invalid_path",
      `Pipeline 在 ${existing.state} 狀態,先 pause/取消排隊 才能修改`,
      409
    );
  }
  // 最小 shape 驗證:防止空 body / 半個 body 把整條 pipeline.json 清光
  // (不做完整 spec 驗,只擋明顯壞掉)
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).name !== "string" ||
    typeof (body as Record<string, unknown>).branch !== "string" ||
    !Array.isArray((body as Record<string, unknown>).tickets)
  ) {
    return err(
      "invalid_path",
      "Body 缺必要欄位:name(string)/ branch(string)/ tickets(array)",
      400
    );
  }
  // autoMerge:若 body 有帶必須是 boolean(不接受 undefined → 維持既有值)
  const bodyAutoMerge = (body as Record<string, unknown>).autoMerge;
  if (bodyAutoMerge !== undefined && typeof bodyAutoMerge !== "boolean") {
    return err("invalid_path", "autoMerge 必須為 boolean", 400);
  }
  const data = { ...body, id };
  await pipelineDir.writePipeline(project.path, id, data, {
    source: "api-handler-explicit",
    sourceDetail: "PUT /pipelines/:id",
    prevStateHint: typeof existing.state === "string" ? existing.state : undefined,
  });
  return ok(data);
  }));
}

export async function gitInit(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!validProjectPath(project.path)) return err("invalid_path", `Path missing: ${project.path}`);
    if (git.hasGit(project.path)) return err("already_initialized", `.git already exists in ${project.path}`);
    try { await git.gitInit(project.path); } catch (e) { return err("internal_error", String(e), 500); }
    return ok(await projectStore.findByHash(hash));
  }, { requireInit: false });
}

export async function reveal(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!validProjectPath(project.path)) return err("invalid_path", `Path missing: ${project.path}`);
    try { await revealFolder(project.path); } catch (e) { return err("internal_error", String(e), 500); }
    return ok({ ok: true });
  }, { requireInit: false });
}

export async function runPipeline(hash: string, pipelineId: string, req?: Request): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.run", pipelineId, via: detectVia(req) }, async () => {
    if (!validProjectPath(project.path)) return err("invalid_path", `Path missing: ${project.path}`);
    if (!project.hasGit) return err("invalid_path", "Project 沒 .git/,先 git init 再跑 pipeline");
    // User 顯式按繼續 = 明確要重試:把所有 failed_transient ticket reset 成 paused,
    // 否則 runner 主迴圈規則「遇 failed_transient 立刻暫停」會讓 pipeline 秒退。
    // 設計初衷是「不自動重試燒 token」,但 user 主動點繼續就是 explicit consent。
    try {
      await pipelineDir.mutatePipeline(project.path, pipelineId, (p) => {
        for (const t of p.tickets ?? []) {
          if (t.status === "failed_transient") {
            t.status = "paused";
          }
        }
        return p;
      }, {
        source: "api-run-pipeline",
        sourceDetail: "reset failed_transient → paused on user run",
      });
    } catch (e) {
      console.warn(`[runPipeline] reset failed_transient skipped: ${String(e)}`);
    }
    const r = await orchestrator.start({ projectPath: project.path, projectHash: hash, pipelineId });
    if (!r.ok) {
      // budget_exceeded → 402 Payment Required + body 帶 spent/limit 給前端顯示
      if (r.reason === "budget_exceeded") {
        return Response.json({ ok: false, error: { code: "budget_exceeded" satisfies ApiErrorCode, message: r.error, spent: r.spent, limit: r.limit } }, { status: 402 });
      }
      // 邏輯阻擋(state guard / 已在跑等)用 409 conflict;真正爆炸用 500
      const isConflict = /已在|完成|排隊|merge/.test(r.error);
      return err("invalid_path", r.error, isConflict ? 409 : 500);
    }
    // queued: true 時,前端可立即顯示「排隊中(順位 N)」不等下一輪 poll
    return ok({ ok: true, queued: r.queued ?? false, position: r.position ?? 0 });
  }));
}

// /pause 跟 /stop 共用本 handler。
// 固定立即停止:running 走 SIGKILL + 標 paused;queued 走 cancelQueued。
// 預期沒 body / 不是 JSON 也容忍。
export async function pausePipeline(
  hash: string,
  pipelineId: string,
  _req?: Request
): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "pipeline.pause", pipelineId }, async () => {
    // queued 狀態走 cancelQueued(直接從 queue 拔 + 標 paused);running 走立即停止。
    if (orchestrator.isQueued(hash, pipelineId)) {
      const r = await orchestrator.cancelQueued({ projectPath: project.path, projectHash: hash, pipelineId });
      if (!r.ok) return err("invalid_path", r.error, 409);
      return ok({ ok: true, cancelled: true });
    }

    const r = await orchestrator.stopImmediate({ projectPath: project.path, projectHash: hash, pipelineId });
    if (!r.ok) {
      const code: ApiErrorCode = r.code === "not_found" ? "not_found" : "invalid_path";
      const status = code === "not_found" ? 404 : 409;
      return err(code, r.error, status);
    }
    return ok({ ok: true });
  }));
}

// AI merge(ticket-based):append 一張 mode=merge synthetic ticket 進 pipeline,
// 然後觸發 runner 接管。merge ticket 由 sub-agent 在 main repo 跑(不在 worktree)。
// 完成後 runner 主 agent 看到 mode=merge done,把 pipeline.state 設 merged + mergeCommit。
// 真實邏輯抽到 lib/pipelineMerge.triggerMerge,handler 跟 auto-trigger 共用。
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
// 跨 pipeline / 跨 type query。目前只支援 type=user_action(state_change 走 pipeline-level endpoint)。
export async function listProjectAudit(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "user_action";
    if (type !== "user_action") return err("invalid_path", `unsupported audit type: ${type}`, 400);
    const action = url.searchParams.get("action") ?? undefined;
    const pipelineId = url.searchParams.get("pipelineId") ?? undefined;
    const ticketId = url.searchParams.get("ticketId") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? Math.min(500, parseInt(limitRaw, 10)) : 50;
    return ok(auditLog.listUserActions(project.path, { action, pipelineId, ticketId, limit }));
  }, { requireInit: false });
}

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

// POST /api/projects/:hash/worktrees/cleanup-merged
// Bulk sweep:掃 project 所有 pipeline,把 state==='merged' 的 worktree 一次清掉。
// best-effort:單條失敗不阻斷其他。回 { cleaned, skipped_not_merged, failed }。
// 只清磁碟,pipeline.json / branch 全不動。冪等:已清過的 worktree 不會出現在 cleaned。
export async function cleanupMergedWorktrees(hash: string): Promise<Response> {
  return withProject(hash, async (project) =>
    withUserAudit(project.path, { action: "project.worktrees.cleanupMerged" }, async () => {
      const pipelines = await pipelineDir.listPipelines(project.path) as Array<{
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
export async function getConfig(hash: string): Promise<Response> {
  return withProject(hash, async (project) => ok({ defaults: await pipelineDir.getResolvedDefaults(project.path) }));
}

// 回 400 with field-level error,body 結構 { ok:false, error:{ code, message, field } }
function fieldErr(field: string, message: string): Response {
  return Response.json({ ok: false, error: { code: "invalid_path" satisfies ApiErrorCode, message, field } }, { status: 400 });
}

// PUT /api/projects/:hash/config — 接 partial body,只認可白名單欄位 + 型別驗證
export async function updateConfig(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const cur = await pipelineDir.readConfig(project.path);
  const nextDefaults: NonNullable<pipelineDir.ProjectConfig["defaults"]> = {
    ...(cur.defaults ?? {}),
  };
  const incomingDefaults = (body.defaults ?? {}) as Record<string, unknown>;

  // max_parallel:number,clamp [1,8](保留既有寬容行為:壞值 → DEFAULT 而不報錯)
  if ("max_parallel" in incomingDefaults) {
    const v = incomingDefaults.max_parallel;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return fieldErr("max_parallel", "max_parallel 必須為 number");
    }
    nextDefaults.max_parallel = pipelineDir.clampMaxParallel(v);
  }

  // default_base_branch:string,trim 後非空
  if ("default_base_branch" in incomingDefaults) {
    const v = incomingDefaults.default_base_branch;
    if (typeof v !== "string") {
      return fieldErr("default_base_branch", "default_base_branch 必須為 string");
    }
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      return fieldErr("default_base_branch", "default_base_branch 不可為空字串");
    }
    nextDefaults.base_branch = trimmed;
  }

  // merge_strategy 已鎖死(merge --no-ff),不接受設定;若 body 有此欄位 silently ignore
  // (舊呼叫端不擋,但寫回 config 時不留)

  // cost_limit_usd:number >= 0
  if ("cost_limit_usd" in incomingDefaults) {
    const v = incomingDefaults.cost_limit_usd;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return fieldErr("cost_limit_usd", "cost_limit_usd 必須為 number");
    }
    if (v < 0) {
      return fieldErr("cost_limit_usd", "cost_limit_usd 必須 >= 0(0 = 無限)");
    }
    nextDefaults.cost_limit_usd = v;
  }

  // auto_merge:boolean(pipeline ready 後是否自動觸發 AI 合併)
  if ("auto_merge" in incomingDefaults) {
    const v = incomingDefaults.auto_merge;
    if (typeof v !== "boolean") {
      return fieldErr("auto_merge", "auto_merge 必須為 boolean");
    }
    nextDefaults.auto_merge = v;
  }

  const next: pipelineDir.ProjectConfig = {
    ...cur,
    defaults: nextDefaults,
    scripts: cur.scripts,
    qa: cur.qa,
  };

  await pipelineDir.writeConfig(project.path, next);
  // max_parallel 變大可能補位,觸發 dispatch
  await orchestrator.triggerDispatch(project.path, hash);
  const resolved = await pipelineDir.getResolvedDefaults(project.path);
  return ok({ defaults: resolved });
  }));
}

// GET /api/projects/:hash/runtime — 回 N/M(running 條數 / max_parallel)給 TopBar
export async function getRuntime(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    // 即使 hasInit 還沒,也回 0/default(避免 TopBar 爆)
    const maxParallel = project.hasInit ? await pipelineDir.getMaxParallel(project.path) : pipelineDir.DEFAULT_MAX_PARALLEL;
    return ok({ runningCount: orchestrator.runningCount(hash), maxParallel });
  }, { requireInit: false });
}

export async function listBranches(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    if (!project.hasGit) return ok([]);
    return ok(await git.listBranches(project.path));
  }, { requireInit: false });
}

export { projectHash };
