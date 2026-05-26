import * as pipelineDir from "../../pipelineDir";
import * as worktree from "../../git/worktree";
import * as notifs from "../../notifs/store";
import * as ticketWatcher from "../ticketWatcher";
import * as testMode from "../../testMode";
import { maybeAutoMerge } from "./autoMerge";
import { dispatch } from "./queue";
import { mutateTicket, sleep } from "./helpers";
import { running } from "./state";

// ─── Mock runner ──────────────────────────────────────────────────────
// VP_TEST_MODE=mock 時走這條,模擬 runner 寫 pipeline.json 的時間軸,
// 不 spawn 真 claude。fs.watch / notif emit / state 機照常,只是訊息流變 deterministic。

export async function startMockRunner(opts: {
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
