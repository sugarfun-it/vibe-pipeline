import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import * as pipelineDir from "../../server/lib/pipelineDir";
import * as orchestrator from "../../server/lib/runner/orchestrator";
import * as runLog from "../../server/lib/runner/runLog";
import * as syncJob from "../../server/lib/runner/syncJob";
import * as auditLog from "../../server/lib/auditLog";
import { resolveProject, requireInit } from "../lib/project";
import { ensureBackend } from "../lib/ensureBackend";
import { post } from "../lib/api";
import type { ParsedArgs } from "../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../lib/output";
import type { Pipeline, RunSummary } from "../../shared/types";

const PIPELINE_USAGE = `vbpl pipeline — manage pipelines (fs ops local; run/stop/merge/sync need backend up)

  vbpl pipeline list                          [--project <hash>]
  vbpl pipeline show   <id>                   [--project <hash>]
  vbpl pipeline create <name>                 [--auto-merge] [--base-branch <branch>]
  vbpl pipeline delete <id>                   [--force]   砍 worktree + branch + json(預設要 confirm)
  vbpl pipeline run    <id>                   (needs backend)
  vbpl pipeline stop   <id>                   (needs backend)
  vbpl pipeline status <id>
  vbpl pipeline log    <id>                   [--follow|-f]
  vbpl pipeline merge  <id>                   AI merge → base
  vbpl pipeline sync   <id>                   [--ai|--cancel|--dismiss]   base → worktree

  <id> also accepts first positional arg.`;

export async function runPipeline(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(PIPELINE_USAGE);
    return;
  }
  switch (sub) {
    case "list":   return pipelineList(args);
    case "show":   return pipelineShow(args);
    case "create": return pipelineCreate(args);
    case "delete": return pipelineDelete(args);
    case "run":    return pipelineRun(args);
    case "stop":   return pipelineStop(args);
    case "status": return pipelineStatus(args);
    case "log":    return pipelineLog(args);
    case "merge":  return pipelineMerge(args);
    case "sync":   return pipelineSync(args);
    default:
      fail("INVALID_ARGS", `Unknown pipeline subcommand: ${sub ?? "(none)"}. Use list|create|show|delete|run|stop|status|log|merge|sync (or 'vbpl pipeline help')`);
  }
}

async function pipelineList(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const pipelines = (await pipelineDir.listPipelines(proj.path)) as Pipeline[];
  if (isJsonMode()) {
    okJson(pipelines);
    return;
  }
  if (pipelines.length === 0) {
    print("No pipelines.");
    return;
  }
  const rows: string[][] = [["ID", "NAME", "STATE", "TICKETS", "BRANCH"]];
  for (const p of pipelines) {
    rows.push([
      p.id,
      p.name,
      p.state,
      String(p.tickets?.length ?? 0),
      p.branch ?? "-",
    ]);
  }
  printLines([table(rows)]);
}

async function pipelineShow(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline show <id>");
  const pipeline = (await pipelineDir.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);
  if (isJsonMode()) {
    okJson(pipeline);
    return;
  }
  printLines([
    `id:        ${pipeline!.id}`,
    `name:      ${pipeline!.name}`,
    `state:     ${pipeline!.state}`,
    `branch:    ${pipeline!.branch}`,
    `baseBranch: ${pipeline!.baseBranch ?? "main"}`,
    `tickets:   ${pipeline!.tickets?.length ?? 0}`,
    `autoMerge: ${pipeline!.autoMerge ?? false}`,
  ]);
  if ((pipeline!.tickets ?? []).length > 0) {
    print("");
    print("Tickets:");
    const rows: string[][] = [["N", "TITLE", "STATUS", "MODE"]];
    for (const t of pipeline!.tickets) {
      rows.push([
        String(t.n),
        t.title,
        t.status,
        t.mode,
      ]);
    }
    printLines([table(rows)]);
  }
}

async function pipelineCreate(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);

  const name = args.positional[0] ?? (typeof args.flags["name"] === "string" ? args.flags["name"] : undefined);
  if (!name) fail("INVALID_ARGS", "Usage: vbpl pipeline create <name> [--base-branch <branch>] [--auto-merge]");

  const id = pipelineDir.generatePipelineId(name);
  const defaults = await pipelineDir.getResolvedDefaults(proj.path);
  const baseBranch = typeof args.flags["base-branch"] === "string" ? args.flags["base-branch"] : defaults.base_branch || "main";
  // auto-merge:flag 顯式給就用 flag,沒給 fallback project config defaults.auto_merge(對齊 web UI 行為)
  // --auto-merge 或 --auto-merge=true → on;--no-auto-merge 或 --auto-merge=false → off;省略 → 看 defaults
  let autoMerge: boolean;
  if (args.flags["auto-merge"] === true || args.flags["auto-merge"] === "true") {
    autoMerge = true;
  } else if (args.flags["auto-merge"] === "false" || args.flags["no-auto-merge"] === true) {
    autoMerge = false;
  } else {
    autoMerge = defaults.auto_merge;
  }
  const branch = `pipeline/${name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "")}`;

  const pipeline: Pipeline = {
    id,
    name,
    branch,
    baseBranch,
    state: "planning",
    tickets: [],
    autoMerge,
  };

  await pipelineDir.writePipeline(proj.path, id, pipeline, {
    source: "cli-pipeline-create",
    sourceDetail: `create pipeline ${name}`,
  });

  if (isJsonMode()) {
    okJson(pipeline);
    return;
  }
  printLines([
    `Created pipeline: ${name}`,
    `  id:     ${id}`,
    `  branch: ${branch}`,
  ]);
}

async function confirmTty(question: string): Promise<boolean> {
  // 沒 TTY 時無法問 → 視為「未確認」by caller(預設 fail)。
  if (!process.stdin.isTTY) return false;
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(question)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

// Delete cascade:走 backend HTTP — backend 負責 preflight(reject running/queued)+ worktree + branch + json + notif。
// CLI 只管 confirm prompt 與 partial result 顯示。
//   --force      跳過 confirm
//   --json mode  自動當 --force(無法互動)
async function pipelineDelete(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline delete <id> [--force]");

  const force = args.flags["force"] === true || isJsonMode();

  // 先撈 pipeline 確認存在(讓 confirm 訊息可以顯示 name + branch)
  const pipeline = (await pipelineDir.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);

  if (!force) {
    const branchInfo = pipeline!.branch ? ` + branch ${pipeline!.branch}` : "";
    const confirmed = await confirmTty(
      `真要刪 pipeline ${pipeline!.name} [${id}] (含 worktree${branchInfo} + pipeline.json)? y/n: `
    );
    if (!confirmed) {
      fail("USER_CANCELLED", "Delete cancelled.");
    }
  }

  await ensureBackend();
  type DeleteResp = {
    ok: true;
    partial: boolean;
    steps: {
      worktree: { ok: boolean; error?: string; skipped?: boolean };
      branch: { ok: boolean; error?: string; skipped?: boolean };
      json: { ok: boolean; error?: string; skipped?: boolean };
    };
    message?: string;
  };
  // 走 fetch DELETE — cli/lib/api.ts 只有 post(),這邊 inline 一個 DELETE
  // (ensureBackend 已在上面跑過)
  const res = await fetchDelete<DeleteResp>(`/api/projects/${proj.hash}/pipelines/${id}`);

  if (isJsonMode()) {
    okJson({ deleted: true, id, partial: res.partial, steps: res.steps, message: res.message });
    return;
  }
  if (res.partial) {
    printLines([
      `⚠ Pipeline 部分刪除:${pipeline!.name} [${id}]`,
      `  worktree: ${stepLine(res.steps.worktree)}`,
      `  branch:   ${stepLine(res.steps.branch)}`,
      `  json:     ${stepLine(res.steps.json)}`,
    ]);
    if (res.message) print(`  → ${res.message}`);
  } else {
    print(`✓ Deleted pipeline: ${pipeline!.name} [${id}] (worktree + branch + json 已清)`);
  }
}

function stepLine(s: { ok: boolean; error?: string; skipped?: boolean }): string {
  if (s.skipped) return "skipped" + (s.error ? ` (${s.error})` : "");
  if (s.ok) return "ok";
  return `FAIL — ${s.error ?? "(no message)"}`;
}

async function fetchDelete<T = unknown>(path: string): Promise<T> {
  const { apiBase } = await import("../lib/serverBase");
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `DELETE ${path} 連線失敗:${msg}`);
  }
  const j = (await res.json()) as { ok: true; data: T } | { ok: false; error: { code?: string; message: string } };
  if (!j.ok) {
    const code = j.error?.code?.toUpperCase() || "IO_ERROR";
    fail(code, j.error?.message || `${path} 失敗(${res.status})`);
  }
  return j.data;
}

// 走 backend HTTP — spawn child(claude/codex runner)必須讓 backend 養。
// CLI 自己 spawn 會在 CLI 退出時失去 child 控制權(orchestrator running map 蒸發,watchdog / stop 都失效)
async function pipelineRun(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline run <id>");
  await ensureBackend();

  const result = await post<{ ok: true; queued?: boolean; position?: number | null }>(
    `/api/projects/${proj.hash}/pipelines/${id}/run`
  );

  if (isJsonMode()) {
    okJson({ started: true, pipelineId: id, queued: result.queued ?? false, position: result.position ?? null });
    return;
  }
  if (result.queued) {
    print(`Pipeline queued: ${id} (position ${result.position ?? "?"})`);
  } else {
    print(`Pipeline started: ${id}`);
  }
}

async function pipelineStop(args: ParsedArgs): Promise<void> {
  if (args.flags["immediate"] !== undefined) fail("INVALID_ARGS", "Unknown flag: --immediate");
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline stop <id>");
  await ensureBackend();

  await post(`/api/projects/${proj.hash}/pipelines/${id}/stop`);

  if (isJsonMode()) {
    okJson({ stopped: true, pipelineId: id });
    return;
  }
  print(`Pipeline stopped: ${id}`);
}

async function pipelineStatus(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline status <id>");

  const pipeline = (await pipelineDir.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);

  const running = orchestrator.isRunning(proj.hash, id);
  const queued = orchestrator.isQueued(proj.hash, id);
  const queuePos = queued ? orchestrator.queuePosition(proj.hash, id) : null;

  const statusObj = {
    id,
    name: pipeline!.name,
    state: pipeline!.state,
    running,
    queued,
    queuePosition: queuePos,
    tickets: (pipeline!.tickets ?? []).map((t) => ({ id: t.id, n: t.n, title: t.title, status: t.status, mode: t.mode })),
  };

  if (isJsonMode()) {
    okJson(statusObj);
    return;
  }
  printLines([
    `Pipeline: ${pipeline!.name} (${id})`,
    `state:    ${pipeline!.state}${running ? " [in-process running]" : ""}${queued ? ` [queued #${queuePos}]` : ""}`,
  ]);
  if ((pipeline!.tickets ?? []).length > 0) {
    print("");
    const rows: string[][] = [["N", "TITLE", "STATUS"]];
    for (const t of pipeline!.tickets) {
      rows.push([String(t.n), t.title, t.status]);
    }
    printLines([table(rows)]);
  }
}

async function pipelineLog(args: ParsedArgs): Promise<void> {
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline log <id> [--last N] [--follow|-f]");

  const follow = args.flags["follow"] === true || args.flags["f"] === true;
  if (follow && isJsonMode()) {
    fail("INVALID_ARGS", "--json mode does not support --follow. Use --json with the listRuns API and manage streaming yourself.");
  }

  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  if (follow) {
    await followPipelineLog(proj.path, id);
    return;
  }

  const lastN = typeof args.flags["last"] === "string" ? Number(args.flags["last"]) : 1;
  const runs = await runLog.listRuns(proj.path, id);

  if (isJsonMode()) {
    okJson(runs.slice(0, lastN));
    return;
  }
  if (runs.length === 0) {
    print("No run logs found.");
    return;
  }
  const toShow = runs.slice(0, lastN);
  for (const run of toShow) {
    printLines([
      `--- Run ${run.filename} ---`,
      `started:  ${new Date(run.startedAt).toLocaleString()}`,
      `exit:     ${run.exitCode ?? "?"}`,
      `duration: ${run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "-"}`,
      `cost:     ${run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : "-"}`,
      `turns:    ${run.numTurns ?? "-"}`,
      `result:   ${run.result ? run.result.slice(0, 200) : "-"}`,
    ]);
    print("");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitLatestRun(projectPath: string, pipelineId: string): Promise<RunSummary> {
  while (true) {
    const runs = await runLog.listRuns(projectPath, pipelineId);
    if (runs[0]?.logPath) return runs[0];
    await sleep(500);
  }
}

async function followPipelineLog(projectPath: string, pipelineId: string): Promise<void> {
  let logPath: string | null = null;
  let lastSize = 0;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let rotationPoll: ReturnType<typeof setInterval> | null = null;
  let reading = false;
  let pending = false;
  let done = false;
  let finish: (() => void) | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (debounce) clearTimeout(debounce);
    if (rotationPoll) clearInterval(rotationPoll);
    watcher?.close();
    process.off("SIGINT", onSigint);
  };
  const complete = (): void => {
    cleanup();
    finish?.();
  };
  const onSigint = (): void => {
    cleanup();
    process.exit(0);
  };
  const readIncremental = async (): Promise<void> => {
    if (!logPath) return;
    const info = await stat(logPath);
    if (info.size <= lastSize) return;
    const file = await open(logPath, "r");
    try {
      let remaining = info.size - lastSize;
      let position = lastSize;
      const buffer = Buffer.alloc(Math.min(64 * 1024, remaining));
      while (remaining > 0) {
        const toRead = Math.min(buffer.length, remaining);
        const { bytesRead } = await file.read(buffer, 0, toRead, position);
        if (bytesRead === 0) break;
        process.stdout.write(buffer.subarray(0, bytesRead));
        position += bytesRead;
        remaining -= bytesRead;
      }
      lastSize = position;
    } finally {
      await file.close();
    }
  };
  const drain = async (): Promise<void> => {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      do {
        pending = false;
        await readIncremental();
      } while (pending);
    } catch (e) {
      process.stderr.write(`log follow stopped: ${e instanceof Error ? e.message : String(e)}\n`);
      complete();
    } finally {
      reading = false;
    }
  };
  const scheduleRead = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void drain();
    }, 100);
  };

  process.on("SIGINT", onSigint);
  const latest = await waitLatestRun(projectPath, pipelineId);
  logPath = latest.logPath;
  watcher = watch(logPath, scheduleRead);
  await drain();

  rotationPoll = setInterval(() => {
    void (async () => {
      const runs = await runLog.listRuns(projectPath, pipelineId);
      if (runs[0]?.logPath && runs[0].logPath !== logPath) {
        process.stderr.write("pipeline 重 spawn,請 re-run vbpl pipeline log --follow\n");
        complete();
      }
    })();
  }, 500);

  await new Promise<void>((resolve) => {
    finish = resolve;
  });
}

// AI merge:走 backend POST /merge,backend spawn runner 主 agent。CLI 立刻返回。
async function pipelineMerge(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline merge <id>");
  await ensureBackend();

  // 2026-05-13 後 backend 二段式:mechanical → mergeCommit;衝突 fallback ai → ticketId
  type MergeResp =
    | { ok: true; mode: "mechanical"; mergeCommit?: { hash: string; subject: string; ts: number }; alreadyMerged?: boolean }
    | { ok: true; mode: "ai"; ticketId: string; conflictFiles?: string[] };
  const res = await post<MergeResp>(`/api/projects/${proj.hash}/pipelines/${id}/merge`);

  if (isJsonMode()) {
    okJson({ ...res, pipelineId: id });
    return;
  }
  if (res.mode === "mechanical") {
    if (res.alreadyMerged) {
      print(`Already merged (no-op): ${id}`);
    } else {
      print(`✓ Merged (mechanical, no AI): ${id}`);
      if (res.mergeCommit) print(`  commit: ${res.mergeCommit.hash.slice(0, 7)} - ${res.mergeCommit.subject}`);
    }
  } else {
    const n = res.conflictFiles?.length ?? 0;
    print(`⚠ Conflict (${n} files), AI 接手:ticket=${res.ticketId}`);
    print(`Watch progress: vbpl pipeline log ${id}`);
  }
}

// Sync:把 base branch merge 進 pipeline worktree。
//   vbpl pipeline sync <id>           → 啟動(試 git merge,衝突跳 conflict_await)
//   vbpl pipeline sync <id> --ai      → conflict_await 階段確認讓 AI 解
//   vbpl pipeline sync <id> --cancel  → 任 active 狀態取消(merge --abort)
//   vbpl pipeline sync <id> --dismiss → 收尾 done/failed,清 syncJob
async function pipelineSync(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline sync <id> [--ai|--cancel|--dismiss]");
  await ensureBackend();

  const wantAi = args.flags["ai"] === true;
  const wantCancel = args.flags["cancel"] === true;
  const wantDismiss = args.flags["dismiss"] === true;

  if (wantAi) {
    // spawn AI child → 必須走 HTTP 讓 backend 養 child
    await post(`/api/projects/${proj.hash}/pipelines/${id}/sync/ai`);
    if (isJsonMode()) { okJson({ confirmed: true }); return; }
    print(`AI conflict resolution started for ${id}. Watch: vbpl pipeline status ${id}`);
    return;
  }
  if (wantCancel) {
    // 可能要 kill 已 spawn AI → 必須走 HTTP
    await post(`/api/projects/${proj.hash}/pipelines/${id}/sync/cancel`);
    if (isJsonMode()) { okJson({ cancelled: true }); return; }
    print(`Sync cancelled. worktree restored via git merge --abort.`);
    return;
  }
  if (wantDismiss) {
    const p = (await pipelineDir.readPipeline(proj.path, id)) as { syncJob?: { state?: string }; [k: string]: unknown } | null;
    if (!p) fail("NOT_FOUND", `Pipeline not found: ${id}`);
    if (!p.syncJob) {
      if (isJsonMode()) { okJson({ dismissed: true, noop: true }); return; }
      print("No syncJob to dismiss.");
      return;
    }
    if (p.syncJob.state === "ai_running" || p.syncJob.state === "merging") {
      fail("STATE_GUARD", `Sync still running (state=${p.syncJob.state}); use --cancel first`);
    }
    const { syncJob: _drop, ...rest } = p;
    void _drop;
    await pipelineDir.writePipeline(proj.path, id, rest, {
      source: "cli-sync-dismiss",
      sourceDetail: "dismiss syncJob",
      prevStateHint: typeof (p as { state?: string }).state === "string" ? (p as { state: string }).state : undefined,
    });
    if (isJsonMode()) { okJson({ dismissed: true }); return; }
    print("syncJob dismissed.");
    return;
  }

  // Default action:啟動 sync(CLI 直接呼 lib,不經 backend route → 自己 audit)
  const handle = auditLog.beginUserAction({
    projectPath: proj.path,
    action: "pipeline.sync",
    pipelineId: id,
  });
  let res: Awaited<ReturnType<typeof syncJob.startSync>>;
  try {
    res = await syncJob.startSync({
      projectPath: proj.path,
      projectHash: proj.hash,
      pipelineId: id,
    });
  } catch (e) {
    handle.error(String(e), "thrown");
    throw e;
  }
  if (!res.ok) {
    handle.error(res.error, "state_guard");
    fail("STATE_GUARD", res.error);
  }
  handle.ok();

  if (isJsonMode()) {
    okJson({ state: res.state, behind: res.behind, conflictFiles: res.conflictFiles });
    return;
  }
  if (res.state === "done") {
    print(`✓ Sync done (was ${res.behind ?? 0} commits behind, git merge clean).`);
  } else if (res.state === "conflict_await") {
    print(`⚠ Conflict: ${res.conflictFiles?.length ?? 0} files. Decide:`);
    print(`  vbpl pipeline sync ${id} --ai      (let AI resolve)`);
    print(`  vbpl pipeline sync ${id} --cancel  (abort merge)`);
    if (res.conflictFiles && res.conflictFiles.length > 0) {
      print("Conflicting files:");
      for (const f of res.conflictFiles.slice(0, 12)) print(`  - ${f}`);
      if (res.conflictFiles.length > 12) print(`  …and ${res.conflictFiles.length - 12} more`);
    }
  } else if (res.state === "failed") {
    print(`✕ Sync failed.`);
  } else {
    print(`Sync state: ${res.state}`);
  }
}
