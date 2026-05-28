import { readPipeline, writePipeline } from "../../domain/pipeline";
import * as projectStore from "../../domain/project";
import * as worktree from "../../io/git/worktree";
import * as notifs from "../../remote/notifs";
import * as ticketWatcher from "../ticketWatcher";
import { isLegacyPausePendingState } from "./helpers";
import { dispatch } from "./queue";
import { running, watchdogTimer, setWatchdogTimer } from "./state";

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

export function isPidAlive(pid: number | undefined): boolean {
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
export async function killProcessTree(pid: number | undefined): Promise<void> {
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

export async function watchdogTick(): Promise<void> {
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
        const p = (await readPipeline(project.path, entry.pipelineId)) as {
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
            await writePipeline(project.path, entry.pipelineId, {
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
          await writePipeline(project.path, entry.pipelineId, {
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
  setWatchdogTimer(setInterval(() => {
    void watchdogTick();
  }, WATCHDOG_INTERVAL_MS));
}
