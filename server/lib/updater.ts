// /api/system/update 後端核心:
// - preflightCheck:三條(git clean / 無 pipeline running / hasUpdate)任一失敗回 reason。
// - writeUpdaterScript:寫一份 detached script 到 ~/.vibe-pipeline/update.{ps1,sh},
//   內容做 git pull --ff-only / bun install / cli:build / cp vbpl exe / frontend build / restart backend。
//   全程 stdout/stderr 都 redirect 到 ~/.vibe-pipeline/update.log(truncate 模式,只留本次)。
// - spawnDetached:跨平台啟動該 script,跟 parent 解耦(detached + unref + stdio:ignore),
//   parent 之後可以安全 process.exit。

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { runCapture } from "./spawn";
import { getVersionStatus } from "./systemVersion";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function updateLogPath(): string {
  return join(vpRoot(), "update.log");
}

export function updaterScriptPath(): string {
  return join(vpRoot(), platform() === "win32" ? "update.ps1" : "update.sh");
}

export function vbplBinDir(): string {
  return join(vpRoot(), "bin");
}

export async function preflightCheck(repoPath: string): Promise<PreflightResult> {
  // 1. git clean
  const status = await runCapture(["git", "status", "--porcelain"], { cwd: repoPath });
  if (!status.ok) {
    return { ok: false, reason: `git status 失敗:${status.err.trim() || "unknown"}` };
  }
  if (status.out.trim().length > 0) {
    return { ok: false, reason: "git working tree 有未提交變更,先 commit / stash 再更新" };
  }
  // 2. 沒 pipeline running(ticket / sync 都算)
  const n = orchestrator.globalRunningCount();
  if (n > 0) {
    return { ok: false, reason: `還有 ${n} 條 pipeline 在跑,等跑完或暫停後再更新` };
  }
  // 3. 有 update
  const ver = await getVersionStatus();
  if (!ver.hasUpdate) {
    return { ok: false, reason: "已是最新版,無需更新" };
  }
  return { ok: true };
}

function ensureVpRoot(): void {
  try {
    mkdirSync(vpRoot(), { recursive: true });
  } catch {
    // ignore
  }
}

// Windows 用 PowerShell;Mac/Linux 用 POSIX sh。
// 兩邊都先 truncate update.log 再 append,所以同 redirect 一條 log。
// build / restart backend 走背景方式;script 本身就是 detached,在背景跑就好。
export function writeUpdaterScript(repoPath: string): string {
  ensureVpRoot();
  const root = vpRoot();
  const log = updateLogPath();
  const binDir = vbplBinDir();
  const isWin = platform() === "win32";
  const path = updaterScriptPath();

  if (isWin) {
    // PowerShell script。所有命令 stdout/stderr 都 *>> $log(會 append,啟動時先清空 log)。
    const content = [
      `# vibe-pipeline auto-updater (generated)`,
      `$ErrorActionPreference = "Continue"`,
      `$log = ${JSON.stringify(log)}`,
      `$repo = ${JSON.stringify(repoPath)}`,
      `$binDir = ${JSON.stringify(binDir)}`,
      `Set-Content -Path $log -Value "[updater] start $(Get-Date -Format o)" -Encoding utf8`,
      `function Run([string]$desc, [scriptblock]$block) {`,
      `  Add-Content -Path $log -Value "[updater] $desc" -Encoding utf8`,
      `  try { & $block *>> $log } catch { Add-Content -Path $log -Value "[updater] $desc FAILED: $_" -Encoding utf8; exit 1 }`,
      `}`,
      `Set-Location -Path $repo`,
      `Run "git pull --ff-only" { git pull --ff-only }`,
      `Run "bun install" { bun install }`,
      `Run "bun run cli:build" { bun run cli:build }`,
      `if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }`,
      `Run "cp vbpl.exe -> bin" { Copy-Item -Force (Join-Path $repo "dist-cli/vbpl.exe") (Join-Path $binDir "vbpl.exe") }`,
      `Run "bun run build" { bun run build }`,
      `Add-Content -Path $log -Value "[updater] restart backend (bun run server)" -Encoding utf8`,
      // 背景啟 backend,自己也不等;detached + windowsHide
      `Start-Process -FilePath "bun" -ArgumentList "run","server" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $log`,
      `Add-Content -Path $log -Value "[updater] done $(Get-Date -Format o)" -Encoding utf8`,
      ``,
    ].join("\r\n");
    writeFileSync(path, content, "utf8");
  } else {
    const content = [
      `#!/usr/bin/env bash`,
      `# vibe-pipeline auto-updater (generated)`,
      `set -u`,
      `LOG=${JSON.stringify(log)}`,
      `REPO=${JSON.stringify(repoPath)}`,
      `BIN_DIR=${JSON.stringify(binDir)}`,
      `: > "$LOG"`,
      `echo "[updater] start $(date -Iseconds)" >> "$LOG"`,
      `run() { local desc="$1"; shift; echo "[updater] $desc" >> "$LOG"; "$@" >> "$LOG" 2>&1 || { echo "[updater] $desc FAILED ($?)" >> "$LOG"; exit 1; }; }`,
      `cd "$REPO" || { echo "[updater] cd FAILED" >> "$LOG"; exit 1; }`,
      `run "git pull --ff-only" git pull --ff-only`,
      `run "bun install" bun install`,
      `run "bun run cli:build" bun run cli:build`,
      `mkdir -p "$BIN_DIR"`,
      // mac / linux 都會 build 出非 .exe 的 binary;這裡保守 cp 整個 dist-cli/ 讓 user 自己挑
      `if [ -f "$REPO/dist-cli/vbpl" ]; then cp -f "$REPO/dist-cli/vbpl" "$BIN_DIR/vbpl" >> "$LOG" 2>&1; fi`,
      `if [ -f "$REPO/dist-cli/vbpl-mac" ]; then cp -f "$REPO/dist-cli/vbpl-mac" "$BIN_DIR/vbpl" >> "$LOG" 2>&1; fi`,
      `if [ -f "$REPO/dist-cli/vbpl-linux" ]; then cp -f "$REPO/dist-cli/vbpl-linux" "$BIN_DIR/vbpl" >> "$LOG" 2>&1; fi`,
      `if [ -f "$REPO/dist-cli/vbpl.exe" ]; then cp -f "$REPO/dist-cli/vbpl.exe" "$BIN_DIR/vbpl.exe" >> "$LOG" 2>&1; fi`,
      `run "bun run build" bun run build`,
      `echo "[updater] restart backend (bun run server)" >> "$LOG"`,
      `( cd "$REPO" && nohup bun run server >> "$LOG" 2>&1 < /dev/null & )`,
      `echo "[updater] done $(date -Iseconds)" >> "$LOG"`,
      ``,
    ].join("\n");
    writeFileSync(path, content, "utf8");
    try {
      // chmod +x;Windows 無效但無害
      const { chmodSync } = require("node:fs") as typeof import("node:fs");
      chmodSync(path, 0o755);
    } catch {
      // ignore
    }
  }
  return path;
}

// 完全 detach:parent process.exit 後 child 持續活著。
// Windows:powershell.exe -NoProfile -ExecutionPolicy Bypass -File update.ps1
// POSIX:bash update.sh
export function spawnDetached(scriptPath: string): void {
  const isWin = platform() === "win32";
  const args = isWin
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
    : ["bash", scriptPath];

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    // Bun 支援 windowsHide;true 在 Windows 不開 console 視窗
    windowsHide: true,
  });
  // 不 await,讓 parent 可以乾淨退出
  try {
    proc.unref();
  } catch {
    // 舊 Bun 沒 unref 就算了,反正我們馬上 process.exit
  }
}
