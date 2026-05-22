import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureRuntime } from "../pipelineDir";
import { atomicWriteJson } from "../atomicWrite";
import type { QAReply, Draft, PartialSpec } from "../../../shared/types";

// 高水位 merge:新值有實質內容才覆蓋,否則保留 prev。
// 防 AI 漏寫某欄位讓既有值掉光。
function mergeSpec(prev: PartialSpec | null, next: PartialSpec | null | undefined): PartialSpec | null {
  if (!next) return prev;
  if (!prev) return next;
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    merged[k] = v;
  }
  return merged as PartialSpec;
}

// 5 canonical 欄位是否齊
function specAllFieldsValid(s: PartialSpec | null): boolean {
  if (!s) return false;
  return (
    typeof s.title === "string" && s.title.length > 0 &&
    typeof s.goal === "string" && s.goal.length > 0 &&
    Array.isArray(s.acceptance) && s.acceptance.length > 0 &&
    typeof s.prompt === "string" && s.prompt.length > 0 &&
    (s.mode === "step" || s.mode === "iter")
  );
}

export type { Draft, Turn } from "../../../shared/types";

function dir(projectPath: string): string {
  return ensureRuntime(projectPath, "qa-drafts");
}

function file(projectPath: string, draftId: string): string {
  return join(dir(projectPath), `${draftId}.json`);
}

export async function listDrafts(projectPath: string): Promise<Draft[]> {
  const d = dir(projectPath);
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
    return [];
  }
  const files = readdirSync(d).filter((f) => f.endsWith(".json"));
  const out: Draft[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await Bun.file(join(d, f)).text()));
    } catch {}
  }
  return out;
}

export async function findActiveByPipeline(
  projectPath: string,
  pipelineId: string
): Promise<Draft | null> {
  const all = await listDrafts(projectPath);
  return all.find((d) => d.pipelineId === pipelineId) ?? null;
}

export async function readDraft(projectPath: string, draftId: string): Promise<Draft | null> {
  const f = file(projectPath, draftId);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(await Bun.file(f).text());
  } catch {
    return null;
  }
}

export async function createDraft(
  projectPath: string,
  pipelineId: string,
  pipelineContext?: string
): Promise<Draft> {
  const draftId = randomUUID().replace(/-/g, "").slice(0, 16);
  const sessionId = randomUUID();
  const now = Date.now();
  const draft: Draft = {
    draftId,
    pipelineId,
    sessionId,
    sessionStarted: false,
    complete: false,
    createdAt: now,
    updatedAt: now,
    turns: [],
    spec: null,
    pipelineContext,
  };
  await atomicWriteJson(file(projectPath, draftId), draft);
  return draft;
}

// 只 append user message 到 disk(claude 尚未跑完前的中繼狀態)。
// 給 turn handler 在送 claude 前先寫,避免「user 送完 → 關 drawer → 接續看不到剛送的訊息」。
export async function appendUserMessage(
  projectPath: string,
  draftId: string,
  userMessage: string
): Promise<Draft> {
  const d = await readDraft(projectPath, draftId);
  if (!d) throw new Error("draft_not_found");
  const now = Date.now();
  d.turns.push({ role: "user", message: userMessage, ts: now });
  d.updatedAt = now;
  await atomicWriteJson(file(projectPath, draftId), d);
  return d;
}

export async function appendTurn(
  projectPath: string,
  draftId: string,
  userMessage: string | null,
  reply: QAReply
): Promise<Draft> {
  const d = await readDraft(projectPath, draftId);
  if (!d) throw new Error("draft_not_found");
  const now = Date.now();
  if (userMessage !== null) {
    d.turns.push({ role: "user", message: userMessage, ts: now });
  }
  d.turns.push({
    role: "ai",
    message: reply.message,
    options: reply.options,
    optionsMode: reply.optionsMode ?? "single",
    ts: now,
  });
  // 高水位 merge:不讓 AI 因為這輪沒寫某欄位就讓既有值掉光。
  d.spec = mergeSpec(d.spec, reply.spec ?? null);
  // Auto-complete:5 欄位齊就 force complete=true,當 AI 漏記時的安全網。
  // 但 reopen 場景(前一輪 complete=true、user 退回 chat 又送訊息)需要尊重 AI 的 complete=false,
  // 否則 user 一送訊息就被搶回最終預覽,卡在 loop。判斷:wasComplete=true 且 AI 明確回 false → 信 AI。
  // (AI 常多問一輪「確認送出?」,frontend SpecReview 才是真正的 user confirm step。)
  const wasComplete = d.complete;
  d.complete =
    reply.complete === true ||
    (!wasComplete && reply.complete !== false && specAllFieldsValid(d.spec));
  // splitInto: 只在 complete=true 那輪採信 AI 提案(coerceSpec 已過 length>=2 + 每元素 complete 驗)
  // 之後 turn 若 AI 又出 splitInto 也採新值;沒出就維持上一輪結果
  if (d.complete && Array.isArray(reply.splitInto) && reply.splitInto.length >= 2) {
    d.splitInto = reply.splitInto;
  }
  d.updatedAt = now;
  await atomicWriteJson(file(projectPath, draftId), d);
  return d;
}

export async function markStarted(projectPath: string, draftId: string): Promise<void> {
  const d = await readDraft(projectPath, draftId);
  if (!d) return;
  d.sessionStarted = true;
  d.updatedAt = Date.now();
  await atomicWriteJson(file(projectPath, draftId), d);
}

export async function deleteDraft(projectPath: string, draftId: string): Promise<void> {
  const f = file(projectPath, draftId);
  if (existsSync(f)) unlinkSync(f);
}
