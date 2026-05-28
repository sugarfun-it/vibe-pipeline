import { call } from "./_client";

// FCM device token 註冊 / 反註冊。走 call()(統一 base URL + JSON + utf-8 charset + ApiError);
// caller(src/lib/fcm.ts)以 try/catch 包覆,失敗只 warn 不阻斷 token 本地保留 / 移除。
export function registerPush(token: string, signal?: AbortSignal): Promise<unknown> {
  return call("/api/push/register", {
    method: "POST",
    body: { token, platform: "web" },
    signal,
  });
}

export function unregisterPush(token: string, signal?: AbortSignal): Promise<unknown> {
  return call("/api/push/unregister", {
    method: "DELETE",
    body: { token },
    signal,
  });
}
