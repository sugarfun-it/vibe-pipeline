// 驗 QA 收斂出 splitInto: TicketSpec[] 時,backend 展開成 N 張 ticket 入列。
// 流程:mock QA 劇本 → 一輪 complete=true + splitInto 三件 → SpecReview 顯示拆分提案 →
//      按「送出建立 3 張 ticket」→ board 出現 3 張、pipeline.json 落地各自 spec。

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setQAScript, type QAReply } from "../helpers/mock-control";

let proj: TempProject;

const SPLIT_REPLY: QAReply = {
  message: "看起來這 ticket 範圍跨三件獨立工作,先拆好給你。",
  options: [],
  complete: true,
  spec: {
    title: "Settings 補三類欄位",
    goal: "讓 user 可在 Settings 一次配 theme / default base / push token",
    acceptance: [
      "theme 切換存 localStorage 並於 reload 保留",
      "default base branch 欄位寫進 ~/.vibe-pipeline/config.json",
      "push token register / unregister 按鈕可用",
    ],
    prompt: "在 SettingsPopover 一次補齊三個分類 tab(主題 / Project / 通知),每類各自獨立寫回。",
    mode: "step",
  },
  splitInto: [
    {
      title: "Settings 補 theme toggle",
      goal: "讓 user 切深淺色並持久化",
      acceptance: ["主題 tab 有 toggle", "切換後寫 localStorage", "reload 後仍保留"],
      prompt: "在 SettingsPopover 主題分頁加 toggle,綁 localStorage `theme`,html class 同步切換。",
      mode: "step",
    },
    {
      title: "Settings 露 default base branch 欄位",
      goal: "user 可改 pipeline 新建時的預設 base branch",
      acceptance: ["Project tab 顯示 base branch input", "寫入 .vibe-pipeline/config.json", "下次 create pipeline 帶入預設值"],
      prompt: "在 SettingsPopover Project 分頁加 base branch input,onBlur 寫回 backend /api/projects/<hash>/config。",
      mode: "step",
    },
    {
      title: "Settings 加 push token 註冊按鈕",
      goal: "user 可在 Settings 啟用 / 關閉 push",
      acceptance: ["通知 tab 顯示啟用按鈕", "成功 register 後狀態變已啟用", "可 unregister"],
      prompt: "在 SettingsPopover 通知分頁加 push toggle,呼叫 fcm.ts register / unregister,顯示當前狀態。",
      mode: "iter",
      iterLimit: 3,
    },
  ],
};

test.beforeEach(async () => {
  await resetMocks();
  proj = await createTempProject({
    pipelines: [
      {
        id: "pipe-split-1",
        name: "split-pipeline",
        branch: "pipeline/split-pipeline",
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

test("QA finalize splitInto 三件 → board 三張 ticket + pipeline.json 各自完整 spec", async ({ page }) => {
  await setQAScript(proj.hash, [SPLIT_REPLY]);

  await page.goto(`/board?project=${proj.hash}`);

  // 開 QA drawer
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();

  // 第一個 AI option(寫死 hello 開場)出現 → 點任意一個觸發第一輪 reply
  const firstOption = page.locator(".qadr-option").first();
  await expect(firstOption).toBeVisible();
  await firstOption.click();

  // splitInto 提案區塊顯示
  await expect(page.locator(".qadr-split-proposal")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".qadr-split-list li")).toHaveCount(3);

  // 預設勾選「送出時拆成 3 張」→ 按鈕顯示 3
  const splitToggle = page.locator(".qadr-split-toggle input[type=checkbox]");
  await expect(splitToggle).toBeChecked();
  const finalizeBtn = page.locator("button", { hasText: "送出建立 3 張 ticket" });
  await expect(finalizeBtn).toBeVisible();
  await finalizeBtn.click();

  // 三張 ticket 都在 board 上
  const titles = [
    "Settings 補 theme toggle",
    "Settings 露 default base branch 欄位",
    "Settings 加 push token 註冊按鈕",
  ];
  for (const t of titles) {
    await expect(page.locator(".ticket-title", { hasText: t })).toBeVisible({ timeout: 5000 });
  }
  await expect(page.locator(".ticket-title")).toHaveCount(3);
  await expect(page.locator(".qadr-drawer")).not.toBeVisible();

  // 讀 pipeline.json 驗 spec 各欄位 + n 連號 + id 唯一
  const pipelinePath = join(proj.path, ".vibe-pipeline", "pipelines", "pipe-split-1.json");
  const raw = readFileSync(pipelinePath, "utf-8");
  const pipeline = JSON.parse(raw) as {
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
  // n 連號 1,2,3
  expect(pipeline.tickets.map((t) => t.n)).toEqual([1, 2, 3]);
  // id 唯一
  const ids = pipeline.tickets.map((t) => t.id);
  expect(new Set(ids).size).toBe(3);
  // 每張都 status=draft 且具完整 spec
  for (let i = 0; i < 3; i++) {
    const t = pipeline.tickets[i];
    expect(t.status).toBe("draft");
    expect(t.title).toBe(SPLIT_REPLY.splitInto![i].title);
    expect(t.goal).toBe(SPLIT_REPLY.splitInto![i].goal);
    expect(t.acceptance).toEqual(SPLIT_REPLY.splitInto![i].acceptance);
    expect(t.prompt).toBe(SPLIT_REPLY.splitInto![i].prompt);
    expect(t.mode).toBe(SPLIT_REPLY.splitInto![i].mode);
  }
  // 第三張 iter + iterLimit 帶到
  expect(pipeline.tickets[2].mode).toBe("iter");
  expect(pipeline.tickets[2].iterLimit).toBe(3);
});

test("user 取消勾選拆分 → 只建 1 張合併版 ticket", async ({ page }) => {
  await setQAScript(proj.hash, [SPLIT_REPLY]);

  await page.goto(`/board?project=${proj.hash}`);
  await page.locator(".focus-add-ticket").click();
  await expect(page.locator(".qadr-drawer")).toBeVisible();
  await page.locator(".qadr-option").first().click();

  // 等 splitInto 提案出現後取消勾選
  await expect(page.locator(".qadr-split-proposal")).toBeVisible({ timeout: 5000 });
  const splitToggle = page.locator(".qadr-split-toggle input[type=checkbox]");
  await splitToggle.uncheck();
  // 按鈕文字退回單張版本
  const oneBtn = page.locator("button", { hasText: /^送出建立 ticket$/ });
  await expect(oneBtn).toBeVisible();
  await oneBtn.click();

  // 只 1 張,title 是合併版主 spec
  await expect(page.locator(".ticket-title", { hasText: "Settings 補三類欄位" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".ticket-title")).toHaveCount(1);

  const pipelinePath = join(proj.path, ".vibe-pipeline", "pipelines", "pipe-split-1.json");
  const pipeline = JSON.parse(readFileSync(pipelinePath, "utf-8")) as {
    tickets: Array<{ n: number; title: string }>;
  };
  expect(pipeline.tickets).toHaveLength(1);
  expect(pipeline.tickets[0].n).toBe(1);
  expect(pipeline.tickets[0].title).toBe("Settings 補三類欄位");
});
