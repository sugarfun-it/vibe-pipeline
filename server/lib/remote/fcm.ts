import { getToken } from "./push/gatewayToken";
import { gatewayUrl } from "./push/gatewayConfig";

export type FcmPayload = {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
};

export const fakeFcmCalls: Array<{ payload: object; ts: number }> = [];

function isMockMode(): boolean {
  return process.env.VP_TEST_MODE === "mock";
}

// initFCM / isFCMReady:gateway url 有設就視為「結構上可用」;
// token 本身 lazy 管理,send 時被動 getToken,沒有 → soft fail。
export function initFCM(): Promise<boolean> {
  if (isMockMode()) return Promise.resolve(true);
  return Promise.resolve(!!gatewayUrl());
}

export function isFCMReady(): boolean {
  if (isMockMode()) return true;
  return !!gatewayUrl();
}

type SendResponse = {
  sent?: number;
  failed?: Array<{ deviceToken?: string; deviceId?: string; code?: string; error?: string }>;
};

// tokens 參數已移除(2026-05-29):real 模式下 gateway 端 device registry 是 SSOT,
// VP backend 不持有 device list,傳什麼 tokens 都被無視;mock 模式也只記 payload。
export async function fanoutPush(payload: FcmPayload): Promise<string[]> {
  if (isMockMode()) {
    fakeFcmCalls.push({
      payload: {
        notification: payload.notification ? { ...payload.notification } : undefined,
        data: payload.data ? { ...payload.data } : undefined,
      },
      ts: Date.now(),
    });
    return [];
  }

  const url = gatewayUrl();

  // send 是被動觸發,不該 auto-issue token;沒 token = 此 backend 從沒 register 過,正常,soft fail。
  const tok = await getToken();
  if (!tok) {
    console.warn("[FCM] gateway token 尚未取得(未 register 過),跳過 fanout");
    return [];
  }

  // device list 由 gateway 端 registry 解析(gateway 是 SSOT);此處只送 payload。
  const title = payload.notification?.title ?? "";
  const body = payload.notification?.body ?? "";
  if (!title || !body) {
    console.warn("[FCM] title / body 缺,gateway 會拒,跳過");
    return [];
  }
  const data = payload.data ? { ...payload.data } : undefined;
  const ticketId = data?.workUnitId ?? data?.ticketId;

  try {
    const res = await fetch(`${url}/push/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({ title, body, data, ticketId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[FCM] gateway /push/send ${res.status}: ${text}`);
      return [];
    }
    const json = (await res.json().catch(() => null)) as SendResponse | null;
    const failed = json?.failed ?? [];
    const dead: string[] = [];
    for (const f of failed) {
      if (
        f.code === "messaging/registration-token-not-registered" ||
        f.code === "messaging/invalid-registration-token"
      ) {
        if (typeof f.deviceToken === "string" && f.deviceToken.length > 0) {
          dead.push(f.deviceToken);
        }
      }
    }
    return dead;
  } catch (e) {
    console.error("[FCM] gateway /push/send 失敗:", e);
    return [];
  }
}

export function resetFakeFcmCalls(): void {
  fakeFcmCalls.length = 0;
}
