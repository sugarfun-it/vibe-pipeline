// Atomic file write helper:tmp → optional chmod → rename → catch 清 tmp。
// 統一 caller(projectStore / pipelineDir / userConfig / push/gatewayToken)。
//
// 設計:
// - 用 node:fs/promises writeFile + rename(避 Bun.$ mv 在 Windows 慢)
// - tmp 同 dir 命名 `${path}.tmp`,確保 rename 是 atomic(跨 device 才會 fall back to copy)
// - chmod 在 rename 前對 tmp file 套用,final file 一上場就帶權限;Windows NTFS 上 chmod
//   只保留 read-only bit(見 rules/remote-access.md),靜默忽略失敗
// - Windows rename 偶發 EPERM / EBUSY(防毒 / Explorer indexer 撞)→ 重試最多 5 次遞增 backoff
// - 失敗時 best-effort unlink tmp,不掩蓋原 error
// - atomicWriteJson 內部 JSON.stringify(null, 2) + round-trip parse 驗 valid(防超大 number /
//   Date 物件等惡作劇 partial 寫出),附 trailing newline(POSIX 慣例 / git diff 友善)

import { writeFile, rename, chmod, unlink } from "node:fs/promises";
import {
  writeFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
} from "node:fs";

export type AtomicWriteOpts = {
  chmod?: number;
};

// Windows EPERM / EBUSY 來源同 renameWithWindowsRetry,但 caller 是 sync 簽名(notifs store
// 的 rewrite / dismissAll / pruneOldRecords 同步呼)→ 不能 await。用 Atomics.wait 做 sync sleep。
const RETRY_DELAYS = [0, 30, 80, 160, 320, 640, 1200, 2000];
const SYNC_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function syncSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(SYNC_SLEEP_BUF, 0, 0, ms);
}

function renameWithWindowsRetrySync(tmp: string, path: string): void {
  const delays = process.platform === "win32" ? RETRY_DELAYS : [0];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay > 0) syncSleep(delay);
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string }).code;
      if (code !== "EPERM" && code !== "EBUSY") break;
    }
  }
  throw lastErr;
}

async function renameWithWindowsRetry(tmp: string, path: string): Promise<void> {
  // Windows EPERM / EBUSY 來源:防毒 / Explorer indexer / fs.watch reader / Bun.spawn child
  // 持 file handle。舊版 [0,20,50,100,200]ms total 370ms 對重 fs.watch 的 e2e 太短;
  // 拉長到 [0,30,80,160,320,640,1200,2000]ms total ~4.4s,exponential backoff。
  // 仍 EPERM = 真死鎖,讓 caller 處理。
  const delays = process.platform === "win32" ? [0, 30, 80, 160, 320, 640, 1200, 2000] : [0];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await rename(tmp, path);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string }).code;
      if (code !== "EPERM" && code !== "EBUSY") break;
    }
  }
  throw lastErr;
}

export async function atomicWriteText(
  path: string,
  text: string,
  opts?: AtomicWriteOpts,
): Promise<void> {
  const tmp = path + ".tmp";
  await writeFile(tmp, text, "utf8");
  if (typeof opts?.chmod === "number") {
    try {
      await chmod(tmp, opts.chmod);
    } catch {
      // Windows NTFS / 權限不足:silent ignore
    }
  }
  try {
    await renameWithWindowsRetry(tmp, path);
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    throw e;
  }
}

export async function atomicWriteJson(
  path: string,
  data: unknown,
  opts?: AtomicWriteOpts,
): Promise<void> {
  const text = JSON.stringify(data, null, 2) + "\n";
  // round-trip:確認自己生的 JSON 真能 parse 回(防 BigInt / Date 物件等被 stringify 後再讀炸)
  JSON.parse(text);
  await atomicWriteText(path, text, opts);
}

// Sync 版本 — 給對外 sync 簽名的 caller(notifs store)用,語意 / Windows retry 跟 async 版一致。
// 不能改 async 的場景才用這個;新 code 預設用上面的 async 版。
export function atomicWriteTextSync(
  path: string,
  text: string,
  opts?: AtomicWriteOpts,
): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text, "utf8");
  if (typeof opts?.chmod === "number") {
    try {
      chmodSync(tmp, opts.chmod);
    } catch {
      // Windows NTFS / 權限不足:silent ignore
    }
  }
  try {
    renameWithWindowsRetrySync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw e;
  }
}
