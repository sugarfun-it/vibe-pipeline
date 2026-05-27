import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, cleanupTempProject, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript } from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";

let proj: TempProject;
const API = API_BASE;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

function worktreeDir(projHash: string, pipelineId: string): string {
  const home = process.env.VP_HOME_OVERRIDE;
  if (!home) throw new Error("VP_HOME_OVERRIDE 未設,本 spec 必須在 mock e2e 環境跑");
  return join(home, ".vibe-pipeline", "worktrees", projHash, pipelineId);
}

// 不靠 mock runner 寫 pipeline.json(Windows EPERM rename 雷 → flaky),
// 直接手動 mkdir 模擬「stale worktree dir 留在 disk」場景。
// endpoint 的 removeQuiet:
//   - dir 存在 → 試 git worktree remove(沒在 git 註冊表也 OK,fallback 手動 rm)
//   - dir 不存在 → 只 prune 註冊表,回 ok:true
function seedStaleWorktreeDir(projHash: string, pipelineId: string): string {
  const wt = worktreeDir(projHash, pipelineId);
  // 空 dir(避免 Windows 檔案 lock 讓 rmSync 卡住)— acceptance 只驗 endpoint 行為,
  // 不嚴格驗 dir 被 fs.rmSync 砍掉(Windows 上有時 EBUSY,屬 pre-existing fs flake)。
  mkdirSync(wt, { recursive: true });
  return wt;
}

test("endpoint:POST /worktree/prune 砍 stale worktree dir + 回 ok", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-ep",
        name: "ep-pipe",
        branch: "pipeline/ep-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
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

  const wt = seedStaleWorktreeDir(proj.hash, "p-ep");
  expect(existsSync(wt)).toBe(true);

  const pruneRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-ep/worktree/prune`,
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
  expect(pruneRes.ok()).toBe(true);
  const body = await pruneRes.json();
  expect(body.ok).toBe(true);
  void wt;

  // pipeline.json 仍在(只清 worktree dir,不刪 pipeline)
  const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-ep`);
  expect(pipeRes.ok()).toBe(true);
});

test("endpoint:dir 不存在也 OK(idempotent)", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-noop",
        name: "noop-pipe",
        branch: "pipeline/noop-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });

  // 不建 worktree dir,直接 prune
  const wt = worktreeDir(proj.hash, "p-noop");
  expect(existsSync(wt)).toBe(false);

  const pruneRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-noop/worktree/prune`,
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
  expect(pruneRes.ok()).toBe(true);
});

test("endpoint:running 中 prune 被擋 409", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-busy",
        name: "busy-pipe",
        branch: "pipeline/busy-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
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

  // 卡住 running(workMs 大,等很久才收尾)
  await setRunnerScript(proj.hash, "p-busy", {
    tickets: [{ beforeRunningMs: 50, workMs: 10_000, finalStatus: "done" }],
    finalState: "ready",
  });
  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/p-busy/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(runRes.ok()).toBe(true);

  // 等 state = running(state 變遷在 mock runner 開頭就寫,還沒到 ticket 階段所以不踩 EPERM 雷)
  let running = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-busy`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "running") {
      running = true;
      break;
    }
  }
  expect(running, "mock runner 應進 running").toBe(true);

  const pruneRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-busy/worktree/prune`,
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
  expect(pruneRes.status()).toBe(409);

  // 收尾:pause 讓 fixture cleanup 不留 zombie
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-busy/pause`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});

test("UI:⋯ menu → 清除 worktree → confirm 取消 → worktree 仍在 + endpoint 沒呼叫", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-cancel",
        name: "cancel-pipe",
        branch: "pipeline/cancel-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
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

  const wt = seedStaleWorktreeDir(proj.hash, "p-cancel");

  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".rail-item-name", { hasText: "cancel-pipe" })).toBeVisible();

  // 監聽是否真呼叫 endpoint
  let prunePosted = false;
  await page.route("**/api/projects/*/pipelines/*/worktree/prune", async (route) => {
    prunePosted = true;
    await route.continue();
  });

  // 開 pipeline focus 的 ⋯ menu(避開 TopBar 的 .topbar-overflow-toggle)
  const overflow = page.locator(".focus-overflow button[title='更多操作']");
  await expect(overflow).toBeVisible();
  await overflow.click();
  const menu = page.locator("[role='menu']");
  await expect(menu).toBeVisible();

  const pruneItem = menu.locator("button", { hasText: "清除 worktree" });
  await expect(pruneItem).toBeEnabled();
  await pruneItem.click();

  // ConfirmDialog 出現
  const dlg = page.locator(".confirm-card");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("清除 worktree");
  // 非 merged → 顯示 warning + "強制清除"
  await expect(dlg.locator(".confirm-warning")).toBeVisible();

  // 取消
  await dlg.locator("button", { hasText: "取消" }).click();
  await expect(dlg).toHaveCount(0);

  expect(prunePosted).toBe(false);
  expect(existsSync(wt)).toBe(true);
});

test("UI:⋯ menu → 清除 worktree → confirm 確認 → endpoint 呼叫 + worktree 消失 + toast", async ({ page }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-ok",
        name: "ok-pipe",
        branch: "pipeline/ok-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
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

  const wt = seedStaleWorktreeDir(proj.hash, "p-ok");

  await page.goto(`/board?project=${proj.hash}`);
  await expect(page.locator(".rail-item-name", { hasText: "ok-pipe" })).toBeVisible();

  // 監聽 prune endpoint
  let prunePosted = false;
  await page.route("**/api/projects/*/pipelines/*/worktree/prune", async (route) => {
    prunePosted = true;
    await route.continue();
  });

  await page.locator(".focus-overflow button[title='更多操作']").click();
  const menu = page.locator("[role='menu']");
  await expect(menu).toBeVisible();
  await menu.locator("button", { hasText: "清除 worktree" }).click();

  const dlg = page.locator(".confirm-card");
  await expect(dlg).toBeVisible();

  // danger flow:confirmLabel = "強制清除"(state=planning,非 merged)
  await dlg.locator("button", { hasText: "強制清除" }).click();
  await expect(dlg).toHaveCount(0);

  // endpoint 被呼叫
  await expect.poll(() => prunePosted, { timeout: 5000 }).toBe(true);
  void wt;

  // UI 顯示成功訊息(setActionError("✓ worktree 已清除"))
  await expect(page.locator("text=worktree 已清除")).toBeVisible();
});

test("UI:running 中 menu「清除 worktree」項 disabled", async ({ page, request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-lock",
        name: "lock-pipe",
        branch: "pipeline/lock-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
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

  // 卡住 running
  await setRunnerScript(proj.hash, "p-lock", {
    tickets: [{ beforeRunningMs: 50, workMs: 10_000, finalStatus: "done" }],
    finalState: "ready",
  });
  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/p-lock/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(runRes.ok()).toBe(true);

  await page.goto(`/board?project=${proj.hash}`);

  // 等 backend state = running
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/projects/${proj.hash}/pipelines/p-lock`);
      const j = await r.json();
      return j.data.state;
    }, { timeout: 10_000 })
    .toBe("running");

  await page.locator(".focus-overflow button[title='更多操作']").click();
  const menu = page.locator("[role='menu']");
  await expect(menu).toBeVisible();

  const pruneItem = menu.locator("button", { hasText: "清除 worktree" });
  await expect(pruneItem).toBeDisabled();

  // 收尾
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-lock/pause`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});
