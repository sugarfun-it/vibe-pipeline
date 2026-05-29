// Visual regression probe — 重構應「視覺零變化」的機械驗證(F CSS px→token 等)。
// before(重構前 commit)跑 --update-snapshots 生 baseline,after(現 main)跑比對。
// 動態 noise 用 planning-state seed(無 running elapsed / cost)+ animations:disabled 消除。
import { expect, test } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks } from "../helpers/mock-control";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
] as const;

function seedPipelines() {
  return [
    {
      id: "pipe-vis",
      name: "visual-demo",
      branch: "pipeline/visual-demo",
      baseBranch: "main",
      state: "planning",
      tickets: [
        {
          id: "vis-t-1",
          n: 1,
          title: "視覺驗證 ticket",
          goal: "驗證重構後視覺等價",
          acceptance: ["board 顯示正常", "drawer 排版一致", "settings 排版一致"],
          prompt: "視覺回歸用 ticket",
          mode: "iter",
          status: "ready",
        },
      ],
    },
  ];
}

for (const vp of VIEWPORTS) {
  test.describe(`visual ${vp.name}`, () => {
    // opt-in probe:預設 skip(baseline 是本機 win32 圖,進 CI / 跨環境字體會誤報)。
    // 重構後手動驗視覺零回歸:`VISUAL=1 bunx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/mock/visual.spec.ts`
    // 跨環境首次:同指令加 --update-snapshots 在該環境重生 baseline。
    test.skip(!process.env.VISUAL, "visual regression probe — set VISUAL=1 to run");
    test.use({ viewport: { width: vp.width, height: vp.height } });

    let proj: TempProject | null = null;

    test.beforeEach(async () => {
      await resetMocks();
      proj = await createTempProject({ pipelines: seedPipelines() });
    });

    test.afterEach(() => {
      if (proj) cleanupTempProject(proj);
      proj = null;
    });

    test("board", async ({ page }) => {
      await page.goto(`/board?project=${proj!.hash}`);
      await expect(page.locator(".focus")).toBeVisible();
      await expect(page.locator(".focus-title")).toBeVisible();
      await expect(page).toHaveScreenshot(`board-${vp.name}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        // temp project 名是 random(vp-e2e-proj-xxxx)→ mask 掉避免 noise
        mask: [page.locator(".proj-trigger")],
      });
    });

    test("ticket-drawer", async ({ page }) => {
      await page.goto(`/board?project=${proj!.hash}`);
      await page.locator(".ticket").first().click();
      const drawer = page.locator(".tdrw-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.locator(".tdrw-section-label").first()).toBeVisible();
      await expect(drawer).toHaveScreenshot(`drawer-${vp.name}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
      });
    });

    test("settings", async ({ page }) => {
      await page.goto(`/board?project=${proj!.hash}`);
      await page.locator(".topbar .icon-btn[title='設定']").click();
      const popover = page.locator(".settings-popover");
      await expect(popover).toBeVisible();
      await expect(popover.getByRole("tab", { name: "專案" })).toBeVisible();
      await expect(popover).toHaveScreenshot(`settings-${vp.name}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
      });
    });
  });
}
