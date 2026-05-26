import { readFile, rm } from "node:fs/promises";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import { serverPort } from "../../lib/serverBase";
import {
  detectServerRepoPath,
  readServerInfo,
  serverPidPath,
} from "../../lib/serverPath";
import {
  healthInfo,
  isPidAlive,
  samePath,
  waitForHealthDown,
  waitForPidExit,
  type StopResult,
} from "./common";

async function readPid(): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(serverPidPath(), "utf8");
  } catch {
    fail("NOT_FOUND", "找不到 server.pid;沒有可停止的 vbpl server");
  }
  const pid = Number(raw.trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    fail("INVALID_ARGS", `server.pid 內容無效:${raw.trim()}`);
  }
  return pid;
}

async function clearStalePid(pid: number, reason: string, options: { quiet?: boolean } = {}): Promise<StopResult> {
  await rm(serverPidPath(), { force: true });
  const result = { stopped: false, stalePidCleared: true, pid, reason };
  if (!options.quiet) {
    if (isJsonMode()) {
      okJson(result);
      return result;
    }
    print("server.pid 已過期，已清除");
  }
  return result;
}

async function isManagedPid(pid: number, repoPath: string): Promise<boolean> {
  const info = await readServerInfo();
  if (!info) return false;
  if (!samePath(info.repo_path, repoPath)) return false;
  if (info.port != null && info.port !== serverPort()) return false;
  if (info.pid != null && info.pid !== pid) return false;
  return true;
}

async function killManagedServer(pid: number, options: { forced?: boolean } = {}): Promise<StopResult> {
  try {
    process.kill(pid);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ESRCH") {
      const msg = e instanceof Error ? e.message : String(e);
      fail("IO_ERROR", `停止 backend 失敗:${msg}`);
    }
  }

  if (!(await waitForPidExit(pid, 1_500))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ESRCH") {
        const msg = e instanceof Error ? e.message : String(e);
        fail("IO_ERROR", `強制停止 backend 失敗:${msg}`);
      }
    }
  }

  await rm(serverPidPath(), { force: true });

  const exited = await waitForPidExit(pid);
  if (!exited) {
    fail("IO_ERROR", `已送出停止訊號,但 PID ${pid} 仍存活`);
  }
  const stopped = await waitForHealthDown();
  if (!stopped) {
    fail("IO_ERROR", "已送出停止訊號,但 /api/health 仍可連線");
  }

  return { stopped: true, pid, forced: options.forced === true };
}

export async function serverStop(options: { quiet?: boolean } = {}): Promise<StopResult> {
  const pid = await readPid();
  const repoPath = await detectServerRepoPath();
  const currentHealth = await healthInfo();
  if (!currentHealth.ok) {
    return clearStalePid(pid, "health_down", options);
  }
  if (currentHealth.pid !== pid) {
    return clearStalePid(pid, "pid_mismatch", options);
  }
  if (currentHealth.repoPath == null || !samePath(currentHealth.repoPath, repoPath)) {
    return clearStalePid(pid, "repo_path_mismatch", options);
  }
  const result = await killManagedServer(pid);
  if (!options.quiet) {
    if (isJsonMode()) {
      okJson(result);
      return result;
    }
    print("已停止");
  }
  return result;
}

export async function serverStopForRestart(): Promise<StopResult> {
  const pid = await readPid();
  const repoPath = await detectServerRepoPath();
  const currentHealth = await healthInfo();
  if (currentHealth.ok) {
    if (currentHealth.pid !== pid) {
      return clearStalePid(pid, "pid_mismatch", { quiet: true });
    }
    if (currentHealth.repoPath == null || !samePath(currentHealth.repoPath, repoPath)) {
      return clearStalePid(pid, "repo_path_mismatch", { quiet: true });
    }
    return killManagedServer(pid);
  }

  if (!isPidAlive(pid)) {
    return clearStalePid(pid, "health_down", { quiet: true });
  }
  if (!(await isManagedPid(pid, repoPath))) {
    return clearStalePid(pid, "health_down_unmanaged_pid_alive", { quiet: true });
  }
  return killManagedServer(pid, { forced: true });
}
