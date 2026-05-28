import { resolve } from "node:path";
import * as projectStore from "../lib/domain/project";
import * as projectConfig from "../lib/domain/projectConfig";
import { init as initProjectDir } from "../lib/domain/projectDir";
import * as git from "../lib/io/git";
import * as orchestrator from "../lib/runner/orchestrator";
import * as auditLog from "../lib/domain/auditLog";
import { pickFolder, revealFolder } from "../lib/io/dialog";
import { projectHash } from "../lib/io/hash";
import { isExistingDirectory } from "../lib/io/fs";
import { ok, err, withProject, withJsonBody } from "./_http";
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
        const resolved = await projectConfig.getResolvedDefaults(project.path);
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
    // initProjectDir 已 idempotent(2026-05-12 改):.vibe-pipeline/ 已存在但內容缺 → 補齊,不再 throw already_initialized。
    // init 只建 dir 結構;config.json 由 writeConfig 負責(沒檔才寫 default),兩步式。
    try {
      await initProjectDir(project.path);
      await projectConfig.writeConfig(project.path);
    } catch (e) { return err("internal_error", String(e), 500); }
    return ok(await projectStore.findByHash(hash));
  }, { requireInit: false });
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

export async function getConfig(hash: string): Promise<Response> {
  return withProject(hash, async (project) => ok({ defaults: await projectConfig.getResolvedDefaults(project.path) }));
}

// 回 400 with field-level error,body 結構 { ok:false, error:{ code, message, field } }
function fieldErr(field: string, message: string): Response {
  return Response.json({ ok: false, error: { code: "invalid_path" satisfies ApiErrorCode, message, field } }, { status: 400 });
}

// PUT /api/projects/:hash/config — 接 partial body,只認可白名單欄位 + 型別驗證
export async function updateConfig(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const cur = await projectConfig.readConfig(project.path);
  const nextDefaults: NonNullable<projectConfig.ProjectConfig["defaults"]> = {
    ...(cur.defaults ?? {}),
  };
  const incomingDefaults = (body.defaults ?? {}) as Record<string, unknown>;

  // max_parallel:number,clamp [1,8](保留既有寬容行為:壞值 → DEFAULT 而不報錯)
  if ("max_parallel" in incomingDefaults) {
    const v = incomingDefaults.max_parallel;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return fieldErr("max_parallel", "max_parallel 必須為 number");
    }
    nextDefaults.max_parallel = projectConfig.clampMaxParallel(v);
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

  const next: projectConfig.ProjectConfig = {
    ...cur,
    defaults: nextDefaults,
    scripts: cur.scripts,
    qa: cur.qa,
  };

  await projectConfig.writeConfig(project.path, next);
  // max_parallel 變大可能補位,觸發 dispatch
  await orchestrator.triggerDispatch(project.path, hash);
  const resolved = await projectConfig.getResolvedDefaults(project.path);
  return ok({ defaults: resolved });
  }));
}

// GET /api/projects/:hash/runtime — 回 N/M(running 條數 / max_parallel)給 TopBar
export async function getRuntime(hash: string): Promise<Response> {
  return withProject(hash, async (project) => {
    // 即使 hasInit 還沒,也回 0/default(避免 TopBar 爆)
    const maxParallel = project.hasInit ? await projectConfig.getMaxParallel(project.path) : projectConfig.DEFAULT_MAX_PARALLEL;
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
