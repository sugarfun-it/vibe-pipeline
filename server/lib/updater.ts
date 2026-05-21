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
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { getVersionStatus } from "./systemVersion";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function updateLogPath(): string {
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
// Windows:`Bun.spawn(install.ps1, { stdio: fd, detached: true })` 實測 install
// process 沒被起來(update.log 只有 backend 寫的 start 行,powershell 沒 spawn)。
// 可能 Bun.spawn 把 file fd 傳給 child 的方式在 Windows 上有 bug。
// 改用 cmd /c start "" /B 寫 launcher .cmd + PS internal redirect:
//   - 寫 ~/.vibe-pipeline/update-launcher.cmd:內含 `powershell -File install.ps1 -AutoStart >> update.log 2>&1`
//   - Bun.spawn(["cmd", "/c", "start", "", "/B", launcher.cmd]) — start /B 是 cmd 內建真 detach
//   - cmd /c start 一啟動 launcher.cmd 就 exit,Bun.spawn 立刻 return
//   - launcher.cmd 由 cmd.exe 持續跑(start /B 給的新 console),PS 開始,redirect 自己
//   - backend 之後自殺,跟整鏈無關
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
    // VBScript launcher for TRUE invisible window:
    //   - cmd /c start /B 仍可能跳 console window(Bun.spawn detached 給 cmd new console group)
    //   - powershell -WindowStyle Hidden 也只 hide PS 自己,parent cmd 仍見
    //   - 唯一真 invisible = WScript.Shell.Run(cmd, 0, False),windowStyle=0 = SW_HIDE
    //
    // VBScript escapes: 雙引號路徑用 "" (兩個雙引號) escape。VBS 字串 concat 用 &。
    const launcherPath = join(vpRoot(), "update-launcher.vbs");
    const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File ""${scriptPath}"" -AutoStart >> ""${logPath}"" 2>&1`;
    const launcherContent = [
      `' vibe-pipeline update launcher (invisible)`,
      `Set sh = CreateObject("WScript.Shell")`,
      `sh.Run "cmd /c ${psCmd}", 0, False`,
      "",
    ].join("\r\n");
    writeFileSync(launcherPath, launcherContent, "utf8");

    // wscript.exe 跑 vbs 本身就 invisible(無 console)。vbs 內 Shell.Run windowStyle=0
    // 起的 cmd → powershell 也是 SW_HIDE。整鏈 0 window。
    // cwd: vpRoot() 必設,避 install.ps1 step 7 移 current junction 撞自己 cwd。
    Bun.spawn(["wscript.exe", launcherPath], {
      cwd: vpRoot(),
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      windowsHide: true,
      // @ts-expect-error Bun 支援 detached 但 TS 型別未必載入
      detached: true,
    });
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
