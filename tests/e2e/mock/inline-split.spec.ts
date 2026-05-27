// 驗 inline AI 拆分(TicketDrawer 內 ✂ 按鈕):
//   點 ticket → drawer 開 → 點「AI 拆分」→ inline 確認卡顯示預覽 →
//     確認 → backend split endpoint 用 mock script 回 N 張 spec → 原 ticket 被 N 張取代;
//     取消 → 原 ticket 不動。
//
// 與 split-into.spec.ts 不同:那條走 QA finalize 階段的 splitInto(建 ticket 時就拆);
// 本條走「ticket 已存在後再拆」inline path,呼 POST /pipelines/.../tickets/.../split。

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setSplitScript } from "../helpers/mock-control";
import type { TicketSpec } from "../../../shared/types";

let proj: TempProject;

const ORIGINAL_TICKET = {
  id: "t-orig",
  n: 1,
  status: "draft" as const,
  title: "Settings 大改造",
  goal: "把 Settings 補齊三類功能",
  acceptance: [
    "theme 切換可用",
    "default base 欄位寫回 config",
    "push 註冊按鈕可用",
  ],
  prompt: "Settings 大改:加 theme tab / project tab / 通知 tab,每類各自獨立寫回。",
  mode: "step" as const,
};

const SPLIT_SPECS: TicketSpec[] = [
  {
    title: "Settings 補 theme toggle",
    goal: "讓 user 切深淺色並持久化",
    acceptance: ["主題 tab 有 toggle", "切換後寫 localStorage", "reload 後仍保留"],
    prompt: "在 SettingsPopover 主題分頁加 toggle,綁 localStorage theme key。",
    mode: "step",
  },
  {
    title: "Settings 露 default base 欄位",
    goal: "user 可改 pipeline 預設 base branch",
    acceptance: ["Project tab 顯示 base input", "寫入 config.json", "create pipeline 帶入預設"],
    prompt: "在 SettingsPopover Project 分頁加 base branch input,onBlur 寫回 backend。",
    mode: "step",
  },
  {
    title: "Settings 加 push 註冊按鈕",
    goal: "user 可啟用 / 關閉 push",
    acceptance: ["通知 tab 顯示啟用按鈕", "register 後狀態變已啟用", "可 unregister"],
    prompt: "在 SettingsPopover 通知分頁加 push toggle,呼 fcm register / unregister。",
    mode: "iter",
    iterLimit: 3,
  },
];

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-inline-split",
        name: "inline-split-pipe",
        branch: "pipeline/inline-split",
        baseBranch: "main",
        state: "planning",
        tickets: [ORIGINAL_TICKET],
      },
    ],
  });
});

test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

async function openDrawerAndTriggerSplit(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/board?project=${proj.hash}`);
  // 點 ticket card → drawer 開
  const tcard = page.locator(".ticket", { hasText: "Settings 大改造" });
  await expect(tcard).toBeVisible();
  await tcard.click();
  await expect(page.locator(".tdrw-drawer")).toBeVisible();
  // 點 AI 拆分按鈕
  const splitBtn = page.locator(".tdrw-action", { hasText: "AI 拆分" });
  await expect(splitBtn).toBeVisible();
  await splitBtn.click();
  // inline 確認卡出現
  await expect(page.locator(".tdrw-split-confirm")).toBeVisible();
  // confirm title 是固定文字「以 AI 拆分並取代這張 ticket」(不含 ticket title)
  await expect(
    page.locator(".tdrw-split-confirm-title", { hasText: "以 AI 拆分" })
  ).toBeVisible();
}

test("inline AI 拆分 → 確認 → 原 ticket 被替換成 3 張", async ({ page }) => {
  await setSplitScript(proj.hash, SPLIT_SPECS);

  await openDrawerAndTriggerSplit(page);

  // 確認鈕(內含 ScissorsIcon)— class 已改 .tdrw-action-danger + .tdrw-split-confirm-cta
  const confirmBtn = page.locator(".tdrw-split-confirm-cta", {
    hasText: "拆分並取代原 ticket",
  });
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();

  // drawer 關閉(BoardScreen 在成功後 setOpenTicket(null))
  await expect(page.locator(".tdrw-drawer")).not.toBeVisible({ timeout: 10000 });

  // board 上出現三張新 ticket title;原 ticket 不在
  for (const s of SPLIT_SPECS) {
    await expect(page.locator(".ticket-title", { hasText: s.title })).toBeVisible({
      timeout: 5000,
    });
  }
  await expect(page.locator(".ticket-title", { hasText: "Settings 大改造" })).toHaveCount(0);

  // pipeline.json 驗 spec
  const pipelinePath = join(proj.path, ".vibe-pipeline", "pipelines", "pipe-inline-split.json");
  const pipeline = JSON.parse(readFileSync(pipelinePath, "utf-8")) as {
    tickets: Array<{
      id: string;
      n: number;
      status: string;
      title: string;
      goal: string;
      acceptance: string[];
      prompt: string;
      mode: string;
      iterLimit?: number;
    }>;
  };
  expect(pipeline.tickets).toHaveLength(3);
  expect(pipeline.tickets.map((t) => t.n)).toEqual([1, 2, 3]);
  // id 唯一,且都不是原 ticket id
  const ids = pipeline.tickets.map((t) => t.id);
  expect(new Set(ids).size).toBe(3);
  expect(ids).not.toContain("t-orig");
  for (let i = 0; i < 3; i++) {
    const t = pipeline.tickets[i];
    expect(t.status).toBe("draft");
    expect(t.title).toBe(SPLIT_SPECS[i].title);
    expect(t.goal).toBe(SPLIT_SPECS[i].goal);
    expect(t.acceptance).toEqual(SPLIT_SPECS[i].acceptance);
    expect(t.prompt).toBe(SPLIT_SPECS[i].prompt);
    expect(t.mode).toBe(SPLIT_SPECS[i].mode);
  }
  expect(pipeline.tickets[2].mode).toBe("iter");
  expect(pipeline.tickets[2].iterLimit).toBe(3);
});

test("inline AI 拆分 → 取消 → 原 ticket 不動,confirm 卡收起", async ({ page }) => {
  // 即便設了 split script,user 取消就不該呼 backend
  await setSplitScript(proj.hash, SPLIT_SPECS);

  await openDrawerAndTriggerSplit(page);

  // 點取消
  const cancelBtn = page.locator(".tdrw-split-confirm-actions .tdrw-action", {
    hasText: "取消",
  });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();

  // confirm 卡消失;AI 拆分原按鈕回來
  await expect(page.locator(".tdrw-split-confirm")).not.toBeVisible();
  await expect(page.locator(".tdrw-action", { hasText: "AI 拆分" })).toBeVisible();

  // pipeline.json 不變:只有原 ticket
  const pipelinePath = join(proj.path, ".vibe-pipeline", "pipelines", "pipe-inline-split.json");
  const pipeline = JSON.parse(readFileSync(pipelinePath, "utf-8")) as {
    tickets: Array<{ id: string; title: string }>;
  };
  expect(pipeline.tickets).toHaveLength(1);
  expect(pipeline.tickets[0].id).toBe("t-orig");
  expect(pipeline.tickets[0].title).toBe("Settings 大改造");
});
