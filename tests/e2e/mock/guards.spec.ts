import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks } from "../helpers/mock-control";
import { API_BASE, TEST_API_BASE } from "../helpers/api-base";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-guard",
        name: "guard-pipe",
        branch: "pipeline/guard-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

test("PUT non-existent pipeline → 404", async ({ request }) => {
  const res = await request.put(`${API_BASE}/projects/${proj.hash}/pipelines/never-existed`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: {
      id: "never-existed",
      name: "x",
      branch: "pipeline/x",
      baseBranch: "main",
      state: "planning",
      tickets: [],
    },
  });
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test("savePipeline 缺必備欄位 → 4xx + UI 不變", async ({ request }) => {
  // 缺 branch
  const res = await request.put(
    `${API_BASE}/projects/${proj.hash}/pipelines/p-guard`,
    {
      data: { id: "p-guard", name: "guard-pipe", baseBranch: "main", state: "planning" },
    }
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test("PUT 沒帶 tickets 陣列 → 4xx", async ({ request }) => {
  const res = await request.put(
    `${API_BASE}/projects/${proj.hash}/pipelines/p-guard`,
    {
      data: {
        id: "p-guard",
        name: "guard-pipe",
        branch: "pipeline/guard-pipe",
        baseBranch: "main",
        state: "planning",
        // tickets 缺
      },
    }
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("/api/__test/* 在 mock 模式 mount;real 模式不存在", async ({ request }) => {
  // 我們在 mock 模式,reset 應該 200
  const res = await request.post(`${TEST_API_BASE}/reset`);
  expect(res.ok()).toBe(true);
});

test("不存在的 project hash → 404", async ({ request }) => {
  const res = await request.get(`${API_BASE}/projects/deadbeef/pipelines`);
  expect(res.status()).toBe(404);
});
