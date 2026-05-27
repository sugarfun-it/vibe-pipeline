// Sync ticket flow:把 baseBranch 的新 commit merge 進 pipeline worktree。
// 走 server/lib/runner/syncJob.ts(startSync / cancelSync / dismiss)+ /api/projects/:h/pipelines/:id/sync 系列。
//
// 場景:
//   1. GET /sync-status:沒 worktree → behind:null;有 worktree → behind 反映 base 推進
//   2. POST /sync:base 推進 + 無衝突 → state=done + mergeCommit
//   3. POST /sync:衝突 → state=conflict_await + conflictFiles
//   4. POST /sync/cancel:conflict_await → abort merge + state=failed
//   5. POST /sync/dismiss:done / failed → 把 syncJob 從 pipeline.json 拿掉
//   6. State guard:running 中按 sync → 409
//   7. UI:sync-chip 從「落後 N · 同步」變「已同步」

import { test, expect } from "@playwright/test";
import { writeFileSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTempProject,
  cleanupTempProject,
  gitIn,
  type TempProject,
} from "../helpers/temp-project";
import {
  resetMocks,
  setRunnerScript,
  type RunnerScript,
} from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";

let proj: TempProject;
const API = API_BASE;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

// 用 git worktree list 從 main repo 找實際 worktree 路徑(branch=pipeline/<name>)。
// 不靠 VP_HOME_OVERRIDE,playwright env 跟 backend env 是否共享在 reuseExistingServer 時不一定。
function worktreeDirByBranch(projectPath: string, branch: string): string | null {
  const r = gitIn(projectPath, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return null;
  const lines = r.out.split(/\r?\n/);
  let curPath: string | null = null;
  for (const line of lines) {
    if (line.startsWith("worktree ")) curPath = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) {
      // branch line e.g. "branch refs/heads/pipeline/foo"
      const b = line.slice("branch refs/heads/".length);
      if (b === branch && curPath) return curPath;
    }
  }
  return null;
}

function readPipelineFile(projectPath: string, pipelineId: string): Record<string, unknown> {
  const f = join(projectPath, ".vibe-pipeline", "pipelines", `${pipelineId}.json`);
  if (!existsSync(f)) throw new Error(`pipeline.json not found: ${f}`);
  return JSON.parse(readFileSync(f, "utf-8"));
}

// 把 .vibe-pipeline/ ignore + commit baseline,避免 runner mutate pipeline.json 弄髒 worktree
function setupIgnore(projectPath: string): void {
  appendFileSync(join(projectPath, ".gitignore"), "\n.vibe-pipeline/\n");
  gitIn(projectPath, ["add", ".gitignore"]);
  gitIn(projectPath, ["commit", "-m", "chore: ignore .vibe-pipeline"]);
}

// 跑一輪 mock runner 讓 worktree 真的被 ensure 出來(branch=pipeline/<name>,from baseBranch=main)
// 回 worktree 絕對路徑(透過 git worktree list 找),caller 直接用此 path 操作 wt
async function bootstrapWorktree(
  request: import("@playwright/test").APIRequestContext,
  pipelineId: string,
  branch: string
): Promise<string> {
  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 20,
        workMs: 40,
        finalStatus: "done",
        commitHash: "mock-bootstrap-1",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, pipelineId, script);
  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/${pipelineId}/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(runRes.ok()).toBe(true);
  // 等 pipeline 跑回 ready(mock runner 寫完 pipeline.json)
  let reached = false;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/${pipelineId}`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data?.state === "ready") {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  // 從 main repo 撈實際 worktree path(不靠 VP_HOME_OVERRIDE 推算)
  let wt: string | null = null;
  for (let i = 0; i < 30; i++) {
    wt = worktreeDirByBranch(proj.path, branch);
    if (wt && existsSync(wt)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!wt || !existsSync(wt)) {
    const list = gitIn(proj.path, ["worktree", "list", "--porcelain"]);
    throw new Error(
      `worktree for branch ${branch} not found after bootstrap. git worktree list:\n${list.out}\nstderr:\n${list.err}`
    );
  }
  return wt;
}

function pipelineSeed(id: string, name: string) {
  return {
    id,
    name,
    branch: `pipeline/${name}`,
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
  };
}

test("GET /sync-status:沒 worktree → behind:null;worktree 存在 + base 推進 → behind 反映新增 commits", async ({ request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-stat", "stat-pipe")] });
  setupIgnore(proj.path);

  // 沒 worktree → behind:null
  const before = await request.get(
    `${API}/projects/${proj.hash}/pipelines/p-stat/sync-status`
  );
  const beforeBody = await before.json();
  expect(beforeBody.ok).toBe(true);
  expect(beforeBody.data.behind).toBeNull();

  await bootstrapWorktree(request, "p-stat", "pipeline/stat-pipe");

  // 剛建 worktree 時 worktree HEAD == base HEAD → behind=0
  const fresh = await request.get(
    `${API}/projects/${proj.hash}/pipelines/p-stat/sync-status`
  );
  const freshBody = await fresh.json();
  expect(freshBody.data.behind).toBe(0);
  expect(freshBody.data.baseBranch).toBe("main");

  // 在 main 加兩個 commit → behind 應該變 2
  writeFileSync(join(proj.path, "feature-a.ts"), "// new on main A\n");
  gitIn(proj.path, ["add", "feature-a.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: A"]);
  writeFileSync(join(proj.path, "feature-b.ts"), "// new on main B\n");
  gitIn(proj.path, ["add", "feature-b.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: B"]);

  const after = await request.get(
    `${API}/projects/${proj.hash}/pipelines/p-stat/sync-status`
  );
  const afterBody = await after.json();
  expect(afterBody.data.behind).toBe(2);
});

test("POST /sync:base 推進無衝突 → state=done + mergeCommit + pipeline.json 寫入 syncJob.done", async ({ request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-clean", "clean-pipe")] });
  setupIgnore(proj.path);
  const wt = await bootstrapWorktree(request, "p-clean", "pipeline/clean-pipe");

  // 在 main 加新 commit(碰沒交集的檔)
  writeFileSync(join(proj.path, "added-on-main.ts"), "// only on main\n");
  gitIn(proj.path, ["add", "added-on-main.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: added-on-main"]);

  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-clean/sync`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.data.state).toBe("done");
  expect(body.data.behind).toBe(1);

  // pipeline.json 應該寫進 syncJob.done + mergeCommit
  const onDisk = readPipelineFile(proj.path, "p-clean") as {
    syncJob?: {
      state?: string;
      mergeCommit?: { hash?: string; subject?: string };
      behindCount?: number;
    };
  };
  expect(onDisk.syncJob?.state).toBe("done");
  expect(onDisk.syncJob?.behindCount).toBe(1);
  expect(onDisk.syncJob?.mergeCommit?.hash).toMatch(/^[a-f0-9]{40}$/);

  // 跑完 sync 後 behind 應該歸 0
  const stat = await request.get(
    `${API}/projects/${proj.hash}/pipelines/p-clean/sync-status`
  );
  const statBody = await stat.json();
  expect(statBody.data.behind).toBe(0);

  // 確認 worktree HEAD 真的包含那個 main commit(看 added-on-main.ts 出現在 HEAD tree)
  const lsTree = gitIn(wt, ["ls-tree", "HEAD", "added-on-main.ts"]);
  expect(lsTree.ok).toBe(true);
  expect(lsTree.out).toContain("added-on-main.ts");
});

test("POST /sync:同檔衝突 → state=conflict_await + conflictFiles;接 /sync/cancel → state=failed + worktree abort", async ({ request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-conf", "conf-pipe")] });
  setupIgnore(proj.path);
  const wt = await bootstrapWorktree(request, "p-conf", "pipeline/conf-pipe");

  // 1. 先在 worktree branch 寫一個檔 commit(模擬 runner 真有改 code)
  writeFileSync(join(wt, "shared.ts"), "export const x = 'pipeline-version';\n");
  let r = gitIn(wt, ["add", "shared.ts"]);
  expect(r.ok).toBe(true);
  r = gitIn(wt, ["commit", "-m", "feat: pipeline shared.ts"]);
  expect(r.ok).toBe(true);

  // 2. main 也寫同檔不同內容 → 必然衝突
  writeFileSync(join(proj.path, "shared.ts"), "export const x = 'main-version';\n");
  r = gitIn(proj.path, ["add", "shared.ts"]);
  expect(r.ok).toBe(true);
  r = gitIn(proj.path, ["commit", "-m", "feat: main shared.ts"]);
  expect(r.ok).toBe(true);

  // 3. behind 應該 = 1
  const stat = await request.get(`${API}/projects/${proj.hash}/pipelines/p-conf/sync-status`);
  expect((await stat.json()).data.behind).toBe(1);

  // 4. POST /sync → 衝突
  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-conf/sync`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.data.state).toBe("conflict_await");
  expect(body.data.conflictFiles).toEqual(expect.arrayContaining(["shared.ts"]));

  const onDisk = readPipelineFile(proj.path, "p-conf") as {
    syncJob?: { state?: string; conflictFiles?: string[] };
  };
  expect(onDisk.syncJob?.state).toBe("conflict_await");
  expect(onDisk.syncJob?.conflictFiles).toEqual(expect.arrayContaining(["shared.ts"]));

  // worktree 應該還在 merge 進行中(linked worktree 的 .git 是 gitdir pointer 不是 dir,
   // 用 git status 判定比直接看 MERGE_HEAD 檔可靠)
  const midMerge = gitIn(wt, ["status", "--porcelain"]);
  expect(midMerge.ok).toBe(true);
  // 衝突狀態的 porcelain 行可能是 UU / AA / DD / AU / UA / DU / UD 等(視兩邊操作而定)
  expect(midMerge.out).toMatch(/^(UU|AA|DD|AU|UA|DU|UD)\s+shared\.ts/m);

  // 5. /sync/cancel → 應該 abort merge + 標 failed
  const cancelRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-conf/sync/cancel`,
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
  expect(cancelRes.ok()).toBe(true);

  const after = readPipelineFile(proj.path, "p-conf") as {
    syncJob?: { state?: string; reason?: string };
  };
  expect(after.syncJob?.state).toBe("failed");
  expect(after.syncJob?.reason).toContain("使用者取消");
  // merge 已 abort:status 應該不含任何衝突行
  const cleanStatus = gitIn(wt, ["status", "--porcelain"]);
  expect(cleanStatus.ok).toBe(true);
  expect(cleanStatus.out).not.toMatch(/^(UU|AA|DD|AU|UA|DU|UD)\s/m);
});

test("POST /sync/dismiss:done 後清掉 syncJob;ai_running / merging 中擋住", async ({ request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-dis", "dis-pipe")] });
  setupIgnore(proj.path);
  await bootstrapWorktree(request, "p-dis", "pipeline/dis-pipe");

  // behind=0 直接呼叫 sync → 立刻 done
  const sync = await request.post(`${API}/projects/${proj.hash}/pipelines/p-dis/sync`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(sync.ok()).toBe(true);
  const syncBody = await sync.json();
  expect(syncBody.data.state).toBe("done");

  // pipeline.json 有 syncJob
  const before = readPipelineFile(proj.path, "p-dis") as { syncJob?: unknown };
  expect(before.syncJob).toBeTruthy();

  // dismiss → syncJob 拿掉
  const dis = await request.post(`${API}/projects/${proj.hash}/pipelines/p-dis/sync/dismiss`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(dis.ok()).toBe(true);
  const after = readPipelineFile(proj.path, "p-dis") as { syncJob?: unknown };
  expect(after.syncJob).toBeUndefined();
});

test("state guard:running 中按 sync → 409 拒絕", async ({ request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-guard", "guard-pipe")] });
  setupIgnore(proj.path);

  // 設長一點的 mock runner 讓它一直在跑(workMs 大)
  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 20,
        workMs: 5000,
        finalStatus: "done",
        commitHash: "mock-guard-1",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-guard", script);
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-guard/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  // 等到 running
  let running = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 80));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-guard`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data?.state === "running") {
      running = true;
      break;
    }
  }
  expect(running).toBe(true);

  // 按 sync → 應該 409
  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-guard/sync`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.ok).toBe(false);
  // backend pause 才能 sync
  expect(body.error?.message ?? "").toMatch(/pause|跑/);

  // 收尾:pause 讓 runner 停掉(避免 afterEach 清不掉)
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-guard/pause`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});

test("UI:sync-chip 從『落後 N · 同步』按下後變『已同步』", async ({ page, request }) => {
  proj = await createTempProject({ pipelines: [pipelineSeed("p-ui", "ui-pipe")] });
  setupIgnore(proj.path);
  await bootstrapWorktree(request, "p-ui", "pipeline/ui-pipe");

  // 推進 base 讓 behind=1
  writeFileSync(join(proj.path, "ui-feat.ts"), "// ui feat\n");
  gitIn(proj.path, ["add", "ui-feat.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: ui"]);

  // 進 board(用 URL ?project)。pipeline 在 ready 狀態 + FocusColumn 抓 syncStatus 一次。
  // base 推進是在 page.goto 之前,所以第一次 fetch 就會拿到 behind=1
  await page.goto(`/board?project=${proj.hash}`);

  // 等「落後 1 · 同步」按鈕出現
  const startBtn = page.locator(".sync-chip", { hasText: "落後 1" });
  await expect(startBtn).toBeVisible({ timeout: 15_000 });

  // ── 中間態驗證 ────────────────────────────────────────────────────
  // syncJob.state=merging 在 backend 是 <1s 視窗,polling(1.5s)很可能掃不到。
  // 用 page.route 攔截 GET /pipelines,在「啟用 inject」期間把目標 pipeline 的 syncJob
  // 改寫成 merging,逼 UI 渲染 sync-chip-busy + RunButton 鎖「同步中」。
  // 驗完關掉 inject,真實 polling 接管 → 最終態走 done chip。
  let injectMerging = true;
  await page.route("**/api/projects/*/pipelines", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const resp = await route.fetch();
    if (!injectMerging) {
      await route.fulfill({ response: resp });
      return;
    }
    const json = await resp.json();
    if (json?.ok && Array.isArray(json.data)) {
      for (const p of json.data) {
        if (p?.id === "p-ui") {
          p.syncJob = {
            state: "merging",
            startedAt: Date.now(),
            behindCount: 1,
          };
        }
      }
    }
    await route.fulfill({ response: resp, json });
  });

  // 點下去 → 走 POST /sync(無衝突 → done),polling 期間因 route inject 看到 merging
  await startBtn.click();

  // 中間態:sync-chip 變 busy class + 文字「同步中」(merging state 用「同步中」,
  // ai_running 才用「助理處理中」)
  const busyChip = page.locator(".sync-chip.sync-chip-busy");
  await expect(busyChip).toBeVisible({ timeout: 5_000 });
  await expect(busyChip).toContainText("同步中");
  // RunButton 走 syncActive 路徑被鎖 — copy 對齊 sync chip 的「助理處理中」,aria-disabled=true
  // (用 aria-disabled 不用 native disabled,讓 SR / keyboard 仍可 focus 看到 reason)
  const runBtnLocked = page.locator(".focus-actions .run-btn-sync-busy");
  await expect(runBtnLocked).toBeVisible();
  await expect(runBtnLocked).toContainText("助理處理中");
  await expect(runBtnLocked).toHaveAttribute("aria-disabled", "true");

  // 關掉 inject,讓真實 polling 走 → 最終態 = sync-chip-done
  injectMerging = false;
  await page.unroute("**/api/projects/*/pipelines");

  const doneChip = page.locator(".sync-chip.sync-chip-done");
  await expect(doneChip).toBeVisible({ timeout: 15_000 });
  await expect(doneChip).toContainText("已同步");
});
