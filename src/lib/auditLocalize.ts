// audit.jsonl 的 state / source / sourceDetail 機器代號 → zh-TW user-facing 標籤。
// AuditTimeline(完整 list)與 PipelineHistoryDrawer(top summary)共用同一份 SSOT,
// 避免兩處各自 declare 後漂移(歷史上 PHD 補了 api-create-pipeline,AuditTimeline 沒同步)。
//
// 注意刻意差異(不在本模組統一):
//   - PHD top summary 有 isDebugDetail 過濾 + 未知 source fallback「系統」,
//     AuditTimeline 完整 list 對未知 source/detail 保留 raw enum(給 dev/debug)。
//     fallback 策略屬各 call site,本模組只負責「已知代號 → 中文」的查表。
//   - 本檔 state 標籤一律「已暫停」(audit 完整句子語境);pipeline rail / chip 用
//     src/lib/pipelines.ts 的「暫停」(空間受限的 chip),兩者刻意不同,別合併。

// state enum → zh 標籤。涵蓋 from/to 可能出現的全部 pipeline.state + ticket.status。
export const STATE_LABEL_ZH: Record<string, string> = {
  planning: "規劃中",
  queued: "排隊中",
  running: "執行中",
  paused: "已暫停",
  ready: "可合併",
  failed: "失敗",
  merged: "已合併",
  done: "完成",
  draft: "草稿",
};

// 找不到對應就 fallback 原值(保開發者可讀性)。
export function localizeAuditState(s: string): string {
  return STATE_LABEL_ZH[s.toLowerCase()] ?? s;
}

// 後端 source 機器代號 → 中文。user 不需要懂 runner-self-detected / api-handler-explicit。
export const SOURCE_LABEL_ZH: Record<string, string> = {
  "user-action": "使用者操作",
  "api-handler-explicit": "API 明確指定",
  "api-create-pipeline": "建立 pipeline",
  "runner-self-detected": "Runner 自動偵測",
  "orchestrator.spawnDirect": "Orchestrator 啟動",
  "ticketWatcher-detected": "Ticket Watcher 偵測",
};

// 已知 sourceDetail token → 中文。未知保留 raw 給 dev/debug。
// 完整 enum dictionary 屬 backend / sourceDetail schema 改動,defer。
export const DETAIL_LABEL_ZH: Record<string, string> = {
  "stop button": "停止按鈕",
  resume: "繼續執行",
  iter_stop_at_limit: "已達 iter 上限",
  iter_limit: "已達 iter 上限",
  iter_limit_reached: "已達 iter 上限",
  "pipeline created": "Pipeline 建立",
  "all tickets done": "所有 ticket 完成",
  "click 合併入 main": "點擊「合併入 main」",
  "tickets added (3)": "新增 3 張 ticket",
  "QA draft created": "建立 QA 草稿",
  "QA draft promoted": "QA 草稿轉正",
  "ticket 2 started": "ticket 2 開始執行",
};

export function localizeAuditDetail(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return DETAIL_LABEL_ZH[raw] ?? raw;
}
