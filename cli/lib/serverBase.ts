import { readFileSync } from "node:fs";
import { fail } from "./output";
import { serverJsonPath } from "./serverPath";

const DEFAULT_SERVER_PORT = 3001;

// backend 啟動後會把實際 bind 的 port 寫進 server.json(支援 EADDRINUSE fallback 到 OS 派 port)。
// sync 讀避免 serverPort() 變 async 把 CLI 路徑全染色;失敗 fallback default 不報錯。
function readPortFromServerJson(): number | null {
  try {
    const raw = readFileSync(serverJsonPath(), "utf8");
    const j = JSON.parse(raw) as { port?: unknown };
    if (typeof j.port === "number" && Number.isInteger(j.port) && j.port > 0 && j.port < 65536) {
      return j.port;
    }
  } catch {
    // 不存在 / 壞掉 / parse 失敗 → fallback
  }
  return null;
}

export function serverPort(): number {
  // 優先序:VBPL_SERVER_PORT env(明示 override) → server.json port(backend 公告) → DEFAULT
  const raw = process.env["VBPL_SERVER_PORT"];
  if (raw != null) {
    const port = Number(raw);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      fail("INVALID_ARGS", `VBPL_SERVER_PORT 無效:${raw}`);
    }
    return port;
  }
  return readPortFromServerJson() ?? DEFAULT_SERVER_PORT;
}

export function localServerBase(): string {
  return `http://127.0.0.1:${serverPort()}`;
}

export function apiBase(): string {
  return process.env["VBPL_API_BASE"] || localServerBase();
}

function normalizeLoopback(hostname: string): string {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ? "loopback" : hostname;
}

export function isLocalApiBase(): boolean {
  try {
    const api = new URL(apiBase());
    const local = new URL(localServerBase());
    return (
      api.protocol === local.protocol &&
      normalizeLoopback(api.hostname) === normalizeLoopback(local.hostname) &&
      api.port === local.port
    );
  } catch {
    return false;
  }
}
