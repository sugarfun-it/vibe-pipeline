import { expect, test, type APIRequestContext } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";

const API = API_BASE;

let proj: TempProject | null = null;

test.beforeEach(async ({ request }) => {
  await resetMocks();
  proj = null;
  await request.post(`${API}/__test/fcm/reset`);
});

test.afterEach(async () => {
  if (proj) cleanupTempProject(proj);
});

function pipelineWithTickets() {
  return {
    id: "pipe-fcm-1",
    name: "fcm-pipeline",
    branch: "pipeline/fcm-pipeline",
    baseBranch: "main",
    state: "planning",
    tickets: [
      {
        id: "fcm-t-1",
        n: 1,
        title: "first-push-ticket",
        goal: "g",
        acceptance: ["a"],
        prompt: "p",
        mode: "step",
        status: "ready",
      },
      {
        id: "fcm-t-2",
        n: 2,
        title: "hold-runner-open",
        goal: "g",
        acceptance: ["a"],
        prompt: "p",
        mode: "step",
        status: "ready",
      },
    ],
  };
}

type FakeFcmCall = {
  tokens: string[];
  payload: {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  };
  ts: number;
};

type TokenFileContent = {
  filename: string;
  content: string;
};

async function registerToken(request: APIRequestContext, token: string) {
  const res = await request.post(`${API}/push/register`, {
    data: { token, platform: "e2e" },
  });
  expect(res.status()).toBe(201);
}

async function getFcmCalls(request: APIRequestContext): Promise<FakeFcmCall[]> {
  const res = await request.get(`${API}/__test/fcm/calls`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { calls: FakeFcmCall[] };
  return body.calls;
}

async function getTokenFileContent(request: APIRequestContext): Promise<TokenFileContent> {
  const res = await request.get(`${API}/__test/push/file-content`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; data: TokenFileContent };
  expect(body.ok).toBe(true);
  return body.data;
}

// SKIP × 3:2026-05-19 push 改走 maintainer gateway sentinel model。
// - device token registry SSOT 搬到 gateway 端 Firestore,VP backend 不再寫
//   `device_tokens.json`,`tokenStore.listTokens` 永遠回 `[]`(或 gateway sentinel record)
// - `/push/register` 改成轉發 gateway,本地不存 token list
// - `fanoutPush` 透過 gateway URL → gateway 端 fan-out 全部 device
// 整個 spec model(本地 device_tokens.json + listTokens 帶 user token)過時。
// 建議 user 決定:刪這檔(gateway integration test 該在 gateway repo 跑),或
// 重寫成「mock gateway HTTP + 驗 backend POST /push/register payload 格式正確」(範圍變得很小)。
test.skip("token registration → /api/push/tokens lists registered token and writes device_tokens.json", async ({ request }) => {
  const token = `fake-device-token-register-${Date.now()}`;

  await registerToken(request, token);

  const res = await request.get(`${API}/push/tokens`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { tokens: Array<{ token: string }> };
  expect(body.tokens.map((t) => t.token)).toContain(token);

  const file = await getTokenFileContent(request);
  expect(file.filename).toBe("device_tokens.json");
  const parsed = JSON.parse(file.content) as { tokens: Array<{ token: string; platform: string }> };
  expect(parsed.tokens).toEqual(
    expect.arrayContaining([expect.objectContaining({ token, platform: "e2e" })])
  );
});

test.skip("ticket done event → fanoutPush records fake FCM call", async ({ request }) => {
  const token = `fake-device-token-fanout-${Date.now()}`;
  await registerToken(request, token);

  proj = await createTempProject({ pipelines: [pipelineWithTickets()] });
  const script: RunnerScript = {
    tickets: [
      { beforeRunningMs: 50, workMs: 50, finalStatus: "done", commitHash: "mock-fcm-1" },
      { beforeRunningMs: 1000, workMs: 50, finalStatus: "done", commitHash: "mock-fcm-2" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-fcm-1", script);

  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/pipe-fcm-1/run`);
  expect(runRes.ok()).toBeTruthy();

  await expect
    .poll(async () => (await getFcmCalls(request)).length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(1);

  const calls = await getFcmCalls(request);
  const first = calls[0]!;
  expect(first.tokens).toContain(token);
  expect(first.payload.notification?.title).toBe("✅ Ticket 完成");
  expect(first.payload.notification?.body).toBe("first-push-ticket");
  expect(first.payload.data?.workUnitId).toBe("fcm-t-1");
  expect(first.payload.data?.url).toContain(`/board?project=${proj.hash}&pipeline=pipe-fcm-1`);
  expect(typeof first.ts).toBe("number");
});

test.skip("unsubscribe → /api/push/tokens removes registered token and updates device_tokens.json", async ({ request }) => {
  const token = `fake-device-token-unsub-${Date.now()}`;
  await registerToken(request, token);

  const before = await getTokenFileContent(request);
  expect(before.content).toContain(token);

  const unregister = await request.post(`${API}/push/unregister`, { data: { token } });
  expect(unregister.ok()).toBeTruthy();

  const res = await request.get(`${API}/push/tokens`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { tokens: Array<{ token: string }> };
  expect(body.tokens.map((t) => t.token)).not.toContain(token);

  const after = await getTokenFileContent(request);
  const parsed = JSON.parse(after.content) as { tokens: Array<{ token: string }> };
  expect(parsed.tokens.map((t) => t.token)).not.toContain(token);
});
