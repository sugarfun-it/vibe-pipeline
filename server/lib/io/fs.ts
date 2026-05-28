import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

// 純 fs 檢查 helper:確認路徑存在且為目錄。給 routes 在做 input validation 時呼叫。
export function isExistingDirectory(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  const abs = resolve(p);
  if (!existsSync(abs)) return false;
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
