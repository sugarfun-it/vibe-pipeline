import type { Provider } from './user';

// ─── Run log(.runtime/logs/<pipelineId>-<ts>.log 解析結果) ───
export type RunSummary = {
  filename: string;       // <pipelineId>-<ts>.log
  logPath: string;        // absolute path to runtime log file
  startedAt: number;      // 從 filename 拆 ts
  exitCode: number | null;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  result: string | null;  // claude CLI "result" 欄位 (主 agent 最終訊息)
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
    reasoning?: number;
  } | null;
  sessionId: string | null;
  hasStderr: boolean;
  provider: Provider | null;
  model: string | null;
  // 失敗原因(最後一條 error / turn.failed message,<=200 字)
  failureReason: string | null;
  // ticket 狀態 snapshot:orchestrator spawn 前 / exit 後寫進 log 的 --- meta --- block
  // RunHistory 比對顯示「t1: ready→done」等差異(沒變的 ticket 不顯)
  ticketsBefore: RunTicketSnapshot[] | null;
  ticketsAfter: RunTicketSnapshot[] | null;
};

export type RunTicketSnapshot = {
  id: string;
  status: string;
};

export type RunDetail = RunSummary & {
  stdout: string;
  stderr: string;
};

// ─── Audit timeline(.runtime/audit.jsonl 的 state_change 行) ───
// 單一定義源:後端 auditLog 寫 / 讀、前端 api/run.ts 讀同 import 本檔,不各自複製漂走。
export type StateChangeEntry = {
  ts: number;
  pipelineId: string;
  type: "state_change";
  from: string;
  to: string;
  source: string;
  sourceDetail?: string;
};

