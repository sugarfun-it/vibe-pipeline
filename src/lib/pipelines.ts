// pipeline / ticket 狀態的 UI 對應(顏色 / 文字 / 時間格式)。
// 之前還有 PIPELINES / PROJECTS mock seed,phase 3 後 prototype 路由全砍掉,
// 不再 import seed,只剩這三個 helper。

export const STATE_COLOR: Record<string, string> = {
  // pipeline states
  paused: "var(--paused)",
  running: "var(--running)",
  queued: "var(--queued)",
  ready: "var(--done)",
  planning: "var(--draft)",
  failed: "var(--failed)",
  merged: "var(--fg-faint)",
  // ticket statuses
  done: "var(--done)",
  draft: "var(--draft)",
  failed_iter_limit: "var(--failed)",
  failed_transient: "var(--failed)",
};

// 純 pipeline.state 用。注意 ticket 不要用這個 — ready 在 pipeline 是「可合併」,
// 在 ticket 是「待跑」,語意衝突。ticket 走下面 TICKET_STATUS_LABEL。
export const STATE_LABEL: Record<string, string> = {
  paused: "暫停",
  running: "執行中",
  queued: "排隊中",
  ready: "可合併",
  planning: "規劃中",
  failed: "失敗",
  merged: "已合併",
};

// ticket.status 用。跟 STATE_LABEL 故意分兩個 map 避開 ready 字面相同語意不同的 bug。
// draft 跟 ready 視為同一類「未執行」(2026-05-16 合併;runner 本來就不區分,UI 也統一)。
export const TICKET_STATUS_LABEL: Record<string, string> = {
  draft: "未執行",
  ready: "未執行",
  running: "執行中",
  paused: "暫停",
  done: "完成",
  failed: "失敗",
  failed_iter_limit: "達 iter 上限",
  failed_transient: "暫時錯誤",
};

// ticket.status 顏色。注意 ready 用淡色(未執行)— STATE_COLOR.ready 是 pipeline 層 var(--done) 綠,
// 兩層顏色語意不同,跟 LABEL 同樣理由分開。
export const TICKET_STATUS_COLOR: Record<string, string> = {
  draft: "var(--draft)",
  ready: "var(--draft)",
  running: "var(--running)",
  paused: "var(--paused)",
  done: "var(--done)",
  failed: "var(--failed)",
  failed_iter_limit: "var(--failed)",
  failed_transient: "var(--failed)",
};

export function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60),
    sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// 把 runner 寫進 ticket.iter.rounds[].criticVerdict 的 verdict 同義 normalize 成
// PASS / FAIL / PARTIAL / UNKNOWN 四種規範值。runner 歷史上有 string("PASS"/"FAIL"/"PARTIAL")
// 跟 number(1 / -1 / 0)兩種寫法,UI 端統一靠這個 helper 收。
export type NormalizedVerdict = "PASS" | "FAIL" | "PARTIAL" | "UNKNOWN";

export function normalizeVerdict(v: unknown): NormalizedVerdict {
  if (v == null) return "UNKNOWN";
  const k = typeof v === "string" ? v.toUpperCase() : String(v);
  if (k === "PASS" || k === "1") return "PASS";
  if (k === "FAIL" || k === "-1") return "FAIL";
  if (k === "PARTIAL" || k === "0") return "PARTIAL";
  return "UNKNOWN";
}

// ms → 人類可讀短字串:`30s` / `2m 5s` / `1h 12m`(0 秒省略)。
// 給 RunHistory / TicketDrawer iter rounds / FocusColumn last-run chip 共用。
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
