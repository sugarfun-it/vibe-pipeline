// 前後端共用持久化型別。Backend 是 source of truth。

// ─── User-level config(~/.vibe-pipeline/config.json,跨 project) ───
// 跟 <target-repo>/.vibe-pipeline/config.json (per-project, max_parallel 等) 不同層。
//
// provider 決定走 ClaudeAdapter 還是 CodexAdapter;model / effort 兩 provider 不同字典
// (claude opus/sonnet/haiku × low/medium/high;codex gpt-5-codex/gpt-5 × minimal/low/medium/high)。
// ModelName / Effort 用 string 寬鬆容納,各 provider 各自的 list 用 *_FOR_PROVIDER lookup。
export type ModelName = string;
export type Effort = string;
export type Provider = "claude" | "codex";
// split = QA 拆 ticket 的 one-shot call(獨立 task class,可用便宜 model)
// executor / critic 原本是同一個 subAgent,2026-05-12 拆開:執行用高 capability(opus/gpt-5.5),
// 審核可用便宜 model(sonnet/gpt-5.4-mini)省 token
export type TaskClass = "qa" | "split" | "runner" | "executor" | "critic" | "merge";

export type TaskModelConfig = {
  provider: Provider;
  model: ModelName;
  effort: Effort;
};

export type PushEventKey =
  | "ticket_done"
  | "ticket_failed"
  | "pipeline_paused"
  | "pipeline_ready"
  | "auto_merge_conflict";

export const PUSH_EVENT_KEYS: PushEventKey[] = [
  "ticket_done",
  "ticket_failed",
  "pipeline_paused",
  "pipeline_ready",
  "auto_merge_conflict",
];

export type UserConfig = {
  defaults: Record<TaskClass, TaskModelConfig>;
  pushEvents: Record<PushEventKey, boolean>;
};

export const TASK_CLASSES: TaskClass[] = ["qa", "split", "runner", "executor", "critic", "merge"];
export const PROVIDERS: Provider[] = ["claude", "codex"];

// 每 provider 各自的 model / effort 允許字典。第一個元素是該 provider 預設值。
// codex 列表對齊 OpenAI Codex models 官方文件(2026-05);codex CLI 接 `-c model="<name>"`
// (不走 -m,ChatGPT auth -m 會 400)。--oss 跑 local model 不在此列。
// effort 對應 codex 的 `model_reasoning_effort` config key,OpenAI 標準 minimal/low/medium/high
export const MODELS_BY_PROVIDER: Record<Provider, readonly ModelName[]> = {
  // claude:full ID 鎖明確版本(2026-05 主力組合)
  // 第一個是該 provider 的預設值。新 model 出現就在這 array 加(`claude --model invalid` 會印錯誤但不列清單)。
  claude: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-opus-4-6",
  ],
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
};

// claude CLI `--effort <level>` 接受 5 個值(實測 `claude --effort invalid` 列出),
// 對應 OpenAI reasoning_effort enum 擴張。codex 走 OpenAI 原版 4 級。
export const EFFORTS_BY_PROVIDER: Record<Provider, readonly Effort[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high"],
};

export function modelsForProvider(p: Provider): readonly ModelName[] {
  return MODELS_BY_PROVIDER[p];
}
export function effortsForProvider(p: Provider): readonly Effort[] {
  return EFFORTS_BY_PROVIDER[p];
}
export function defaultModelForProvider(p: Provider): ModelName {
  return MODELS_BY_PROVIDER[p][0];
}
export function defaultEffortForProvider(p: Provider): Effort {
  return EFFORTS_BY_PROVIDER[p][1] ?? EFFORTS_BY_PROVIDER[p][0]; // 取 medium / 退 low
}
export function isValidModel(p: Provider, m: ModelName): boolean {
  return MODELS_BY_PROVIDER[p].includes(m);
}
export function isValidEffort(p: Provider, e: Effort): boolean {
  return EFFORTS_BY_PROVIDER[p].includes(e);
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  defaults: {
    qa: { provider: "claude", model: "claude-sonnet-4-6", effort: "low" },
    split: { provider: "claude", model: "claude-sonnet-4-6", effort: "low" },
    runner: { provider: "claude", model: "claude-opus-4-7", effort: "medium" },
    // 執行AI:真的改 code,要 capability
    executor: { provider: "claude", model: "claude-opus-4-7", effort: "high" },
    // 審核AI:讀 diff 判 PASS/FAIL,sonnet + medium 已夠用,省 token
    critic: { provider: "claude", model: "claude-sonnet-4-6", effort: "medium" },
    merge: { provider: "claude", model: "claude-opus-4-7", effort: "high" },
  },
  pushEvents: {
    ticket_done: true,
    ticket_failed: true,
    pipeline_paused: true,
    pipeline_ready: true,
    auto_merge_conflict: true,
  },
};

// 舊代碼還在 import 這兩個 const 的話,保留 claude 預設值不破壞(deprecated,新代碼用 *_FOR_PROVIDER)
export const MODEL_NAMES: readonly ModelName[] = MODELS_BY_PROVIDER.claude;
export const EFFORT_LEVELS: readonly Effort[] = EFFORTS_BY_PROVIDER.claude;

export const TASK_CLASS_LABELS: Record<TaskClass, string> = {
  qa: "QA Spec",
  split: "Ticket Split",
  runner: "Main Agent",
  executor: "Executor",
  critic: "Critic",
  merge: "Merge Agent",
};

// 第二行說明文字 — 弱化 hint,在 UI 主 label 下方小字顯
export const TASK_CLASS_HINTS: Record<TaskClass, string> = {
  qa: "規格收斂",
  split: "大任務拆分 Ticket",
  runner: "任務執行主 Agent",
  executor: "執行AI(改 code)",
  critic: "審核AI(判 PASS/FAIL)",
  merge: "合併衝突解決",
};


export type Project = {
  path: string; // absolute
  hash: string; // sha256(path).slice(0, 8)
  name: string; // basename(path)
  hasInit: boolean; // .vibe-pipeline/ 是否存在
  hasGit: boolean; // .git/ 是否存在(runner 階段需要)
  lastOpenedAt: number; // unix ms
  currentBranch?: string; // 當前 git HEAD 短名(`git symbolic-ref --short HEAD`),非 git repo 為 undefined
  defaultBaseBranch?: string; // config.defaults.base_branch(沒設則 fallback 當前 git branch)
  costLimitUsd?: number; // config.defaults.cost_limit_usd(0 = 無限)
};

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
  mergeCommit?: { hash: string; subject: string; ts: number };
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

// ─── Worktree diff(server/lib/git/worktree.ts 算 / frontend 顯示) ───
export type DiffStat = { files: number; added: number; deleted: number };
export type DiffFile = { path: string; added: number; deleted: number };
export type FullDiff = { files: DiffFile[]; raw: string };

// ─── API envelope ─────────────────────────────────────────────────
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: ApiErrorCode; message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export type ApiErrorCode =
  | "not_found"
  | "permission_denied"
  | "dialog_cancelled"
  | "invalid_path"
  | "not_initialized"
  | "already_initialized"
  | "budget_exceeded"
  | "not_merged"
  | "internal_error";

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
