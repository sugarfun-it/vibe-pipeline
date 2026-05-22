import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { open as openFile } from "node:fs/promises";
import * as pipelineDir from "../pipelineDir";
import * as projectStore from "../projectStore";
import * as worktree from "../git/worktree";
import * as notifs from "../notifs/store";
import * as ticketWatcher from "./ticketWatcher";
import * as runLog from "./runLog";
import * as testMode from "../testMode";
import { buildRunnerBehaviorPrompt } from "./runnerPrompt";
import { loadUserConfig, getTaskConfigWithAdapter } from "../userConfig";
import { ensureDepsAfterMerge } from "../depInstall";

const LOG_CODE_WIDTH = 10;

// P5: 抓 ticket id/status 寫進 log meta block,RunHistory diff 用
function snapshotTickets(
  tickets: ReadonlyArray<{ id?: string; status?: string } | undefined> | undefined
): Array<{ id: string; status: string }> {
  if (!tickets) return [];
  const out: Array<{ id: string; status: string }> = [];
  for (const t of tickets) {
    if (t && typeof t.id === "string" && typeof t.status === "string") {
      out.push({ id: t.id, status: t.status });
    }
  }
  return out;
}

type RunningProcess = {
  pipelineId: string;
  proc: Bun.Subprocess | null; // mock 模式為 null
  startedAt: number;
  // kind 區分 ticket runner 主 agent 跟 sync AI(衝突解)。
  // isRunning() / runningCount() 都把兩種視為 busy,擋 /run /merge /sync 等操作。
  // 但 watchdog crash recovery 行為不同:ticket 標 paused;sync 走 git merge --abort + syncJob.state="failed"
  kind: "ticket" | "sync";
};

const running = new Map<string, RunningProcess>(); // key: <projectHash>:<pipelineId>

function runnerLogHeader(pipelineId: string, state: "active" | "exited", code: number | null = null): string {
  const codeText = code == null ? "".padEnd(LOG_CODE_WIDTH) : String(code).padEnd(LOG_CODE_WIDTH);
  return `[runner ${pipelineId}] ${state} code=${codeText}\n`;
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

async function patchRunnerLogExitCode(logFile: string, pipelineId: string, code: number | null): Promise<void> {
  const file = await openFile(logFile, "r+");
  try {
    await file.write(runnerLogHeader(pipelineId, "exited", code), 0, "utf8");
  } finally {
    await file.close();
  }
}

// 暴露給 syncJob.ts 註冊 / 卸載 sync 的 running entry。
// 共用 running map 讓 isRunning() / runningCount() / max_parallel 自動把 sync 算成 busy。
export function registerSyncRunning(
  projectHash: string,
  pipelineId: string,
  proc: Bun.Subprocess
): void {
  running.set(key(projectHash, pipelineId), {
    pipelineId,
    proc,
    startedAt: Date.now(),
    kind: "sync",
  });
}

export function unregisterRunning(projectHash: string, pipelineId: string): void {
  running.delete(key(projectHash, pipelineId));
}

export function runningKind(
  projectHash: string,
  pipelineId: string
): "ticket" | "sync" | null {
  return running.get(key(projectHash, pipelineId))?.kind ?? null;
}

// === Liveness watchdog ===
// Bun.Subprocess.exited 通常會在 child 結束時 fire,但 Windows 偶發
// process tree 異常(orphan / handle leak)可能造成 exit promise 卡住,running map
// entry 留下「pipeline.json 寫 running 但實際沒 process」的 stale 狀態。
// 每 60s 掃一遍,對每個 entry 驗 OS PID 是否還活,死了就走跟正常 exit 同樣的
// cleanup(標 paused + notif + 釋 slot + dispatcher 接棒)。
// 純加邏輯,既有 exit handler 不動;watchdog 抓到的話 exit handler 失效這 entry
// 不會收到 proc.exited resolve,但 running.delete 已執行,handler 後續寫操作對
// 已刪除 entry 是 no-op,安全。
const WATCHDOG_INTERVAL_MS = 60_000;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 不殺只查
    return true;
  } catch {
    return false;
  }
}

// 跨平台殺整棵 process tree。Windows 殺父不殺孫,單 SIGKILL 會留 orphan(codex
// sub-agent 常踩),所以 stop / restart 都得呼這個。Windows 走 taskkill /T /F,
// POSIX 試 process group(-pid)失敗 fallback 單 pid。失敗吞掉,呼叫端用 fs 善後判
// ground truth。
async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      const proc = Bun.spawn(["taskkill", "/T", "/F", "/PID", String(pid)], {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      });
      await proc.exited;
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
}

async function watchdogTick(): Promise<void> {
  for (const [k, entry] of running.entries()) {
    if (!entry.proc) continue; // mock 模式
    // exitCode 非 null 表示 Bun 知道 process 已退;exit handler 應該會處理。
    // 但若 exit handler 卡住(extremely rare),這邊也視為已死,fallback recover
    const codeKnown = entry.proc.exitCode !== null;
    const pidAlive = isPidAlive(entry.proc.pid);
    if (codeKnown || !pidAlive) {
      const reason = codeKnown
        ? `exit code=${entry.proc.exitCode} but stuck in running map`
        : `PID ${entry.proc.pid} no longer alive`;
      console.warn(`[watchdog ${entry.pipelineId}] ${reason} — recovering`);
      const [hashPart] = k.split(":");
      const projectHash = hashPart ?? "";
      const project = await projectStore.findByHash(projectHash);
      if (!project) {
        running.delete(k);
        continue;
      }
      try {
        const p = (await pipelineDir.readPipeline(project.path, entry.pipelineId)) as {
          state?: string;
          name?: string;
          syncJob?: { state?: string };
          [k: string]: unknown;
        } | null;
        if (entry.kind === "sync") {
          // sync AI 死了 → git merge --abort + 標 syncJob.failed
          try {
            await worktree.mergeAbort(project.path, entry.pipelineId);
          } catch (e) {
            console.error(`[watchdog ${entry.pipelineId}] sync abort failed:`, e);
          }
          if (p?.syncJob && p.syncJob.state === "ai_running") {
            await pipelineDir.writePipeline(project.path, entry.pipelineId, {
              ...p,
              syncJob: {
                ...p.syncJob,
                state: "failed",
                endedAt: Date.now(),
                reason: reason,
              },
            }, {
              source: "watchdog-crash-recover",
              sourceDetail: `sync ${reason}`,
              prevStateHint: typeof p.state === "string" ? p.state : undefined,
            });
            notifs.emit(project.path, {
              type: "sync_failed",
              title: `${p.name || entry.pipelineId} 同步 AI 異常結束`,
              sub: reason,
              pipelineId: entry.pipelineId,
            });
          }
        } else if (p && (p.state === "running" || isLegacyPausePendingState(p.state))) {
          // ticket runner 死亡後收斂成 paused,保留 worktree 進度
          await pipelineDir.writePipeline(project.path, entry.pipelineId, {
            ...p,
            state: "paused",
          }, {
            source: "watchdog-crash-recover",
            sourceDetail: reason,
            prevStateHint: typeof p.state === "string" ? p.state : undefined,
          });
          notifs.emit(project.path, {
            type: "runner_crash",
            title: `${p.name || entry.pipelineId} runner 異常結束`,
            sub: reason,
            pipelineId: entry.pipelineId,
          });
        }
      } catch (e) {
        console.error(`[watchdog ${entry.pipelineId}] cleanup failed:`, e);
      }
      running.delete(k);
      if (entry.kind === "ticket") {
        ticketWatcher.stop({ projectHash, pipelineId: entry.pipelineId });
      }
      // 釋 slot,dispatcher 接棒
      dispatch(project.path, projectHash).catch((e) =>
        console.error(`[watchdog ${entry.pipelineId}] dispatch failed:`, e)
      );
    }
  }
}

export function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    void watchdogTick();
  }, WATCHDOG_INTERVAL_MS);
}

// FIFO queue per project:enqueue 順序 = 排隊順位。dispatcher 從隊頭撈、轉 spawn。
// 不存 process,只存「下一次 spawn 該帶的 opts」。
type QueuedItem = {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  enqueuedAt: number;
};
// key: projectHash → ordered list (順位 = index + 1)
const queues = new Map<string, QueuedItem[]>();

function key(projectHash: string, pipelineId: string): string {
  return `${projectHash}:${pipelineId}`;
}

const LEGACY_PAUSE_PENDING_STATE = "stop" + "ping";

function isLegacyPausePendingState(state: unknown): boolean {
  return state === LEGACY_PAUSE_PENDING_STATE;
}

// 算單一 pipeline 的累積花費。
// 來源優先序:ticket.runs[].cost(若 runner 有寫入)→ fallback 解析 runtime/logs/<pipelineId>-<ts>.log。
// 已 merged / failed / paused 也算。算不出來就當 0,絕不擋住 /run。
async function computePipelineSpent(projectPath: string, pipelineId: string): Promise<number> {
  try {
    const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
      tickets?: Array<{
        runs?: Array<{ cost?: number }>;
        [k: string]: unknown;
      }>;
      [k: string]: unknown;
    } | null;
    if (!pipeline) return 0;

    let total = 0;
    let foundTicketCost = false;
    for (const t of pipeline.tickets ?? []) {
      for (const r of t.runs ?? []) {
        if (typeof r.cost === "number" && Number.isFinite(r.cost)) {
          total += r.cost;
          foundTicketCost = true;
        }
      }
    }
    if (foundTicketCost) return total;

    // fallback:沒 ticket-level cost,sum 該 pipeline 的 log 解析結果
    try {
      const runs = await runLog.listRuns(projectPath, pipelineId);
      for (const r of runs) {
        if (typeof r.costUsd === "number" && Number.isFinite(r.costUsd)) {
          total += r.costUsd;
        }
      }
    } catch {
      // log 解析失敗當 0
    }
    return total;
  } catch {
    return 0;
  }
}

export function isRunning(projectHash: string, pipelineId: string): boolean {
  return running.has(key(projectHash, pipelineId));
}

export function isQueued(projectHash: string, pipelineId: string): boolean {
  const q = queues.get(projectHash);
  return q ? q.some((it) => it.pipelineId === pipelineId) : false;
}

// 同 project 還在跑的條數 — 給 routes / TopBar N/M 用
export function runningCount(projectHash: string): number {
  let n = 0;
  for (const k of running.keys()) {
    if (k.startsWith(projectHash + ":")) n++;
  }
  return n;
}

// 全 project 還在跑的條數(ticket + sync 都算)— 給 system update preflight 用
export function globalRunningCount(): number {
  return running.size;
}

// 順位(1-based);不在 queue 回 0
export function queuePosition(projectHash: string, pipelineId: string): number {
  const q = queues.get(projectHash);
  if (!q) return 0;
  const i = q.findIndex((it) => it.pipelineId === pipelineId);
  return i < 0 ? 0 : i + 1;
}

function enqueue(item: QueuedItem): void {
  const arr = queues.get(item.projectHash) ?? [];
  arr.push(item);
  queues.set(item.projectHash, arr);
}

function dequeue(projectHash: string, pipelineId: string): boolean {
  const arr = queues.get(projectHash);
  if (!arr) return false;
  const i = arr.findIndex((it) => it.pipelineId === pipelineId);
  if (i < 0) return false;
  arr.splice(i, 1);
  if (arr.length === 0) queues.delete(projectHash);
  return true;
}

// 從 queue 撈下一張可跑的並 spawn。每次 ticket 跑完 / max_parallel 變動時呼叫。
// 每次只取 1 張(if slot 還空就會被下一輪 dispatch 接著跑)。
async function dispatch(projectPath: string, projectHash: string): Promise<void> {
  const max = await pipelineDir.getMaxParallel(projectPath);
  while (runningCount(projectHash) < max) {
    const arr = queues.get(projectHash);
    if (!arr || arr.length === 0) return;
    const next = arr.shift()!;
    if (arr.length === 0) queues.delete(projectHash);

    // 嘗試 spawn — 若目標 pipeline 已不在 queued 狀態(被 user 改回 paused / 刪掉)就跳過
    const cur = (await pipelineDir.readPipeline(projectPath, next.pipelineId)) as {
      state?: string;
    } | null;
    if (!cur || cur.state !== "queued") continue;
    // 改回 ready / paused 之類後再 spawn(spawn 內會 mark running)
    // 但內部 spawn 已 own state guard;這邊不重設 state,直接呼叫內部 spawn
    await spawnDirect({ projectPath, projectHash, pipelineId: next.pipelineId });
  }
}

// 起 main agent。Pipeline 必須已存在,有 branch 欄位。
// 行為:
//   - 既有 state guard(running/merged/queued + ready 沒可跑 ticket)擋
//   - slot 滿 → 標 queued + emit pipeline_queued + enqueue,不 spawn
//   - slot 沒滿 → 直接 spawn(走 spawnDirect)
export type StartResult =
  | { ok: true; queued?: boolean; position?: number }
  | { ok: false; error: string; reason?: "budget_exceeded"; spent?: number; limit?: number };

export async function start(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<StartResult> {
  const { projectPath, projectHash, pipelineId } = opts;
  const k = key(projectHash, pipelineId);

  if (running.has(k)) {
    return { ok: false, error: "Pipeline 已在跑" };
  }
  if (isQueued(projectHash, pipelineId)) {
    return { ok: false, error: "Pipeline 已在排隊" };
  }

  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    branch?: string;
    baseBranch?: string;
    name?: string;
    state?: string;
    tickets?: Array<{ status?: string }>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return { ok: false, error: `Pipeline not found: ${pipelineId}` };

  // State guard:不允許在這幾個狀態 spawn(避免重複跑、燒錢空轉)
  if (pipeline.state === "running") {
    return { ok: false, error: "Pipeline 已在 running" };
  }
  if (pipeline.state === "queued") {
    return { ok: false, error: "Pipeline 已在 queued" };
  }
  if (pipeline.state === "ready" || pipeline.state === "merged") {
    // 沒事可跑 — ready / merged 都需要 user 先 append 新 ticket(或 sync ticket)才有東西跑。
    // merged 不是終態:branch / worktree 都還在,可以繼續加 ticket、sync、再 merge。
    const hasRunnable = (pipeline.tickets ?? []).some(
      (t) => t.status === "draft" || t.status === "ready"
    );
    if (!hasRunnable) {
      return { ok: false, error: "Pipeline 沒待跑的 ticket(append 新 ticket 或 reset 既有的)" };
    }
  }

  // Budget check:cost_limit_usd > 0 且該 pipeline 累積 spent >= limit 時擋下。
  // 不改 pipeline state(維持當前)。emit pipeline_blocked_budget notif。
  const resolved = await pipelineDir.getResolvedDefaults(projectPath);
  const limit = resolved.cost_limit_usd;
  if (limit > 0) {
    const spent = await computePipelineSpent(projectPath, pipelineId);
    if (spent >= limit) {
      notifs.emit(projectPath, {
        type: "pipeline_blocked_budget",
        title: `${pipeline.name || pipelineId} 被預算上限擋下`,
        sub: `該 pipeline 累積已花 $${spent.toFixed(4)} / 上限 $${limit.toFixed(2)}`,
        pipelineId,
      });
      return {
        ok: false,
        error: `已達預算上限($${spent.toFixed(4)} / $${limit.toFixed(2)})`,
        reason: "budget_exceeded",
        spent,
        limit,
      };
    }
  }

  // Slot 檢查:滿了改進 queue
  const max = await pipelineDir.getMaxParallel(projectPath);
  if (runningCount(projectHash) >= max) {
    enqueue({ projectPath, projectHash, pipelineId, enqueuedAt: Date.now() });
    await pipelineDir.mutatePipeline(projectPath, pipelineId, (p) => ({
      ...p,
      state: "queued",
    }), {
      source: "orchestrator.start",
      sourceDetail: "slot full → enqueue",
    });
    const pos = queuePosition(projectHash, pipelineId);
    notifs.emit(projectPath, {
      type: "pipeline_queued",
      title: `${pipeline.name || pipelineId} 已排隊`,
      sub: `順位 ${pos}(slot ${runningCount(projectHash)}/${max} 已滿)`,
      pipelineId,
    });
    return { ok: true, queued: true, position: pos };
  }

  return spawnDirect({ projectPath, projectHash, pipelineId });
}

// 真正 spawn 主 agent。state guard / slot 檢查在外層 start 完成。
// dispatcher 也走這條(已從 queue 撈出來、確認 slot 有空)。
async function spawnDirect(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const k = key(projectHash, pipelineId);

  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    branch?: string;
    baseBranch?: string;
    name?: string;
    state?: string;
    tickets?: Array<{ status?: string }>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return { ok: false, error: `Pipeline not found: ${pipelineId}` };

  const branch = pipeline.branch || `pipeline/${pipeline.name || pipelineId}`;
  const baseBranch = pipeline.baseBranch || "main";

  // 1. 建/重用 worktree
  let wtPath: string;
  try {
    wtPath = await worktree.ensure(projectPath, pipelineId, branch, baseBranch);
  } catch (e) {
    return { ok: false, error: `worktree 失敗: ${String(e)}` };
  }

  // 2. 標 pipeline running 寫回(用 mutatePipeline 避免覆蓋 worktree.ensure 期間 user 改的欄位)
  await pipelineDir.mutatePipeline(projectPath, pipelineId, (p) => ({
    ...p,
    state: "running",
  }), {
    source: "orchestrator.spawnDirect",
    sourceDetail: "spawn runner main agent",
  });

  // GC:每次 /run 順便修剪累積。logs per-pipeline 留 10、notifs 全 project 留 500。
  // 失敗安靜忽略,GC 不該擋 runner 起跑。
  try {
    runLog.pruneLogs(projectPath, pipelineId, 10);
    notifs.pruneOldRecords(projectPath, 500);
  } catch {
    // skip
  }

  // 3a. E2E mock 分支:不 spawn 真 claude,起 fake timeline 模擬寫 pipeline.json
  if (testMode.isTestMode()) {
    return startMockRunner({ projectPath, projectHash, pipelineId, k });
  }

  // 3b. spawn claude CLI 主 agent (cwd = worktree)
  const sessionId = randomUUID();
  const initialMessage = `開始跑 pipeline。\n\npipeline JSON: ${join(
    projectPath,
    ".vibe-pipeline",
    "pipelines",
    `${pipelineId}.json`
  )}\npipelineId: ${pipelineId}\nworktree (your cwd): ${wtPath}\n\n讀 pipeline JSON,按 system prompt 流程跑。`;

  // 主 agent 拿全工具 — 因為 sub-agent (Task) 會繼承限制,
  // 擋 Edit/Write 就等於 sub-agent 也不能改 code,ticket 跑不了。
  // 改用 system prompt 約束主 agent 自己不直接改 source(只用 Edit/Write 更新 pipeline.json)
  const userCfg = await loadUserConfig();
  const executorCfg = userCfg.defaults.executor;
  const criticCfg = userCfg.defaults.critic;
  const mergeCfg = userCfg.defaults.merge;
  const runnerCfg = await getTaskConfigWithAdapter("runner");

  // 主 agent 永遠帶 bypass:現在 codex sub-agent 改走 Bash 直呼 `codex exec ...`
  // (不再經 codex-rescue plugin),主 agent 必須能 Bash 任意指令才能派 codex / 跑
  // 環境 setup。安全邊界:source code 改動仍走 sub-agent,主 agent 只 Bash 派發 +
  // 環境工具,risk 跟既有「sub-agent 改 code」同等級
  const needsBypassPermissions = true;

  let proc: Bun.Subprocess;
  try {
    proc = runnerCfg.adapter.spawn({
      kind: "runner",
      cwd: wtPath,
      sessionId,
      initialMessage,
      systemPrompt: buildRunnerBehaviorPrompt({ executor: executorCfg, critic: criticCfg, merge: mergeCfg }),
      model: runnerCfg.model,
      effort: runnerCfg.effort,
      needsBypassPermissions,
    });
  } catch (e) {
    return { ok: false, error: `spawn ${runnerCfg.adapter.name} failed: ${String(e)}` };
  }

  running.set(k, { pipelineId, proc, startedAt: Date.now(), kind: "ticket" });

  notifs.emit(projectPath, {
    type: "pipeline_started",
    title: `${pipeline.name || pipelineId} 開始運行`,
    sub: `worktree: ${wtPath}`,
    pipelineId,
  });

  // 啟 ticket watcher:監看 pipeline.json,ticket.status 變化 → emit notif
  await ticketWatcher.start({ projectPath, projectHash, pipelineId });

  // log file: <target>/.vibe-pipeline/.runtime/logs/<pipelineId>-<ts>.log
  const logsDir = pipelineDir.ensureRuntime(projectPath, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, `${pipelineId}-${Date.now()}.log`);
  await Bun.write(logFile, runnerLogHeader(pipelineId, "active") + "--- stdout ---\n");

  // P5: snapshot 當下 tickets 狀態作為 ticketsBefore(spawn 前的基線),exit handler 算 diff 用
  const ticketsBefore = snapshotTickets(pipeline.tickets);

  // 不 await — let it run async,handler 監看 exit
  (async () => {
    let stdoutText = "";
    let stderrText = "";
    let logStream: WriteStream | null = null;
    try {
      logStream = createWriteStream(logFile, { flags: "a" });
      const stdoutPromise = (async () => {
        if (!proc.stdout) return;
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
          const s = new TextDecoder().decode(chunk);
          stdoutText += s;
          logStream?.write(s);
        }
      })();
      const stderrPromise = (async () => {
        if (!proc.stderr) return;
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          stderrText += new TextDecoder().decode(chunk);
        }
      })();
      await Promise.all([stdoutPromise, stderrPromise]);
      const codeFromExited = await proc.exited;
      const code = proc.exitCode;
      logStream.write("\n--- stderr ---\n");
      logStream.write(stderrText);
      // P5: 寫 ticket snapshot meta(before spawn snapshot + after exit re-read)
      const finalForMeta = (await pipelineDir.readPipeline(projectPath, pipelineId).catch(() => null)) as {
        tickets?: Array<{ id?: string; status?: string }>;
      } | null;
      const ticketsAfter = snapshotTickets(finalForMeta?.tickets ?? []);
      const meta = JSON.stringify({ ticketsBefore, ticketsAfter });
      logStream.write("\n--- meta ---\n");
      logStream.write(meta);
      await endStream(logStream);
      logStream = null;
      await patchRunnerLogExitCode(logFile, pipelineId, code ?? codeFromExited);
      console.log(`[runner ${pipelineId}] exited code=${code}, log → ${logFile}`);

      // 偵測 transient error:exit code !== 0(child crash / OOM / API quota / kill)
      // 或 stdout 含 turn.failed / thread.failed(Claude CLI 回報 API 拒絕)
      // 主 agent 在這些情況沒機會自標 paused,backend 要兜底:
      //   pipeline.state="paused" + 將 running ticket 改 failed_transient + emit notif
      // 為 normal exit(code===0 且無 turn.failed)留路徑不動,讓主 agent 自己寫的 state 為準
      const exitCode = code ?? codeFromExited;
      const hasTurnFailed = /\b(turn\.failed|thread\.failed)\b/.test(stdoutText);
      const isTransient = (exitCode !== null && exitCode !== 0) || hasTurnFailed;
      if (isTransient) {
        try {
          const cur = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
            state?: string;
            name?: string;
            tickets?: Array<{ status?: string; [k: string]: unknown }>;
            [k: string]: unknown;
          } | null;
          if (cur && (cur.state === "running" || cur.state === "stopping")) {
            const now = Date.now();
            const tickets = (cur.tickets ?? []).map((t) =>
              t.status === "running"
                ? { ...t, status: "failed_transient", endedAt: now }
                : t
            );
            await pipelineDir.writePipeline(projectPath, pipelineId, {
              ...cur,
              state: "paused",
              tickets,
            }, {
              source: "orchestrator.transient-recover",
              sourceDetail: hasTurnFailed
                ? "child reported turn.failed"
                : `child exit code=${exitCode}`,
              prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
            });
            const sub = hasTurnFailed
              ? "child 回報 turn.failed(API quota / provider error)"
              : `child 異常退出 (code=${exitCode})`;
            notifs.emit(projectPath, {
              type: "pipeline_paused",
              title: `${cur.name || pipelineId} runner 異常結束,已暫停`,
              sub,
              pipelineId,
            });
          }
        } catch (e) {
          console.error(`[runner ${pipelineId}] transient recovery failed:`, e);
        }
      }

      // Emit notif based on final pipeline state
      // transient 路徑已 emit pipeline_paused + 寫 state,跳過避免重複 notif
      if (!isTransient) try {
        const final = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
          state?: string;
          name?: string;
          baseBranch?: string;
          mergeCommit?: { hash?: string };
        } | null;
        const name = final?.name || pipelineId;

        // Merge 完 worktree 已沒用 — 直接 prune,讓 `git worktree list` / VSCode Source Control
        // 不再堆積已合併的分支。pipeline.json 保留作紀錄,只清磁碟與 git 註冊表。
        // 失敗時 emit warning notif 但不阻斷 merge 成功狀態。
        if (final?.state === "merged") {
          try {
            const r = await worktree.removeQuiet(projectPath, pipelineId);
            if (!r.ok) {
              console.warn(`[runner ${pipelineId}] worktree prune failed: ${r.error}`);
              notifs.emit(projectPath, {
                type: "pipeline_merge_cleanup_failed",
                title: `${name} merge 後 worktree 清理失敗`,
                sub: r.error,
                pipelineId,
              });
            }
          } catch (e) {
            console.warn(`[runner ${pipelineId}] worktree prune threw:`, e);
          }

          // 雷區 #20:merge 動到 package.json 或 bun.lock → 同步跑 bun install 補 main repo node_modules
          const mergeHash = final?.mergeCommit?.hash;
          if (mergeHash) {
            try {
              const dep = await ensureDepsAfterMerge(projectPath, mergeHash);
              if (dep.ran && !dep.ok) {
                console.warn(`[runner ${pipelineId}] bun install failed: ${dep.error}`);
                notifs.emit(projectPath, {
                  type: "pipeline_merge_cleanup_failed",
                  title: `${name} merge 後 bun install 失敗`,
                  sub: dep.error,
                  pipelineId,
                });
              }
            } catch (e) {
              console.warn(`[runner ${pipelineId}] ensureDepsAfterMerge threw:`, e);
            }
          }
        }

        if (final?.state === "ready") {
          notifs.emit(projectPath, {
            type: "pipeline_ready_to_merge",
            title: `${name} 完成,可合併`,
            pipelineId,
          });
        } else if (final?.state === "paused") {
          notifs.emit(projectPath, {
            type: "pipeline_paused",
            title: `${name} 已暫停`,
            pipelineId,
          });
        } else if (final?.state === "failed") {
          notifs.emit(projectPath, {
            type: "pipeline_failed",
            title: `${name} 失敗`,
            sub: `code=${code}`,
            pipelineId,
          });
        } else if (code !== 0) {
          notifs.emit(projectPath, {
            type: "runner_crash",
            title: `${name} runner 異常結束`,
            sub: `exit ${code}`,
            pipelineId,
          });
        }
      } catch (e) {
        console.error(`[runner ${pipelineId}] notif emit failed:`, e);
      }
    } catch (e) {
      console.error(`[runner ${pipelineId}] error:`, e);
      if (logStream) {
        try {
          logStream.write("\n--- stderr ---\n");
          logStream.write(stderrText);
          await endStream(logStream);
          logStream = null;
        } catch {}
      }
      try {
        const finalForMeta = (await pipelineDir.readPipeline(projectPath, pipelineId).catch(() => null)) as {
          tickets?: Array<{ id?: string; status?: string }>;
        } | null;
        const meta = JSON.stringify({
          ticketsBefore,
          ticketsAfter: snapshotTickets(finalForMeta?.tickets ?? []),
        });
        await Bun.write(
          logFile,
          `${runnerLogHeader(pipelineId, "active")}--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}\n[runner ${pipelineId}] error: ${String(e)}\n--- meta ---\n${meta}`,
        );
      } catch {}
    } finally {
      running.delete(k);
      ticketWatcher.stop({ projectHash, pipelineId });
      // Auto-merge:pipeline 收尾後若 state=ready && autoMerge → 直接觸發 AI merge。
      // 必須在 running.delete 之後,讓 triggerMerge 內的 orchestrator.start 看得到空 slot。
      // 不擋 dispatch — 即使 auto-merge spawn 自己也走 start(若 slot 滿會自己進 queue)。
      try {
        await maybeAutoMerge({ projectPath, projectHash, pipelineId });
      } catch (e) {
        console.error(`[runner ${pipelineId}] maybeAutoMerge failed:`, e);
      }
      // slot 釋出,看看 queue 有沒有 pending 接棒
      dispatch(projectPath, projectHash).catch((e) =>
        console.error(`[runner ${pipelineId}] dispatch after exit failed:`, e)
      );
    }
  })();

  return { ok: true };
}

// Pipeline 進入 ready 後,若 autoMerge=true 且當前 state=ready → 自動觸發 AI 合併。
// 走跟手動 /merge 同一條 triggerMerge,因此 slot 滿會自然進 queue。
// 失敗(working tree 髒 / spawn 失敗等)→ 寫 lastAutoMergeError + emit notif,不重試。
// 用 dynamic import 避免 orchestrator <-> pipelineMerge 循環(pipelineMerge 也 import 本檔)。
async function maybeAutoMerge(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<void> {
  const { projectPath, projectHash, pipelineId } = opts;
  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    state?: string;
    name?: string;
    autoMerge?: boolean;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return;
  // 自動 merge 觸發條件:autoMerge=true && state===ready && 不在 merged/merging/failed
  // (merged 已合過、merging 沒這個 state、failed 不重試)
  if (!pipeline.autoMerge) return;
  if (pipeline.state !== "ready") return;

  const name = pipeline.name || pipelineId;
  notifs.emit(projectPath, {
    type: "pipeline_auto_merge_started",
    title: `${name} 自動合併已觸發`,
    sub: "全 ticket done → autoMerge=true",
    pipelineId,
  });

  // 清掉之前的 lastAutoMergeError(重新嘗試)
  if (pipeline.lastAutoMergeError !== undefined) {
    await pipelineDir.writePipeline(projectPath, pipelineId, {
      ...pipeline,
      lastAutoMergeError: undefined,
    }, {
      source: "maybeAutoMerge",
      sourceDetail: "clear lastAutoMergeError before retry",
      prevStateHint: typeof pipeline.state === "string" ? pipeline.state : undefined,
    });
  }

  try {
    // 2026-05-13 改:auto-merge 二段式。
    // 1. backend-only git merge(autoMergeNoAI)→ clean 秒結束、寫 state=merged
    // 2. 撞衝突 → 自動 fallback 到 triggerMerge(spawn AI runner 全套),同 manual merge 路徑
    //    心智:autoMerge=true 是「全自動」承諾,user 不想自己決定燒 token;
    //    速度收益保留在 clean 場景(~90%),衝突場景跟過去一樣慢但無人值守
    // 其他失敗(dirty / git_error)→ 不 fallback AI(那不是 AI 能解的),emit merge_blocked 等 user
    // dynamic import 拆循環依賴
    const { autoMergeNoAI, triggerMerge } = await import("../pipelineMerge");
    const r = await autoMergeNoAI({
      projectPath,
      projectHash,
      pipelineId,
      hasGit: true,
    });
    if (r.ok) {
      const sub = "mergeCommit" in r && r.mergeCommit
        ? `merge commit ${r.mergeCommit.hash.slice(0, 7)}`
        : "已最新(無 commit 可合)";
      notifs.emit(projectPath, {
        type: "pipeline_merged",
        title: `${name} 自動合併完成`,
        sub,
        pipelineId,
      });
      return;
    }

    // 失敗分流:conflict → 自動升級走 AI;其他 → emit merge_blocked 等 user
    if (r.reason === "conflict") {
      const fileCount = "conflictFiles" in r ? r.conflictFiles.length : 0;
      notifs.emit(projectPath, {
        type: "pipeline_auto_merge_started",
        title: `${name} 撞衝突,升級走 AI 合併`,
        sub: `${fileCount} 衝突檔,backend 已 abort merge,改 spawn AI`,
        pipelineId,
      });
      // FCM push:user 可能不在 UI(autoMerge 場景就是要無人值守);告知 AI 接手了
      void (async () => {
        try {
          const cfg = await loadUserConfig();
          if (!cfg.pushEvents.auto_merge_conflict) return;
          const tokenStore = await import("../push/tokenStore");
          const { fanoutPush } = await import("../fcm");
          const records = await tokenStore.listTokens();
          if (records.length === 0) return;
          const dead = await fanoutPush(
            records.map((rec) => rec.token),
            {
              notification: {
                title: `🤖 ${name} AI 接手解衝突`,
                body: `自動合併撞 ${fileCount} 個衝突檔,AI 開始處理`,
              },
              data: {
                workUnitId: pipelineId,
                url: `/board?project=${projectHash}&pipeline=${pipelineId}`,
              },
            }
          );
          if (dead.length > 0) await tokenStore.removeDeadTokens(dead);
        } catch (e) {
          console.error(`[autoMerge ${pipelineId}] push failed:`, e);
        }
      })();
      const ai = await triggerMerge({
        projectPath,
        projectHash,
        pipelineId,
        hasGit: true,
      });
      if (!ai.ok) {
        const cur = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
          state?: string;
          [k: string]: unknown;
        } | null;
        if (cur) {
          await pipelineDir.writePipeline(projectPath, pipelineId, {
            ...cur,
            lastAutoMergeError: ai.error,
          }, {
            source: "maybeAutoMerge",
            sourceDetail: `AI fallback failed: ${ai.error}`,
            prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
          });
        }
        notifs.emit(projectPath, {
          type: "merge_blocked",
          title: `${name} 自動合併升級 AI 也失敗`,
          sub: ai.error,
          pipelineId,
        });
      }
      return;
    }

    // dirty / git_error / not_found / running — 不適合 AI 自動解,emit merge_blocked
    const cur = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
      state?: string;
      [k: string]: unknown;
    } | null;
    if (cur) {
      await pipelineDir.writePipeline(projectPath, pipelineId, {
        ...cur,
        lastAutoMergeError: r.error,
      }, {
        source: "maybeAutoMerge",
        sourceDetail: `auto-merge blocked: ${r.error}`,
        prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
      });
    }
    notifs.emit(projectPath, {
      type: "merge_blocked",
      title: `${name} 自動合併失敗`,
      sub: r.error,
      pipelineId,
    });
  } catch (e) {
    console.error(`[autoMerge ${pipelineId}] failed:`, e);
  }
}

// Immediate stop:對 spawn 的主 agent ChildProcess SIGKILL(Windows ChildProcess.kill() = terminate),
// 然後同步把 pipeline.state = "paused" + 把仍 running 的 ticket 標 "paused"。
// 已死 process / 找不到 handle → 視同成功,只校正 pipeline.json 狀態。
// state guard:pipeline 不在 running 才報 state_guard。
export async function stopImmediate(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code?: "state_guard" | "not_found" }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const k = key(projectHash, pipelineId);

  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    state?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) {
    return { ok: false, error: `Pipeline not found: ${pipelineId}`, code: "not_found" };
  }
  if (pipeline.state !== "running") {
    return {
      ok: false,
      error: `Pipeline 不在 running 狀態(當前: ${pipeline.state})`,
      code: "state_guard",
    };
  }

  // 砍整棵 process tree(main agent + sub-agent + sub-agent 子孫)。Windows 單殺
  // 父不殺孫,SIGKILL main agent 會留 codex/claude sub-agent orphan(用 fs 看到 ticket
  // 被改但不知誰幹的)。改走 killProcessTree:Windows taskkill /T,POSIX process group。
  const entry = running.get(k);
  if (entry?.proc) {
    try {
      await killProcessTree(entry.proc.pid);
    } catch (e) {
      console.warn(`[runner ${pipelineId}] killProcessTree failed (likely already exited):`, e);
    }
    // 等 exit 確認 — proc.exited 在已死的 process 上會立刻 resolve
    try {
      await Promise.race([
        entry.proc.exited,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // ignore
    }
  }

  // 確保 in-memory entry 清掉(exit handler 通常也會清,但我們已經 SIGKILL,搶在前面或補)
  running.delete(k);
  ticketWatcher.stop({ projectHash, pipelineId });

  // 重讀 pipeline(exit handler 可能已寫一輪)→ 校正狀態
  const cur = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    state?: string;
    name?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  } | null;
  if (cur) {
    const tickets = (cur.tickets ?? []).map((t) =>
      t.status === "running" ? { ...t, status: "paused" } : t
    );
    await pipelineDir.writePipeline(projectPath, pipelineId, {
      ...cur,
      state: "paused",
      tickets,
    }, {
      source: "stop-immediate",
      sourceDetail: "user pressed stop",
      prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
    });
    notifs.emit(projectPath, {
      type: "pipeline_paused",
      title: `${cur.name || pipelineId} 已立即停止`,
      sub: "主 agent 被強制終止",
      pipelineId,
    });
  }

  // slot 釋出,queue 接棒
  dispatch(projectPath, projectHash).catch((e) =>
    console.error(`[runner ${pipelineId}] dispatch after immediate stop failed:`, e)
  );

  return { ok: true };
}

// ─── Mock runner ──────────────────────────────────────────────────────
// VP_TEST_MODE=mock 時走這條,模擬 runner 寫 pipeline.json 的時間軸,
// 不 spawn 真 claude。fs.watch / notif emit / state 機照常,只是訊息流變 deterministic。

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function startMockRunner(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  k: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId, k } = opts;

  const script = testMode.getRunnerScript(projectHash, pipelineId);
  if (!script) {
    return {
      ok: false,
      error: `[mock runner] no script for ${projectHash}:${pipelineId}. ` +
        `先 POST /api/__test/script/runner 設劇本`,
    };
  }

  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    name?: string;
    tickets?: Array<{ id?: string; status?: string; mode?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  } | null;
  if (!pipeline) return { ok: false, error: "pipeline not found in mock" };

  running.set(k, { pipelineId, proc: null, startedAt: Date.now(), kind: "ticket" });

  notifs.emit(projectPath, {
    type: "pipeline_started",
    title: `${pipeline.name || pipelineId} 開始運行`,
    sub: `[mock]`,
    pipelineId,
  });

  await ticketWatcher.start({ projectPath, projectHash, pipelineId });

  // 不 await — 讓 timeline 異步跑
  (async () => {
    let immediateCancelled = false;
    const isCancelled = () => !running.has(k);
    try {
      const tickets = pipeline.tickets ?? [];
      const pausedMid = false;
      // mock 模式下若最後一張是 merge ticket 且沒對應 script 條目,自動帶過
      // (auto-merge / 手動 /merge 都會 append synthetic merge ticket,spec 不需也不該另設它的劇本)
      let mockMergeDone = false;
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i];
        const tScript = script.tickets[i];
        if (!tScript) {
          if (t.mode === "merge") {
            await sleep(30);
            const fakeHash = `mockmerge${Date.now().toString(16).padStart(8, "0")}`;
            const fullHash = (fakeHash + "0".repeat(40)).slice(0, 40);
            await mutateTicket(projectPath, pipelineId, t.id ?? `t${i}`, (curT) => ({
              ...curT,
              status: "done",
              startedAt: Date.now(),
              endedAt: Date.now(),
              commits: [
                {
                  hash: fullHash,
                  subject: `merge: pipeline → base`,
                  ts: Date.now(),
                },
              ],
            }));
            mockMergeDone = true;
            break;
          }
          // 其他 mode 沒劇本就跳過(fail-soft 留給 spec 自己驗)
          break;
        }

        await sleep(tScript.beforeRunningMs ?? 50);
        if (isCancelled()) {
          immediateCancelled = true;
          break;
        }
        await mutateTicket(projectPath, pipelineId, t.id ?? `t${i}`, (curT) => ({
          ...curT,
          status: "running",
          startedAt: Date.now(),
        }));

        if (t.mode === "iter" && tScript.iterRounds && tScript.iterRounds.length > 0) {
          const rounds: Array<Record<string, unknown>> = [];
          const verdicts: string[] = [];
          for (let r = 0; r < tScript.iterRounds.length; r++) {
            const round = tScript.iterRounds[r];
            const startedAt = Date.now();
            await sleep(round.durationMs ?? 80);
            if (isCancelled()) {
              immediateCancelled = true;
              break;
            }
            const endedAt = Date.now();
            rounds.push({
              n: r + 1,
              startedAt,
              endedAt,
              executorSummary: round.executorSummary ?? `mock executor turn ${r + 1}`,
              criticVerdict: round.verdict,
              criticFeedback: round.criticFeedback ?? "",
            });
            verdicts.push(round.verdict);
            // 寫一次中途進度,模擬 fs.watch 看到 round 累加
            await mutateTicket(projectPath, pipelineId, t.id ?? `t${i}`, (curT) => ({
              ...curT,
              iter: { current: r + 1, rounds: [...rounds], verdicts: [...verdicts] },
            }));
          }
          if (immediateCancelled) break;
        } else {
          await sleep(tScript.workMs ?? 100);
          if (isCancelled()) {
            immediateCancelled = true;
            break;
          }
        }

        const commits =
          tScript.commitHash != null
            ? [
                {
                  hash: tScript.commitHash,
                  subject: tScript.commitSubject ?? `ticket(${i + 1}): ${(t as { title?: string }).title ?? "mock"}`,
                  ts: Date.now(),
                },
              ]
            : [];

        await mutateTicket(projectPath, pipelineId, t.id ?? `t${i}`, (curT) => ({
          ...curT,
          status: tScript.finalStatus,
          endedAt: Date.now(),
          ...(commits.length > 0 ? { commits } : {}),
        }));
      }
      if (immediateCancelled) return;

      // 收尾 pipeline state
      // mock merge ticket 跑完一律標 merged,不看 script.finalState(它是給原 ticket 流程用的)
      const finalState = pausedMid
        ? "paused"
        : mockMergeDone
          ? "merged"
          : (script.finalState ?? "ready");
      const final = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
        tickets?: Array<{ mode?: string; commits?: Array<{ hash?: string }> }>;
        [k: string]: unknown;
      } | null;
      if (final) {
        const next: Record<string, unknown> = { ...final, state: finalState };
        // 補 mergeCommit 給前端 / spec 驗(從剛剛 mock merge ticket 抓 hash)
        if (mockMergeDone) {
          const mergeTicket = (final.tickets ?? []).find((t) => t.mode === "merge");
          const hash = mergeTicket?.commits?.[0]?.hash;
          if (hash) next.mergeCommit = { hash, mergedAt: Date.now() };
        }
        const finalState_ = (final as { state?: unknown }).state;
        await pipelineDir.writePipeline(projectPath, pipelineId, next, {
          source: "mock-runner-finalize",
          sourceDetail: `mock runner final state=${finalState}`,
          prevStateHint: typeof finalState_ === "string" ? finalState_ : undefined,
        });
      }

      const name = pipeline.name || pipelineId;
      // Mock merge 後也要 prune worktree(mock 不一定有真 worktree dir,但 git 註冊表可能有)
      if (finalState === "merged") {
        try {
          const r = await worktree.removeQuiet(projectPath, pipelineId);
          if (!r.ok) {
            console.warn(`[mock runner ${pipelineId}] worktree prune failed: ${r.error}`);
            notifs.emit(projectPath, {
              type: "pipeline_merge_cleanup_failed",
              title: `${name} merge 後 worktree 清理失敗`,
              sub: r.error,
              pipelineId,
            });
          }
        } catch (e) {
          console.warn(`[mock runner ${pipelineId}] worktree prune threw:`, e);
        }
      }
      if (finalState === "ready") {
        notifs.emit(projectPath, {
          type: "pipeline_ready_to_merge",
          title: `${name} 完成,可合併`,
          pipelineId,
        });
      } else if (finalState === "paused") {
        notifs.emit(projectPath, {
          type: "pipeline_paused",
          title: `${name} 已暫停`,
          pipelineId,
        });
      } else if (finalState === "failed") {
        notifs.emit(projectPath, {
          type: "pipeline_failed",
          title: `${name} 失敗`,
          pipelineId,
        });
      }
    } catch (e) {
      console.error(`[mock runner ${pipelineId}] error:`, e);
    } finally {
      running.delete(k);
      ticketWatcher.stop({ projectHash, pipelineId });
      if (!immediateCancelled) {
        try {
          await maybeAutoMerge({ projectPath, projectHash, pipelineId });
        } catch (e) {
          console.error(`[mock runner ${pipelineId}] maybeAutoMerge failed:`, e);
        }
        dispatch(projectPath, projectHash).catch((e) =>
          console.error(`[mock runner ${pipelineId}] dispatch after exit failed:`, e)
        );
      }
    }
  })();

  return { ok: true };
}

// 讀 pipeline → 找對應 ticket → 套 update fn → 寫回。每次都全 reload 因 user 可能中途改別欄。
async function mutateTicket(
  projectPath: string,
  pipelineId: string,
  ticketId: string,
  update: (t: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    tickets?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  } | null;
  if (!p) return;
  const tickets = p.tickets ?? [];
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return;
  tickets[idx] = update(tickets[idx]);
  const prev = typeof (p as { state?: unknown }).state === "string"
    ? ((p as { state: string }).state)
    : undefined;
  await pipelineDir.writePipeline(projectPath, pipelineId, { ...p, tickets }, {
    source: "mock-runner-ticket",
    sourceDetail: `update ticket ${ticketId}`,
    prevStateHint: prev,
  });
}

// Crash recovery:server 啟動時掃 pipelines。兩種 inconsistency 都修:
// (a) pipeline.state="running"/"queued" 或舊版 pause-pending state 但 process / queue 不在
//     (in-memory state 隨 server 重啟蒸發)→ 標 paused
// (b) ticket.status="running" 但 pipeline 不是 running(任何 state)→ 標 paused
//
// (b) 處理上一次 server 死前 ticket 已寫 running,但 pipeline state 改回 paused 後沒同步 ticket
// 的殘留(畫面會出現 RunButton 顯「繼續」+ TicketCard 卻仍顯「執行中」的錯位)。
export async function recoverStale(projectPath: string): Promise<void> {
  const pipelines = (await pipelineDir.listPipelines(projectPath)) as Array<{
    id?: string;
    state?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
  for (const p of pipelines) {
    if (!p.id) continue;
    const isStaleRunning =
      p.state === "running" || isLegacyPausePendingState(p.state) || p.state === "queued";
    const hasOrphanTicket =
      !isStaleRunning && p.state !== "running" &&
      (p.tickets ?? []).some((t) => t.status === "running");
    if (!isStaleRunning && !hasOrphanTicket) continue;

    const nextState = isStaleRunning ? "paused" : p.state;
    // stale running pipeline 視同 transient 失敗 — 主 agent 沒機會自標 paused 就被殺
    // (server restart / OS crash 等),running ticket 改 failed_transient + endedAt
    // 對齊 exit handler transient 路徑語義;user 按繼續會 reset 成 paused 再 reuse worktree。
    // 純 orphan ticket(pipeline 不是 running)維持改 paused — 那是「state 寫對 ticket 沒同步」
    // 的非 transient 殘留。
    const now = Date.now();
    const tickets = (p.tickets ?? []).map((t) => {
      if (t.status !== "running") return t;
      return isStaleRunning
        ? { ...t, status: "failed_transient", endedAt: now }
        : { ...t, status: "paused" };
    });
    await pipelineDir.writePipeline(projectPath, p.id, {
      ...p,
      state: nextState,
      tickets,
    }, {
      source: "startup-recover",
      sourceDetail: isStaleRunning
        ? `stale ${p.state} → paused on server boot`
        : "orphan running ticket fix",
      prevStateHint: typeof p.state === "string" ? p.state : undefined,
    });
    if (isStaleRunning) {
      const pName = (p as { name?: string }).name || p.id;
      notifs.emit(projectPath, {
        type: "pipeline_paused",
        title: `${pName} 因 server 重啟暫停`,
        sub: `runner child 已蒸發,worktree 進度保留;按繼續可從中斷處接`,
        pipelineId: p.id,
      });
    }
    console.log(
      `[runner] recovered stale pipeline ${p.id} (was ${p.state}) → ${nextState}, orphan tickets fixed`
    );
  }
}

// 把已 queued 的 pipeline 從 queue 移除 + state 回 paused。給 user 在排隊時按「取消排隊」用。
export async function cancelQueued(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const removed = dequeue(projectHash, pipelineId);
  if (!removed) return { ok: false, error: "Pipeline 不在排隊中" };
  const pipeline = (await pipelineDir.readPipeline(projectPath, pipelineId)) as {
    state?: string;
    [k: string]: unknown;
  } | null;
  if (pipeline && pipeline.state === "queued") {
    await pipelineDir.writePipeline(projectPath, pipelineId, {
      ...pipeline,
      state: "paused",
    }, {
      source: "cancel-queued",
      sourceDetail: "user dequeue",
      prevStateHint: pipeline.state,
    });
  }
  return { ok: true };
}

// 公開給 routes:max_parallel 變大時手動觸發補位
export async function triggerDispatch(projectPath: string, projectHash: string): Promise<void> {
  await dispatch(projectPath, projectHash);
}
