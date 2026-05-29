// CLI HTTP client — 只 mutate 操作(spawn / kill 子程)走這個,
// 讓 backend server 養 child process,CLI 死了 child 不會孤兒。
// read 操作仍走 fs(reuse server/lib/*)直接讀 .vibe-pipeline/ 內容。
//
// base URL 解析優先序:
//   1. VBPL_API_BASE env var(user 自訂 e.g. tailscale IP)
//   2. http://127.0.0.1:${VBPL_SERVER_PORT || 3001}(跟 server start 對齊)

import { ensureBackend } from "./ensureBackend";
import { apiBase } from "./serverBase";
import { fail } from "./output";

// 先確認 backend 活著,沒活就 helpful error。所有 mutate 呼叫前都走這個。
export async function requireBackend(): Promise<void> {
  await ensureBackend();
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code?: string; message: string } };

export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  await requireBackend();
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "user-agent": "vbpl-cli",
        ...(body != null ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `POST ${path} 連線失敗:${msg}`);
  }
  const j = (await res.json()) as ApiResult<T>;
  if (!j.ok) {
    const code = j.error?.code?.toUpperCase() || "IO_ERROR";
    fail(code, j.error?.message || `${path} 失敗(${res.status})`);
  }
  return j.data;
}

// GET wrapper — 讀 backend in-memory 狀態(e.g. orchestrator 執行態)時用。
// read 純 fs 資料仍直接 reuse server/lib/*,不走這個。
export async function get<T = unknown>(path: string): Promise<T> {
  await requireBackend();
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { "user-agent": "vbpl-cli" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `GET ${path} 連線失敗:${msg}`);
  }
  const j = (await res.json()) as ApiResult<T>;
  if (!j.ok) {
    const code = j.error?.code?.toUpperCase() || "IO_ERROR";
    fail(code, j.error?.message || `${path} 失敗(${res.status})`);
  }
  return j.data;
}
