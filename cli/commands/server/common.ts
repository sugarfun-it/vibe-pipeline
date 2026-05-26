import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fail } from "../../lib/output";
import { localServerBase } from "../../lib/serverBase";
import { serverLogPath, serverPidPath } from "../../lib/serverPath";

export const START_TIMEOUT_MS = 5_000;
export const HEALTH_TIMEOUT_MS = 5_000;
export const POLL_MS = 200;

export type HealthInfo = {
  ok: boolean;
  pid: number | null;
  repoPath: string | null;
};

export type StartResult = {
  started: boolean;
  alreadyRunning?: boolean;
  pid: number;
  repoPath: string;
  logPath?: string;
  url: string;
};

export type StopResult = {
  stopped: boolean;
  pid: number;
  stalePidCleared?: boolean;
  reason?: string;
  forced?: boolean;
};

export type StartOptions = {
  quiet?: boolean;
  healthTimeoutMs?: number;
  timeoutMessage?: string;
  deadlineAtMs?: number;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function serverBase(): string {
  return localServerBase();
}

function healthUrl(): string {
  return `${serverBase()}/api/health`;
}

export function deadlineRemaining(deadlineAtMs: number | undefined, fallbackMs: number): number {
  if (deadlineAtMs == null) return fallbackMs;
  return Math.max(0, Math.min(fallbackMs, deadlineAtMs - Date.now()));
}

export function failStartTimeout(options: StartOptions, logPath?: string): never {
  fail("START_TIMEOUT", options.timeoutMessage ?? `backend 5s 內沒有通過 health check。log:${logPath ?? serverLogPath()}`);
}

export async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(serverPidPath(), "utf8");
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return err.code === "EPERM";
  }
}

export async function pidFileUptimeMinutes(): Promise<number> {
  try {
    const info = await stat(serverPidPath());
    return Math.max(0, Math.floor((Date.now() - info.mtimeMs) / 60_000));
  } catch {
    return 0;
  }
}

export async function healthInfo(timeoutMs = 500): Promise<HealthInfo> {
  if (timeoutMs <= 0) return { ok: false, pid: null, repoPath: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl(), { method: "GET", signal: controller.signal });
    if (res.status !== 200) return { ok: false, pid: null, repoPath: null };
    const body = await res.json().catch(() => null) as {
      data?: { pid?: unknown; repo_path?: unknown; repoPath?: unknown };
    } | null;
    const pid = typeof body?.data?.pid === "number" ? body.data.pid : null;
    const rawRepoPath = body?.data?.repo_path ?? body?.data?.repoPath;
    const repoPath = typeof rawRepoPath === "string" && rawRepoPath.length > 0 ? rawRepoPath : null;
    return { ok: true, pid, repoPath };
  } catch {
    return { ok: false, pid: null, repoPath: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function healthOk(timeoutMs = 500): Promise<boolean> {
  return (await healthInfo(timeoutMs)).ok;
}

export async function waitForHealthUp(timeoutMs = START_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(Math.min(500, Math.max(1, deadline - Date.now())))) return true;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return false;
}

export async function waitForHealthDown(): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await healthOk())) return true;
    await sleep(POLL_MS);
  }
  return !(await healthOk());
}

export async function waitForPidExit(pid: number, timeoutMs = START_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_MS);
  }
  return !isPidAlive(pid);
}
