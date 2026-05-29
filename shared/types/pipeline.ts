import type { Ticket, CommitRef } from './ticket';
import type { SyncJob } from './sync';

type CurrentPipelineState =
  | "planning"
  | "running"
  | "queued"
  | "paused"
  | "ready"
  | "failed"
  | "merged";

type LegacyPausePendingState = "stop\u0070ing";
export type PipelineState = CurrentPipelineState;

export type Pipeline = {
  id: string;
  name: string;
  branch: string;
  state: PipelineState | LegacyPausePendingState;
  tickets: Ticket[];
  baseBranch?: string;
  // 建立時間 unix ms。2026-05-13 加,既有 pipeline.json 沒此欄位 → listPipelines 讀檔時
  // 用 id 內嵌的 hex timestamp backfill。排序 UI 都以這欄位為準(避免手 craft id 排錯)
  createdAt?: number;
  mergedAt?: number;
  mergeCommit?: CommitRef;
  // Pipeline ready 後是否自動觸發 AI 合併。建 pipeline 時若 body 未指定就讀 project config defaults.auto_merge
  autoMerge?: boolean;
  // 上一次自動 merge 嘗試失敗的訊息(preflight 失敗 / runner FAIL 都可寫)。重觸發時清掉
  lastAutoMergeError?: string;
  // Sync 狀態(把 base merge 進 worktree)。不在 tickets[] 內,純 pipeline-level state。
  // 不存在或 state="idle" → 沒在 sync。其他狀態 → UI 顯示對應提示 + 鎖定操作
  syncJob?: SyncJob;
  // listPipelines 時 backend 用 existsSync 算出來;UI 用來判「開啟 worktree」可不可點。
  // 非持久化欄位 — 不寫回 pipeline.json,只在 list response 出現。
  hasWorktree?: boolean;
};
