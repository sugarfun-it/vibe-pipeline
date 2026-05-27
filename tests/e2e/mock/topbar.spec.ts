import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks } from "../helpers/mock-control";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

test("active project 名稱 + path 顯示在 TopBar", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);
  // path 含 tmpdir 前綴(temp project 路徑通常含 'vp-e2e-proj-')
  await expect(page.locator(".proj-trigger-path", { hasText: "vp-e2e-proj-" })).toBeVisible();
});

test("git branch chip 不顯示 (backend toProject 不 lazy fetch currentBranch)", async ({ page }) => {
  // 2026-05 起 server/lib/projectStore.ts `toProject` 不呼 git(避免每次 list /
  // status 都 spawn git);chip 渲染條件是 `hasGit && currentBranch`,currentBranch
  // 永遠 undefined → chip 不渲染。spec 改成驗證 chip 不存在,避免歷史假設誤導。
  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".topbar-current-branch")).toHaveCount(0);
});

test("theme toggle:亮 → 暗,localStorage 持久,reload 後仍 dark", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);
  // 預設 light
  await expect(page.locator("html.light")).toBeAttached();

  await page.locator(".topbar-theme-toggle").click();
  await expect(page.locator("html.light")).toHaveCount(0);
  // localStorage 應該存了 dark
  const stored = await page.evaluate(() => localStorage.getItem("vibe-pipeline:theme"));
  expect(stored).toBe("dark");

  await page.reload();
  // 第一個 frame 應該已 dark(index.html inline script)
  await expect(page.locator("html.light")).toHaveCount(0);
});

test("URL ?theme=dark override localStorage", async ({ page }) => {
  // 先設 light
  await page.goto(`/board?project=${proj.hash}`);
  await page.evaluate(() => localStorage.setItem("vibe-pipeline:theme", "light"));

  // ?theme=dark 應該 override
  await page.goto(`/board?project=${proj.hash}&theme=dark`);
  await expect(page.locator("html.light")).toHaveCount(0);
});

test("recents dropdown 開啟 + 列出當前 project", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".proj-trigger").click();
  await expect(page.locator(".proj-menu")).toBeVisible();
  await expect(page.locator(".proj-menu-item.is-active")).toBeVisible();
});

test("bell 沒 unread 時不顯示數字 badge", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".bell-dot-num")).toHaveCount(0);
});
