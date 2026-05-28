import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
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
  // 對應 server/lib/io/git/worktree.ts worktreePath:vibeHome()/.vibe-pipeline/worktrees/<hash>/<id>
  const home = process.env.VP_HOME_OVERRIDE;
  if (!home) throw new Error("VP_HOME_OVERRIDE 未設,本 spec 必須在 mock e2e 環境跑");
  return join(home, ".vibe-pipeline", "worktrees", projHash, pipelineId);
}

function worktreeListed(projectPath: string, wtPath: string): boolean {
  const r = gitIn(projectPath, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return false;
  // porcelain 格式 "worktree <abs path>" 一行;normalize path 比較(Windows \ vs git /)
  const norm = wtPath.replace(/\\/g, "/").toLowerCase();
  return r.out.split(/\r?\n/).some((line) => {
    if (!line.startsWith("worktree ")) return false;
    return line.slice("worktree ".length).replace(/\\/g, "/").toLowerCase() === norm;
  });
}

test("merge 成功後 worktree dir + git worktree list 都消失", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-prune",
        name: "prune-pipe",
        branch: "pipeline/prune-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "step 1",
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

  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 20,
        workMs: 40,
        finalStatus: "done",
        commitHash: "mock-prune-1",
      },
    ],
    finalState: "merged",
  };
  await setRunnerScript(proj.hash, "p-prune", script);

  // 跑 — orchestrator 會 ensure worktree,然後 mock runner 收尾標 merged → removeQuiet
  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/p-prune/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(runRes.ok()).toBe(true);

  const wt = worktreeDir(proj.hash, "p-prune");

  // 等到 pipeline state = merged 且 worktree 已 prune
  let reached = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-prune`);
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

test("DELETE pipeline:任何 state 都 prune worktree(含 merged)", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-del",
        name: "delete-pipe",
        branch: "pipeline/delete-pipe",
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

  // 跑一次讓 worktree ensure 建出來
  const script: RunnerScript = {
    tickets: [
      { beforeRunningMs: 20, workMs: 40, finalStatus: "done", commitHash: "mock-del-1" },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-del", script);
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-del/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  const wt = worktreeDir(proj.hash, "p-del");

  // 等 ready(worktree 已建)
  let built = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-del`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "ready" && existsSync(wt)) {
      built = true;
      break;
    }
  }
  expect(built).toBe(true);

  // DELETE 應 prune worktree
  const delRes = await request.delete(`${API}/projects/${proj.hash}/pipelines/p-del`);
  expect(delRes.ok()).toBe(true);
  expect(existsSync(wt)).toBe(false);
  expect(worktreeListed(proj.path, wt)).toBe(false);
});

test("Reset all + Run:已 prune 過的 pipeline 再跑時 worktree 自動重建", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-redo",
        name: "redo-pipe",
        branch: "pipeline/redo-pipe",
        baseBranch: "main",
        state: "planning",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "first",
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

  const wt = worktreeDir(proj.hash, "p-redo");

  // 第一輪:merged → 自動 prune
  await setRunnerScript(proj.hash, "p-redo", {
    tickets: [{ beforeRunningMs: 20, workMs: 40, finalStatus: "done", commitHash: "mock-redo-1" }],
    finalState: "merged",
  });
  await request.post(`${API}/projects/${proj.hash}/pipelines/p-redo/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  let pruned = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-redo`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "merged" && !existsSync(wt)) {
      pruned = true;
      break;
    }
  }
  expect(pruned).toBe(true);

  // 把 pipeline 改回 planning + 重 setRunnerScript,模擬 user reset all 後 run
  // 直接 PUT — merged 不在 PUT race guard 黑名單
  const cur = await request.get(`${API}/projects/${proj.hash}/pipelines/p-redo`);
  const curBody = await cur.json();
  const nextData = {
    ...curBody.data,
    state: "planning",
    tickets: [
      {
        id: "t1",
        n: 1,
        title: "first",
        goal: "g",
        acceptance: ["a"],
        prompt: "p",
        mode: "step",
        status: "ready",
      },
    ],
  };
  // 移除 merged 標記
  delete nextData.mergedAt;
  delete nextData.mergeCommit;

  const putRes = await request.put(`${API}/projects/${proj.hash}/pipelines/p-redo`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: nextData,
  });
  expect(putRes.ok()).toBe(true);

  await setRunnerScript(proj.hash, "p-redo", {
    tickets: [{ beforeRunningMs: 20, workMs: 40, finalStatus: "done", commitHash: "mock-redo-2" }],
    finalState: "ready",
  });

  const run2 = await request.post(`${API}/projects/${proj.hash}/pipelines/p-redo/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(run2.ok()).toBe(true);

  let rebuilt = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (existsSync(wt)) {
      rebuilt = true;
      break;
    }
  }
  expect(rebuilt).toBe(true);
});
