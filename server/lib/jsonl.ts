// JSONL 共用 read/write helper。
//
// 用途:集中 line-by-line parse / append 的樣板(existsSync → readFile → split → JSON.parse,
// 壞行 silently skip;append 前 ensure parent dir)。
//
// 注意:
// - 採 sync fs API。caller(auditLog / notifs store)對外都是 sync,helper 跟著 sync 才不會
//   level 改 wrapper 簽名 → 牽動全 codebase caller(routes / cli)
// - 壞行(JSON.parse 失敗)安靜跳過,不擋整檔讀取
// - 檔不存在回 [];讀檔 IO 失敗也回 []
// - appendJsonl 自動 mkdir -p parent
// - typed wrapper 對 entry 的進一步 filter / transform 仍由 caller 負責

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // 壞行跳過
    }
  }
  return out;
}

export function appendJsonl<T>(path: string, entry: T): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}
