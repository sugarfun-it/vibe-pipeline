import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, cleanupTempProject, gitIn, type TempProject } from "../helpers/temp-project";
import { resetMocks } from "../helpers/mock-control";
import { API_BASE } from "../helpers/api-base";

let proj: TempProject;

test.beforeEach(async () => {
  await resetMocks();
});
test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

// 在 fixture 內預建 branch + commit,讓 merge endpoint 真有東西可 squash
// .vibe-pipeline/ 已在 helper init 階段 commit 進 .gitignore,merge dirty preflight 不會卡。
function preBuildBranch(projectPath: string, branch: string, fileName: string): void {
  gitIn(projectPath, ["checkout", "-b", branch]);
  writeFileSync(join(projectPath, fileName), `// added on ${branch}\n`);
  gitIn(projectPath, ["add", fileName]);
  gitIn(projectPath, ["commit", "-m", `feat: add ${fileName}`]);
  gitIn(projectPath, ["checkout", "main"]);
}

test("squash merge:全 ticket done + ready → POST /merge → state=merged + mergeCommit", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-merge",
        name: "merge-pipe",
        branch: "pipeline/merge-pipe",
        baseBranch: "main",
        state: "ready",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "test",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
            commits: [{ hash: "fake-hash", subject: "ticket(1): test", ts: Date.now() }],
          },
        ],
      },
    ],
  });
  preBuildBranch(proj.path, "pipeline/merge-pipe", "feature.ts");

  const res = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-merge/merge`);
  const body = await res.json();
  if (!res.ok()) {
    throw new Error(`merge failed: status=${res.status()} body=${JSON.stringify(body)}`);
  }
  // backend 2026-05-13 改:回 { mode:'mechanical', mergeCommit:{hash,subject,ts} }
  expect(body.data.mergeCommit.hash).toMatch(/^[a-f0-9]{40}$/);

  // 後端應該已經把 pipeline state 寫成 merged
  const pipeRes = await request.get(`${API_BASE}/projects/${proj.hash}/pipelines/p-merge`);
  const pipeBody = await pipeRes.json();
  expect(pipeBody.data.state).toBe("merged");
  expect(pipeBody.data.mergeCommit.hash).toBe(body.data.mergeCommit.hash);
});

test("merge 完 base 真的有那個 commit", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-merge2",
        name: "merge-pipe-2",
        branch: "pipeline/merge-pipe-2",
        baseBranch: "main",
        state: "ready",
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "x",
            goal: "g",
            acceptance: ["a"],
            prompt: "p",
            mode: "step",
            status: "done",
            commits: [],
          },
        ],
      },
    ],
  });
  preBuildBranch(proj.path, "pipeline/merge-pipe-2", "thing.ts");

  await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-merge2/merge`);

  // squash 後 main 應該多一個 commit(原本只有 init);ls-tree 看到 thing.ts
  const lsTree = gitIn(proj.path, ["ls-tree", "main", "thing.ts"]);
  expect(lsTree.ok).toBe(true);
  expect(lsTree.out).toContain("thing.ts");
});

test("merge 不可在 state != ready 跑", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-merge3",
        name: "not-ready",
        branch: "pipeline/not-ready",
        baseBranch: "main",
        state: "planning",
        tickets: [],
      },
    ],
  });
  const res = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-merge3/merge`);
  expect(res.ok()).toBe(false);
});

test("已 merge 的 pipeline 再 merge → 擋", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-merge4",
        name: "already-merged",
        branch: "pipeline/already-merged",
        baseBranch: "main",
        state: "merged",
        tickets: [],
      },
    ],
  });
  const res = await request.post(`${API_BASE}/projects/${proj.hash}/pipelines/p-merge4/merge`);
  expect(res.ok()).toBe(false);
});
