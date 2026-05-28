// pipeline.json CRUD + race-safe mutate helper。
// 寫入時若 state 變動 → 自動 appendStateChange 到 audit log。

import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { atomicWriteJson } from "../io/atomicWrite";
import { exists as worktreeExists } from "../io/git/worktree";
import { appendStateChange } from "../auditLog";
import * as projectDir from "./projectDir";
import type { Pipeline } from "../../../shared/types";

const SLUG_CHARS = /[^a-z0-9-_]+/g;

export function generatePipelineId(name: string): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const slug = name.toLowerCase().replace(SLUG_CHARS, "-").replace(/^-+|-+$/g, "") || "pipeline";
  return `${ts}-${slug}`;
}

export function pipelineFile(projectPath: string, id: string): string {
  return join(projectDir.rootPath(projectPath), "pipelines", `${id}.json`);
}

export async function listPipelines(projectPath: string): Promise<unknown[]> {
  const dir = join(projectDir.rootPath(projectPath), "pipelines");
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(await Bun.file(join(dir, f)).text()) as Record<string, unknown>;
      // backfill createdAt:既有 pipeline 沒此欄位 → 用 id 內嵌的 hex timestamp(generatePipelineId 格式)
      if (typeof obj.createdAt !== "number") {
        const idStr = typeof obj.id === "string" ? obj.id : "";
        const tsHex = idStr.split("-")[0];
        const ts = tsHex && /^[0-9a-f]+$/i.test(tsHex) ? parseInt(tsHex, 16) : 0;
        obj.createdAt = Number.isFinite(ts) ? ts : 0;
      }
      // hasWorktree:fs 真實狀態,讓 UI 不靠 state heuristic 判斷「開啟 worktree」可不可點。
      // 涵蓋 merged 自動 cleanup、外部手動 rm、cleanup-merged bulk sweep 等 state 跟 fs 不一致情境。
      if (typeof obj.id === "string") {
        obj.hasWorktree = worktreeExists(projectPath, obj.id);
      }
      out.push(obj);
    } catch {}
  }
  // 倒序排,UI 最新建的在最上面;舊資料 backfill 後也走同邏輯
  out.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
  return out;
}

export async function readPipeline(projectPath: string, id: string): Promise<unknown | null> {
  const file = pipelineFile(projectPath, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await Bun.file(file).text());
  } catch {
    return null;
  }
}

// writePipeline 多 optional `opts`:
//   - source:audit log 內記「誰寫的」,沒傳 → 'unknown'。
//   - sourceDetail:同上,附帶上下文。
//   - prevStateHint:caller(mutatePipeline / 已讀過 disk 的 caller)把舊 state 傳進來,
//                   避免再讀一次。沒傳就自己讀 disk 拿舊 state。
// 寫入後若 prev.state !== next.state → appendStateChange。
export async function writePipeline(
  projectPath: string,
  id: string,
  data: unknown,
  opts?: { source?: string; sourceDetail?: string; prevStateHint?: string },
): Promise<void> {
  let prevState: string | undefined = opts?.prevStateHint;
  if (prevState === undefined) {
    try {
      const before = (await readPipeline(projectPath, id)) as { state?: unknown } | null;
      prevState = typeof before?.state === "string" ? before.state : undefined;
    } catch {
      prevState = undefined;
    }
  }
  const file = pipelineFile(projectPath, id);
  // defensive: 若 caller 跳過 init / writeConfig 走野生路徑(理論上不該,但歷史踩過),
  // 確保 pipelines/ 存在再寫,避免 writeFile ENOENT。
  mkdirSync(dirname(file), { recursive: true });
  await atomicWriteJson(file, data);
  const nextStateRaw = (data as { state?: unknown } | null)?.state;
  const nextState = typeof nextStateRaw === "string" ? nextStateRaw : undefined;
  if (prevState !== nextState && (prevState !== undefined || nextState !== undefined)) {
    appendStateChange({
      projectPath,
      pipelineId: id,
      from: prevState ?? "(none)",
      to: nextState ?? "(none)",
      source: opts?.source ?? "unknown",
      sourceDetail: opts?.sourceDetail,
    });
  }
}

// pipeline.json read-modify-write 的 race-safe helper:read → 同步 mutator → write,
// **中間零 await**。pipeline.json 是 user PUT + runner / route handler 多處同時寫的共享狀態,
// 任何「讀 snapshot → await 慢操作 → 寫回 snapshot」pattern 都會吃掉中間 user 改的欄位。
//
// 紀律:
//   - mutator 必須宣告 sync ((p: Pipeline) => Pipeline),不接受 async / Promise。
//   - 任何慢操作(git / spawn / fetch / 其他 fs)寫在 helper **外面**,callsite 自己處理。
//   - mutator 內只做純資料轉換(set status / push ticket / 改 iter 計數等)。
//
// 為何不接受 async mutator:async function 即便 body 沒 await,return type 仍是 Promise,
// 強制 await 等於恢復 race window。寫死 sync 簽名是讓「中間插 await」變成型別錯誤,
// 後人改錯時 tsc 就會擋下(防呆 by type system)。
export async function mutatePipeline(
  projectPath: string,
  id: string,
  mutator: (p: Pipeline) => Pipeline,
  opts?: { source?: string; sourceDetail?: string },
): Promise<Pipeline> {
  const cur = (await readPipeline(projectPath, id)) as Pipeline | null;
  if (!cur) throw new Error("Pipeline not found: " + id);
  const prevState = typeof (cur as { state?: unknown }).state === "string"
    ? ((cur as { state: string }).state)
    : undefined;
  const next = mutator(cur);
  await writePipeline(projectPath, id, next, {
    source: opts?.source,
    sourceDetail: opts?.sourceDetail,
    prevStateHint: prevState,
  });
  return next;
}

// 刪 pipeline.json(worktree 不動,user 想清自己去)
export function deletePipeline(projectPath: string, id: string): boolean {
  const file = pipelineFile(projectPath, id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}
