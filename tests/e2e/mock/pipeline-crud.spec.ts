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

test("空 project 顯示 create CTA,點 → 建立 pipeline → Rail 出現", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);

  // 沒 pipeline 時 Rail 顯示「新 pipeline」按鈕
  const addBtn = page.locator(".rail-add").filter({ hasText: "新 pipeline" });
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // CreateCard 表單出現
  const input = page.locator(".create-card input.mono");
  await expect(input).toBeVisible();
  await input.fill("ship-it");

  await page.locator(".create-submit").click();

  // 建立成功 → Rail 出現該 pipeline
  await expect(page.locator(".rail-item-name", { hasText: "ship-it" })).toBeVisible();
});

test("名稱重複 → 建立按鈕 disabled + 錯誤提示", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);

  // 先建一條
  await page.locator(".rail-add").click();
  await page.locator(".create-card input.mono").fill("first");
  await page.locator(".create-submit").click();
  await expect(page.locator(".rail-item-name", { hasText: "first" })).toBeVisible();

  // 再開一次,填同名
  await page.locator(".rail-add").click();
  await page.locator(".create-card input.mono").fill("first");
  await expect(page.locator(".form-hint--error", { hasText: "已存在" })).toBeVisible();
  await expect(page.locator(".create-submit")).toBeDisabled();
});

test("名稱不合法 → 提示 + 建立 disabled", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);

  await page.locator(".rail-add").click();
  await page.locator(".create-card input.mono").fill("Bad Name!");
  await expect(page.locator(".form-hint--error", { hasText: "小寫英文" })).toBeVisible();
  await expect(page.locator(".create-submit")).toBeDisabled();
});

test("Esc 取消建立 → CreateCard 收起,Rail 不變", async ({ page }) => {
  await page.goto(`/board?project=${proj.hash}`);

  await page.locator(".rail-add").click();
  // 等 CreateCard 真的出現再 fill,避免 race
  const input = page.locator(".create-card input.mono");
  await expect(input).toBeVisible();
  await input.fill("never-saved");
  // Esc 從 input 上送
  await input.press("Escape");

  // CreateCard 消失,「新 pipeline」CTA 回來
  await expect(page.locator(".create-card")).toHaveCount(0);
  await expect(page.locator(".rail-add")).toBeVisible();
});

test("rename inline ✎ → 改名 enter 套用", async ({ page }) => {
  // seed 一條
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-rn-1",
        name: "old-name",
        branch: "pipeline/old-name",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);

  // 點 ✎ 編輯按鈕(focus title 區)
  const editBtn = page.locator("button[title='改名']");
  await expect(editBtn).toBeVisible();
  await editBtn.click();

  // 編輯態的 input(用 inline rename input 唯一特徵 — 在 .focus-title 旁邊)
  const input = page.locator("input.mono").filter({ hasNot: page.locator("[placeholder]") });
  await input.fill("new-name");
  await page.keyboard.press("Enter");

  // Rail / focus title 都更新
  await expect(page.locator(".rail-item-name", { hasText: "new-name" })).toBeVisible();
});

test("delete pipeline 從 overflow menu → 確認 → Rail 消失", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-del-1",
        name: "to-delete",
        branch: "pipeline/to-delete",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".rail-item-name", { hasText: "to-delete" })).toBeVisible();

  // overflow ⋯ menu(用 aria-label 區隔 TopBar 上的「更多操作」)
  const overflowBtn = page.locator("button[aria-label='更多 pipeline 操作']");
  await expect(overflowBtn).toBeVisible();
  await overflowBtn.click();

  // 點 menu 內「刪除 pipeline」→ 跳 ConfirmDialog → 點 confirm button(planning state confirmLabel=「強制刪除」)
  await page.locator("[role='menu'] button", { hasText: "刪除 pipeline" }).click();
  await page.locator(".confirm-card button", { hasText: /強制刪除|^刪除$/ }).click();

  await expect(page.locator(".rail-item-name", { hasText: "to-delete" })).toHaveCount(0);
});
