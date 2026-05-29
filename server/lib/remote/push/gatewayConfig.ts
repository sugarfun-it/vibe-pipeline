// Push gateway URL 的單一來源(2026-05-29 收斂)。
// 原本 DEFAULT_GATEWAY_URL + gatewayUrl() 在 fcm.ts / gatewayToken.ts / tokenStore.ts
// 三處各 hardcode 一份,改 url 要同步三邊(雷:漏改 → ensureToken issue 不到 token)。
//
// 對齊 rules/remote-access.md:maintainer host 的 Cloud Run gateway 為 default,
// forker 自架 gateway → `PUSH_GATEWAY_URL` env override。enduser .env 完全不必設。

export const DEFAULT_GATEWAY_URL = "https://vp-gateway-799841449136.asia-east1.run.app";

// gatewayUrl 永遠回 string(必有 DEFAULT fallback);trailing slash 去掉。
// fcm 端歷史上宣告 string | null,但實際 impl 從不回 null,收斂成單一 string 版。
export function gatewayUrl(): string {
  const v = process.env.PUSH_GATEWAY_URL?.trim();
  const raw = v && v.length > 0 ? v : DEFAULT_GATEWAY_URL;
  return raw.replace(/\/+$/, "");
}
