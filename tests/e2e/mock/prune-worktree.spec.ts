import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, cleanupTempProject, gitIn, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";
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

function worktreeListed(projectPath: string, wtPath: string): boolean {
  const r = gitIn(projectPath, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return false;
  const norm = wtPath.replace(/\\/g, "/").toLowerCase();
  return r.out.split(/\r?\n/).some((line) => {
    if (!line.startsWith("worktree ")) return false;
    return line.slice("worktree ".length).replace(/\\/g, "/").toLowerCase() === norm;
  });
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

// 把 .vibe-pipeline/ 加進 .gitignore 並提交,讓 backend mutate pipeline.json 不弄髒 working tree;
// 接著建 pipeline branch + 一個檔 commit,這樣 /merge 走 mechanical autoMergeNoAI 才有東西可 merge。
// 對應 auto-merge.spec.ts preBuildBranch 同套路。
function preBuildBranch(projectPath: string, branch: string, fileName: string): void {
  writeFileSync(join(projectPath, ".gitignore"), ".vibe-pipeline/\n");
  gitIn(projectPath, ["add", ".gitignore"]);
  gitIn(projectPath, ["commit", "-m", "chore: ignore .vibe-pipeline"]);
  gitIn(projectPath, ["checkout", "-b", branch]);
  writeFileSync(join(projectPath, fileName), `// added on ${branch}\n`);
  gitIn(projectPath, ["add", fileName]);
  gitIn(projectPath, ["commit", "-m", `feat: add ${fileName}`]);
  gitIn(projectPath, ["checkout", "main"]);
}

// 走 `git worktree add` 真實建一個 worktree dir + 註冊進 git metadata,
// 這樣才能驗 removeQuiet 真把 dir + worktree list entry 都拔掉。
function ensureRealWorktree(projectPath: string, projectHash: string, pipelineId: string, branch: string): string {
  const wt = worktreeDir(projectHash, pipelineId);
  mkdirSync(join(wt, ".."), { recursive: true });
  const r = gitIn(projectPath, ["worktree", "add", wt, branch]);
  if (!r.ok) throw new Error(`git worktree add 失敗:${r.err || r.out}`);
  return wt;
}

test("endpoint:POST /worktree/cleanup 砍 stale worktree dir + 回 ok", async ({ request }) => {
  // backend cleanup endpoint 規定 state=merged(未 merged 一律 409,防誤砍未落地改動)
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-ep",
        name: "ep-pipe",
        branch: "pipeline/ep-pipe",
        baseBranch: "main",
        state: "merged",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
          },
        ],
      },
    ],
  });

  const wt = seedStaleWorktreeDir(proj.hash, "p-ep");
  expect(existsSync(wt)).toBe(true);

  const pruneRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-ep/worktree/cleanup`,
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
        state: "merged",
        tickets: [],
      },
    ],
  });

  // 不建 worktree dir,直接 prune
  const wt = worktreeDir(proj.hash, "p-noop");
  expect(existsSync(wt)).toBe(false);

  const pruneRes = await request.post(
    `${API}/projects/${proj.hash}/pipelines/p-noop/worktree/cleanup`,
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
  expect(pruneRes.ok()).toBe(true);
});

// ─── auto-cleanup after merge(2026-05-27 b713818)── ─────────────────────────
// 覆蓋 pipelineMerge.ts 的 autoCleanWorktreeAfterMerge 在四條 merge path 的呼叫:
//   1. POST /merge mechanical autoMergeNoAI clean
//   2. POST /merge alreadyMerged(ahead=0 補寫 state=merged)
//   3. POST /merge → conflict → AI fallback → mock runner 收尾 state=merged
//   4. 失敗 emit pipeline_merge_cleanup_failed notif 不擋 merge — 跨平台難穩定模擬,留 manual 驗
// 註:mock runner 直接 finalState=merged 的路徑由 merge-prune.spec.ts 蓋。

test("POST /merge mechanical autoMergeNoAI → worktree dir + git worktree list 自動清", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-mech",
        name: "mech-pipe",
        branch: "pipeline/mech-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
            commits: [{ hash: "fake", subject: "ticket(1)", ts: Date.now() }],
          },
        ],
      },
    ],
  });
  preBuildBranch(proj.path, "pipeline/mech-pipe", "mech-feature.ts");

  // 手動 attach worktree,模擬之前 runner ensure 過、merge 前 worktree 仍 on disk
  const wt = ensureRealWorktree(proj.path, proj.hash, "p-mech", "pipeline/mech-pipe");
  expect(existsSync(wt)).toBe(true);
  expect(worktreeListed(proj.path, wt)).toBe(true);

  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-mech/merge`);
  const body = await res.json();
  expect(res.ok(), `merge failed: ${JSON.stringify(body)}`).toBe(true);
  expect(body.data.mode).toBe("mechanical");
  expect(body.data.mergeCommit.hash).toMatch(/^[a-f0-9]{40}$/);

  // pipeline state=merged
  const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-mech`);
  const pipeBody = await pipeRes.json();
  expect(pipeBody.data.state).toBe("merged");

  // worktree dir + git worktree list 都應消失(autoCleanWorktreeAfterMerge 同步呼叫,
  // 不必 poll;若 cleanup 失敗 backend 仍會回 ok 並 emit notif,所以這裡 hard assert)
  expect(existsSync(wt)).toBe(false);
  expect(worktreeListed(proj.path, wt)).toBe(false);
});

test("POST /merge alreadyMerged(ahead=0)→ 補寫 state=merged 同時清 worktree", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-already",
        name: "already-pipe",
        branch: "pipeline/already-pipe",
        baseBranch: "main",
        state: "ready", // 還沒標 merged,但 git 層其實 ahead=0
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
          },
        ],
      },
    ],
  });

  // 把 .vibe-pipeline/ ignore 進 commit(同 preBuildBranch 但不另建 feature commit)—
  // 直接從 main checkout branch,branch HEAD 等於 main HEAD,ahead=0。
  writeFileSync(join(proj.path, ".gitignore"), ".vibe-pipeline/\n");
  gitIn(proj.path, ["add", ".gitignore"]);
  gitIn(proj.path, ["commit", "-m", "chore: ignore .vibe-pipeline"]);
  gitIn(proj.path, ["branch", "pipeline/already-pipe"]); // 同 main HEAD

  // 確認 ahead=0
  const ahead = gitIn(proj.path, ["rev-list", "--count", "main..pipeline/already-pipe"]);
  expect(ahead.ok).toBe(true);
  expect(ahead.out.trim()).toBe("0");

  const wt = ensureRealWorktree(proj.path, proj.hash, "p-already", "pipeline/already-pipe");
  expect(existsSync(wt)).toBe(true);

  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-already/merge`);
  const body = await res.json();
  expect(res.ok(), `merge failed: ${JSON.stringify(body)}`).toBe(true);
  expect(body.data.mode).toBe("mechanical");
  expect(body.data.alreadyMerged).toBe(true);

  // pipeline state 補成 merged
  const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-already`);
  const pipeBody = await pipeRes.json();
  expect(pipeBody.data.state).toBe("merged");

  // alreadyMerged 分支也走 autoCleanWorktreeAfterMerge
  expect(existsSync(wt)).toBe(false);
  expect(worktreeListed(proj.path, wt)).toBe(false);
});

test("POST /merge 撞衝突 → AI fallback → mock runner 收尾 → worktree 自動清", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-aifb",
        name: "ai-fb-pipe",
        branch: "pipeline/ai-fb-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
            commits: [{ hash: "fake", subject: "ticket(1)", ts: Date.now() }],
          },
        ],
      },
    ],
  });
  // 製造 conflict:main 與 branch 都改同一檔不同內容
  writeFileSync(join(proj.path, ".gitignore"), ".vibe-pipeline/\n");
  gitIn(proj.path, ["add", ".gitignore"]);
  gitIn(proj.path, ["commit", "-m", "chore: ignore .vibe-pipeline"]);
  gitIn(proj.path, ["checkout", "-b", "pipeline/ai-fb-pipe"]);
  writeFileSync(join(proj.path, "conflict.ts"), "// branch version\n");
  gitIn(proj.path, ["add", "conflict.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: branch side"]);
  gitIn(proj.path, ["checkout", "main"]);
  writeFileSync(join(proj.path, "conflict.ts"), "// main version\n");
  gitIn(proj.path, ["add", "conflict.ts"]);
  gitIn(proj.path, ["commit", "-m", "feat: main side"]);

  const wt = ensureRealWorktree(proj.path, proj.hash, "p-aifb", "pipeline/ai-fb-pipe");
  expect(existsSync(wt)).toBe(true);

  // mock runner 不會跳已 done 的 ticket — 它對每個 pipeline.tickets[i] 都查 script.tickets[i],
  // 缺項就 break(L60-86)。所以 t1 即使已 done 也得給一個快通 script entry,讓 loop 走到 i=1
  // 拿 append 進來的 merge ticket(沒 script 條目但 mode=merge → 走 synthetic 自動標 done → finalState=merged)
  const script: RunnerScript = {
    tickets: [
      { beforeRunningMs: 5, workMs: 5, finalStatus: "done", commitHash: "fake" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-aifb", script);

  const res = await request.post(`${API}/projects/${proj.hash}/pipelines/p-aifb/merge`);
  const body = await res.json();
  expect(res.ok(), `merge failed: ${JSON.stringify(body)}`).toBe(true);
  expect(body.data.mode).toBe("ai");
  expect(body.data.ticketId).toBeTruthy();

  // 等 mock runner 跑完 merge ticket → state=merged → mock runner removeQuiet
  let reached = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-aifb`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "merged" && !existsSync(wt)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  expect(existsSync(wt)).toBe(false);
  expect(worktreeListed(proj.path, wt)).toBe(false);
});
