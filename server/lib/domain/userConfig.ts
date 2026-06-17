// User-level config(~/.vibe-pipeline/config.json),跨 project 共用。
// 跟 <target-repo>/.vibe-pipeline/config.json(per-project,max_parallel / base_branch / cost_limit)
// 是不同層的兩個檔,不互相覆寫、不合併。
//
// claude CLI flag 對齊(以 `claude --help` 為準,2026-05-11):
//   --model <model>   model alias(opus / sonnet / haiku ...),直接帶 alias 即可
//   --effort <level>  effort level(low / medium / high / xhigh / max);本檔只露 low/medium/high
//
// Executor / critic / merge 由 backend code orchestrator 直接 spawn 成 top-level process,
// provider/model/effort 都在 adapter spawn 參數落實。
//
// atomic write 對齊 projectStore.ts:.tmp + JSON.parse round-trip + Bun.$ mv。

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { vibeHome } from "../io/paths";
import { atomicWriteJson } from "../io/atomicWrite";
import {
  DEFAULT_USER_CONFIG,
  PUSH_EVENT_KEYS,
  PROVIDERS,
  TASK_CLASSES,
  defaultEffortForProvider,
  type Effort,
  type ModelName,
  type Provider,
  type PushEventKey,
  type TaskClass,
  type TaskModelConfig,
  type UserConfig,
} from "../../../shared/types";
import {
  getDefaultModel as defaultModelForProvider,
  getEfforts as effortsForProvider,
  getModels as modelsForProvider,
  isValidEffort,
  isValidModel,
} from "./modelCatalog";

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

// PUT 接 partial body,白名單 defaults.{qa,split,executor,critic,merge}.{provider,model,effort}。
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
): Promise<TaskModelConfig & { adapter: import("../cli").CliAdapter }> {
  const cfg = await getTaskConfig(tc);
  const { getAdapter } = await import("../cli");
  return { ...cfg, adapter: getAdapter(tc, cfg.provider) };
}
