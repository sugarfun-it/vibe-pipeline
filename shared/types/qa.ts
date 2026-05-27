// ─── QA / Ticket spec ─────────────────────────────────────────────
// mode: "step" = 單次任務(跑一次就收) / "iter" = 迭代任務(執行AI ↔ 審核AI 來回到通過)
export type TicketSpec = {
  title: string;
  goal: string;
  acceptance: string[];
  prompt: string;
  mode: "step" | "iter";
  iterLimit?: number; // iter 模式上限輪數,預設 5
  iterStopAtLimit?: boolean; // 達上限是否整條 pause(true),否則標 ticket failed 跳下一張(false),預設 true
};

export const DEFAULT_ITER_LIMIT = 5;
export const DEFAULT_ITER_STOP_AT_LIMIT = true;
export const MODE_LABELS: Record<TicketSpec["mode"] | "merge" | "sync", string> = {
  iter: "迭代任務",
  step: "單次任務",
  merge: "AI 合併",
  sync: "AI 同步",
};

export type PartialSpec = Partial<TicketSpec>;

export type QAReply = {
  message: string;
  options: string[];
  optionsMode?: "single" | "multi";
  complete: boolean;
  spec: PartialSpec | null;
  // 選填:complete=true 時若 AI 判斷範圍橫跨多件獨立 ticket → 填 N 個完整 spec。
  // 用於零延遲 split(取代後跑的 splitTicketSpec call)。length < 2 等同沒拆建議,前端忽略
  splitInto?: TicketSpec[];
};

export type Turn = {
  role: "user" | "ai";
  message: string;
  options?: string[];
  optionsMode?: "single" | "multi";
  ts: number;
};

export type Draft = {
  draftId: string;
  pipelineId: string;
  sessionId: string;
  sessionStarted: boolean;
  complete: boolean;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  spec: PartialSpec | null;
  // QA 開始時 snapshot 的 pipeline 內既有 ticket 摘要,供 AI 引導時避免重複定義。
  // 不在後續 turn 重抓 — 一條 draft 整段對話用同一份上下文,避免 AI 看到漂移。
  pipelineContext?: string;
  // QA AI 在 complete=true 那輪若認為範圍橫跨多件 → 提供 N 個完整 spec。
  // 替代後跑 splitTicketSpec(零額外 latency)。frontend 在 finalize 前讓 user 選拆/不拆
  splitInto?: TicketSpec[];
};

export function isCompleteSpec(s: unknown): s is TicketSpec {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.title === "string" &&
    o.title.length > 0 &&
    typeof o.goal === "string" &&
    o.goal.length > 0 &&
    Array.isArray(o.acceptance) &&
    o.acceptance.length > 0 &&
    o.acceptance.every((x) => typeof x === "string") &&
    typeof o.prompt === "string" &&
    o.prompt.length > 0 &&
    (o.mode === "step" || o.mode === "iter")
  );
}

