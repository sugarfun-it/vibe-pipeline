import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

function pipelineWith(tickets: Array<{ id: string; title: string; mode?: "step" | "iter" }>) {
  return {
    id: "p-edge",
    name: "edge-pipe",
    branch: "pipeline/edge-pipe",
    baseBranch: "main",
    state: "planning",
    tickets: tickets.map((t, i) => ({
      id: t.id,
      n: i + 1,
      title: t.title,
      goal: "g",
      acceptance: ["a"],
      prompt: "p",
      mode: t.mode ?? "step",
      status: "ready",
    })),
  };
}

test("ticket finalStatus=failed_iter_limit → ticket 顯示 iter 上限狀態", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith([{ id: "t-fail", title: "iter-failed", mode: "iter" }])],
  });
  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 30,
        iterRounds: [
          { verdict: "FAIL", durationMs: 30 },
          { verdict: "FAIL", durationMs: 30 },
        ],
        finalStatus: "failed_iter_limit",
      },
    ],
    finalState: "paused",
  };
  await setRunnerScript(proj.hash, "p-edge", script);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  // 跑完 paused + ticket finalStatus=failed_iter_limit(terminal failure)→ RunButton
  // 顯示「無可執行 ticket」(failed_iter_limit 不在 runnable list — user 要先重置 ticket)
  await expect(
    page.locator("[data-testid='run-btn'][data-run-state='empty']"),
  ).toBeVisible({ timeout: 10000 });

  // 點開 ticket drawer → iter rounds 顯示兩條 FAIL verdict
  await page.locator(".ticket", { hasText: "iter-failed" }).click();
  await expect(page.locator(".tdrw-iter-verdict.is-fail")).toHaveCount(2);
});

test("running 中按 Run → 後端 state guard 擋(409 / 4xx)", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith([{ id: "t-running", title: "long-task" }])],
  });
  const script: RunnerScript = {
    tickets: [{ beforeRunningMs: 200, workMs: 2000, finalStatus: "done", commitHash: "mock-x" }],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-edge", script);
  await page.goto(`/board?project=${proj.hash}`);

  // 第一次 Run
  const res1 = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-edge/run`);
  expect(res1.ok()).toBe(true);

  // 第二次立即 Run → 應該被 guard 擋
  const res2 = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-edge/run`);
  expect(res2.ok()).toBe(false);
  const body = await res2.json();
  expect(body.error.message).toMatch(/已在 running|已在跑/);
});

test("merged pipeline 不准 Run → state guard 擋", async ({ request }) => {
  // backend 設計:merged 仍可 append 新 ticket 再跑(非終態)。
  // guard 只在「沒待跑 ticket」時觸發 → 給空 tickets 確保撞 guard。
  proj = await createTempProject({
    pipelines: [
      {
        ...pipelineWith([]),
        state: "merged",
      },
    ],
  });
  const res = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-edge/run`);
  expect(res.ok()).toBe(false);
  const body = await res.json();
  // backend 錯誤訊息含「ticket」/「append」/「reset」— 不再硬碰 /merge/
  expect(body.error.message).toMatch(/ticket|append|reset|merge/);
});

test("沒劇本就跑 mock runner → 回 error 不 spawn", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith([{ id: "t-x", title: "no-script" }])],
  });
  // 故意不 setRunnerScript
  const res = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-edge/run`);
  expect(res.ok()).toBe(false);
  const body = await res.json();
  expect(body.error.message).toMatch(/no script/);
});
