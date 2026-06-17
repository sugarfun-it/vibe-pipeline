// Runner PID sidecar:spawn 時把 runner 主 agent 的 OS pid 落地到
// <target>/.vibe-pipeline/.runtime/runner-pids/<pipelineId>.json,讓 stop /
// watchdog / recoverStale 在 in-memory running map handle 不見時(誤判 recover /
// server 重啟 / duplicate spawn)仍能用 pid 兜底 killProcessTree 整棵 tree。
// 純 runtime、gitignored,不進 pipeline.json,不動 shared schema。
//
// 背景:orphan runner 是「stuck running + pipeline.json 被另一個 process 週期性覆寫」
// 的根因 — watchdog/stop 只殺 map 裡的 proc,map 一丟就殺不到。

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../../io/atomicWrite";
import { ensureRuntime, runtimePath } from "../../domain/projectDir";
import { runCapture } from "../../io/childSpawn";

export type RunnerPidInfo = {
  pid: number;
  sessionId: string;
  startedAt: number;
  kind: "ticket" | "sync";
};

const SUBDIR = "runner-pids";

// 純解析:壞 JSON / 非物件 / 缺或壞 pid → null。抽出來給 bun test 驗。
export function parseRunnerPid(text: string): RunnerPidInfo | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const pid = o.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : "";
  const startedAt =
    typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : 0;
  const kind = o.kind === "sync" ? "sync" : "ticket";
  return { pid, sessionId, startedAt, kind };
}

function pidFilePath(projectPath: string, pipelineId: string): string {
  return runtimePath(projectPath, join(SUBDIR, `${pipelineId}.json`));
}

export async function writeRunnerPid(
  projectPath: string,
  pipelineId: string,
  info: RunnerPidInfo
): Promise<void> {
  ensureRuntime(projectPath, SUBDIR);
  await atomicWriteJson(pidFilePath(projectPath, pipelineId), info);
}

export function readRunnerPid(projectPath: string, pipelineId: string): RunnerPidInfo | null {
  const f = pidFilePath(projectPath, pipelineId);
  if (!existsSync(f)) return null;
  try {
    return parseRunnerPid(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

// 純比對:該 pid 的 cmdline 是否真含我們 spawn 帶的 sessionId。抽出來給 bun test 驗。
export function cmdlineMatchesSession(cmdline: string | null, sessionId: string): boolean {
  if (!cmdline || !sessionId) return false;
  return cmdline.includes(sessionId);
}

async function processCmdline(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    const r = await runCapture([
      "powershell",
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
    ]);
    return r.ok ? r.out : null;
  }
  const r = await runCapture(["ps", "-p", String(pid), "-o", "args="]);
  return r.ok ? r.out : null;
}

// 殺 sidecar pid 前的安全驗證:確認該 pid 仍存活 AND 其 cmdline 真含 sidecar 內的
// sessionId。防 OS 把死掉 runner 的 pid 回收給無關 process 後被誤殺(跨重啟尤其常見)。
// 無 sessionId(理論不該發生)→ 無法防回收 → 回 false 不殺。
export async function verifyRunnerPid(info: RunnerPidInfo): Promise<boolean> {
  if (!info.sessionId) return false;
  return cmdlineMatchesSession(await processCmdline(info.pid), info.sessionId);
}

// 刪 sidecar。帶 expectPid 時只在 sidecar 內 pid 相符才刪 —— 防 duplicate spawn 下
// 舊 runner 的 exit handler 把新 runner 剛寫的 sidecar 誤刪(race guard)。
// 不帶 expectPid = 無條件刪(reaper 路徑:watchdog / recoverStale / stop 已確定要收掉這條)。
export function clearRunnerPid(
  projectPath: string,
  pipelineId: string,
  expectPid?: number
): void {
  try {
    const f = pidFilePath(projectPath, pipelineId);
    if (!existsSync(f)) return;
    if (typeof expectPid === "number") {
      const cur = parseRunnerPid(readFileSync(f, "utf8"));
      if (cur && cur.pid !== expectPid) return; // 不是我寫的,別動
    }
    unlinkSync(f);
  } catch {
    // best-effort
  }
}
