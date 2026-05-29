import type { JSX } from "react";

// 失敗原因常是整段 JSON(claude CLI / codex / api error response 原樣 dump),直接渲染撐爆 row。
// 是 JSON 就 parse 抽 message/error/code/api_error_status 等可讀欄位;非 JSON 用 raw。最後 truncate 到 120 字。
export function formatFailureReason(raw: string): string {
  const trimmed = raw.trim();
  let display = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const message =
        (typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.error?.message === "string" && parsed.error.message) ||
        (typeof parsed.code === "string" && parsed.code) ||
        (typeof parsed.api_error_status === "number" && `API ${parsed.api_error_status}`) ||
        (typeof parsed.subtype === "string" && parsed.subtype) ||
        "";
      if (message) display = message;
    } catch {
      // parse 失敗保留 raw
    }
  }
  return display.length > 120 ? `${display.slice(0, 120)}…` : display;
}

// RH-013 / RH-017:result 字串裡 runner 常 dump 「state=ready」「state=running」「draft→done」之類 raw token,
// 對 user(非 dev)讀起來像漏字。對已知值做 zh-TW 替換,raw 保留在 title 給 dev / debug。
// 邊界:只動已知 enum (ready / running / paused / done / merged / failed / merge_failed),
//      未知 state 保留原樣不亂譯。draft / done / split / pending 等 ticket status 同理。
export const STATE_LABELS: Record<string, string> = {
  ready: "可合併",
  running: "執行中",
  paused: "已暫停",
  done: "完成",
  merged: "已合併",
  failed: "失敗",
  merge_failed: "合併失敗",
};
export const TICKET_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  done: "完成",
  split: "已拆分",
  pending: "待處理",
};
// hist-014:result 完整版渲染 — 把 `key=value` / `key.field=value` token 用 <code> 包,
// 半形逗號後補空格、半形句點接續用全形句點觀感較統一,但保留 `key=value` 內部不動。
// 「3 個 ticket 全 PASS、3 commit。pipeline.state=ready,可 merge。」
//   → 「3 個 ticket 全數通過,3 個 commit。pipeline.state=ready,可合併。」
export function renderResult(raw: string): JSX.Element {
  // i18n 替換(全 PASS / commit 量詞 / 可 merge / pipeline.狀態 / state= / ticket draft→done /
  //   中文標點與中英 spacing)全收斂在 localizeResult 一處,renderResult 不再重跑同一批 replace。
  //   token <code> wrap 在 localize 之後跑,輸入字串與舊版一致(localize 不產生新的 key=value token)。
  const s = localizeResult(raw);
  // 把 `key=value` 或 `key.field=value` 包 <code>(保 mono 樣式)
  const parts: Array<string | JSX.Element> = [];
  const re = /([a-z_][a-z0-9_.]*=[a-z0-9_\-]+)/gi;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index));
    parts.push(<code key={`c${key++}`}>{m[0]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) parts.push(s.slice(lastIndex));
  return <>{parts.length > 0 ? parts : s}</>;
}

export function localizeResult(raw: string): string {
  let s = raw;
  // HIST-RUN-003 round 1 (2026-05-25):collapsed 卡片直接用 localizeResult,
  //   把 i18n 替換邏輯(全 PASS、commit、可 merge、pipeline.狀態)都搬到這層,
  //   不再只在 expanded renderResult() 才有,確保 head 顯示就是中文。
  s = s.replace(/全\s*PASS/gi, "全數通過");
  s = s.replace(/(\d+)\s*commit(?![=:\-])/gi, "$1 個 commit");
  s = s.replace(/可\s*merge/gi, "可合併");
  s = s.replace(/,(?=\S)/g, ", ");
  // state=ready → 狀態:可合併 — 先做這條,下一條才能 catch 「pipeline.狀態」
  s = s.replace(/state=([a-z_]+)/gi, (_, k: string) => {
    const lc = k.toLowerCase();
    return STATE_LABELS[lc] != null ? `狀態:${STATE_LABELS[lc]}` : `state=${k}`;
  });
  // pipeline.狀態 → pipeline 狀態(state= 替換完才會看到「pipeline.狀態」);避免中文裡夾半形句點
  s = s.replace(/pipeline\.狀態/g, "pipeline 狀態");
  // HD-RUN-EXP-003 / 007 round 1 (2026-05-25):
  //   raw 常見「state=ready, 可 merge」這種 runner 自然語句,被 localize 後變
  //   「狀態:可合併, 可合併」(同 token 連續出現兩次)。最後 pass 一次去重 +
  //   半形逗號補空格(英文 commit/ticket 與中文交界處 spacing)。
  s = s.replace(/(可合併)\s*[,，、]\s*可合併/g, "$1");
  s = s.replace(/, (?=[一-鿿])/g, ",");
  s = s.replace(/, (?=[一-鿿])/g, ","); // 兩次保險,連續 case
  // 中文後緊接英文 token 補一個半形空格(中英排版常規:「全數通過 3」→「全數通過 3」、「3 commit」→「3 commit」)
  s = s.replace(/([一-鿿])(\d|[A-Za-z])/g, "$1 $2");
  s = s.replace(/(\d|[A-Za-z])([一-鿿])/g, "$1 $2");
  // draft→done → 草稿→完成(全形 → 也支援)
  s = s.replace(/([a-z_]+)\s*(?:→|->)\s*([a-z_]+)/gi, (m, fromK: string, toK: string) => {
    const f = fromK.toLowerCase();
    const t = toK.toLowerCase();
    const from = TICKET_STATUS_LABELS[f];
    const to = TICKET_STATUS_LABELS[t];
    return from != null && to != null ? `${from}→${to}` : m;
  });
  return s;
}
