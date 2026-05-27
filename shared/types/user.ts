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

