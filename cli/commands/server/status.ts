import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isJsonMode, okJson, print } from "../../lib/output";
import { serverPidPath } from "../../lib/serverPath";
import {
  HEALTH_TIMEOUT_MS,
  healthInfo,
  isPidAlive,
  pidFileUptimeMinutes,
  readPidFile,
} from "./common";

export async function serverStatus(): Promise<void> {
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
