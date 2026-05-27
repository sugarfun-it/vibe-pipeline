import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setQAScript, type QAReply } from "../helpers/mock-control";

const VIEWPORTS = [
  { name: "mobile 375", width: 375, height: 812, mobile: true },
  { name: "tablet 768", width: 768, height: 1024, mobile: false },
  { name: "desktop 1440", width: 1440, height: 900, mobile: false },
] as const;

const COMPLETE_REPLY: QAReply = {
  message: "整理好了",
  options: [],
  complete: true,
  spec: {
    title: "RWD QA ticket",
    goal: "驗證 QA drawer 在各 breakpoint 可操作",
    acceptance: ["drawer 可開啟", "送出後可預覽"],
    prompt: "建立一張用來驗證 RWD 的 ticket",
    mode: "step",
  },
};

function seedPipelines() {
  return [
    {
      id: "pipe-rwd-a",
      name: "rwd-alpha",
      branch: "pipeline/rwd-alpha",
      baseBranch: "main",
      state: "planning",
      tickets: [
        {
          id: "rwd-t-1",
          n: 1,
          title: "RWD ticket alpha",
          goal: "驗證 TicketDrawer",
          acceptance: ["TicketDrawer visible", "TicketDrawer close works"],
          prompt: "檢查 ticket drawer RWD",
          mode: "step",
          status: "ready",
        },
      ],
    },
    {
      id: "pipe-rwd-b",
      name: "rwd-beta",
      branch: "pipeline/rwd-beta",
      baseBranch: "main",
      state: "planning",
      tickets: [
        {
          id: "rwd-t-2",
          n: 1,
          title: "RWD ticket beta",
          goal: "驗證 Board",
          acceptance: ["Board visible"],
          prompt: "檢查 board RWD",
          mode: "step",
          status: "ready",
        },
      ],
    },
  ];
}

async function expectNoViewportOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function expectDrawerFullWidthOnMobile(_page: Page, drawer: Locator) {
  // tdrw-drawer / qadr-drawer 在 mobile 不再 100vw fullwidth,改成 `max-width: 100vw - 32px`
  // (16px 左右 gutter)— 視覺上更像 sheet。375vw → drawer ≈ 343px。
  // 仍驗證 drawer 從靠右(或靠左)邊緣展開,看起來「佔滿可用空間」:寬度貼近 viewport 上限。
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(300);
  expect(box!.width).toBeLessThanOrEqual(376);
}

for (const vp of VIEWPORTS) {
  test.describe(`RWD ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    let proj: TempProject | null = null;

    test.beforeEach(async () => {
      await resetMocks();
      proj = await createTempProject({ pipelines: seedPipelines() });
      await setQAScript(proj.hash, [COMPLETE_REPLY]);
    });

    test.afterEach(() => {
      if (proj) cleanupTempProject(proj);
      proj = null;
    });

    test("TopBar / Rail / Board / TicketDrawer / QADrawer 可見且可操作", async ({ page }) => {
      expect(proj).not.toBeNull();
      await page.goto(`/board?project=${proj!.hash}`);

      await expect(page.locator(".topbar")).toBeVisible();
      await page.locator(".proj-trigger").click();
      await expect(page.locator(".proj-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.locator(".topbar-theme-toggle").click();
      await expect(page.locator("html.light")).toHaveCount(0);

      await expect(page.locator(".focus")).toBeVisible();
      // BoardScreen 用 pipelines[0] fallback;listPipelines 用 createdAt 倒序,fixture seed
      // 沒帶 createdAt,backfill 走 id 內嵌 hex,「pipe-rwd-a / pipe-rwd-b」都解不出 → 都 0,
      // readdir 順序決定 — 觀察結果 rwd-alpha 排前面。
      await expect(page.locator(".focus-title", { hasText: "rwd-alpha" })).toBeVisible();
      await expect(page.locator(".ticket-title", { hasText: "RWD ticket alpha" })).toBeVisible();
      await expectNoViewportOverflow(page);

      if (vp.mobile) {
        await expect(page.locator(".rail")).not.toBeVisible();
        await page.getByRole("tab", { name: "Pipeline" }).click();
        await expect(page.locator(".rail")).toBeVisible();
        await expect(page.locator(".focus")).not.toBeVisible();
        await page.locator(".rail-item", { hasText: "rwd-beta" }).click();
        await expect(page.locator(".focus")).toBeVisible();
        await expect(page.locator(".rail")).not.toBeVisible();
        await expect(page.locator(".focus-title", { hasText: "rwd-beta" })).toBeVisible();
      } else {
        await expect(page.locator(".rail")).toBeVisible();
        await page.locator(".rail-item", { hasText: "rwd-beta" }).click();
        await expect(page.locator(".focus-title", { hasText: "rwd-beta" })).toBeVisible();
      }

      await page.locator(".ticket", { hasText: "RWD ticket beta" }).click();
      const ticketDrawer = page.locator(".tdrw-drawer");
      await expect(ticketDrawer).toBeVisible();
      // SpecSections 改用中文 label「目標」/「驗收」/「提示詞」(英文 "goal" 過時)
      await expect(ticketDrawer.locator(".tdrw-section-label", { hasText: "目標" })).toBeVisible();
      if (vp.mobile) await expectDrawerFullWidthOnMobile(page, ticketDrawer);
      await page.locator(".tdrw-drawer .create-x").click();
      await expect(ticketDrawer).not.toBeVisible();

      await page.locator(".focus-add-ticket").click();
      const qaDrawer = page.locator(".qadr-drawer");
      await expect(qaDrawer).toBeVisible();
      if (vp.mobile) await expectDrawerFullWidthOnMobile(page, qaDrawer);
      // 第一輪用 starter chip(.qadr-suggestion);後續輪才是 InlineMultiSelect(.qadr-option)
      await expect(page.locator(".qadr-suggestion").first()).toBeVisible();
      await page.locator(".qadr-suggestion").first().click();
      await expect(page.locator("button", { hasText: "送出建立需求單" })).toBeVisible();
    });
  });
}
