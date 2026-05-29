import { expect, test, type APIRequestContext } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";
import { getGatewayRecords, resetGatewayRecords, type GatewayRecord } from "../helpers/mock-gateway";

const API = API_BASE;

let proj: TempProject | null = null;

// 2026-05-19 push 改走 maintainer gateway,本 spec 在 PUSH_GATEWAY_URL 指向 mock gateway
// (`tests/e2e/helpers/mock-gateway.ts`,playwright config webServer 啟動於 port 3004)的前提下驗:
//
// 1. token 註冊 → backend 對 mock gateway 呼 `/tokens/auto-issue` + `/push/register`,
//    本地 `~/.vibe-pipeline/gateway-token` 寫入
// 2. ticket 完成 → 觸發 `fanoutPush`;mock 模式下走 in-process fakeFcmCalls 短路(production
//    code 路徑,本 spec 不動)— 驗 fakeFcmCalls 收到 ticket 完成的 payload
// 3. unregister → backend 對 mock gateway 呼 `/push/unregister`(本地 gateway-token 不刪,
//    跟 production 邏輯一致 — unregister 是 device 級,不是這個 backend instance 級)
test.beforeEach(async ({ request }) => {
  await resetMocks();
  await resetGatewayRecords();
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
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
}

async function getFcmCalls(request: APIRequestContext): Promise<FakeFcmCall[]> {
  const res = await request.get(`${API}/__test/fcm/calls`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { calls: FakeFcmCall[] };
  return body.calls;
}

async function getTokenFileContent(
  request: APIRequestContext,
  file?: string
): Promise<TokenFileContent> {
  const url = file
    ? `${API}/__test/push/file-content?file=${encodeURIComponent(file)}`
    : `${API}/__test/push/file-content`;
  const res = await request.get(url);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; data: TokenFileContent };
  expect(body.ok).toBe(true);
  return body.data;
}

function recordsMatching(records: GatewayRecord[], path: string): GatewayRecord[] {
  return records.filter((r) => r.path === path);
}

test("token registration → mock gateway 收到 auto-issue + push/register,本地寫入 gateway-token", async ({
  request,
}) => {
  // 確認初始狀態:gateway-token 不存在(reset 已清)
  const before = await getTokenFileContent(request, "gateway-token");
  expect(before.filename).toBe("gateway-token");
  expect(before.content).toBe("");

  const deviceToken = `fake-device-token-register-${Date.now()}`;
  await registerToken(request, deviceToken);

  // mock gateway 應收到一筆 /tokens/auto-issue(lazy ensureToken)+ 一筆 /push/register
  const records = await getGatewayRecords();
  const autoIssue = recordsMatching(records, "/tokens/auto-issue");
  const pushRegister = recordsMatching(records, "/push/register");
  expect(autoIssue.length).toBe(1);
  expect(pushRegister.length).toBe(1);
  expect(pushRegister[0]!.body).toMatchObject({
    deviceToken,
    label: "e2e",
  });

  // 本地 gateway-token 應寫入,內容對應 mock gateway 發的 token(test-token-<uuid>)
  const after = await getTokenFileContent(request, "gateway-token");
  expect(after.content.length).toBeGreaterThan(0);
  expect(after.content.startsWith("test-token-")).toBe(true);
});

test("ticket done → fanoutPush 觸發,fakeFcmCalls 收到 ticket 完成 payload", async ({
  request,
}) => {
  // 先註冊 token(讓 listTokens 不回 [])
  const deviceToken = `fake-device-token-fanout-${Date.now()}`;
  await registerToken(request, deviceToken);

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

  // mock 模式 fanoutPush 短路到 in-process fakeFcmCalls(production code 行為,本 spec 不改),
  // 所以驗 fakeFcmCalls 而非 mock gateway records
  await expect
    .poll(async () => (await getFcmCalls(request)).length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(1);

  const calls = await getFcmCalls(request);
  const first = calls[0]!;
  expect(first.payload.notification?.title).toBe("✅ Ticket 完成");
  expect(first.payload.notification?.body).toBe("first-push-ticket");
  expect(first.payload.data?.workUnitId).toBe("fcm-t-1");
  expect(first.payload.data?.url).toContain(`/board?project=${proj.hash}&pipeline=pipe-fcm-1`);
  expect(typeof first.ts).toBe("number");
});

test("unregister → mock gateway 收到 push/unregister(本地 gateway-token 保留)", async ({
  request,
}) => {
  const deviceToken = `fake-device-token-unsub-${Date.now()}`;
  await registerToken(request, deviceToken);

  // 確認 register 路徑寫入 gateway-token
  const beforeUnregister = await getTokenFileContent(request, "gateway-token");
  expect(beforeUnregister.content.length).toBeGreaterThan(0);

  await resetGatewayRecords(); // 隔離 register 階段的 records

  const unregister = await request.post(`${API}/push/unregister`, { data: { token: deviceToken } });
  expect(unregister.ok()).toBeTruthy();

  const records = await getGatewayRecords();
  const unregisterCalls = recordsMatching(records, "/push/unregister");
  expect(unregisterCalls.length).toBe(1);
  expect(unregisterCalls[0]!.body).toMatchObject({ deviceToken });

  // unregister 是 device 級操作,backend instance 的 gateway-token 不該被刪
  // (gateway-token 是 backend 自己對 gateway 的 bearer,跟 device 解綁無關)
  const afterUnregister = await getTokenFileContent(request, "gateway-token");
  expect(afterUnregister.content).toBe(beforeUnregister.content);
});
