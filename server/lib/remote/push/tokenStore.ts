// Gateway 上線後,device token registry 的 SSOT 在 gateway(Firestore),
// 本地不再保留 device_tokens.json。register / unregister 改成轉發 gateway,
// listTokens 回 sentinel(fanoutPush 不看個別 token,gateway 端 fanout 全部 device),
// removeDeadTokens 是 no-op(gateway 收到 invalid-token 會自己刪)。
//
// 2026-05-19 lazy token:bearer token 不再從 env 讀,改 `gatewayToken.ts` 管理
// (檔案 `~/.vibe-pipeline/gateway-token`,沒有就 POST /tokens/auto-issue 取得)。
// register 進入點主動 ensureToken,send 是被動 getToken(沒有就 soft-fail)。

import { ensureToken, getToken } from "./gatewayToken";
import { gatewayUrl } from "./gatewayConfig";

export type DeviceTokenRecord = {
  id: string;
  token: string;
  platform: string;
  created_at: string;
  last_seen_at: string;
};

async function postGatewayWithToken(
  path: string,
  body: object,
  bearerToken: string
): Promise<Response | null> {
  const url = gatewayUrl();
  try {
    return await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`[push] gateway ${path} 失敗:`, e);
    return null;
  }
}

export async function registerToken(
  token: string,
  platform = "unknown"
): Promise<DeviceTokenRecord> {
  const normalizedToken = token.trim();
  const normalizedPlatform = platform.trim() || "unknown";
  const now = new Date().toISOString();

  let bearer: string;
  try {
    bearer = await ensureToken();
  } catch (e) {
    console.error("[push] ensureToken 失敗,無法 register:", e);
    return {
      id: normalizedToken,
      token: normalizedToken,
      platform: normalizedPlatform,
      created_at: now,
      last_seen_at: now,
    };
  }

  const res = await postGatewayWithToken(
    "/push/register",
    { deviceToken: normalizedToken, label: normalizedPlatform },
    bearer
  );
  if (res && !res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[push] /push/register ${res.status}: ${text}`);
  }
  return {
    id: normalizedToken,
    token: normalizedToken,
    platform: normalizedPlatform,
    created_at: now,
    last_seen_at: now,
  };
}

export async function unregisterToken(token: string): Promise<void> {
  const normalizedToken = token.trim();
  let bearer: string;
  try {
    bearer = await ensureToken();
  } catch (e) {
    console.error("[push] ensureToken 失敗,無法 unregister:", e);
    return;
  }
  const res = await postGatewayWithToken(
    "/push/unregister",
    { deviceToken: normalizedToken },
    bearer
  );
  if (res && !res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[push] /push/unregister ${res.status}: ${text}`);
  }
}

// Sentinel:gateway 是 device registry SSOT,VP backend 不再持有 device list。
// 回 1 個假 record 讓 ticketWatcher / orchestrator 的 `records.length > 0` 判斷成立,
// 真正的 fanout 在 gateway 端做。
//
// gateway 設定齊備 = gateway URL 有(已 DEFAULT_GATEWAY_URL fallback)+ token 已存在(不主動 issue;listTokens 是被動查)。
export async function listTokens(): Promise<DeviceTokenRecord[]> {
  const tok = await getToken();
  if (!tok) return [];
  const now = new Date().toISOString();
  return [
    {
      id: "gateway",
      token: "gateway",
      platform: "gateway",
      created_at: now,
      last_seen_at: now,
    },
  ];
}

// No-op:dead token 由 gateway 端 invalid-registration-token 自動刪除,
// VP backend 不再維護 token list。保留 signature 讓 call site 不必改。
export async function removeDeadTokens(_deadTokens: string[]): Promise<void> {
  return;
}
