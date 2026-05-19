import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureRuntime } from "../pipelineDir";
import { readJsonl, appendJsonl } from "../jsonl";
import type { NotifEventType, NotifRecord, NotifSeverity } from "../../../shared/types";
export type { NotifRecord };

function file(projectPath: string): string {
  return join(ensureRuntime(projectPath), "notifs.jsonl");
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emit(
  projectPath: string,
  params: {
    type: NotifEventType;
    title: string;
    sub?: string;
    pipelineId?: string;
    sev?: NotifSeverity;
  }
): NotifRecord {
  const r: NotifRecord = {
    id: genId(),
    type: params.type,
    title: params.title,
    sub: params.sub,
    ts: Date.now(),
    unread: true,
    pipelineId: params.pipelineId,
    sev: params.sev,
  };
  appendJsonl(file(projectPath), r);
  return r;
}

export function list(projectPath: string, limit = 200): NotifRecord[] {
  const all = readJsonl<NotifRecord>(file(projectPath));
  return all.slice(-limit).reverse();
}

function rewrite(projectPath: string, fn: (r: NotifRecord) => NotifRecord | null): void {
  const f = file(projectPath);
  if (!existsSync(f)) return;
  const lines = readFileSync(f, "utf8").split("\n").filter((l) => l.trim());
  const out: string[] = [];
  for (const line of lines) {
    try {
      const r: NotifRecord = JSON.parse(line);
      const next = fn(r);
      if (next) out.push(JSON.stringify(next));
    } catch {
      out.push(line);
    }
  }
  writeFileSync(f, out.join("\n") + (out.length ? "\n" : ""));
}

export function markRead(projectPath: string, id: string): void {
  rewrite(projectPath, (r) => (r.id === id ? { ...r, unread: false } : r));
}

export function markAllRead(projectPath: string): void {
  rewrite(projectPath, (r) => ({ ...r, unread: false }));
}

export function dismiss(projectPath: string, id: string): void {
  rewrite(projectPath, (r) => (r.id === id ? null : r));
}

// 砍光 notifs.jsonl(user 主動「全部清除」用)。
// 跟 pruneOldRecords 不同:這個無條件清空,不保留任何紀錄
export function dismissAll(projectPath: string): void {
  const f = file(projectPath);
  if (!existsSync(f)) return;
  try {
    writeFileSync(f, "");
  } catch {
    // 失敗安靜忽略
  }
}

// 全 project notifs 保留最新 keep 筆(unread / read 不分,純按時序)。
// JSONL 是 append-only,GC 等於一次性 rewrite。
// 失敗 (檔不存在 / parse 壞) 安靜忽略。
export function pruneOldRecords(projectPath: string, keep = 500): number {
  const f = file(projectPath);
  if (!existsSync(f)) return 0;
  let lines: string[];
  try {
    lines = readFileSync(f, "utf8").split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return 0;
  }
  if (lines.length <= keep) return 0;
  const kept = lines.slice(-keep);
  try {
    writeFileSync(f, kept.join("\n") + "\n");
    return lines.length - keep;
  } catch {
    return 0;
  }
}
