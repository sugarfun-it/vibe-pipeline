// `vbpl update` — 跑 install script update VP 到 GitHub latest release
//
// design:
//   CLI 不重寫 install / update 邏輯,只是 thin wrapper 跑 install script
//   (scripts/install.{ps1,sh})。install script 是 self-contained:
//     1. 偵測 + 停 user backend(若有跑)
//     2. fetch GitHub latest tag
//     3. download tarball
//     4. 解到 versions/<tag>/
//     5. bun install
//     6. swap current junction/symlink
//     7. cleanup 舊版(留近 N 個供 rollback)
//     8. 起 backend from new current/
//
//   `vbpl update` 入口跟 PWA Settings「複製指令 → terminal 跑」入口共用同條 install script。
//   single source of truth = scripts/install.{ps1,sh}。
//
// flag:
//   --check   只查不裝(印 current / latest / hasUpdate)
//   --yes     跳過 install script 內互動式 PATH prompt(若已在 PATH 就跳過)
//
// 平台:
//   Windows  → spawn `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script>`
//   POSIX    → spawn `sh <script>`
//
// script 來源優先序:
//   1. process.cwd()/scripts/install.{ps1,sh}(local 版,離線 + 改了 script 立刻測得到)
//   2. 沒有 → 從 GitHub raw fetch(走 install.{ps1,sh} 的 one-liner 流程)

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import type { ParsedArgs } from "../lib/args";
import { bool } from "../lib/args";
import { fail, isJsonMode, okJson, print } from "../lib/output";
import { localServerBase } from "../lib/serverBase";

const GITHUB_REPO = process.env.VP_GITHUB_REPO ?? "sugarfun-it/vibe-pipeline";

const USAGE = `vbpl update — fetch + apply latest VP release

SYNOPSIS
  vbpl update [flags]

OPTIONS
  (none)            預設行為:跑 install script(stop backend → 下載 tarball → swap → restart)
  --check           只查不裝(印 current / latest / hasUpdate)
  --yes             跳過 install script 內的 interactive prompt(unattended 用)

EXAMPLES
  vbpl update                  # 拉最新 release 裝起來
  vbpl update --check          # 只看有沒有新版,不裝
  vbpl update --check --json   # JSON 給 agent 解析「該不該升」
  vbpl update --yes            # CI / cron 跑(不問 confirm)

NOTES
  - 走的 install script:scripts/install.{ps1,sh}(跟 README one-liner 同一條)
  - 過程會短暫殺 backend,running pipeline 會 → state=paused,update 完按「繼續」接續
  - tarball 從 GitHub release 抓:${GITHUB_REPO}(可 VP_GITHUB_REPO env 改)

SEE ALSO
  vbpl server --help    # update 期間 backend 流程`;
const GITHUB_RAW_INSTALL_PS1 = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.ps1`;
const GITHUB_RAW_INSTALL_SH = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh`;

type VersionStatus = {
  current: string;
  latest: { tag: string; url: string; publishedAt: string } | null;
  isLatest: boolean;
  hasUpdate: boolean;
};

async function fetchVersionStatus(): Promise<VersionStatus> {
  const res = await fetch(`${localServerBase()}/api/system/version`);
  if (!res.ok) throw new Error(`backend HTTP ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data?: VersionStatus; error?: { message?: string } };
  if (!json.ok || !json.data) {
    throw new Error(json.error?.message ?? "unknown error from /api/system/version");
  }
  return json.data;
}

// 找 local install script(repo 內 scripts/),沒有再 fallback fetch GitHub raw
function localScriptPath(isWin: boolean): string | null {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "scripts", isWin ? "install.ps1" : "install.sh"),
    // VBPL_HOME / current dir 也可能有
    process.env.VBPL_HOME
      ? join(process.env.VBPL_HOME, "scripts", isWin ? "install.ps1" : "install.sh")
      : null,
  ].filter((p): p is string => p !== null);
  for (const p of candidates) {
    if (existsSync(p)) return resolve(p);
  }
  return null;
}

async function runInstallScript(isWin: boolean): Promise<number> {
  const local = localScriptPath(isWin);
  let proc: ReturnType<typeof Bun.spawn>;
  if (local) {
    print(`Running install script: ${local}`);
    if (isWin) {
      proc = Bun.spawn(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", local],
        { stdout: "inherit", stderr: "inherit", stdin: "inherit", windowsHide: false },
      );
    } else {
      proc = Bun.spawn(["sh", local], {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
    }
  } else {
    const url = isWin ? GITHUB_RAW_INSTALL_PS1 : GITHUB_RAW_INSTALL_SH;
    print(`Local script not found, fetching from ${url}`);
    if (isWin) {
      // irm | iex 跑遠端 script
      const cmd = `irm '${url}' | iex`;
      proc = Bun.spawn(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        { stdout: "inherit", stderr: "inherit", stdin: "inherit", windowsHide: false },
      );
    } else {
      // curl ... | sh
      const cmd = `curl -fsSL '${url}' | sh`;
      proc = Bun.spawn(["sh", "-c", cmd], {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
    }
  }
  return await proc.exited;
}

export async function runUpdate(_sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (args.flags["help"] === true) {
    print(USAGE);
    return;
  }

  const checkOnly = bool(args.flags["check"]);
  // --yes 留 placeholder,目前 install script 沒接此 flag(PATH 已存在的話不問),保留 forward-compat
  // const yes = bool(args.flags["yes"]);

  let ver: VersionStatus;
  try {
    ver = await fetchVersionStatus();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("NO_SERVER", `查詢版本失敗(backend 沒跑?):${msg}`);
  }

  if (checkOnly) {
    if (isJsonMode()) {
      okJson(ver);
      return;
    }
    print(`Current: ${ver.current}`);
    print(`Latest:  ${ver.latest?.tag ?? "(no release)"}`);
    print(`Update:  ${ver.hasUpdate ? "available" : "up to date"}`);
    return;
  }

  if (!ver.hasUpdate) {
    if (isJsonMode()) {
      okJson({ ok: true, message: "already up to date", current: ver.current });
      return;
    }
    print(`Already up to date (${ver.current}).`);
    return;
  }

  print(`Update available: ${ver.current} -> ${ver.latest?.tag}`);

  const code = await runInstallScript(platform() === "win32");
  if (code !== 0) {
    fail("UPDATE_FAILED", `install script exited with code ${code}`);
  }
  // install script 末段已 vbpl server start,新 backend 應已跑著
  if (isJsonMode()) {
    okJson({ ok: true, applied: ver.latest?.tag });
    return;
  }
  print("");
  print(`Update staged. Run 'vbpl server start' to launch new backend.`);
  print(`Then open PWA and accept the 'Apply update' banner to reload UI.`);
}
