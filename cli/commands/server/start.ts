import { closeSync, openSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import { serverPort } from "../../lib/serverBase";
import {
  detectServerRepoPath,
  rememberServerRepoPath,
  serverLogPath,
  serverPidPath,
  serverStateDir,
} from "../../lib/serverPath";
import {
  deadlineRemaining,
  failStartTimeout,
  healthInfo,
  readPidFile,
  samePath,
  serverBase,
  START_TIMEOUT_MS,
  waitForHealthUp,
  type StartOptions,
  type StartResult,
} from "./common";

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
