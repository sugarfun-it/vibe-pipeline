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

export type AtomicWriteOpts = {
  chmod?: number;
};

async function renameWithWindowsRetry(tmp: string, path: string): Promise<void> {
  const delays = process.platform === "win32" ? [0, 20, 50, 100, 200] : [0];
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
