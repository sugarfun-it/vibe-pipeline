import { readFileSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { serverStart } from "../commands/server";
import { isPidAlive } from "../commands/server/common";
import { fail } from "./output";
import { apiBase, isLocalApiBase } from "./serverBase";
import { serverStateDir } from "./serverPath";

const ENSURE_TIMEOUT_MS = 1_750;
const CONNECT_TIMEOUT_MS = 300;
const POLL_MS = 200;
const LOCK_STALE_MS = 10_000;

let ensured = false;

function lockPath(): string {
  return join(serverStateDir(), "server.start.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function timeoutMessage(): string {
  return "backend 起不來,跑 vbpl server logs 看原因";
}

async function tryConnect(timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}/api/health`, { method: "GET", signal: controller.signal, headers: { "user-agent": "vbpl-cli" } });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type StartLock = {
  release: () => Promise<void>;
  releaseSync: () => void;
};

async function readLock(): Promise<{ pid: number | null; ts: number | null; raw: string } | null> {
  try {
    const raw = await readFile(lockPath(), "utf8");
    const [pidRaw, tsRaw] = raw.trim().split(/\s+/);
    const pid = Number(pidRaw);
    const ts = Number(tsRaw);
    return {
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      ts: Number.isFinite(ts) && ts > 0 ? ts : null,
      raw,
    };
  } catch {
    return null;
  }
}

async function clearStaleLock(): Promise<boolean> {
  const lock = await readLock();
  if (!lock) return false;
  const staleByPid = lock.pid == null || !isPidAlive(lock.pid);
  const staleByAge = lock.ts != null && Date.now() - lock.ts > LOCK_STALE_MS;
  if (!staleByPid && !staleByAge) return false;
  await rm(lockPath(), { force: true }).catch(() => undefined);
  return true;
}

async function tryAcquireLock(): Promise<StartLock | null> {
  await mkdir(serverStateDir(), { recursive: true });
  const token = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}\n`;
  try {
    const handle = await open(lockPath(), "wx");
    try {
      await handle.writeFile(token, "utf8");
    } finally {
      await handle.close();
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EEXIST") return null;
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `backend start lock 建立失敗:${msg}`);
  }

  return {
    release: async () => {
      try {
        const current = await readFile(lockPath(), "utf8");
        if (current === token) await rm(lockPath(), { force: true });
      } catch {
        // lock already gone
      }
    },
    releaseSync: () => {
      try {
        const current = readFileSync(lockPath(), "utf8");
        if (current === token) rmSync(lockPath(), { force: true });
      } catch {
        // lock already gone
      }
    },
  };
}

async function acquireLockOrWaitForHealth(deadlineAt: number): Promise<StartLock | null> {
  while (remainingMs(deadlineAt) > 0) {
    const lock = await tryAcquireLock();
    if (lock) return lock;
    await clearStaleLock();
    if (await tryConnect(Math.min(POLL_MS, remainingMs(deadlineAt)))) return null;
    await sleep(Math.min(POLL_MS, remainingMs(deadlineAt)));
  }
  fail("START_TIMEOUT", timeoutMessage());
}

export async function ensureBackend(): Promise<void> {
  if (ensured) return;
  const deadlineAt = Date.now() + ENSURE_TIMEOUT_MS;
  if (await tryConnect(Math.min(CONNECT_TIMEOUT_MS, remainingMs(deadlineAt)))) {
    ensured = true;
    return;
  }

  if (!isLocalApiBase()) {
    fail("START_TIMEOUT", timeoutMessage());
  }

  const lock = await acquireLockOrWaitForHealth(deadlineAt);
  if (!lock) {
    ensured = true;
    return;
  }

  const releaseOnExit = (): void => lock.releaseSync();
  process.once("exit", releaseOnExit);
  try {
    if (await tryConnect(Math.min(CONNECT_TIMEOUT_MS, remainingMs(deadlineAt)))) {
      ensured = true;
      return;
    }
    const left = remainingMs(deadlineAt);
    if (left <= 0) fail("START_TIMEOUT", timeoutMessage());
    await serverStart({
      quiet: true,
      healthTimeoutMs: left,
      deadlineAtMs: deadlineAt,
      timeoutMessage: timeoutMessage(),
    });
    ensured = true;
  } finally {
    process.off("exit", releaseOnExit);
    await lock.release();
  }
}
