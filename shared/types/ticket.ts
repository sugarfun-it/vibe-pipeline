// ─── Pipeline / Ticket(持久化於 .vibe-pipeline/pipelines/<id>.json) ───
// "merge" / "sync" 是 synthetic ticket(/merge / /sync endpoint append),不在 QA / TicketSpec 列表
export type TicketMode = "step" | "iter" | "merge" | "sync";

export type TicketStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "failed_iter_limit"
  | "failed_transient";

// 1/0/-1 是舊 prototype mock 格式;runner 寫回是字串 "PASS"/"FAIL"/"PARTIAL"
export type Verdict = 1 | 0 | -1 | "PASS" | "FAIL" | "PARTIAL";

// 一輪 iter 的紀錄。runner 主 agent 在每輪審核完寫進 ticket.iter.rounds[]。
export type IterRound = {
  n: number;                  // 第幾輪 (1-based)
  startedAt: number;          // 執行AI 派出當下,unix ms
  endedAt?: number;           // 審核完當下
  executorSummary?: string;   // 主 agent 拿到 sub-agent 結果後的簡述(<=300 字)
  criticVerdict: "PASS" | "FAIL" | "PARTIAL";
  criticFeedback?: string;    // 審核AI 給的 feedback(下一輪 prompt 用)
};

// iter 階段(UI 用;persistent JSON 寫 "doer"/"critic"/"done" 等)
export type IterStage = "doer" | "critic" | "✓" | "done";

// 持久化的 iter 狀態(寫進 ticket.iter)。
// totalElapsed 不在實際 JSON,前端 FocusColumn 依 rounds[] 推算後可選擇掛上來;
// 保留 optional 欄位讓 UI 與型別都不用走 cast。
export type IterState = {
  current: number;
  stage: IterStage;
  verdicts: Verdict[];
  rounds?: IterRound[];
  totalElapsed?: number;
};

// ticket 完成後 runner commit 的紀錄
export type CommitRef = {
  hash: string;       // git rev-parse HEAD 抓的完整 hash
  subject: string;    // commit message 第一行
  ts: number;         // commit 時間 unix ms
};

export type Ticket = {
  id: string;
  n: number;
  title: string;
  goal?: string;
  acceptance?: string[];
  prompt?: string;
  mode: TicketMode;
  status: TicketStatus;
  iterLimit?: number;
  iterStopAtLimit?: boolean;
  // step / iter 共用:runner 寫 unix ms,給 UI 算 elapsed 用
  startedAt?: number;
  endedAt?: number;
  meta?: string;
  iter?: IterState;
  liveLog?: string;
  reason?: string;
  commits?: CommitRef[];
};
