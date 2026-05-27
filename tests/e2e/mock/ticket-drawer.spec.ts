import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks } from "../helpers/mock-control";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

const TICKET_FULL = {
  id: "t-1",
  n: 1,
  title: "示範 ticket",
  goal: "驗證 drawer 各欄位",
  acceptance: ["AC1: title 顯示", "AC2: prompt 顯示"],
  prompt: "做一個 demo",
  mode: "step" as const,
  status: "done" as const,
  commits: [
    { hash: "1234567890abcdef", subject: "ticket(1): 示範 ticket", ts: Date.now() },
  ],
};

test("點 ticket → drawer 開啟,goal/acceptance/prompt 各欄位顯示", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [TICKET_FULL],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);

  // 點 ticket card
  const tcard = page.locator(".ticket", { hasText: "示範 ticket" });
  await expect(tcard).toBeVisible();
  await tcard.click();

  // drawer 出現
  await expect(page.locator(".tdrw-drawer")).toBeVisible();

  // 各 section 顯示對應內容(內容走 ReactMarkdown → .tdrw-prompt-md;done 預設折疊但 DOM 仍存)
  await expect(page.locator(".tdrw-drawer", { hasText: "驗證 drawer 各欄位" })).toBeVisible();
  await expect(page.locator(".tdrw-prompt-md", { hasText: "AC1: title 顯示" })).toBeVisible();
  await expect(page.locator(".tdrw-prompt-md", { hasText: "做一個 demo" })).toBeVisible();
});

test("commits 顯示 + 點 hash 複製", async ({ page, context }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [TICKET_FULL],
      },
    ],
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".ticket", { hasText: "示範 ticket" }).click();

  // commit hash 短碼顯示前 7 字
  const hashBtn = page.locator(".tdrw-commit-hash-btn", { hasText: "1234567" });
  await expect(hashBtn).toBeVisible();
  await hashBtn.click();

  // 驗 clipboard 拿到完整 hash(text 變「已複製」只 1.4s,polling 容易 race)
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  expect(txt).toBe("1234567890abcdef");
});

test("Esc 關 drawer", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [TICKET_FULL],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".ticket", { hasText: "示範 ticket" }).click();
  await expect(page.locator(".tdrw-drawer")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".tdrw-drawer")).not.toBeVisible();
});

test("done ticket 顯示「重開 ticket」操作按鈕", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [TICKET_FULL],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".ticket", { hasText: "示範 ticket" }).click();

  await expect(
    page.locator("button", { hasText: "重開 ticket" })
  ).toBeVisible();
});

test("draft ticket(沒 done)不顯示重置按鈕", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t-d",
            n: 1,
            title: "draft-ticket",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "ready",
          },
        ],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".ticket", { hasText: "draft-ticket" }).click();

  await expect(page.locator("button", { hasText: "重開 ticket" })).toHaveCount(0);
});

test("iter ticket 審核 block:PASS 沒 feedback 顯 placeholder「(通過,無補充意見)」", async ({ page }) => {
  // 2026-05-13 修法:critic PASS 不寫 feedback 是允許的(systemPrompt 寫「PASS 可空」)。
  // UI 不再用 truthy check 隱藏整段,改顯灰字 italic placeholder,避免 user 誤以為審核沒跑。
  proj = await createTempProject({
    pipelines: [
      {
        id: "p1",
        name: "td-pipe",
        branch: "pipeline/td-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [
          {
            id: "t-iter",
            n: 1,
            title: "iter-ticket",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "iter",
            status: "done",
            iter: {
              current: 2,
              stage: "done",
              verdicts: ["PARTIAL", "PASS"],
              rounds: [
                {
                  n: 1,
                  startedAt: Date.now() - 60_000,
                  endedAt: Date.now() - 50_000,
                  executorSummary: "Round 1 改了 X",
                  criticVerdict: "PARTIAL",
                  criticFeedback: "Round 1 還缺 Y",
                },
                {
                  n: 2,
                  startedAt: Date.now() - 30_000,
                  endedAt: Date.now() - 20_000,
                  executorSummary: "Round 2 補了 Y",
                  criticVerdict: "PASS",
                  criticFeedback: "",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".ticket", { hasText: "iter-ticket" }).click();
  await expect(page.locator(".tdrw-drawer")).toBeVisible();

  // 兩 round 都顯示 — 第二輪是 PASS + 空 feedback,審核 section 不該整段隱掉
  const roundCards = page.locator(".tdrw-iter-round");
  await expect(roundCards).toHaveCount(2);

  // Round 2 內必須含「審核 AI 回饋」label 跟 placeholder 文字(全形括號 + 全形逗號)
  const round2 = roundCards.nth(1);
  await expect(round2.locator(".tdrw-iter-round-label", { hasText: "審核 AI 回饋" })).toBeVisible();
  await expect(round2.locator(".tdrw-text", { hasText: "通過，無補充意見" })).toBeVisible();

  // Round 1 PARTIAL 有實 feedback,placeholder 不該出現
  const round1 = roundCards.nth(0);
  await expect(round1.locator(".tdrw-text", { hasText: "Round 1 還缺 Y" })).toBeVisible();
});
