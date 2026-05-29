import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setQAScript, type QAReply } from "../helpers/mock-control";

// 覆蓋 2026-05-13 加的 QA reopen 流程:
// - SpecReview「← 繼續討論」切回 chat(viewOverride='chat')
// - chat 送訊息後不立刻跳回 SpecReview(race regression guard)
// - chat 頂顯「→ 查看最終預覽」橫條,點下去切回(viewOverride='review')
// - reopen 後改完 spec finalize → ticket 出現
//
// 對應 backend 修法:claudeCli systemPrompt rule 6 + draftStore auto-complete(wasComplete && reply.complete!==false 才 fire);
// frontend:viewOverride 'chat'|'review'|null 雙向,不在送訊息時清

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-reopen-1",
        name: "reopen-pipeline",
        branch: "pipeline/reopen-pipeline",
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

const SPEC_5_5 = {
  title: "加 light theme",
  goal: "切換亮色背景",
  acceptance: ["TopBar 有 toggle", "持久化 localStorage"],
  prompt: "加 ToggleLight icon button 在 TopBar,切換 html.light + 寫 localStorage",
  mode: "step" as const,
};

const COMPLETE_REPLY: QAReply = {
  message: "整理好了",
  options: [],
  complete: true,
  spec: SPEC_5_5,
};

// reopen 場景:user 點繼續討論後送訊息,AI 看 rule 6 必須回 complete=false
const REOPEN_REPLY: QAReply = {
  message: "退回 chat 了。要改 / 加什麼?",
  options: [],
  complete: false,
  spec: SPEC_5_5,
};

// reopen 後 user 再送一句,AI 補 spec(acceptance 加一條)
const ADJUSTED_REPLY: QAReply = {
  message: "OK,acceptance 加了一條:預設跟系統主題",
  options: [],
  complete: false,
  spec: {
    ...SPEC_5_5,
    acceptance: ["TopBar 有 toggle", "持久化 localStorage", "預設跟系統主題"],
  },
};

async function startQAAndReachSpecReview(page: import("@playwright/test").Page) {
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();
  // 第一輪用 starter chip(.qadr-suggestion);後續輪才是 InlineMultiSelect(.qadr-option)
  await page.locator(".qadr-suggestion").first().click();
  await expect(page.locator("button", { hasText: "送出建立需求單" })).toBeVisible({ timeout: 5000 });
}

test("繼續討論:SpecReview → chat 視圖切換", async ({ page }) => {
  await setQAScript(proj.hash, [COMPLETE_REPLY]);
  await startQAAndReachSpecReview(page);

  // 點繼續討論 → SpecReview 消失,chat composer 顯示
  await page.locator("button", { hasText: "繼續討論" }).click();
  await expect(page.locator("button", { hasText: "送出建立需求單" })).not.toBeVisible();
  await expect(page.locator(".qadr-composer")).toBeVisible();
});

test("race regression:繼續討論後送訊息,SpecReview 不立刻跳回", async ({ page }) => {
  // 兩輪劇本:第一輪 complete=true 進 review;第二輪 reopen 返 complete=false 留 chat
  await setQAScript(proj.hash, [COMPLETE_REPLY, REOPEN_REPLY]);
  await startQAAndReachSpecReview(page);

  await page.locator("button", { hasText: "繼續討論" }).click();
  await expect(page.locator(".qadr-composer")).toBeVisible();

  // 在 composer 送一句
  const composer = page.locator(".qadr-composer textarea");
  await composer.fill("我想加個跟系統主題同步的條件");
  await page.keyboard.press("Enter");

  // 關鍵 regression:就算 backend 還沒處理完,SpecReview 也不能瞬間跳回
  // (前一版 forceChat 一送就清,disk 上 draft.complete=true 還沒被改,UI 會誤跳)
  // 給 1s 短 window 內檢查
  await expect(page.locator("button", { hasText: "送出建立需求單" })).not.toBeVisible({ timeout: 1000 });

  // 用「第二輪 AI 回應已落地」當確定 anchor 取代 waitForTimeout:
  // REOPEN_REPLY 的 message 出現在 chat bubble = 第二輪 complete=false 已寫回 draft。
  // 此 anchor 反映時序「送訊息 → 收回應」,且回應落地後仍須維持 chat(不跳回 SpecReview)。
  await expect(
    page.locator(".qadr-bubble-ai .qadr-bubble-msg", { hasText: "退回 chat 了" }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator("button", { hasText: "送出建立需求單" })).not.toBeVisible();
  await expect(page.locator(".qadr-composer")).toBeVisible();
});

test("chat 頂顯「→ 查看最終預覽」橫條,點下去切回 SpecReview", async ({ page }) => {
  await setQAScript(proj.hash, [COMPLETE_REPLY]);
  await startQAAndReachSpecReview(page);

  await page.locator("button", { hasText: "繼續討論" }).click();

  // chat 頂 banner 顯「→ 查看最終預覽」按鈕(spec 已 5/5 + !showReview)
  const returnBtn = page.locator("button", { hasText: "查看最終預覽" });
  await expect(returnBtn).toBeVisible();

  // 點下去 → SpecReview 回來
  await returnBtn.click();
  await expect(page.locator("button", { hasText: "送出建立需求單" })).toBeVisible();
});

test("reopen → 改 spec → 查看最終預覽 → finalize → ticket 出現", async ({ page }) => {
  await setQAScript(proj.hash, [COMPLETE_REPLY, ADJUSTED_REPLY]);
  await startQAAndReachSpecReview(page);

  await page.locator("button", { hasText: "繼續討論" }).click();

  // 送補充訊息
  const composer = page.locator(".qadr-composer textarea");
  await composer.fill("acceptance 加一條:預設跟系統主題");
  await page.keyboard.press("Enter");

  // 用「補充輪 AI 回應已落地」當確定 anchor 取代 waitForTimeout:
  // ADJUSTED_REPLY 的 message 出現 = 第二輪 spec 更新已寫回 draft,且仍維持 chat。
  await expect(
    page.locator(".qadr-bubble-ai .qadr-bubble-msg", { hasText: "acceptance 加了一條" }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".qadr-composer")).toBeVisible();

  // 點 查看最終預覽 → SpecReview 顯
  await page.locator("button", { hasText: "查看最終預覽" }).click();
  const finalize = page.locator("button", { hasText: "送出建立需求單" });
  await expect(finalize).toBeVisible();

  // 不檢查 acceptance 內容(textarea value assert 跨 form lib 不穩),直接送出
  await finalize.click();

  // ticket 出現在 focus list
  await expect(page.locator(".ticket-title", { hasText: "加 light theme" })).toBeVisible();
  await expect(page.locator(".qadr-drawer")).not.toBeVisible();
});
