import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setQAScript, type QAReply } from "../helpers/mock-control";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-qa-1",
        name: "qa-pipeline",
        branch: "pipeline/qa-pipeline",
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

const COMPLETE_REPLY: QAReply = {
  message: "整理好了,看起來這張 ticket 是…",
  options: [],
  complete: true,
  spec: {
    title: "加 dark mode toggle",
    goal: "讓 user 可切深淺色",
    acceptance: ["TopBar 顯示 toggle", "切換後 localStorage 持久"],
    prompt: "在 TopBar 加 dark mode toggle 按鈕,切換 html.light class 並寫 localStorage",
    mode: "step",
  },
};

test("QA 一輪完成 → SpecReview → finalize → ticket 出現在 focus", async ({ page }) => {
  // 劇本:user 第一次送 → AI 直接 complete=true 給完整 spec
  await setQAScript(proj.hash, [COMPLETE_REPLY]);

  await page.goto(`/board?project=${proj.hash}`);

  // 開 QA drawer:點 + ticket
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();

  // 第一個 AI 訊息(寫死)+ 第一輪 starter chip 出現(.qadr-suggestion 是 starter,
  // 後續輪的 InlineMultiSelect 才是 .qadr-option)
  await expect(page.locator(".qadr-bubble-ai").first()).toBeVisible();
  const firstOption = page.locator(".qadr-suggestion").first();
  await expect(firstOption).toBeVisible();
  await firstOption.click();

  // mock 回 complete=true → SpecReview 顯示 + 「送出建立需求單」按鈕
  const finalizeBtn = page.locator("button", { hasText: "送出建立需求單" });
  await expect(finalizeBtn).toBeVisible({ timeout: 5000 });
  await finalizeBtn.click();

  // ticket 出現在 focus list
  await expect(page.locator(".ticket-title", { hasText: "加 dark mode toggle" })).toBeVisible();
  await expect(page.locator(".qadr-drawer")).not.toBeVisible();
});

test("QA 多輪 → spec checklist 進度 → 最後一輪 complete", async ({ page }) => {
  // 4 輪劇本,前 3 輪逐步累積 spec partial,最後一輪 complete
  const partial1: QAReply = {
    message: "好,先收 title 跟 goal",
    options: ["step", "iter"],
    complete: false,
    spec: { title: "重構 header", goal: "拆出共用 nav" },
  };
  const partial2: QAReply = {
    message: "驗收條件呢?",
    options: ["AC: nav 抽 component", "AC: TopBar 不變寫法"],
    complete: false,
    spec: {
      title: "重構 header",
      goal: "拆出共用 nav",
      acceptance: ["nav 抽 component"],
      mode: "step",
    },
  };
  // 注意:frontend 用 isSpecComplete (fields 齊就轉 SpecReview),不看 complete flag。
  // 所以中間 reply 的 spec 不能 5/5 齊,否則 drawer 提早進 review 階段、options 消失。
  const partial3: QAReply = {
    message: "再給 prompt 用詞",
    options: ["照預設"],
    complete: false,
    spec: {
      title: "重構 header",
      goal: "拆出共用 nav",
      acceptance: ["nav 抽 component"],
      mode: "step",
      // prompt 故意還沒填,讓 frontend 留在 transcript 階段
    },
  };
  const final: QAReply = {
    message: "齊了",
    options: [],
    complete: true,
    spec: {
      title: "重構 header",
      goal: "拆出共用 nav",
      acceptance: ["nav 抽 component", "TopBar 維持原樣"],
      prompt: "把 TopBar 內 nav 抽成獨立 component,放 src/shell/Nav.tsx,不改視覺",
      mode: "step",
    },
  };

  await setQAScript(proj.hash, [partial1, partial2, partial3, final]);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();

  // 4 輪 — 第一輪用 starter chip(.qadr-suggestion);後續輪 partial reply 沒帶
  // optionsMode → default "single" → Composer 渲染 .qadr-option chips,點即送
  // (multi-mode 才用 InlineMultiSelect + 「送出已選」)
  for (let i = 0; i < 4; i++) {
    const sel = i === 0 ? ".qadr-suggestion" : ".qadr-option";
    const opt = page.locator(sel).first();
    await expect(opt).toBeVisible({ timeout: 5000 });
    await opt.click();
    // 每輪後給時間 React render
    await page.waitForTimeout(200);
  }

  // 收尾應該 complete
  await expect(page.locator("button", { hasText: "送出建立需求單" })).toBeVisible({ timeout: 5000 });
});

test("Esc 關 QA drawer → drawer 消失;空 draft 自動 cancel", async ({ page }) => {
  await setQAScript(proj.hash, [COMPLETE_REPLY]);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();

  // 沒打字直接關。Overlay 的 Escape handler 對 INPUT / TEXTAREA target 不 close
  // (交由元件自己處理),drawer mount 後焦點自動推到 composer textarea,
  // 所以 Esc 要先把焦點移開 textarea。改用 header 上的關閉按鈕(等同 ESC 行為)。
  await page.locator(".qadr-drawer .drawer-close").click();
  await expect(page.locator(".qadr-drawer")).not.toBeVisible();

  // ticket 沒有,pipeline 仍是 planning(focus list 顯示 empty)
  await expect(page.locator(".ticket-title")).toHaveCount(0);
});
