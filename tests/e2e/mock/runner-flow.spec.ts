import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
});

test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

function pipelineWithTickets(tickets: Array<{ id: string; title: string; mode?: "step" | "iter" }>) {
  return {
    id: "pipe-run-1",
    name: "run-pipeline",
    branch: "pipeline/run-pipeline",
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

type RunnerFlowPipeline = {
  state: string;
  tickets: Array<{
    id: string;
    status: string;
    commits?: Array<{ hash?: string }>;
    iter?: { verdicts?: string[]; rounds?: Array<{ criticVerdict?: string }> };
  }>;
};

async function readPipeline(
  request: APIRequestContext,
  hash: string,
  pipelineId = "pipe-run-1"
): Promise<RunnerFlowPipeline> {
  const res = await request.get(`/api/projects/${hash}/pipelines/${pipelineId}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { ok: boolean; data?: RunnerFlowPipeline };
  expect(body.ok).toBe(true);
  expect(body.data).toBeTruthy();
  return body.data!;
}

async function clickImmediateStop(page: Page): Promise<void> {
  await page.getByRole("button", { name: /停止/ }).click();
}

test("step ticket Run → running → done → ready,commit hash 寫回", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [pipelineWithTickets([{ id: "t-step-1", title: "single-step" }])],
  });
  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 50,
        workMs: 80,
        finalStatus: "done",
        commitHash: "mock-abc1234567",
        commitSubject: "ticket(1): single-step",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-run-1", script);

  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".rail-item-name", { hasText: "run-pipeline" })).toBeVisible();

  // 按 ▶ 開始運行
  await page.locator("[data-testid='run-btn']").click();

  await expect.poll(async () => (await readPipeline(request, proj.hash)).state).toBe("ready");
  const done = await readPipeline(request, proj.hash);
  expect(done.tickets[0].status).toBe("done");
  expect(done.tickets[0].commits?.[0]?.hash).toBe("mock-abc1234567");
});

test("iter mode FAIL → PASS chain,verdicts 顯示", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [pipelineWithTickets([{ id: "t-iter-1", title: "iter-task", mode: "iter" }])],
  });
  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 50,
        iterRounds: [
          { verdict: "FAIL", durationMs: 60, executorSummary: "first attempt", criticFeedback: "missed AC2" },
          { verdict: "PASS", durationMs: 60, executorSummary: "addressed feedback", criticFeedback: "looks good" },
        ],
        finalStatus: "done",
        commitHash: "mock-deadbeef",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-run-1", script);

  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  await expect.poll(async () => (await readPipeline(request, proj.hash)).state).toBe("ready");

  const done = await readPipeline(request, proj.hash);
  expect(done.tickets[0].iter?.verdicts).toEqual(["FAIL", "PASS"]);
  expect(done.tickets[0].iter?.rounds?.map((r) => r.criticVerdict)).toEqual(["FAIL", "PASS"]);
});

test("Pause running → state 立即變 paused,resume 接續", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [
      pipelineWithTickets([
        { id: "t-pause-1", title: "first" },
        { id: "t-pause-2", title: "second" },
      ]),
    ],
  });
  const script: RunnerScript = {
    // workMs 拉長,給 Windows + fs.watch noisy 環境留時間讓 polling 捕捉 running 狀態
    tickets: [
      { beforeRunningMs: 100, workMs: 4000, finalStatus: "done", commitHash: "mock-1" },
      { beforeRunningMs: 50, workMs: 100, finalStatus: "done", commitHash: "mock-2" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-run-1", script);

  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  await expect.poll(async () => {
    const p = await readPipeline(request, proj.hash);
    return p.tickets.find((t) => t.id === "t-pause-1")?.status;
  }, { timeout: 10000 }).toBe("running");

  await clickImmediateStop(page);

  await expect.poll(async () => (await readPipeline(request, proj.hash)).state).toBe("paused");
  const paused = await readPipeline(request, proj.hash);
  expect(paused.tickets.find((t) => t.id === "t-pause-1")?.status).toBe("paused");
  expect(paused.tickets.find((t) => t.id === "t-pause-2")?.status).toBe("ready");

  await page.getByRole("button", { name: /繼續/ }).click();
  await expect.poll(async () => (await readPipeline(request, proj.hash)).state).toBe("ready");
});

test("ticket 跑中段按停止 → ticket 直接標 paused", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [
      pipelineWithTickets([
        { id: "t-mid-1", title: "long-running" },
        { id: "t-mid-2", title: "next" },
      ]),
    ],
  });
  const script: RunnerScript = {
    tickets: [
      { beforeRunningMs: 50, workMs: 2000, finalStatus: "done", commitHash: "mock-mid-1" },
      { beforeRunningMs: 50, workMs: 100, finalStatus: "done", commitHash: "mock-mid-2" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-run-1", script);

  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  await expect.poll(async () => {
    const p = await readPipeline(request, proj.hash);
    return p.tickets.find((t) => t.id === "t-mid-1")?.status;
  }).toBe("running");

  await clickImmediateStop(page);

  await expect.poll(async () => {
    const p = await readPipeline(request, proj.hash);
    return {
      state: p.state,
      first: p.tickets.find((t) => t.id === "t-mid-1")?.status,
      second: p.tickets.find((t) => t.id === "t-mid-2")?.status,
    };
  }).toEqual({ state: "paused", first: "paused", second: "ready" });

  await expect.poll(async () => {
    const p = await readPipeline(request, proj.hash);
    return {
      state: p.state,
      first: p.tickets.find((t) => t.id === "t-mid-1")?.status,
      second: p.tickets.find((t) => t.id === "t-mid-2")?.status,
    };
  }, { timeout: 1300, intervals: [300, 500, 500] }).toEqual({
    state: "paused",
    first: "paused",
    second: "ready",
  });
});

test("按停止 → pipeline.state 從 running 直接到 paused,不經其他中介值", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [pipelineWithTickets([{ id: "t-state-1", title: "state-watch" }])],
  });
  const script: RunnerScript = {
    tickets: [
      { beforeRunningMs: 50, workMs: 2000, finalStatus: "done", commitHash: "mock-state-1" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "pipe-run-1", script);

  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  await expect.poll(async () => (await readPipeline(request, proj.hash)).state).toBe("running");

  const observed: string[] = [];
  const observer = (async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = (await readPipeline(request, proj.hash)).state;
      observed.push(state);
      if (state === "paused") return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();

  await clickImmediateStop(page);
  await observer;

  expect(observed).toContain("running");
  expect(observed).toContain("paused");
  expect(observed.every((state) => state === "running" || state === "paused")).toBe(true);
});

test("沒 ticket 的 pipeline 顯示「無ticket可執行」按鈕", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-empty-1",
        name: "empty-pipe",
        branch: "pipeline/empty-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator("button", { hasText: /無.*ticket|無 ticket/ })).toBeVisible();
});
