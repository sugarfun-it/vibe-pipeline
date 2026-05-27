import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

function pipelineWith(tickets: number) {
  return {
    id: "p-notif",
    name: "notif-pipe",
    branch: "pipeline/notif-pipe",
    baseBranch: "main",
    state: "planning",
    tickets: Array.from({ length: tickets }, (_, i) => ({
      id: `t-${i + 1}`,
      n: i + 1,
      title: `t${i + 1}`,
      goal: "g",
      acceptance: ["a"],
      prompt: "p",
      mode: "step",
      status: "ready",
    })),
  };
}

test("初始 inbox 是 collapsed strip,unreadCount=0", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith(0)],
  });
  await page.goto(`/board?project=${proj.hash}`);

  await expect(page.locator(".inbox-strip")).toBeVisible();
  await expect(page.locator(".inbox-strip-count")).toHaveText("0");
});

test("跑完 pipeline → emit pipeline_ready_to_merge → strip 顯示 unread", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith(1)],
  });
  const script: RunnerScript = {
    tickets: [{ beforeRunningMs: 30, workMs: 50, finalStatus: "done", commitHash: "mock-1" }],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-notif", script);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();

  // pipeline 跑完後 emit pipeline_started + pipeline_ready_to_merge,unread 應該至少 1
  await expect(page.locator(".inbox-strip-count.has-unread")).toBeVisible({ timeout: 10000 });
});

test("展開 inbox panel → 看到 notif 列表 → mark-all-read 清空 unread", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith(1)],
  });
  const script: RunnerScript = {
    tickets: [{ beforeRunningMs: 30, workMs: 50, finalStatus: "done", commitHash: "mock-2" }],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-notif", script);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();
  await expect(page.locator(".inbox-strip-count.has-unread")).toBeVisible({ timeout: 10000 });

  // 展開 inbox(strip 上的展開按鈕)
  await page.locator("[data-testid='inbox-strip-expand']").click();
  await expect(page.locator(".inbox-panel")).toBeVisible();

  // 至少一條 notif 顯示
  const items = page.locator(".inbox-item");
  await expect(items.first()).toBeVisible();

  // mark all read
  await page.locator(".inbox-foot-link", { hasText: "全部標為已讀" }).click();
  // mark-all-read 後底部連結應消失
  await expect(page.locator(".inbox-foot-link", { hasText: "全部標為已讀" })).toHaveCount(0);
});

test("inbox filter:unread / blocking 切換", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [pipelineWith(1)],
  });
  await setRunnerScript(proj.hash, "p-notif", {
    tickets: [{ beforeRunningMs: 30, workMs: 50, finalStatus: "done", commitHash: "mock-3" }],
    finalState: "ready",
  });
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator("[data-testid='run-btn']").click();
  await expect(page.locator(".inbox-strip-count.has-unread")).toBeVisible({ timeout: 10000 });

  await page.locator("[data-testid='inbox-strip-expand']").click();
  await expect(page.locator(".inbox-panel")).toBeVisible();

  // 切到 unread filter
  await page.locator(".inbox-filter-btn", { hasText: "未讀" }).click();
  await expect(page.locator(".inbox-filter-btn.is-active", { hasText: "未讀" })).toBeVisible();

  // 切到 blocking
  await page.locator(".inbox-filter-btn", { hasText: "阻斷" }).click();
  await expect(page.locator(".inbox-filter-btn.is-active", { hasText: "阻斷" })).toBeVisible();
  // ready_to_merge 是 muted/info 級,不是 block,所以 blocking filter 應該 empty
  await expect(page.locator(".inbox-empty", { hasText: "沒有阻斷類通知" })).toBeVisible();
});
