// ─── Notification taxonomy ─────────────────────────────────────────
// Schema 先定下,producer / 觸發點等 [P2] runner 落地再寫。
// sev: block 需 user 動作 / info 重要更新 / muted 活動紀錄
// phase: 標示這個事件什麼時候會真的有來源觸發

export type NotifSeverity = "block" | "info" | "muted";
export type NotifPhase = "stub-first" | "P2" | "P3";

export type NotifEventType =
  // stub-first(現在能觸發,但 user 自己剛做完,通常不發)
  | "project_init"
  | "pipeline_created"
  | "pipeline_deleted"
  | "pipeline_renamed"
  | "ticket_added"
  | "ticket_removed"
  | "ticket_status_changed"
  // P2(runner / budget 落地後)
  | "pipeline_started"
  | "pipeline_queued"
  | "pipeline_paused"
  | "ticket_started"
  | "iter_critic_pass"
  | "iter_critic_fail"
  | "ticket_done"
  | "ticket_failed"
  | "pipeline_ready_to_merge"
  | "merge_started"
  | "merge_blocked"
  | "pipeline_auto_merge_started"
  | "pipeline_merged"
  | "pipeline_merge_cleanup_failed"
  | "pipeline_failed"
  | "budget_warn"
  | "budget_hard_cap"
  | "pipeline_blocked_budget"
  | "runner_stall"
  | "runner_crash"
  | "sync_started"
  | "sync_conflict"
  | "sync_succeeded"
  | "sync_failed"
  // P3(SKILL / 跨 pipeline / 排程)
  | "skill_candidate"
  | "cross_pipeline_pattern"
  | "scheduler_fired"
  // Frontend 主動 emit(action toast 同步留 inbox history),sev 由 caller 決定
  | "frontend_action_failed"
  | "frontend_action_warn"
  | "frontend_action_info"
  // System(自動更新等全域系統事件)
  | "system_updating";

export type NotifEventMeta = {
  sev: NotifSeverity;
  phase: NotifPhase;
  label: string;
};

// 持久化的 notif 紀錄(append-only 寫進 .runtime/notifs.jsonl)
// sev 是 optional override — 多數 type 的 sev 來自 NOTIF_EVENTS 字典查詢;
// frontend_action_* 由 caller 動態決定 sev,寫進記錄裡,UI 讀出時優先用 record.sev。
export type NotifRecord = {
  id: string;
  type: NotifEventType;
  title: string;
  sub?: string;
  ts: number;
  unread: boolean;
  pipelineId?: string;
  sev?: NotifSeverity;
};

export const NOTIF_EVENTS: Record<NotifEventType, NotifEventMeta> = {
  project_init: { sev: "muted", phase: "stub-first", label: "Project 初始化完成" },
  pipeline_created: { sev: "muted", phase: "stub-first", label: "Pipeline 建立" },
  pipeline_deleted: { sev: "muted", phase: "stub-first", label: "Pipeline 刪除" },
  pipeline_renamed: { sev: "muted", phase: "stub-first", label: "Pipeline 改名" },
  ticket_added: { sev: "muted", phase: "stub-first", label: "Ticket 加入" },
  ticket_removed: { sev: "muted", phase: "stub-first", label: "Ticket 移除" },
  ticket_status_changed: { sev: "muted", phase: "stub-first", label: "Ticket 狀態變更" },

  pipeline_started: { sev: "muted", phase: "P2", label: "Pipeline 開始運行" },
  pipeline_queued: { sev: "muted", phase: "P2", label: "Pipeline 已排隊" },
  pipeline_paused: { sev: "info", phase: "P2", label: "Pipeline 已暫停" },
  ticket_started: { sev: "muted", phase: "P2", label: "Ticket 開始跑" },
  iter_critic_pass: { sev: "info", phase: "P2", label: "Iteration critic pass" },
  iter_critic_fail: { sev: "muted", phase: "P2", label: "Iteration critic fail(連續 N 次升 block)" },
  ticket_done: { sev: "info", phase: "P2", label: "Ticket done" },
  ticket_failed: { sev: "block", phase: "P2", label: "Ticket failed" },
  pipeline_ready_to_merge: { sev: "info", phase: "P2", label: "Pipeline ready to merge" },
  merge_started: { sev: "muted", phase: "P2", label: "AI 合併開始" },
  merge_blocked: { sev: "block", phase: "P2", label: "AI 合併失敗,需處理" },
  pipeline_auto_merge_started: { sev: "info", phase: "P2", label: "Pipeline 自動合併已觸發" },
  pipeline_merged: { sev: "info", phase: "P2", label: "Pipeline merge 完成" },
  pipeline_merge_cleanup_failed: { sev: "info", phase: "P2", label: "Merge 後 worktree 清理失敗" },
  pipeline_failed: { sev: "block", phase: "P2", label: "Pipeline failed" },
  budget_warn: { sev: "info", phase: "P2", label: "Budget 80% 警告" },
  budget_hard_cap: { sev: "block", phase: "P2", label: "Budget 硬上限" },
  pipeline_blocked_budget: { sev: "block", phase: "P2", label: "Pipeline 被預算上限擋下" },
  runner_stall: { sev: "block", phase: "P2", label: "Runner 卡住" },
  runner_crash: { sev: "block", phase: "P2", label: "Runner crash" },
  sync_started: { sev: "muted", phase: "P2", label: "同步已啟動" },
  sync_conflict: { sev: "block", phase: "P2", label: "同步遇衝突,等 user 決定" },
  sync_succeeded: { sev: "info", phase: "P2", label: "同步完成" },
  sync_failed: { sev: "block", phase: "P2", label: "同步失敗" },

  skill_candidate: { sev: "info", phase: "P3", label: "新 SKILL 候選" },
  cross_pipeline_pattern: { sev: "info", phase: "P3", label: "跨 pipeline 模式偵測" },
  scheduler_fired: { sev: "muted", phase: "P3", label: "排程觸發" },

  // Frontend 主動 emit:三種預設 sev,實際 sev 以 NotifRecord.sev override 為準
  frontend_action_failed: { sev: "block", phase: "P2", label: "前端動作失敗" },
  frontend_action_warn: { sev: "info", phase: "P2", label: "前端動作警告" },
  frontend_action_info: { sev: "muted", phase: "P2", label: "前端動作紀錄" },

  system_updating: { sev: "info", phase: "P2", label: "系統更新中(backend 即將重啟)" },
};
