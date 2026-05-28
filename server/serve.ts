// Bun.serve init + port fallback + 寫 server.json + listen 訊息。
// 從 server/index.ts split。consumer 直接 `import { server } from "./index"`(barrel re-export)。
//
// Port 動態 fallback:DESIRED_PORT 被占用(orphan socket / 其他 process)→ 改 port:0 讓 OS 派閒置 port,
// 真實 port 寫進 ~/.vibe-pipeline/server.json,CLI / shim 從那邊讀,PWA 用 relative URL 不在乎。
// Tailscale serve forwarding(`tailscale serve --https=443 http://localhost:<port>`)由 user 自管,
// backend 不主動戳 Tailscale CLI。

import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { vibeHome } from "./lib/io/paths";
import { handle, logAccess, withCors } from "./router";

const DESIRED_PORT = Number(process.env.PORT ?? 3001);

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

// Export server 給 routes/system.ts:update handler 用,做 graceful shutdown
// 避免 process.exit 留 zombie socket(Windows port 3001 卡 TIME_WAIT,新 backend 起不來)
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
