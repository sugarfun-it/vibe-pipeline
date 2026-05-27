// Sync 流程的 state machine。
// idle      → 沒在 sync(等同 syncJob undefined)
// merging   → 純 git merge 進行中(<1s,user 看不太到)
// conflict_await → git merge 失敗,有衝突;等 user 決定要不要 AI 解
// ai_running    → 衝突,user 確認讓 AI 解,正在跑
// failed    → 失敗(merge / AI 都可能進此狀態)。worktree 已 git merge --abort,可重試
// done      → 成功(畫面短暫顯示後回 idle)
export type SyncJobState =
  | "merging"
  | "conflict_await"
  | "ai_running"
  | "failed"
  | "done";

export type SyncJob = {
  state: SyncJobState;
  startedAt: number;
  endedAt?: number;
  // 啟動時 worktree 落後 base 幾個 commit
  behindCount: number;
  // conflict_await / failed 時填:衝突檔案列表(相對 worktree path)
  conflictFiles?: string[];
  // ai_running 階段:spawn 出去的 child PID(server 重啟 / watchdog 用)
  aiPid?: number;
  // ai_running:live log 最後一行(像 ticket.liveLog)
  liveLog?: string;
  // failed 時填:失敗原因
  reason?: string;
  // done 時填:merge commit hash
  mergeCommit?: { hash: string; subject: string; ts: number };
};
