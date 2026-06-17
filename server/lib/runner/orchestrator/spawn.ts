import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { mutatePipeline, readPipeline } from "../../domain/pipeline";
import { getMaxParallel, getResolvedDefaults } from "../../domain/projectConfig";
import { ensureRuntime } from "../../domain/projectDir";
import * as worktree from "../../io/git/worktree";
import * as notifs from "../../remote/notifs";
import * as ticketWatcher from "../ticketWatcher";
import * as runLog from "../runLog";
import * as testMode from "../../testMode";
import { ensureDepsAfterMerge } from "../../system/depInstall";
import { maybeAutoMerge } from "./autoMerge";
import { dispatch, enqueue } from "./queue";
import { computePipelineSpent, patchRunnerLogExitCode, runnerLogHeader, snapshotTickets } from "./helpers";
import { key, queuePosition, running, runningCount, isQueued } from "./state";
import { startMockRunner } from "./mock";
import { writeRunnerPid, clearRunnerPid } from "./runnerPidFile";
import { runCodeOrchestrator } from "./codeRunner";

// 起 backend code orchestrator。Pipeline 必須已存在,有 branch 欄位。
// 行為:
//   - 既有 state guard(running/merged/queued + ready 沒可跑 ticket)擋
//   - slot 滿 → 標 queued + emit pipeline_queued + enqueue,不 spawn
//   - slot 沒滿 → 直接進 backend TS runner(走 spawnDirect)
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

  if (running.has(k)) return { ok: false, error: "Pipeline 已在跑" };
  if (isQueued(projectHash, pipelineId)) return { ok: false, error: "Pipeline 已在排隊" };

  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    branch?: string;
    baseBranch?: string;
    name?: string;
    state?: string;
    tickets?: Array<{ status?: string }>;
  } | null;
  if (!pipeline) return { ok: false, error: "Pipeline not found: " + pipelineId };

  if (pipeline.state === "running") return { ok: false, error: "Pipeline 已在 running" };
  if (pipeline.state === "queued") return { ok: false, error: "Pipeline 已在 queued" };
  if (pipeline.state === "ready" || pipeline.state === "merged") {
    const hasRunnable = (pipeline.tickets ?? []).some((t) => t.status === "draft" || t.status === "ready");
    if (!hasRunnable) return { ok: false, error: "Pipeline 沒待跑的 ticket(append 新 ticket 或 reset 既有的)" };
  }

  const resolved = await getResolvedDefaults(projectPath);
  const limit = resolved.cost_limit_usd;
  if (limit > 0) {
    const spent = await computePipelineSpent(projectPath, pipelineId);
    if (spent >= limit) {
      notifs.emit(projectPath, {
        type: "pipeline_blocked_budget",
        title: (pipeline.name || pipelineId) + " 被預算上限擋下",
        sub: "該 pipeline 累積已花 $" + spent.toFixed(4) + " / 上限 $" + limit.toFixed(2),
        pipelineId,
      });
      return {
        ok: false,
        error: "已達預算上限($" + spent.toFixed(4) + " / $" + limit.toFixed(2) + ")",
        reason: "budget_exceeded",
        spent,
        limit,
      };
    }
  }

  const max = await getMaxParallel(projectPath);
  if (runningCount(projectHash) >= max) {
    enqueue({ projectPath, projectHash, pipelineId, enqueuedAt: Date.now() });
    await mutatePipeline(projectPath, pipelineId, (p) => ({ ...p, state: "queued" }), {
      source: "orchestrator.start",
      sourceDetail: "slot full -> enqueue",
    });
    const pos = queuePosition(projectHash, pipelineId);
    notifs.emit(projectPath, {
      type: "pipeline_queued",
      title: (pipeline.name || pipelineId) + " 已排隊",
      sub: "順位 " + pos + "(slot " + runningCount(projectHash) + "/" + max + " 已滿)",
      pipelineId,
    });
    return { ok: true, queued: true, position: pos };
  }

  return spawnDirect({ projectPath, projectHash, pipelineId });
}

// 真正啟動 backend runner。state guard / slot 檢查在外層 start 完成。
// dispatcher 也走這條(已從 queue 撈出來、確認 slot 有空)。
export async function spawnDirect(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const k = key(projectHash, pipelineId);

  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    branch?: string;
    baseBranch?: string;
    name?: string;
    state?: string;
    tickets?: Array<{ id?: string; status?: string }>;
  } | null;
  if (!pipeline) return { ok: false, error: "Pipeline not found: " + pipelineId };

  const branch = pipeline.branch || "pipeline/" + (pipeline.name || pipelineId);
  const baseBranch = pipeline.baseBranch || "main";

  let wtPath: string;
  try {
    wtPath = await worktree.ensure(projectPath, pipelineId, branch, baseBranch);
  } catch (e) {
    return { ok: false, error: "worktree 失敗: " + String(e) };
  }

  await mutatePipeline(projectPath, pipelineId, (p) => ({ ...p, state: "running" }), {
    source: "orchestrator.spawnDirect",
    sourceDetail: "start backend code orchestrator",
  });

  try {
    runLog.pruneLogs(projectPath, pipelineId, 10);
    notifs.pruneOldRecords(projectPath, 500);
  } catch {
    // GC is best-effort.
  }

  if (testMode.isTestMode()) {
    return startMockRunner({ projectPath, projectHash, pipelineId, k });
  }

  const startedAt = Date.now();
  running.set(k, { pipelineId, proc: null, startedAt, kind: "ticket" });

  notifs.emit(projectPath, {
    type: "pipeline_started",
    title: (pipeline.name || pipelineId) + " 開始運行",
    sub: "worktree: " + wtPath,
    pipelineId,
  });

  await ticketWatcher.start({ projectPath, projectHash, pipelineId });

  const logsDir = ensureRuntime(projectPath, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, pipelineId + "-" + Date.now() + ".log");
  await Bun.write(logFile, runnerLogHeader(pipelineId, "active") + "--- stdout ---\n");
  const ticketsBefore = snapshotTickets(pipeline.tickets);
  const sessionId = randomUUID();

  void (async () => {
    let resultCode = 0;
    try {
      const result = await runCodeOrchestrator({
        projectPath,
        projectHash,
        pipelineId,
        worktreePath: wtPath,
        logFile,
        onProcess: async (proc) => {
          const existing = running.get(k);
          if (existing) running.set(k, { ...existing, proc });
          if (proc && typeof proc.pid === "number") {
            await writeRunnerPid(projectPath, pipelineId, {
              pid: proc.pid,
              sessionId,
              startedAt: Date.now(),
              kind: "ticket",
            }).catch((e) => console.warn("[runner " + pipelineId + "] writeRunnerPid failed:", e));
          } else {
            clearRunnerPid(projectPath, pipelineId);
          }
        },
      });
      resultCode = result.exitCode;
      await appendFile(logFile, "\n--- stderr ---\n" + result.stderr, "utf8");
      const finalForMeta = (await readPipeline(projectPath, pipelineId).catch(() => null)) as {
        tickets?: Array<{ id?: string; status?: string }>;
      } | null;
      const ticketsAfter = snapshotTickets(finalForMeta?.tickets ?? []);
      await appendFile(logFile, "\n--- meta ---\n" + JSON.stringify({ ticketsBefore, ticketsAfter }), "utf8");
      await patchRunnerLogExitCode(logFile, pipelineId, result.exitCode);
      await finalizeAfterRun({ projectPath, projectHash, pipelineId, initialName: pipeline.name, exitCode: result.exitCode });
    } catch (e) {
      resultCode = 1;
      console.error("[runner " + pipelineId + "] error:", e);
      await appendFile(logFile, "\n[runner " + pipelineId + "] error: " + String(e), "utf8").catch(() => undefined);
      await patchRunnerLogExitCode(logFile, pipelineId, 1).catch(() => undefined);
      await finalizeAfterRun({ projectPath, projectHash, pipelineId, initialName: pipeline.name, exitCode: 1 });
    } finally {
      running.delete(k);
      clearRunnerPid(projectPath, pipelineId);
      ticketWatcher.stop({ projectHash, pipelineId });
      try {
        await maybeAutoMerge({ projectPath, projectHash, pipelineId });
      } catch (e) {
        console.error("[runner " + pipelineId + "] maybeAutoMerge failed:", e);
      }
      dispatch(projectPath, projectHash).catch((e) =>
        console.error("[runner " + pipelineId + "] dispatch after exit failed:", e)
      );
      console.log("[runner " + pipelineId + "] exited code=" + resultCode + ", log -> " + logFile);
    }
  })();

  return { ok: true };
}

async function finalizeAfterRun(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  initialName?: string;
  exitCode: number;
}): Promise<void> {
  const { projectPath, pipelineId, initialName, exitCode } = opts;
  const final = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    name?: string;
    mergeCommit?: { hash?: string };
  } | null;
  const name = final?.name || initialName || pipelineId;

  if (final?.state === "merged") {
    try {
      const r = await worktree.removeQuiet(projectPath, pipelineId);
      if (!r.ok) {
        console.warn("[runner " + pipelineId + "] worktree prune failed: " + r.error);
        notifs.emit(projectPath, {
          type: "pipeline_merge_cleanup_failed",
          title: name + " merge 後 worktree 清理失敗",
          sub: r.error,
          pipelineId,
        });
      }
    } catch (e) {
      console.warn("[runner " + pipelineId + "] worktree prune threw:", e);
    }

    const mergeHash = final.mergeCommit?.hash;
    if (mergeHash) {
      try {
        const dep = await ensureDepsAfterMerge(projectPath, mergeHash);
        if (dep.ran && !dep.ok) {
          notifs.emit(projectPath, {
            type: "pipeline_merge_cleanup_failed",
            title: name + " merge 後 bun install 失敗",
            sub: dep.error,
            pipelineId,
          });
        }
      } catch (e) {
        console.warn("[runner " + pipelineId + "] ensureDepsAfterMerge threw:", e);
      }
    }
  }

  if (final?.state === "ready") {
    notifs.emit(projectPath, {
      type: "pipeline_ready_to_merge",
      title: name + " 完成,可合併",
      pipelineId,
    });
  } else if (final?.state === "paused") {
    notifs.emit(projectPath, {
      type: "pipeline_paused",
      title: name + " 已暫停",
      pipelineId,
    });
  } else if (final?.state === "failed") {
    notifs.emit(projectPath, {
      type: "pipeline_failed",
      title: name + " 失敗",
      sub: "code=" + exitCode,
      pipelineId,
    });
  } else if (exitCode !== 0) {
    notifs.emit(projectPath, {
      type: "runner_crash",
      title: name + " runner 異常結束",
      sub: "exit " + exitCode,
      pipelineId,
    });
  }
}
