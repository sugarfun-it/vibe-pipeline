// Mock push gateway harness。
//
// 兩種用法:
// 1. 被 playwright config webServer 啟動:`bun run tests/e2e/helpers/mock-gateway.ts`
//    在 PORT(default 3004)起 Bun.serve,模擬 production gateway
//    (`server/lib/remote/push/gatewayToken.ts` + `server/lib/remote/push/tokenStore.ts` 對接的 endpoint)。
// 2. spec 內 import:`getRecords()` / `resetRecords()` 透過 HTTP 控制 mock 狀態。
//
// Endpoint 對齊真 gateway:
//   POST /tokens/auto-issue   → 回 { token }(ensureToken / registerToken / unregisterToken 觸發)
//   POST /push/register       → 回 { ok }       (tokenStore.registerToken 觸發)
//   POST /push/unregister     → 回 { ok }       (tokenStore.unregisterToken 觸發)
//   POST /push/send           → 回 { sent, failed: [] } (fanoutPush 在 non-mock 模式才打;
//                                                       VP_TEST_MODE=mock 下 fanoutPush 走
//                                                       fakeFcmCalls 短路,本 endpoint 不會被打到,
//                                                       保留以防 production code 變動或 forker debug)
//   GET  /__records           → 回所有收到的 request 紀錄
//   POST /__reset             → 清掉 records
//
// 每筆 record:{ method, path, body, ts }

export type GatewayRecord = {
  method: string;
  path: string;
  body: unknown;
  ts: number;
};

const PORT = Number(process.env.MOCK_GATEWAY_PORT ?? "3004");

const records: GatewayRecord[] = [];

function record(method: string, path: string, body: unknown): void {
  records.push({ method, path, body, ts: Date.now() });
}

async function readJsonSafe(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (method === "GET" && path === "/__records") {
    return jsonResponse({ records });
  }
  if (method === "POST" && path === "/__reset") {
    records.length = 0;
    return jsonResponse({ ok: true });
  }
  if (method === "GET" && path === "/health") {
    return jsonResponse({ ok: true, mock: true });
  }

  if (method === "POST" && path === "/tokens/auto-issue") {
    const body = await readJsonSafe(req);
    record("POST", path, body);
    const token = `test-token-${crypto.randomUUID()}`;
    return jsonResponse({ token });
  }
  if (method === "POST" && path === "/push/register") {
    const body = await readJsonSafe(req);
    record("POST", path, body);
    return jsonResponse({ ok: true });
  }
  if (method === "POST" && path === "/push/unregister") {
    const body = await readJsonSafe(req);
    record("POST", path, body);
    return jsonResponse({ ok: true });
  }
  if (method === "POST" && path === "/push/send") {
    const body = await readJsonSafe(req);
    record("POST", path, body);
    return jsonResponse({ sent: 1, failed: [] });
  }

  return jsonResponse({ error: "not_found", path, method }, 404);
}

// 標準 entry:被 webServer 啟動時直接跑
if (import.meta.main) {
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: handler,
  });
  console.log(`[mock-gateway] listening on http://127.0.0.1:${PORT}`);
}

// ──────────────────────────────
// spec 端 client helpers
// ──────────────────────────────

export function mockGatewayBaseUrl(): string {
  const port = process.env.MOCK_GATEWAY_PORT ?? "3004";
  return `http://127.0.0.1:${port}`;
}

export async function getGatewayRecords(): Promise<GatewayRecord[]> {
  const res = await fetch(`${mockGatewayBaseUrl()}/__records`);
  if (!res.ok) throw new Error(`mock-gateway /__records ${res.status}`);
  const body = (await res.json()) as { records: GatewayRecord[] };
  return body.records;
}

export async function resetGatewayRecords(): Promise<void> {
  const res = await fetch(`${mockGatewayBaseUrl()}/__reset`, { method: "POST" });
  if (!res.ok) throw new Error(`mock-gateway /__reset ${res.status}`);
}
