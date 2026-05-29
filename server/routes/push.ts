import { ok, err, readJson } from "./_http";
import * as tokenStore from "../lib/remote/push/tokenStore";
import { fanoutPush, isFCMReady } from "../lib/remote/fcm";

function readToken(body: Record<string, unknown>): string | null {
  const token = body.token;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function register(req: Request): Promise<Response> {
  const body = await readJson(req);
  const token = readToken(body);
  if (!token) return err("invalid_path", "token 必須為非空字串", 400);
  const platform = typeof body.platform === "string" ? body.platform : "unknown";
  const record = await tokenStore.registerToken(token, platform);
  return ok({ token: record });
}

export async function unregister(req: Request): Promise<Response> {
  const body = await readJson(req);
  const token = readToken(body);
  if (!token) return err("invalid_path", "token 必須為非空字串", 400);
  await tokenStore.unregisterToken(token);
  return ok({ ok: true });
}

export async function tokens(): Promise<Response> {
  return ok({ tokens: await tokenStore.listTokens() });
}

// Smoke test:對所有 registered tokens fan-out 一發測試 push,驗證鏈路
export async function test(): Promise<Response> {
  if (!isFCMReady()) {
    return err("not_initialized", "FCM gateway 未配置(檢查 PUSH_GATEWAY_URL,或 hardcode default 是否被 env override)", 500);
  }
  const records = await tokenStore.listTokens();
  if (records.length === 0) {
    return err("invalid_path", "沒任何已註冊的 device token(先在 Settings → 通知 啟用)", 400);
  }
  const ts = new Date().toLocaleTimeString();
  const dead = await fanoutPush({
    notification: {
      title: "vibe-pipeline 測試推播",
      body: `從 backend 發送 · ${ts}`,
    },
    data: { url: "/board" },
  });
  if (dead.length > 0) await tokenStore.removeDeadTokens(dead);
  return ok({
    sent: records.length,
    dead: dead.length,
    ts,
  });
}

export function config(): Response {
  return ok({
    apiKey: process.env.FCM_API_KEY ?? "",
    authDomain: process.env.FCM_AUTH_DOMAIN ?? "",
    projectId: process.env.FCM_PROJECT_ID ?? "",
    storageBucket: process.env.FCM_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.FCM_MESSAGING_SENDER_ID ?? "",
    appId: process.env.FCM_APP_ID ?? "",
    vapidKey: process.env.FCM_VAPID_KEY ?? "",
  });
}
