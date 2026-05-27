import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import * as pipelineDir from "../../pipelineDir";
import * as worktree from "../../git/worktree";
import * as notifs from "../../notifs/store";
import * as ticketWatcher from "../ticketWatcher";
import * as runLog from "../runLog";
import * as testMode from "../../testMode";
import { buildRunnerBehaviorPrompt } from "../runnerPrompt";
import { loadUserConfig, getTaskConfigWithAdapter } from "../../userConfig";
import { ensureDepsAfterMerge } from "../../depInstall";
import { maybeAutoMerge } from "./autoMerge";
import { dispatch, enqueue } from "./queue";
import { computePipelineSpent, endStream, patchRunnerLogExitCode, runnerLogHeader, snapshotTickets } from "./helpers";
import { key, queuePosition, running, runningCount, isQueued } from "./state";
import { startMockRunner } from "./mock";

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
export async function spawnDirect(opts: {
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
        for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
          const s = new TextDecoder().decode(chunk);
          stdoutText += s;
          logStream?.write(s);
        }
      })();
      const stderrPromise = (async () => {
        if (!proc.stderr) return;
        for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
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
