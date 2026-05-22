// /api/system/update 後端核心(v4 — install-script-only,re-add for PWA UX):
//
// design:
//   v0.2.x .pending hook + swap-on-start cross-process coupling 已砍。
//   v0.3 改 install-script-only 但只 CLI(vbpl update),PWA user 沒 terminal 卡住。
//   v0.2.4 加回 /api/system/update,但**邏輯極簡**:純 spawn install script
//   detached + stdio file,backend 自己 exit。
//
//   為什麼 PWA-triggered 不撞 v0.2.x stdio chain bug:
//     PWA 走 HTTP request,backend stdio = server.log fds(獨立,跟 PWA 無關)。
//     backend Bun.spawn install with stdio: ["ignore", logFd, logFd] → install 跑時
//     stdio = file fds。install 的 grandchildren 繼承 = file fds,沒 chain 到 HTTP
//     request。CLI-triggered case 撞 chain 是因為 bash → vbpl → install 整鏈 stdio
//     是 bash pipe。
//
// flow:
//   1. preflightCheck:globalRunningCount===0 + hasUpdate
//   2. spawn install.ps1 -AutoStart / install.sh --auto-start detached + stdio file
//   3. response 200 立刻
//   4. setTimeout 500ms self-exit
//   5. install script 跑(stop backend → download → swap → start 新 backend)
//   6. PWA polls /api/health 直到新 backend up

import { join } from "node:path";
import { existsSync, mkdirSync, openSync, writeFileSync, unlinkSync } from "node:fs";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { getVersionStatus } from "./systemVersion";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

function updateLogPath(): string {
  return join(vpRoot(), "update.log");
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

export async function preflightCheck(): Promise<PreflightResult> {
  const n = orchestrator.globalRunningCount();
  if (n > 0) {
    return { ok: false, reason: `還有 ${n} 條 pipeline 在跑,等跑完或暫停後再更新` };
  }
  const ver = await getVersionStatus();
  if (!ver.hasUpdate) {
    return { ok: false, reason: "已是最新版,無需更新" };
  }
  return { ok: true };
}

// 找 install script:優先 current/scripts/(從 v0.2.5 起 build-tarball 白名單含 scripts/,
// enduser install dir 有 local script),否則 dev clone process.cwd()/scripts/,
// 最後 fallback 從 GitHub raw 下載到 temp + 顯式呼叫帶 args。
function localScriptPath(): string | null {
  const cwd = process.cwd();
  const isWin = platform() === "win32";
  const name = isWin ? "install.ps1" : "install.sh";
  const candidates = [
    join(cwd, "scripts", name),
    // current/ junction(若 backend 從 vbpl server start 起,cwd 已是 current),仍 cover
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const GITHUB_RAW_INSTALL_PS1 =
  "https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1";
const GITHUB_RAW_INSTALL_SH =
  "https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.sh";

// Fallback:從 GitHub raw 抓 install script 到 temp,回 path 給 spawn 用。
// 不用 `irm | iex` 因為 iex 不接 args(script 內 param block 永遠拿不到 -AutoStart)。
async function downloadInstallScript(): Promise<string> {
  const isWin = platform() === "win32";
  const url = isWin ? GITHUB_RAW_INSTALL_PS1 : GITHUB_RAW_INSTALL_SH;
  const tmpDir = vpRoot();
  const tmpPath = join(tmpDir, isWin ? "install-tmp.ps1" : "install-tmp.sh");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch install script failed: HTTP ${res.status}`);
  const body = await res.text();
  writeFileSync(tmpPath, body, "utf8");
  return tmpPath;
}

// Spawn install script — 真 detach,backend 自殺後 install 還活。
//
// Windows:不能用 `Bun.spawn(powershell, { detached: true })` — Win32 限制 +
// Node #51018 已記錄:DETACHED_PROCESS 會 silently ignore CREATE_NO_WINDOW
// 且 PowerShell child 無 console attached → silently 不執行。實測證實。
//
// 改用 mediator pattern:
//   Bun.spawn(powershell hidden, NO detached)        ← windowsHide 在無 detached 下生效
//     └─ mediator 跑 `Start-Process powershell -WindowStyle Hidden ...
//        -RedirectStandardOutput log -RedirectStandardError log.err`
//        Start-Process 內建 ShellExecute 路徑 — spawned process 自然 detached + hidden,
//        survives mediator + backend 死。
//     └─ mediator ~500ms 就退,Bun.spawn 收尾,backend 接著自殺。
//
// argv path 用 forward slash:Bun.spawn 在 Windows argv 處理 `\U \E \s` 當 escape
// 會吃掉 backslash。`scriptPath`/`logPath` 全轉成 / 後傳。
//
// POSIX:`Bun.spawn(install.sh, { stdio: fd, detached: true })` 走新 process group 正常 detach。
export async function spawnInstallScript(): Promise<void> {
  ensureVpRoot();
  resetLog();
  const isWin = platform() === "win32";
  const logPath = updateLogPath();

  // Resolve script path: local first, else download to temp
  let scriptPath = localScriptPath();
  if (!scriptPath) {
    scriptPath = await downloadInstallScript();
  }

  if (isWin) {
    // Cleanup 殘留 launcher 檔(從舊版 vbs / cmd 路徑遷移過來的 enduser 才會有)
    for (const stale of ["update-launcher.vbs", "update-launcher.cmd"]) {
      try { unlinkSync(join(vpRoot(), stale)); } catch {}
    }

    const fwdScript = scriptPath.replace(/\\/g, "/");
    const fwdLog = logPath.replace(/\\/g, "/");
    const cmd =
      `Start-Process powershell -WindowStyle Hidden ` +
      `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${fwdScript}','-AutoStart' ` +
      `-RedirectStandardOutput '${fwdLog}' -RedirectStandardError '${fwdLog}.err'`;
    Bun.spawn(
      ["powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", cmd],
      {
        cwd: vpRoot(),
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
        windowsHide: true,
      },
    );
  } else {
    // POSIX:走 Bun.spawn detached + stdio:fd,process group fork 正常 detach
    const stdoutFd = openSync(logPath, "a");
    const stderrFd = openSync(logPath, "a");
    try {
      Bun.spawn(["sh", scriptPath, "--auto-start"], {
        stdout: stdoutFd,
        stderr: stderrFd,
        stdin: "ignore",
        // @ts-expect-error Bun 支援 detached 但 TS 型別未必載入
        detached: true,
      });
    } catch (e) {
      try { require("node:fs").closeSync(stdoutFd); } catch {}
      try { require("node:fs").closeSync(stderrFd); } catch {}
      throw e;
    }
  }
}
