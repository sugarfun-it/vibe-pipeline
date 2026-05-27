import { test, expect } from "@playwright/test";
import { createTempProject, cleanupTempProject, gitIn, type TempProject } from "../helpers/temp-project";
import { resetMocks, setRunnerScript, type RunnerScript } from "../helpers/mock-control";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { API_BASE } from "../helpers/api-base";

let proj: TempProject;
const API = API_BASE;

test.beforeEach(async () => {
  await resetMocks();
});

test.afterEach(() => {
  if (proj) cleanupTempProject(proj);
});

// 在 fixture 內預建 pipeline branch + commit,讓 auto-merge ticket 真有東西可 merge
// 同時把 .vibe-pipeline/(register-project 寫入的 config / pipelines)commit 進 main,
// 否則 triggerMerge 的 working-tree clean preflight 會把它當 untracked 擋下。
function preBuildBranch(projectPath: string, branch: string, fileName: string): void {
  // backend 跑 runner 期間會 mutate pipeline.json,若 .vibe-pipeline/ 已 tracked 會弄髒 working tree
  // 把整個 .vibe-pipeline/ 加進 .gitignore(在 baseline commit 之前)讓它從一開始就 untracked-but-ignored
  appendFileSync(join(projectPath, ".gitignore"), "\n.vibe-pipeline/\n");
  gitIn(projectPath, ["add", ".gitignore"]);
  gitIn(projectPath, ["commit", "-m", "chore: ignore .vibe-pipeline"]);
  gitIn(projectPath, ["checkout", "-b", branch]);
  writeFileSync(join(projectPath, fileName), `// added on ${branch}\n`);
  gitIn(projectPath, ["add", fileName]);
  gitIn(projectPath, ["commit", "-m", `feat: add ${fileName}`]);
  gitIn(projectPath, ["checkout", "main"]);
}

// 直接讀 pipeline.json file 驗 autoMerge 欄位 persist 到磁碟
function readPipelineFile(projectPath: string, pipelineId: string): Record<string, unknown> {
  const f = join(projectPath, ".vibe-pipeline", "pipelines", `${pipelineId}.json`);
  if (!existsSync(f)) throw new Error(`pipeline.json not found: ${f}`);
  return JSON.parse(readFileSync(f, "utf-8"));
}

test("PUT /config 接受 auto_merge:boolean,GET 拿得回", async ({ request }) => {
  proj = await createTempProject();
  // 預設 false
  const initial = await request.get(`${API}/projects/${proj.hash}/config`);
  const initialBody = await initial.json();
  expect(initialBody.data.defaults.auto_merge).toBe(false);

  // PUT true
  const put = await request.put(`${API}/projects/${proj.hash}/config`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { defaults: { auto_merge: true } },
  });
  const putBody = await put.json();
  expect(put.ok()).toBe(true);
  expect(putBody.data.defaults.auto_merge).toBe(true);

  // PUT 非 boolean → 400
  const bad = await request.put(`${API}/projects/${proj.hash}/config`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { defaults: { auto_merge: "yes" } },
  });
  expect(bad.status()).toBe(400);
});

test("POST /pipelines 沒帶 autoMerge → 讀 project config defaults.auto_merge", async ({ request }) => {
  proj = await createTempProject();
  // 設 default true
  await request.put(`${API}/projects/${proj.hash}/config`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { defaults: { auto_merge: true } },
  });

  const create = await request.post(`${API}/projects/${proj.hash}/pipelines`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { name: "auto-on", branch: "pipeline/auto-on", baseBranch: "main", state: "planning", tickets: [] },
  });
  const body = await create.json();
  expect(body.data.autoMerge).toBe(true);
  // persist 驗:讀檔確認 autoMerge=true 真寫進 pipeline.json
  const onDisk = readPipelineFile(proj.path, body.data.id);
  expect(onDisk.autoMerge).toBe(true);

  // body 顯式帶 false → 蓋過 default
  const create2 = await request.post(`${API}/projects/${proj.hash}/pipelines`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: {
      name: "manual",
      branch: "pipeline/manual",
      baseBranch: "main",
      state: "planning",
      tickets: [],
      autoMerge: false,
    },
  });
  const body2 = await create2.json();
  expect(body2.data.autoMerge).toBe(false);
  const onDisk2 = readPipelineFile(proj.path, body2.data.id);
  expect(onDisk2.autoMerge).toBe(false);
});

test("PUT /pipelines/:id autoMerge=true → persist 到 pipeline.json", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-toggle",
        name: "toggle-pipe",
        branch: "pipeline/toggle-pipe",
        baseBranch: "main",
        state: "planning",
        autoMerge: false,
        tickets: [],
      },
    ],
  });
  // 初始讀檔 false
  const before = readPipelineFile(proj.path, "p-toggle");
  expect(before.autoMerge).toBe(false);

  // toggle 開 → PUT 整 pipeline body 帶 autoMerge=true(模擬 ⋯ menu 點 toggle 後前端打 API)
  const fullBody = {
    id: "p-toggle",
    name: "toggle-pipe",
    branch: "pipeline/toggle-pipe",
    baseBranch: "main",
    state: "planning",
    tickets: [],
    autoMerge: true,
  };
  const res = await request.put(`${API}/projects/${proj.hash}/pipelines/p-toggle`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: fullBody,
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.data.autoMerge).toBe(true);

  // 讀檔再驗 persist
  const after = readPipelineFile(proj.path, "p-toggle");
  expect(after.autoMerge).toBe(true);

  // toggle 關 → PUT 回 false
  const res2 = await request.put(`${API}/projects/${proj.hash}/pipelines/p-toggle`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { ...fullBody, autoMerge: false },
  });
  expect(res2.ok()).toBe(true);
  const after2 = readPipelineFile(proj.path, "p-toggle");
  expect(after2.autoMerge).toBe(false);

  // 非 boolean 應被擋 → 400
  const bad = await request.put(`${API}/projects/${proj.hash}/pipelines/p-toggle`, {
    headers: { "content-type": "application/json; charset=utf-8" },
    data: { ...fullBody, autoMerge: "yes" },
  });
  expect(bad.status()).toBe(400);
});

test("autoMerge=true:全 ticket done → 自動 merge → pipeline.state=merged", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-auto",
        name: "auto-pipe",
        branch: "pipeline/auto-pipe",
        baseBranch: "main",
        state: "planning",
        autoMerge: true,
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "do thing",
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
  preBuildBranch(proj.path, "pipeline/auto-pipe", "auto-feature.ts");

  const script: RunnerScript = {
    tickets: [
      {
        beforeRunningMs: 30,
        workMs: 60,
        finalStatus: "done",
        commitHash: "mock-auto-1",
        commitSubject: "ticket(1): do thing",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-auto", script);

  const runRes = await request.post(`${API}/projects/${proj.hash}/pipelines/p-auto/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  expect(runRes.ok()).toBe(true);

  // 等 pipeline 跑完 ticket → backend 觸發 auto-merge → 再跑一次 mock runner 處理 merge ticket → state=merged
  let merged = false;
  let autoMergeNotif = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-auto`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "merged") merged = true;
    const notifRes = await request.get(`${API}/projects/${proj.hash}/notifs`);
    const notifBody = await notifRes.json();
    if ((notifBody.data ?? []).some((n: { type?: string }) => n.type === "pipeline_auto_merge_started")) {
      autoMergeNotif = true;
    }
    if (merged && autoMergeNotif) break;
  }
  expect(autoMergeNotif).toBe(true);
  expect(merged).toBe(true);

  // 驗 pipeline.json 內有 merge ticket(synthetic) + mergeCommit
  const onDisk = readPipelineFile(proj.path, "p-auto") as {
    state?: string;
    autoMerge?: boolean;
    mergeCommit?: { hash?: string };
    tickets?: Array<{ mode?: string; status?: string }>;
  };
  expect(onDisk.state).toBe("merged");
  expect(onDisk.autoMerge).toBe(true);
  expect(onDisk.mergeCommit?.hash).toBeTruthy();
  // autoMergeNoAI (2026-05-13 二段式) clean 路徑走 git merge --no-ff,不 append synthetic merge ticket。
  // 只有 AI fallback path 才會 append merge ticket。原 ticket 保持 done。
  expect((onDisk.tickets ?? []).every((t) => t.mode !== "merge")).toBe(true);
});

test("autoMerge=false:全 ticket done → ready 後不自動 merge,等手動", async ({ request }) => {
  proj = await createTempProject({
    pipelines: [
      {
        id: "p-manual",
        name: "manual-pipe",
        branch: "pipeline/manual-pipe",
        baseBranch: "main",
        state: "planning",
        autoMerge: false,
        tickets: [
          {
            id: "t1",
            n: 1,
            title: "do thing",
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
        beforeRunningMs: 30,
        workMs: 60,
        finalStatus: "done",
        commitHash: "mock-manual-1",
      },
    ],
    finalState: "ready",
  };
  await setRunnerScript(proj.hash, "p-manual", script);

  await request.post(`${API}/projects/${proj.hash}/pipelines/p-manual/run`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  // 等 ready
  let reached = false;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-manual`);
    const pipeBody = await pipeRes.json();
    if (pipeBody.data.state === "ready") {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  // 多等幾輪確認沒自動加 merge ticket / 沒進 merged / 沒發 auto-merge notif
  await new Promise((r) => setTimeout(r, 600));
  const pipeRes = await request.get(`${API}/projects/${proj.hash}/pipelines/p-manual`);
  const pipeBody = await pipeRes.json();
  const tickets = pipeBody.data.tickets ?? [];
  expect(tickets.some((t: { mode?: string }) => t.mode === "merge")).toBe(false);
  expect(pipeBody.data.state).toBe("ready");

  const notifRes = await request.get(`${API}/projects/${proj.hash}/notifs`);
  const notifBody = await notifRes.json();
  expect(
    (notifBody.data ?? []).some((n: { type?: string }) => n.type === "pipeline_auto_merge_started")
  ).toBe(false);

  // 驗 pipeline.json autoMerge=false persist
  const onDisk = readPipelineFile(proj.path, "p-manual");
  expect(onDisk.autoMerge).toBe(false);
});
