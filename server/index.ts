import { join, normalize, resolve as pathResolve, sep } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { vibeHome } from "./lib/paths";
import * as projects from "./routes/projects";
import * as runRoutes from "./routes/run";
import * as notifs from "./routes/notifs";
import * as syncRoutes from "./routes/sync";
import * as qa from "./routes/qa";
import * as push from "./routes/push";
import * as userConfigRoutes from "./routes/userConfig";
import * as test from "./routes/test";
import * as system from "./routes/system";
import * as projectStore from "./lib/projectStore";
import * as orchestrator from "./lib/runner/orchestrator";
import * as syncJob from "./lib/runner/syncJob";
import * as testMode from "./lib/testMode";
import { initFCM } from "./lib/fcm/index";

const DESIRED_PORT = Number(process.env.PORT ?? 3001);
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const TAILSCALE_ORIGIN_RE = /^https?:\/\/100\.\d+\.\d+\.\d+(:\d+)?$/;
const CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization";

function logAccess(method: string, pathname: string, status: number, startedAt: number): void {
  if (!pathname.startsWith("/api/")) return;
  console.log(`[access] ${method} ${pathname} ${status} ${Date.now() - startedAt}ms`);
}

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (TAILSCALE_ORIGIN_RE.test(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function withCors(response: Response, origin: string | null, requestHeaders?: string | null): Response {
  const headers = new Headers(response.headers);
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", CORS_METHODS);
    headers.set("Access-Control-Allow-Headers", requestHeaders || CORS_HEADERS);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function notFound(): Response {
  return Response.json(
    { ok: false, error: { code: "not_found", message: "Route not found" } },
    { status: 404 }
  );
}

// dist/ 在 build artifact tree 內位於 server/ 同層上一級
const DIST_ROOT = pathResolve(import.meta.dir, "..", "dist");
const INDEX_HTML_PATH = join(DIST_ROOT, "index.html");

async function serveIndexHtml(): Promise<Response> {
  const file = Bun.file(INDEX_HTML_PATH);
  if (!(await file.exists())) {
    return notFound();
  }
  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // PWA SW 自己管 HTML cache,backend 不加 cache header 避免 stale UI
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  // path traversal 過濾:reject 任何含 .. segment
  const decoded = decodeURIComponent(pathname);
  if (decoded.split("/").some((seg) => seg === "..")) return null;
  const rel = decoded.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) {
    // root 或目錄 → SPA fallback
    return serveIndexHtml();
  }
  const candidate = pathResolve(DIST_ROOT, rel);
  // 二次防線:resolve 後路徑必須仍在 DIST_ROOT 內
  const distNorm = normalize(DIST_ROOT + sep);
  if (!candidate.startsWith(distNorm) && candidate !== DIST_ROOT) {
    return null;
  }
  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file, { status: 200 });
  }
  // 找不到 → SPA fallback(client-side router 處理)
  return serveIndexHtml();
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // 非 /api/* GET/HEAD → serve dist/ static + SPA fallback
  // (擺在 /api/health 之前不影響 /api/* — pathname.startsWith("/api/") 直接 skip)
  if (!pathname.startsWith("/api/") && (method === "GET" || method === "HEAD")) {
    const res = await serveStatic(pathname);
    if (res) return res;
  }

  if (pathname === "/api/health" && method === "GET") {
    return Response.json({
      ok: true,
      data: { status: "up", testMode: testMode.isTestMode(), pid: process.pid, repo_path: process.cwd() },
    });
  }

  if (pathname === "/api/system/version" && method === "GET") {
    return system.version();
  }
  if (pathname === "/api/system/update" && method === "POST") {
    return system.update();
  }

  // E2E 控制端點 — 只 mock 模式 mount,real 模式 404
  if (testMode.isTestMode() && pathname.startsWith("/api/__test/")) {
    if (pathname === "/api/__test/register-project" && method === "POST")
      return test.registerProject(req);
    if (pathname === "/api/__test/script/qa" && method === "POST")
      return test.setQAScript(req);
    if (pathname === "/api/__test/script/runner" && method === "POST")
      return test.setRunnerScript(req);
    if (pathname === "/api/__test/script/split" && method === "POST")
      return test.setSplitScript(req);
    if (pathname === "/api/__test/reset" && method === "POST") return test.reset();
    if (pathname === "/api/__test/seed/rich-pipeline" && method === "POST")
      return test.seedRichPipeline(req);
    if (pathname === "/api/__test/fcm/calls" && method === "GET") return test.fcmCalls();
    if (pathname === "/api/__test/fcm/reset" && method === "POST") return test.fcmReset();
    if (pathname === "/api/__test/push/file-content" && method === "GET")
      return test.pushFileContent();
    return notFound();
  }

  // User-level config(~/.vibe-pipeline/config.json,跨 project)
  if (pathname === "/api/user/config" && method === "GET") {
    return userConfigRoutes.getConfig();
  }
  if (pathname === "/api/user/config" && method === "PUT") {
    return userConfigRoutes.updateConfig(req);
  }

  if (pathname === "/api/push/config" && method === "GET") {
    return push.config();
  }
  if (pathname === "/api/push/register" && method === "POST") {
    return push.register(req);
  }
  if (pathname === "/api/push/unregister" && (method === "DELETE" || method === "POST")) {
    return push.unregister(req);
  }
  if (pathname === "/api/push/tokens" && method === "GET") {
    return push.tokens();
  }
  if (pathname === "/api/push/test" && method === "POST") {
    return push.test();
  }

  if (pathname === "/api/projects" && method === "GET") {
    return projects.listRecent();
  }
  if (pathname === "/api/projects/select" && method === "POST") {
    return projects.selectFolder();
  }
  if (pathname === "/api/projects/browse" && method === "GET") {
    return projects.browseFolder(req);
  }
  if (pathname === "/api/projects/open" && method === "POST") {
    return projects.openProject(req);
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([a-f0-9]{8})(\/.*)?$/);
  if (projectMatch) {
    const hash = projectMatch[1];
    const rest = projectMatch[2] ?? "";

    // DELETE /api/projects/:hash — 從最近專案 list 移除(SSOT state.json),不刪 project fs
    if (rest === "" && method === "DELETE") return projects.removeRecent(hash);
    if (rest === "/status" && method === "GET") return projects.status(hash);
    if (rest === "/init" && method === "POST") return projects.init(hash);
    if (rest === "/git-init" && method === "POST") return projects.gitInit(hash);
    if (rest === "/reveal" && method === "POST") return projects.reveal(hash);
    if (rest === "/branches" && method === "GET") return projects.listBranches(hash);
    if (rest === "/config" && method === "GET") return projects.getConfig(hash);
    if (rest === "/config" && method === "PUT") return projects.updateConfig(hash, req);
    if (rest === "/runtime" && method === "GET") return projects.getRuntime(hash);
    if (rest === "/audit" && method === "GET") return projects.listProjectAudit(hash, req);
    if (rest === "/worktrees/cleanup-merged" && method === "POST") return projects.cleanupMergedWorktrees(hash);
    if (rest === "/pipelines" && method === "GET") return projects.listPipelines(hash);
    if (rest === "/pipelines" && method === "POST") return projects.createPipeline(hash, req);
    const pipelineMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)$/);
    if (pipelineMatch) {
      const id = pipelineMatch[1];
      if (method === "GET") return projects.getPipeline(hash, id);
      if (method === "PUT") return projects.savePipeline(hash, id, req);
      if (method === "DELETE") return projects.deletePipeline(hash, id);
    }

    const pipelineRunMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/(run|pause|stop|merge|sync)$/);
    if (pipelineRunMatch && method === "POST") {
      const id = pipelineRunMatch[1];
      const action = pipelineRunMatch[2];
      if (action === "run") return projects.runPipeline(hash, id, req);
      // pause 與 stop 共用 handler;固定立即停止
      if (action === "pause" || action === "stop") return projects.pausePipeline(hash, id, req);
      if (action === "merge") return projects.mergePipeline(hash, id);
      if (action === "sync") return syncRoutes.syncPipeline(hash, id);
    }

    const syncStatusMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/sync-status$/);
    if (syncStatusMatch && method === "GET") {
      return syncRoutes.syncStatus(hash, syncStatusMatch[1]);
    }

    const syncSubMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/sync\/(ai|cancel|dismiss)$/
    );
    if (syncSubMatch && method === "POST") {
      const id = syncSubMatch[1];
      const sub = syncSubMatch[2];
      if (sub === "ai") return syncRoutes.syncConfirmAi(hash, id);
      if (sub === "cancel") return syncRoutes.syncCancel(hash, id);
      if (sub === "dismiss") return syncRoutes.syncDismiss(hash, id);
    }

    const worktreeRevealMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/worktree\/reveal$/
    );
    if (worktreeRevealMatch && method === "POST") {
      return projects.revealWorktree(hash, worktreeRevealMatch[1]);
    }

    const worktreeCleanupMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/worktree\/cleanup$/
    );
    if (worktreeCleanupMatch && method === "POST") {
      return projects.cleanupWorktree(hash, worktreeCleanupMatch[1]);
    }

    // 「重置 pipeline」— 取代舊 worktree/prune + ticket reset 兩個 button
    // 一步:worktree 刪 + branch 刪(讓下次 fresh from base)+ tickets done/failed→draft
    const resetMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/reset$/);
    if (resetMatch && method === "POST") {
      return projects.resetPipelineRoute(hash, resetMatch[1]);
    }

    const diffStatMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/diff-stat$/);
    if (diffStatMatch && method === "GET") {
      return runRoutes.pipelineDiffStat(hash, diffStatMatch[1]);
    }

    const diffFullMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/diff$/);
    if (diffFullMatch && method === "GET") {
      return runRoutes.pipelineDiff(hash, diffFullMatch[1]);
    }

    const pipelineAuditMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/audit$/);
    if (pipelineAuditMatch && method === "GET") {
      return projects.listPipelineAudit(hash, pipelineAuditMatch[1], req);
    }

    const pipelineRunsListMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/runs$/);
    if (pipelineRunsListMatch && method === "GET") {
      return runRoutes.listPipelineRuns(hash, pipelineRunsListMatch[1]);
    }
    const pipelineRunsDetailMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/runs\/([A-Za-z0-9._-]+)$/
    );
    if (pipelineRunsDetailMatch && method === "GET") {
      return runRoutes.getPipelineRun(
        hash,
        pipelineRunsDetailMatch[1],
        pipelineRunsDetailMatch[2]
      );
    }

    if (rest === "/notifs" && method === "GET") return notifs.listNotifs(hash);
    if (rest === "/notif" && method === "POST") return notifs.postNotif(hash, req);
    if (rest === "/notifs/mark-all-read" && method === "POST")
      return notifs.markAllNotifsRead(hash);
    if (rest === "/notifs/dismiss-all" && method === "POST")
      return notifs.dismissAllNotifs(hash);
    const notifMatch = rest.match(/^\/notifs\/([a-z0-9]+)\/(read|dismiss)$/);
    if (notifMatch && method === "POST") {
      const nid = notifMatch[1];
      if (notifMatch[2] === "read") return notifs.markNotifRead(hash, nid);
      if (notifMatch[2] === "dismiss") return notifs.dismissNotif(hash, nid);
    }

    const qaStartMatch = rest.match(/^\/pipelines\/([a-z0-9_-]+)\/qa\/start$/);
    if (qaStartMatch && method === "POST") return qa.start(hash, qaStartMatch[1], req);

    // ticket-level operations(split / delete)— 跑 qa.ts 因為 split 用 claude CLI(同 stack)
    const ticketSplitMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/tickets\/([a-z0-9_-]+)\/split$/
    );
    if (ticketSplitMatch && method === "POST") {
      return qa.splitTicket(hash, ticketSplitMatch[1], ticketSplitMatch[2]);
    }
    const ticketDeleteMatch = rest.match(
      /^\/pipelines\/([a-z0-9_-]+)\/tickets\/([a-z0-9_-]+)$/
    );
    if (ticketDeleteMatch && method === "DELETE") {
      return qa.deleteTicket(hash, ticketDeleteMatch[1], ticketDeleteMatch[2]);
    }

    if (rest === "/qa/drafts" && method === "GET") return qa.listDrafts(hash);

    const qaDraftMatch = rest.match(/^\/qa\/([a-f0-9]+)(\/.*)?$/);
    if (qaDraftMatch) {
      const draftId = qaDraftMatch[1];
      const sub = qaDraftMatch[2] ?? "";
      if (sub === "" && method === "GET") return qa.getDraft(hash, draftId);
      if (sub === "/turn" && method === "POST") return qa.turn(hash, draftId, req);
      if (sub === "/finalize" && method === "POST") return qa.finalize(hash, draftId, req);
      if (sub === "/preview-split" && method === "POST") return qa.previewSplit(hash, draftId, req);
      if (sub === "/cancel" && method === "POST") return qa.cancel(hash, draftId);
    }
  }

  return notFound();
}

// Export server 給 routes/system.ts:update handler 用,做 graceful shutdown
// 避免 process.exit 留 zombie socket(Windows port 3001 卡 TIME_WAIT,新 backend 起不來)
//
// Port 動態 fallback:DESIRED_PORT 被占用(orphan socket / 其他 process)→ 改 port:0 讓 OS 派閒置 port,
// 真實 port 寫進 ~/.vibe-pipeline/server.json,CLI / shim 從那邊讀,PWA 用 relative URL 不在乎。
// Tailscale serve forwarding(`tailscale serve --https=443 http://localhost:<port>`)由 user 自管,
// backend 不主動戳 Tailscale CLI。
const serveOpts: Parameters<typeof Bun.serve>[0] = {
  port: DESIRED_PORT,
  hostname: "0.0.0.0",
  // 預設 10s 太短 — QA / split / merge 都會 spawn claude CLI,單次跑 10-60s 常見;
  // 拉到 5min cover 大部分 case,真超過代表 claude 卡死,讓 bun 砍掉合理
  idleTimeout: 255, // bun 上限 255s (≈4.25min)
  async fetch(req, srv) {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    let response: Response;
    if (req.method === "OPTIONS") {
      response = withCors(
        new Response(null, { status: 204 }),
        origin,
        req.headers.get("Access-Control-Request-Headers")
      );
      logAccess(req.method, url.pathname, response.status, startedAt);
      return response;
    }
    const ip = srv.requestIP(req)?.address ?? null;
    (req as unknown as { __ip?: string }).__ip = ip ?? "unknown";
    try {
      response = withCors(await handle(req), origin);
    } catch (e) {
      response = withCors(
        Response.json(
          { ok: false, error: { code: "internal_error", message: String(e) } },
          { status: 500 }
        ),
        origin
      );
    }
    logAccess(req.method, url.pathname, response.status, startedAt);
    return response;
  },
};

export const server = ((): ReturnType<typeof Bun.serve> => {
  try {
    return Bun.serve(serveOpts);
  } catch (e) {
    if ((e as { code?: string })?.code === "EADDRINUSE") {
      console.warn(`[server] port ${DESIRED_PORT} 被占用(orphan socket?),改用 OS 派閒置 port`);
      return Bun.serve({ ...serveOpts, port: 0 });
    }
    throw e;
  }
})();

// 公告實際 port — CLI / vbpl 之後的指令從 server.json 讀 port,PWA 用 relative URL 不在乎。
// merge 既有 server.json(CLI 在 spawn 後寫 repo_path / log_path / 初始 pid;backend 覆蓋 pid + port)。
// tmp + rename 避免 CLI 同時寫的 partial read。
try {
  const dir = join(vibeHome(), ".vibe-pipeline");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "server.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // server.json 不存在 / 壞 — 從零寫即可
  }
  const merged = { ...existing, pid: process.pid, port: server.port, started_at: Date.now() };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
} catch (e) {
  console.warn(`[server] 寫 server.json 失敗(不致命):${e instanceof Error ? e.message : String(e)}`);
}

console.log(`vibe-pipeline backend listening on http://${server.hostname}:${server.port}`);

// 2026-05-24 auth removal migration:啟動時若舊 ~/.vibe-pipeline/auth.json 仍在 → 直接刪。
// 該檔在 auth feature 拔除後變孤兒,留著是垃圾(maintainer 確認 VP 無 user,no backup OK)。
// noop 一旦檔不存在,所以不影響後續 boot。
try {
  const orphan = join(vibeHome(), ".vibe-pipeline", "auth.json");
  if (existsSync(orphan)) {
    unlinkSync(orphan);
    console.log(`[migrate] removed orphan ${orphan}(auth feature 已於 2026-05-24 拔除)`);
  }
} catch (e) {
  console.warn(`[migrate] auth.json cleanup 失敗(不致命):${e instanceof Error ? e.message : String(e)}`);
}

void initFCM();

// Crash recovery: 啟動時掃所有有 .vibe-pipeline/ 的 recent project,
// 若 pipeline.state="running" 但 process 不在 (server 重啟),標 paused
(async () => {
  try {
    const recents = await projectStore.listRecent();
    for (const p of recents) {
      if (!p.hasInit) continue;
      try {
        await orchestrator.recoverStale(p.path);
        await syncJob.recoverStaleSync(p.path);
      } catch (e) {
        console.error(`[recover] ${p.path} failed:`, e);
      }
    }
  } catch (e) {
    console.error("[recover] scan failed:", e);
  }
})();

// Liveness watchdog:server 跑期間每 60s 掃 running map,抓 process 死了但
// exit handler 沒收到通知的 stale entry(Windows 偶發 socket / handle leak 場景)。
// recoverStale 只在啟動跑一次,watchdog 補 runtime 期間的偵測。
orchestrator.startWatchdog();
