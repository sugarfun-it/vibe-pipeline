#!/usr/bin/env bun
// maintainer-only stack switcher — dev.sh / prod.sh 的真實邏輯。
// 用 Bun(跑 backend 必在)取代原本 .sh 的 python:path 比較 / server.json 讀取 /
// idempotent 判斷全走 cli/ 既有 robust TS,不挑 host 的 python flavor。
// 刻意不掛進 vbpl 命令樹 — enduser 跑同一份 cli/ 但不該看到 dev/prod 切換。

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { healthOk, samePath } from "../../cli/commands/server/common";
import { serverPort } from "../../cli/lib/serverBase";
import { detectServerRepoPath, readServerInfo } from "../../cli/lib/serverPath";

type Mode = "dev" | "prod";

function log(mode: Mode, msg: string): void {
  process.stdout.write(`[${mode}] ${msg}\n`);
}

async function run(
  cmd: string[],
  opts: { cwd?: string; allowFail?: boolean } = {},
): Promise<number> {
  const proc = Bun.spawn({ cmd, cwd: opts.cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0 && !opts.allowFail) {
    process.stderr.write(`command failed (${code}): ${cmd.join(" ")}\n`);
    process.exit(code || 1);
  }
  return code;
}

async function forceKillPort(port: number): Promise<void> {
  if (process.platform === "win32") {
    await run(
      [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }`,
      ],
      { allowFail: true },
    );
  } else {
    await run(["bash", "-c", `lsof -ti:${port} 2>/dev/null | xargs -r kill -9 2>/dev/null || true`], {
      allowFail: true,
    });
  }
}

// dist/index.html 當 build 新鮮度基準;src/ 任一檔較新就要 rebuild。
function srcNewerThanDist(root: string): boolean {
  const distIndex = join(root, "dist", "index.html");
  if (!existsSync(distIndex)) return true;
  const distMtime = statSync(distIndex).mtimeMs;
  const srcDir = join(root, "src");
  if (!existsSync(srcDir)) return false;
  let newer = false;
  const walk = (dir: string): void => {
    if (newer) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (newer) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (statSync(p).mtimeMs > distMtime) newer = true;
    }
  };
  walk(srcDir);
  return newer;
}

async function reportVersion(): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort()}/api/system/version`);
    const body = (await res.json()) as { data?: { current?: string } };
    if (body?.data?.current) process.stdout.write(`current=${body.data.current}\n`);
  } catch {
    // report 失敗不致命
  }
}

function findShim(): string {
  const base = join(homedir(), ".vibe-pipeline", "bin", "vbpl");
  if (existsSync(base + ".exe")) return base + ".exe";
  if (existsSync(base + ".cmd")) return base + ".cmd";
  if (existsSync(base)) return base;
  process.stderr.write(`找不到 vbpl shim:${base}(.exe/.cmd)。先安裝 enduser stack 再切 /prod。\n`);
  process.exit(1);
}

async function dev(): Promise<void> {
  // dev 永遠以 cwd 解析 repo,清掉殘留 VBPL_HOME 免得 detect 命中別的 stack。
  delete process.env["VBPL_HOME"];
  const root = await detectServerRepoPath();
  const info = await readServerInfo();
  if (info?.repo_path && samePath(info.repo_path, root) && (await healthOk(2000))) {
    log("dev", `already on dev clone (port ${serverPort()}), no-op`);
    await reportVersion();
    return;
  }

  log("dev", "stop existing backend");
  await run(["bun", "run", "cli/vbpl.ts", "server", "stop"], { cwd: root, allowFail: true });
  if (info?.port) await forceKillPort(info.port);

  if (srcNewerThanDist(root)) {
    log("dev", "rebuild dist/ (src/ newer)");
    await run(["bun", "run", "build"], { cwd: root });
  } else {
    log("dev", "dist/ up-to-date, skip build");
  }

  log("dev", "start dev backend");
  await run(["bun", "run", "cli/vbpl.ts", "server", "start"], { cwd: root });
  log("dev", `backend up on port ${serverPort()}`);
  await reportVersion();
}

async function prod(): Promise<void> {
  // 模擬 enduser 安裝態:repo = ~/.vibe-pipeline/current,啟動走 shim(vbpl.exe 設 VBPL_HOME)。
  const expected = join(homedir(), ".vibe-pipeline", "current");
  const info = await readServerInfo();
  if (info?.repo_path && samePath(info.repo_path, expected) && (await healthOk(2000))) {
    log("prod", `already on install stack (port ${serverPort()}), no-op`);
    await reportVersion();
    return;
  }

  const shim = findShim();
  log("prod", "stop existing backend");
  await run([shim, "server", "stop"], { allowFail: true });
  if (info?.port) await forceKillPort(info.port);

  log("prod", "start enduser backend");
  await run([shim, "server", "start"]);
  const port = serverPort();
  log("prod", `backend up on port ${port}`);

  // port 可能 EADDRINUSE fallback,tailscale forward 要同步指到實際 port。
  if (Bun.which("tailscale")) {
    log("prod", `tailscale → http://localhost:${port}`);
    await run(["tailscale", "serve", "--bg", "--https=443", `http://localhost:${port}`], {
      allowFail: true,
    });
  }
  await reportVersion();
}

const mode = process.argv[2] as Mode | undefined;
if (mode === "dev") await dev();
else if (mode === "prod") await prod();
else {
  process.stderr.write("usage: bun run .claude/commands/stack.ts dev|prod\n");
  process.exit(2);
}
