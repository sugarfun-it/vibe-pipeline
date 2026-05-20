// /api/system/update 後端核心(tarball + launcher pattern,2026-05-21 重寫):
//
// 動機:Windows 上 backend 不能 rmrf 自己 cwd(EBUSY 然後 rename EPERM,
// app/ 內容被刪光留空殼變 zombie)。改用 launcher pattern:
//
// flow:
//   1. preflightCheck:無 pipeline running + hasUpdate
//   2. downloadAndStage:fetch GitHub releases/latest → 下載到 `~/.vibe-pipeline/app.download.tmp/`
//      → 解壓到 `~/.vibe-pipeline/app.staging/` → resolveRoot
//   3. writeHelperScript:寫一份 detached helper(`.ps1` / `.sh`)到 `~/.vibe-pipeline/`
//      內容做 wait-backend-die → rmrf app/ → rename staging root → app/ → spawn 新 backend
//   4. spawnHelperDetached:跨平台啟動 helper,跟 parent 解耦
//   5. route handler response 200 → setTimeout 1500ms self-exit(讓 helper 等到 backend cwd 釋放)
//   6. helper 把新 backend stdout/stderr redirect 到 `~/.vibe-pipeline/server.log`(對齊 vbpl server start)
//
// 失敗任一步直接拋,純前進不 rollback(spec C 決議,失敗 user 重跑 install script 即修)。
// 全程 log append 到 `~/.vibe-pipeline/update.log`(truncate 模式,只留本次)+ helper 自己 append。

import { join, basename } from "node:path";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync, createWriteStream, chmodSync } from "node:fs";
import { Readable } from "node:stream";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { getVersionStatus, fetchLatestRelease } from "./systemVersion";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function updateLogPath(): string {
  return join(vpRoot(), "update.log");
}

export function appDir(): string {
  return join(vpRoot(), "app");
}

function downloadDir(): string {
  return join(vpRoot(), "app.download.tmp");
}

function stagingDir(): string {
  return join(vpRoot(), "app.staging");
}

function serverLogPath(): string {
  return join(vpRoot(), "server.log");
}

function helperScriptPath(): string {
  return join(vpRoot(), platform() === "win32" ? "update-helper.ps1" : "update-helper.sh");
}

function ensureVpRoot(): void {
  try {
    mkdirSync(vpRoot(), { recursive: true });
  } catch {
    // ignore
  }
}

function resetLog(): void {
  ensureVpRoot();
  try {
    writeFileSync(updateLogPath(), `[updater] start ${new Date().toISOString()}\n`, "utf8");
  } catch {
    // ignore
  }
}

function log(msg: string): void {
  try {
    appendFileSync(updateLogPath(), `[updater] ${msg}\n`, "utf8");
  } catch {
    // ignore
  }
}

export async function preflightCheck(): Promise<PreflightResult> {
  // 1. 沒 pipeline running(ticket / sync 都算)
  const n = orchestrator.globalRunningCount();
  if (n > 0) {
    return { ok: false, reason: `還有 ${n} 條 pipeline 在跑,等跑完或暫停後再更新` };
  }
  // 2. 有 update
  const ver = await getVersionStatus();
  if (!ver.hasUpdate) {
    return { ok: false, reason: "已是最新版,無需更新" };
  }
  return { ok: true };
}

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type ReleaseInfo = {
  tag: string;
  downloadUrl: string;
  filename: string;
  needsStripTopLevel: boolean;
};

const GITHUB_REPO = process.env.VP_GITHUB_REPO ?? "eric14304/vibe-pipeline";

async function fetchReleaseInfo(): Promise<ReleaseInfo> {
  const latest = await fetchLatestRelease();
  if (!latest) {
    throw new Error("無法取得 GitHub latest release(沒發過 release / 網路 / rate limit)");
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "vibe-pipeline",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases/latest HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    tag_name?: string;
    tarball_url?: string;
    assets?: ReleaseAsset[];
  };
  const tag = typeof json.tag_name === "string" ? json.tag_name : latest.tag;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const asset =
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".tar.gz")) ??
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".tgz")) ??
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".zip"));
  if (asset && typeof asset.browser_download_url === "string") {
    return {
      tag,
      downloadUrl: asset.browser_download_url,
      filename: asset.name,
      needsStripTopLevel: false,
    };
  }
  if (typeof json.tarball_url === "string" && json.tarball_url.length > 0) {
    return {
      tag,
      downloadUrl: json.tarball_url,
      filename: `${tag}.tar.gz`,
      needsStripTopLevel: true,
    };
  }
  throw new Error("release 沒 .tar.gz / .zip asset 也沒 tarball_url");
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": "vibe-pipeline" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`下載失敗 HTTP ${res.status} ${url}`);
  }
  await new Promise<void>((resolve, reject) => {
    const sink = createWriteStream(dest);
    const src = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    src.on("error", reject);
    sink.on("error", reject);
    sink.on("finish", resolve);
    src.pipe(sink);
  });
}

async function runTool(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [outBuf, errBuf, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  if (outBuf.trim()) log(`stdout: ${outBuf.trim()}`);
  if (errBuf.trim()) log(`stderr: ${errBuf.trim()}`);
  if (code !== 0) {
    throw new Error(`${args.join(" ")} 失敗 exit=${code}`);
  }
}

// Windows tar 解析:
//   - System32 tar.exe = native bsdtar(Win10 17063+ 內建),正確處理 `C:\path`
//   - git-for-Windows usr/bin/tar.exe = MSYS bsdtar,把 `C:\path` mangle 成 `C\:\\path`(MSYS path 轉譯)
// PowerShell `tar` 走 cmdlet resolution 命中 System32(沒事);Bun.spawn 走 PATH 順序,常命中
// git-for-Windows(因 git 安裝把 usr/bin 加在前面)。
// 修法:Windows 顯式給 absolute path C:\Windows\System32\tar.exe(會 fail 在 < Win10 17063,
// 但 VP 本來就要 Win10+;Bun 也是)。POSIX 仍用 PATH 上 tar(GNU tar 行為正常)。
// --force-local 不能加(bsdtar 全部不認,加了直接 exit 1)。
function winTarPath(): string {
  return join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");
}

async function extractArchive(archivePath: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  const isWin = platform() === "win32";
  const tarBin = isWin ? winTarPath() : "tar";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await runTool([tarBin, "-xzf", archivePath, "-C", outDir], outDir);
    return;
  }
  if (lower.endsWith(".zip")) {
    if (isWin) {
      await runTool(
        [
          "powershell.exe",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(outDir)} -Force`,
        ],
        outDir
      );
    } else {
      await runTool([tarBin, "-xf", archivePath, "-C", outDir], outDir);
    }
    return;
  }
  throw new Error(`不支援的封存格式:${basename(archivePath)}`);
}

function resolveRoot(outDir: string, forceStrip: boolean): string {
  const entries = readdirSync(outDir).filter((n) => n !== "." && n !== "..");
  if (entries.length === 1) {
    const inner = join(outDir, entries[0]);
    try {
      if (statSync(inner).isDirectory()) return inner;
    } catch {
      // ignore
    }
  }
  if (forceStrip) {
    throw new Error(`tarball 預期單一 top-level dir,實際 ${entries.length} 個 entries`);
  }
  return outDir;
}

function rmrf(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (e) {
    log(`rmSync ${path} 警告:${String(e)}`);
  }
}

export type StagedUpdate = {
  tag: string;
  stagingRoot: string;
  cleanupPaths: string[];
};

// download + extract,不動 app/。回 staging root path 給 helper 用。
export async function downloadAndStage(): Promise<StagedUpdate> {
  ensureVpRoot();
  resetLog();
  log(`repo=${GITHUB_REPO}`);
  // 清理上次殘留
  rmrf(downloadDir());
  rmrf(stagingDir());
  mkdirSync(downloadDir(), { recursive: true });

  const rel = await fetchReleaseInfo();
  log(`tag=${rel.tag} url=${rel.downloadUrl} stripTop=${rel.needsStripTopLevel}`);

  const archivePath = join(downloadDir(), rel.filename);
  log(`download → ${archivePath}`);
  await downloadToFile(rel.downloadUrl, archivePath);

  log(`extract → ${stagingDir()}`);
  await extractArchive(archivePath, stagingDir());
  const root = resolveRoot(stagingDir(), rel.needsStripTopLevel);
  log(`stagingRoot=${root}`);

  return {
    tag: rel.tag,
    stagingRoot: root,
    cleanupPaths: [downloadDir(), stagingDir()],
  };
}

// 寫跨平台 helper script:wait backend exit → rmrf app → rename staging → spawn new backend → self-delete
// 帶 backendPid 讓 helper 知道等誰;帶 bunPath 避免 PATH 解析(用當前 process.execPath,通常是 bun)
export function writeHelperScript(opts: {
  backendPid: number;
  stagingRoot: string;
  cleanupPaths: string[];
}): string {
  const isWin = platform() === "win32";
  const bunPath = process.execPath;
  const path = helperScriptPath();
  const app = appDir();
  const logP = updateLogPath();
  const srvLog = serverLogPath();

  if (isWin) {
    const cleanupExpr =
      opts.cleanupPaths.length > 0
        ? "@(" + opts.cleanupPaths.map((p) => JSON.stringify(p)).join(", ") + ")"
        : "@()";
    const content = [
      `# vibe-pipeline update helper (generated, ASCII-only for Win PS 5.1 safety)`,
      `$ErrorActionPreference = "Continue"`,
      `$log = ${JSON.stringify(logP)}`,
      `$BackendPid = ${opts.backendPid}`,
      `$Staging = ${JSON.stringify(opts.stagingRoot)}`,
      `$App = ${JSON.stringify(app)}`,
      `$BunPath = ${JSON.stringify(bunPath)}`,
      `$ServerLog = ${JSON.stringify(srvLog)}`,
      `$Cleanup = ${cleanupExpr}`,
      `$Self = $MyInvocation.MyCommand.Path`,
      ``,
      `function L($m) { try { Add-Content -Path $log -Value ("[helper] " + (Get-Date -Format o) + " " + $m) -Encoding utf8 } catch {} }`,
      ``,
      `L "start, waiting backend pid $BackendPid (max 30s)"`,
      `for ($i = 0; $i -lt 60; $i++) {`,
      `  $p = Get-Process -Id $BackendPid -ErrorAction SilentlyContinue`,
      `  if (-not $p) { L ("backend exited after " + ($i * 500) + "ms"); break }`,
      `  Start-Sleep -Milliseconds 500`,
      `}`,
      `$p = Get-Process -Id $BackendPid -ErrorAction SilentlyContinue`,
      `if ($p) {`,
      `  L "WARN: backend still alive after 30s, force kill"`,
      `  try { Stop-Process -Id $BackendPid -Force } catch { L ("force kill failed: " + $_) }`,
      `  Start-Sleep -Seconds 2`,
      `}`,
      ``,
      `L "rmrf $App (retry up to 20x)"`,
      `for ($i = 0; $i -lt 20; $i++) {`,
      `  if (-not (Test-Path $App)) { break }`,
      `  try { Remove-Item -Recurse -Force $App; break } catch { L ("retry " + $i + ": " + $_); Start-Sleep -Milliseconds 500 }`,
      `}`,
      `if (Test-Path $App) { L "ERROR: cannot remove $App, abort"; exit 1 }`,
      ``,
      `L "rename $Staging -> $App"`,
      `try { Move-Item $Staging $App } catch { L ("ERROR rename: " + $_); exit 1 }`,
      ``,
      `foreach ($c in $Cleanup) {`,
      `  if (Test-Path $c) { try { Remove-Item -Recurse -Force $c -ErrorAction SilentlyContinue } catch {} }`,
      `}`,
      ``,
      `L "bun install in $App (tarball lacks node_modules)"`,
      `try {`,
      `  $bunInstall = Start-Process -FilePath $BunPath -ArgumentList "install","--silent" -WorkingDirectory $App -NoNewWindow -Wait -PassThru`,
      `  if ($bunInstall.ExitCode -ne 0) { L ("WARN bun install exit=" + $bunInstall.ExitCode + " — new backend may fail to start") }`,
      `  else { L "bun install ok" }`,
      `} catch { L ("bun install threw: " + $_) }`,
      ``,
      `L "spawn new backend from $App via cmd.exe (Start-Process -RedirectStandard* disallows same-path stdout+stderr)"`,
      `try {`,
      `  $env:VBPL_HOME = $App`,
      `  $serverTs = Join-Path $App "server/index.ts"`,
      `  $bunQ = '"' + $BunPath + '"'`,
      `  $serverQ = '"' + $serverTs + '"'`,
      `  $logQ = '"' + $ServerLog + '"'`,
      `  $cmdLine = "/c " + $bunQ + " run " + $serverQ + " >> " + $logQ + " 2>&1"`,
      `  Start-Process -FilePath "cmd.exe" -ArgumentList $cmdLine -WorkingDirectory $App -WindowStyle Hidden | Out-Null`,
      `  L "spawn invoked (cmd.exe wrapped, can't confirm bun exit — check server.log)"`,
      `} catch { L ("spawn cmd.exe failed: " + $_) }`,
      ``,
      `L "done"`,
      `try { Remove-Item -Force $Self -ErrorAction SilentlyContinue } catch {}`,
      ``,
    ].join("\r\n");
    writeFileSync(path, content, { encoding: "utf8" });
  } else {
    const cleanupQuoted = opts.cleanupPaths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(" ");
    const content = [
      `#!/bin/sh`,
      `# vibe-pipeline update helper (generated)`,
      `set -u`,
      `LOG=${JSON.stringify(logP)}`,
      `PID=${opts.backendPid}`,
      `STAGING=${JSON.stringify(opts.stagingRoot)}`,
      `APP=${JSON.stringify(app)}`,
      `BUN=${JSON.stringify(bunPath)}`,
      `SERVER_LOG=${JSON.stringify(srvLog)}`,
      `CLEANUP="${cleanupQuoted}"`,
      `SELF="$0"`,
      ``,
      `log() { echo "[helper] $(date -Iseconds 2>/dev/null || date) $*" >> "$LOG" 2>/dev/null || true; }`,
      `log "start, waiting backend pid $PID (max 30s)"`,
      ``,
      `i=0`,
      `while [ "$i" -lt 60 ] && kill -0 "$PID" 2>/dev/null; do`,
      `  sleep 0.5`,
      `  i=$((i+1))`,
      `done`,
      `if kill -0 "$PID" 2>/dev/null; then`,
      `  log "WARN: backend still alive, force kill"`,
      `  kill -9 "$PID" 2>/dev/null || true`,
      `  sleep 2`,
      `fi`,
      ``,
      `log "rmrf $APP"`,
      `rm -rf "$APP" || { log "rmrf failed"; exit 1; }`,
      ``,
      `log "mv $STAGING -> $APP"`,
      `mv "$STAGING" "$APP" || { log "mv failed"; exit 1; }`,
      ``,
      `for c in $CLEANUP; do`,
      `  rm -rf "$c" 2>/dev/null || true`,
      `done`,
      ``,
      `log "bun install in $APP (tarball lacks node_modules)"`,
      `cd "$APP" || { log "cd failed"; exit 1; }`,
      `if "$BUN" install --silent >> "$LOG" 2>&1; then`,
      `  log "bun install ok"`,
      `else`,
      `  log "WARN bun install non-zero exit — new backend may fail to start"`,
      `fi`,
      ``,
      `log "spawn new backend from $APP"`,
      `export VBPL_HOME="$APP"`,
      `nohup "$BUN" run "$APP/server/index.ts" >> "$SERVER_LOG" 2>&1 < /dev/null &`,
      `disown 2>/dev/null || true`,
      `log "done"`,
      `rm -f "$SELF" 2>/dev/null || true`,
      ``,
    ].join("\n");
    writeFileSync(path, content, { encoding: "utf8" });
    try {
      chmodSync(path, 0o755);
    } catch {
      // ignore
    }
  }
  return path;
}

// 跨平台 detach 啟動 helper。parent 隨後可 process.exit。
export function spawnHelperDetached(helperPath: string): void {
  const isWin = platform() === "win32";
  const args = isWin
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath]
    : ["bash", helperPath];
  log(`spawn helper: ${args.join(" ")}`);
  try {
    Bun.spawn(args, {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      windowsHide: true,
      // @ts-expect-error Bun 支援 detached 選項但 TS 型別未必載入
      detached: true,
    });
  } catch (e) {
    log(`spawn helper 失敗:${String(e)}`);
    throw e;
  }
}
