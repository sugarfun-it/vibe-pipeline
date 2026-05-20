// Versioned install layout SSOT(2026-05-21 self-update 改 Scoop-style 後落地):
//
// ~/.vibe-pipeline/
//   versions/v0.1.X/         # 各版本獨立目錄(self-update 解壓進來)
//   current -> versions/...  # junction(Windows)/ symlink(POSIX),指向當前版本
//   .pending                 # 純文字檔,內容 = 目標版本 tag。next `vbpl server start` 偵測後 swap
//
// 邏輯:
// - update flow:download → 解壓到 versions/v0.1.NEW/ → bun install → writePending(tag) → backend exit
// - vbpl server start:readPending 有值 → swapCurrentTo(tag) → clearPending → spawn from current/
// - swap 發生時 current/ 內**沒人在跑**,完全避開 Windows cwd lock / rmrf 自殺等雷
//
// 不踩的雷(歷史教訓 / 設計信條):
// - swap = symlinkSync atomic 級別(POSIX 原子,Windows junction 是 reparse-point,
//   現有 file handle 不受影響,但新 cwd resolves 到新 target)
// - .pending 是純文字 single line tag,不是 JSON(避免 parse 失敗失語)
// - migrate legacy `app/` 不在本 module(刻意:install.ps1 / install.sh 自己處理,
//   backend 內不該動 install layout 結構,避 backend 跑著時誤動 user 檔)
//
// Module 給 updater.ts(寫 .pending)+ cli/commands/server.ts(讀 + swap)+ install.ps1 (?
// install scripts 是 PowerShell / bash 不能 import 本檔,自己實作但要對齊本檔語意)

import { existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { vibeHome } from "./paths";

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function versionsDir(): string {
  return join(vpRoot(), "versions");
}

export function versionDir(tag: string): string {
  return join(versionsDir(), tag);
}

// Updater 解壓 + bun install 寫到 staging dir(versions/<tag>.staging/),
// 不直接覆寫 versions/<tag>/(可能正是 current → backend cwd,撞 EBUSY)。
// swap 時 vbpl server start 才把 staging rename 成 final。tag sanitize 同 versionDir。
export function versionStagingDir(tag: string): string {
  return join(versionsDir(), `${tag}.staging`);
}

export function currentLink(): string {
  return join(vpRoot(), "current");
}

export function pendingPath(): string {
  return join(vpRoot(), ".pending");
}

// 讀 .pending 內容(去頭尾空白)。沒檔 / 空檔 / 讀失敗 → null。
export function readPending(): string | null {
  if (!existsSync(pendingPath())) return null;
  try {
    const tag = readFileSync(pendingPath(), "utf8").trim();
    return tag.length > 0 ? tag : null;
  } catch {
    return null;
  }
}

export function writePending(tag: string): void {
  writeFileSync(pendingPath(), tag, "utf8");
}

export function clearPending(): void {
  if (!existsSync(pendingPath())) return;
  try {
    rmSync(pendingPath(), { force: true });
  } catch {
    // ignore
  }
}

// Promote staging → final version dir(`versions/<tag>.staging/` → `versions/<tag>/`)。
// 若 final 已存在 → rmrf(此時 backend 已 exit,current/ junction 沒 process 在用,可安全刪)。
// staging 不存在 → no-op(updater 已 promote 過 / 沒 update)。
// 失敗 throw。
export function promoteStagingIfAny(tag: string): boolean {
  const staging = versionStagingDir(tag);
  if (!existsSync(staging)) return false;
  const final = versionDir(tag);
  if (existsSync(final)) {
    rmSync(final, { recursive: true, force: true });
  }
  renameSync(staging, final);
  return true;
}

// Swap `current` → `versions/<tag>/`。先確保 staging promoted。
// Windows 用 `junction`(directory junction,不需 admin / dev mode);POSIX 用 `dir` symlink。
// 既有 link 先 rmrf 掉(只刪 link 本身,不會跟到 target — junction / symlink 都 OK)。
// target 不存在(promote 也沒救)→ throw。
export function swapCurrentTo(tag: string): void {
  promoteStagingIfAny(tag);
  const target = versionDir(tag);
  if (!existsSync(target)) {
    throw new Error(`version dir not found: ${target}`);
  }
  const link = currentLink();
  if (existsSync(link)) {
    // lstat 不 follow symlink,確認 link 本身存在類型
    const st = lstatSync(link);
    if (st.isSymbolicLink()) {
      rmSync(link, { force: true });
    } else if (st.isDirectory()) {
      // Windows junction 在 lstat 報 Directory;rmSync recursive 對 junction 只移 link 不刪 target
      rmSync(link, { recursive: true, force: true });
    } else {
      throw new Error(`current 不是 junction / symlink / dir,無法 swap:${link}`);
    }
  }
  symlinkSync(target, link, platform() === "win32" ? "junction" : "dir");
}
