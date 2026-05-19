// User-level config(~/.vibe-pipeline/config.json),跨 project 共用。
// 跟 <target-repo>/.vibe-pipeline/config.json(per-project,max_parallel / base_branch / cost_limit)
// 是不同層的兩個檔,不互相覆寫、不合併。
//
// claude CLI flag 對齊(以 `claude --help` 為準,2026-05-11):
//   --model <model>   model alias(opus / sonnet / haiku ...),直接帶 alias 即可
//   --effort <level>  effort level(low / medium / high / xhigh / max);本檔只露 low/medium/high
//
// Sub-agent 與 Merge 兩種 task class 不是後端直接 spawn(由 runner 主 agent 透過 Task tool 派出),
// 所以是把 "model" / "effort" 字串塞進主 agent 的 system prompt,讓主 agent 在呼叫 Task tool
// 時指定 model 參數;effort 沒對應 Task tool 參數,以「effort 偏好」文字提示寫進 prompt
// (best-effort,sub-agent 自己決定要不要照辦)。
//
// atomic write 對齊 projectStore.ts:.tmp + JSON.parse round-trip + Bun.$ mv。

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { vibeHome } from "./paths";
import { atomicWriteJson } from "./atomicWrite";
import {
  DEFAULT_USER_CONFIG,
  PUSH_EVENT_KEYS,
  PROVIDERS,
  TASK_CLASSES,
  defaultEffortForProvider,
  defaultModelForProvider,
  effortsForProvider,
  isValidEffort,
  isValidModel,
  modelsForProvider,
  type Effort,
  type ModelName,
  type Provider,
  type PushEventKey,
  type TaskClass,
  type TaskModelConfig,
  type UserConfig,
} from "../../shared/types";

function dir(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

function file(): string {
  return join(dir(), "config.json");
}

function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as string[]).includes(v);
}

// per-provider 驗 model / effort:不同 provider 字典不同(claude opus/sonnet/haiku × low/medium/high;
// codex gpt-5-codex/gpt-5 × minimal/low/medium/high)。switch provider 後若舊值不合法 → 退到該 provider 預設
function coerceTaskModel(raw: unknown, fallback: TaskModelConfig): TaskModelConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  const provider: Provider = isProvider(o.provider) ? o.provider : fallback.provider;
  const rawModel = typeof o.model === "string" ? o.model : "";
  const model: ModelName = isValidModel(provider, rawModel)
    ? rawModel
    : isValidModel(provider, fallback.model)
    ? fallback.model
    : defaultModelForProvider(provider);
  const rawEffort = typeof o.effort === "string" ? o.effort : "";
  const effort: Effort = isValidEffort(provider, rawEffort)
    ? rawEffort
    : isValidEffort(provider, fallback.effort)
    ? fallback.effort
    : defaultEffortForProvider(provider);
  return { provider, model, effort };
}

function defaultPushEvents(): Record<PushEventKey, boolean> {
  return { ...DEFAULT_USER_CONFIG.pushEvents };
}

function defaultDefaults(): UserConfig["defaults"] {
  return { ...DEFAULT_USER_CONFIG.defaults };
}

function coercePushEvents(raw: unknown): Record<PushEventKey, boolean> {
  const out = defaultPushEvents();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const key of PUSH_EVENT_KEYS) {
    if (typeof o[key] === "boolean") out[key] = o[key];
  }
  return out;
}

function coerceConfig(raw: unknown): UserConfig {
  const fallback = DEFAULT_USER_CONFIG;
  if (!raw || typeof raw !== "object") {
    return { defaults: defaultDefaults(), pushEvents: defaultPushEvents() };
  }
  const o = raw as Record<string, unknown>;
  const rawDefaults = (o.defaults && typeof o.defaults === "object" ? o.defaults : {}) as Record<
    string,
    unknown
  >;
  // 2026-05-12 migration:舊 config 用 'subAgent' 一個 key 涵蓋 executor + critic。
  // 新 schema 拆兩個。讀檔時把 subAgent 當 executor 預設(critic 走 fallback 預設 sonnet)
  // 讓 user 之前的設定不丟,critic 由 user 在 SettingsPopover 後續挑便宜 model
  if (rawDefaults.subAgent && !rawDefaults.executor) {
    rawDefaults.executor = rawDefaults.subAgent;
  }
  const out: UserConfig["defaults"] = { ...fallback.defaults };
  for (const tc of TASK_CLASSES) {
    out[tc] = coerceTaskModel(rawDefaults[tc], fallback.defaults[tc]);
  }
  // executor/critic/merge 整組對稱 runner;不齊 → snap 整套(provider + model + effort)= runner
  const runnerCfg = out.runner;
  for (const tc of ["executor", "critic", "merge"] as const) {
    if (out[tc].provider !== runnerCfg.provider) {
      out[tc] = { ...runnerCfg };
    }
  }
  return { defaults: out, pushEvents: coercePushEvents(o.pushEvents) };
}

export async function loadUserConfig(): Promise<UserConfig> {
  if (!existsSync(file())) {
    return { defaults: defaultDefaults(), pushEvents: defaultPushEvents() };
  }
  try {
    const text = await Bun.file(file()).text();
    return coerceConfig(JSON.parse(text));
  } catch {
    return { defaults: defaultDefaults(), pushEvents: defaultPushEvents() };
  }
}

export async function writeUserConfig(cfg: UserConfig): Promise<UserConfig> {
  if (!existsSync(dir())) mkdirSync(dir(), { recursive: true });
  await atomicWriteJson(file(), cfg);
  return cfg;
}

// PUT 接 partial body,白名單 defaults.{qa,runner,executor,critic,merge}.{model,effort}。
// 其他鍵忽略。型別錯 → 拋 invalid_path err,routes 層轉 400。
export class UserConfigPatchError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

export async function patchUserConfig(body: unknown): Promise<UserConfig> {
  const cur = await loadUserConfig();
  if (!body || typeof body !== "object") return cur;
  const bodyObj = body as Record<string, unknown>;
  const incoming = bodyObj.defaults;
  const incomingDefaults =
    incoming && typeof incoming === "object" ? (incoming as Record<string, unknown>) : {};
  const nextDefaults: UserConfig["defaults"] = { ...cur.defaults };
  for (const tc of TASK_CLASSES) {
    if (!(tc in incomingDefaults)) continue;
    const raw = incomingDefaults[tc];
    if (!raw || typeof raw !== "object") {
      throw new UserConfigPatchError(`defaults.${tc}`, `defaults.${tc} 必須為 object`);
    }
    const o = raw as Record<string, unknown>;
    const cur_tc = cur.defaults[tc];
    let provider: Provider = cur_tc.provider;
    let model: ModelName = cur_tc.model;
    let effort: Effort = cur_tc.effort;
    if ("provider" in o) {
      if (!isProvider(o.provider)) {
        throw new UserConfigPatchError(
          `defaults.${tc}.provider`,
          `defaults.${tc}.provider 必須為 ${PROVIDERS.join("/")}`
        );
      }
      provider = o.provider;
    }
    if ("model" in o) {
      if (typeof o.model !== "string" || !isValidModel(provider, o.model)) {
        throw new UserConfigPatchError(
          `defaults.${tc}.model`,
          `defaults.${tc}.model 必須為 ${modelsForProvider(provider).join("/")}(provider=${provider})`
        );
      }
      model = o.model;
    }
    if ("effort" in o) {
      if (typeof o.effort !== "string" || !isValidEffort(provider, o.effort)) {
        throw new UserConfigPatchError(
          `defaults.${tc}.effort`,
          `defaults.${tc}.effort 必須為 ${effortsForProvider(provider).join("/")}(provider=${provider})`
        );
      }
      effort = o.effort;
    }
    // provider 變但 model/effort 沒同步換 → 自動 snap 到該 provider 預設
    if ("provider" in o) {
      if (!("model" in o) && !isValidModel(provider, model)) {
        model = defaultModelForProvider(provider);
      }
      if (!("effort" in o) && !isValidEffort(provider, effort)) {
        effort = defaultEffortForProvider(provider);
      }
    }
    nextDefaults[tc] = { provider, model, effort };
  }
  // executor/critic/merge.provider 必須跟 runner.provider 一致;
  // 例外:同次 PUT body 同時改 runner + 該 tc 兩者新 provider 一致(用 nextDefaults.runner.provider 比較)
  const finalRunnerProvider = nextDefaults.runner.provider;
  for (const tc of ["executor", "critic", "merge"] as const) {
    const incomingTc = incomingDefaults[tc];
    const incomingHasProvider =
      incomingTc &&
      typeof incomingTc === "object" &&
      "provider" in (incomingTc as Record<string, unknown>);
    if (incomingHasProvider && nextDefaults[tc].provider !== finalRunnerProvider) {
      throw new UserConfigPatchError(
        `defaults.${tc}.provider`,
        `defaults.${tc}.provider 必須跟 defaults.runner.provider 一致(runner=${finalRunnerProvider})`
      );
    }
  }
  // runner.provider 換了 → executor/critic/merge 整組對稱 runner(provider + model + effort 全跟);
  // 例外:incoming 同次明確指定該 tc 的 model/effort,則尊重 incoming(且必須跟新 provider 相容,否則 fallback runner 值)
  if (cur.defaults.runner.provider !== finalRunnerProvider) {
    const runnerNext = nextDefaults.runner;
    for (const tc of ["executor", "critic", "merge"] as const) {
      const incomingTc = (incomingDefaults[tc] && typeof incomingDefaults[tc] === "object"
        ? (incomingDefaults[tc] as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const provider: Provider = runnerNext.provider;
      let model: ModelName = runnerNext.model;
      let effort: Effort = runnerNext.effort;
      if ("model" in incomingTc && isValidModel(provider, nextDefaults[tc].model)) {
        model = nextDefaults[tc].model;
      }
      if ("effort" in incomingTc && isValidEffort(provider, nextDefaults[tc].effort)) {
        effort = nextDefaults[tc].effort;
      }
      nextDefaults[tc] = { provider, model, effort };
    }
  }
  const nextPushEvents: Record<PushEventKey, boolean> = { ...cur.pushEvents };
  if ("pushEvents" in bodyObj) {
    const incomingPushEvents = bodyObj.pushEvents;
    if (!incomingPushEvents || typeof incomingPushEvents !== "object") {
      throw new UserConfigPatchError("pushEvents", "pushEvents 必須為 object");
    }
    const o = incomingPushEvents as Record<string, unknown>;
    for (const key of PUSH_EVENT_KEYS) {
      if (!(key in o)) continue;
      if (typeof o[key] !== "boolean") {
        throw new UserConfigPatchError(`pushEvents.${key}`, `pushEvents.${key} 必須為 boolean`);
      }
      nextPushEvents[key] = o[key];
    }
  }
  return writeUserConfig({ defaults: nextDefaults, pushEvents: nextPushEvents });
}

// 拿單一 task class 的 provider/model/effort(spawn 點呼叫)
export async function getTaskConfig(tc: TaskClass): Promise<TaskModelConfig> {
  const cfg = await loadUserConfig();
  return cfg.defaults[tc];
}

// 拿 task class config + 對應 adapter instance(spawn 點便利方法,避免 caller 自己 import getAdapter)
export async function getTaskConfigWithAdapter(
  tc: TaskClass
): Promise<TaskModelConfig & { adapter: import("./cli").CliAdapter }> {
  const cfg = await getTaskConfig(tc);
  const { getAdapter } = await import("./cli");
  return { ...cfg, adapter: getAdapter(tc, cfg.provider) };
}
