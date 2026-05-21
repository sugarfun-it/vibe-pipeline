import { closeSync, existsSync, openSync, watch, type FSWatcher } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bool } from "../lib/args";
import type { ParsedArgs } from "../lib/args";
import { fail, isJsonMode, okJson, print } from "../lib/output";
import { localServerBase, serverPort } from "../lib/serverBase";
import {
  detectServerRepoPath,
  readServerInfo,
  rememberServerRepoPath,
  serverLogPath,
  serverPidPath,
  serverStateDir,
} from "../lib/serverPath";

const START_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const POLL_MS = 200;

const SERVER_USAGE = `vbpl server — manage vibe-pipeline backend

  vbpl server start
  vbpl server stop
  vbpl server status
  vbpl server restart
  vbpl server logs [--follow|-f]`;

type HealthInfo = {
  ok: boolean;
  pid: number | null;
  repoPath: string | null;
};

type StartResult = {
  started: boolean;
  alreadyRunning?: boolean;
  pid: number;
  repoPath: string;
  logPath?: string;
  url: string;
};

type StopResult = {
  stopped: boolean;
  pid: number;
  stalePidCleared?: boolean;
  reason?: string;
  forced?: boolean;
};

type StartOptions = {
  quiet?: boolean;
  healthTimeoutMs?: number;
  timeoutMessage?: string;
  deadlineAtMs?: number;
};

export async function runServer(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(SERVER_USAGE);
    return;
  }
  switch (sub) {
    case "start": return void await serverStart();
    case "stop":  return void await serverStop();
    case "status": return serverStatus();
    case "restart": return serverRestart();
    case "logs": return serverLogs(args);
    default:
      fail("INVALID_ARGS", `Unknown server subcommand: ${sub ?? "(none)"}. Use start|stop|status|restart|logs (or 'vbpl server help')`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function serverBase(): string {
  return localServerBase();
}

function healthUrl(): string {
  return `${serverBase()}/api/health`;
}

function deadlineRemaining(deadlineAtMs: number | undefined, fallbackMs: number): number {
  if (deadlineAtMs == null) return fallbackMs;
  return Math.max(0, Math.min(fallbackMs, deadlineAtMs - Date.now()));
}

function failStartTimeout(options: StartOptions, logPath?: string): never {
  fail("START_TIMEOUT", options.timeoutMessage ?? `backend 5s 內沒有通過 health check。log:${logPath ?? serverLogPath()}`);
}

async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(serverPidPath(), "utf8");
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return err.code === "EPERM";
  }
}

async function pidFileUptimeMinutes(): Promise<number> {
  try {
    const info = await stat(serverPidPath());
    return Math.max(0, Math.floor((Date.now() - info.mtimeMs) / 60_000));
  } catch {
    return 0;
  }
}

async function healthInfo(timeoutMs = 500): Promise<HealthInfo> {
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

async function healthOk(timeoutMs = 500): Promise<boolean> {
  return (await healthInfo(timeoutMs)).ok;
}

async function waitForHealthUp(timeoutMs = START_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(Math.min(500, Math.max(1, deadline - Date.now())))) return true;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return false;
}

async function waitForHealthDown(): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await healthOk())) return true;
    await sleep(POLL_MS);
  }
  return !(await healthOk());
}

async function waitForPidExit(pid: number, timeoutMs = START_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_MS);
  }
  return !isPidAlive(pid);
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

export async function serverStart(options: StartOptions = {}): Promise<StartResult> {
  const repoPath = await detectServerRepoPath();
  const initialHealth = await healthInfo(deadlineRemaining(options.deadlineAtMs, 500));
  if (initialHealth.ok) {
    const pidFile = await readPidFile();
    if (
      pidFile == null ||
      initialHealth.pid == null ||
      initialHealth.pid !== pidFile ||
      initialHealth.repoPath == null ||
      !samePath(initialHealth.repoPath, repoPath)
    ) {
      fail(
        "PORT_IN_USE",
        `${serverBase()} 已有非 vbpl server start 管理的 backend。請先停止該 backend,或確認 server.pid/repo_path。`,
      );
    }
    await rememberServerRepoPath(repoPath, {
      pid: initialHealth.pid,
      port: serverPort(),
      log_path: serverLogPath(),
    });
    const result = { started: false, alreadyRunning: true, pid: initialHealth.pid, repoPath, url: serverBase() };
    if (!options.quiet) {
      if (isJsonMode()) {
        okJson(result);
        return result;
      }
      print("已在跑");
    }
    return result;
  }

  await mkdir(serverStateDir(), { recursive: true });
  const logPath = serverLogPath();
  const pidPath = serverPidPath();
  if (options.deadlineAtMs != null && deadlineRemaining(options.deadlineAtMs, 1) <= 0) {
    failStartTimeout(options, logPath);
  }

  let stdoutFd: number | null = null;
  let stderrFd: number | null = null;
  let child: ReturnType<typeof Bun.spawn>;
  try {
    stdoutFd = openSync(logPath, "a");
    stderrFd = openSync(logPath, "a");
    child = Bun.spawn(["bun", "run", "server/index.ts"], {
      cwd: repoPath,
      env: { ...process.env, PORT: String(serverPort()) },
      stdio: ["ignore", stdoutFd, stderrFd],
      detached: true,
      windowsHide: true,
    } as Parameters<typeof Bun.spawn>[1]);
    child.unref();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `啟動 backend 失敗:${msg}`);
  } finally {
    if (stdoutFd != null) closeSync(stdoutFd);
    if (stderrFd != null) closeSync(stderrFd);
  }

  await writeFile(pidPath, String(child.pid) + "\n", "utf8");
  await rememberServerRepoPath(repoPath, {
    pid: child.pid,
    port: serverPort(),
    log_path: logPath,
    started_at: Date.now(),
  });

  const healthTimeoutMs = deadlineRemaining(options.deadlineAtMs, options.healthTimeoutMs ?? START_TIMEOUT_MS);
  if (healthTimeoutMs <= 0 || !(await waitForHealthUp(healthTimeoutMs))) {
    try {
      process.kill(child.pid);
    } catch {
      // best effort cleanup after a failed start
    }
    await rm(pidPath, { force: true });
    failStartTimeout(options, logPath);
  }

  const startedHealth = await healthInfo(deadlineRemaining(options.deadlineAtMs, 500));
  if (
    !startedHealth.ok ||
    startedHealth.pid !== child.pid ||
    startedHealth.repoPath == null ||
    !samePath(startedHealth.repoPath, repoPath)
  ) {
    try {
      process.kill(child.pid);
    } catch {
      // best effort cleanup after a failed start
    }
    await rm(pidPath, { force: true });
    fail("PORT_IN_USE", `${serverBase()} health 回應不屬於剛啟動的 vbpl backend。log:${logPath}`);
  }

  const result = { started: true, pid: child.pid, repoPath, logPath, url: serverBase() };
  if (!options.quiet) {
    if (isJsonMode()) {
      okJson(result);
      return result;
    }
    print("已啟動");
  }
  return result;
}

async function serverStatus(): Promise<void> {
  const pidPath = serverPidPath();
  if (!existsSync(pidPath)) {
    if (isJsonMode()) {
      okJson({ status: "down", running: false });
      return;
    }
    print("未啟動");
    return;
  }

  const pid = await readPidFile();
  if (pid == null || !isPidAlive(pid)) {
    await rm(pidPath, { force: true });
    if (isJsonMode()) {
      okJson({ status: "down", running: false, stalePidCleared: true, pid });
      return;
    }
    print("未啟動(stale pid 已清)");
    return;
  }

  const health = await healthInfo(HEALTH_TIMEOUT_MS);
  if (health.ok) {
    const uptimeMinutes = await pidFileUptimeMinutes();
    if (isJsonMode()) {
      okJson({ status: "up", running: true, pid, uptimeMinutes });
      return;
    }
    print(`up (PID ${pid}, uptime ${uptimeMinutes}m)`);
    return;
  }

  if (isJsonMode()) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { code: "UNRESPONSIVE", message: `unresponsive(PID ${pid} 還活,但 health 不回)` },
      data: { status: "unresponsive", running: true, pid },
    }) + "\n");
  } else {
    print(`unresponsive(PID ${pid} 還活,但 health 不回)`);
  }
  process.exit(2);
}

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

async function serverStop(options: { quiet?: boolean } = {}): Promise<StopResult> {
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

async function serverStopForRestart(): Promise<StopResult> {
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

async function serverRestart(): Promise<void> {
  const stopped = await serverStopForRestart();
  const started = await serverStart({ quiet: true });
  if (isJsonMode()) {
    okJson({ restarted: true, stopped, started });
    return;
  }
  print("已重啟");
}

async function serverLogs(args: ParsedArgs): Promise<void> {
  const follow = bool(args.flags["follow"]) || bool(args.flags["f"]);
  if (follow && isJsonMode()) {
    fail("INVALID_ARGS", "--json mode does not support --follow.");
  }
  if (follow) {
    await followServerLog();
    return;
  }

  const logPath = serverLogPath();
  let content = "";
  try {
    content = await readFile(logPath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      const msg = e instanceof Error ? e.message : String(e);
      fail("IO_ERROR", `讀取 server log 失敗:${msg}`);
    }
  }

  if (isJsonMode()) {
    okJson({ logPath, content });
    return;
  }
  process.stdout.write(content);
}

async function followServerLog(): Promise<void> {
  const logPath = serverLogPath();
  await mkdir(serverStateDir(), { recursive: true });
  if (!existsSync(logPath)) {
    await writeFile(logPath, "", "utf8");
  }

  let lastSize = 0;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let reading = false;
  let pending = false;
  let done = false;
  let finish: (() => void) | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (debounce) clearTimeout(debounce);
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
    const info = await stat(logPath);
    if (info.size < lastSize) lastSize = 0;
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
      process.stderr.write(`server log follow stopped: ${e instanceof Error ? e.message : String(e)}\n`);
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
  watcher = watch(logPath, scheduleRead);
  await drain();
  await new Promise<void>((resolve) => {
    finish = resolve;
  });
}
