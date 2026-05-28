import * as userConfig from "../../server/lib/domain/userConfig";
import type { ParsedArgs } from "../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../lib/output";
import { TASK_CLASSES } from "../../shared/types";

const CONFIG_USAGE = `vbpl config — user-level per-task-class model defaults (~/.vibe-pipeline/config.json)

SYNOPSIS
  vbpl config <sub> [key] [value]

SUBCOMMANDS
  list                   列全部 config(連同預設值)
  get <key>              讀單一 key
  set <key> <value>      改單一 key,寫回 ~/.vibe-pipeline/config.json

OPTIONS
  (config 用 positional key/value,沒 flag;全域 --json 仍可用)

KEY FORMAT
  <taskClass>.<field>

  taskClass = qa|split|runner|executor|critic|merge
  field     = provider|model|effort

  taskClass 解釋:
    qa        QA drawer 對話收斂 spec 的 AI
    split     AI 拆 ticket 用的 AI
    runner    pipeline 主 orchestrator(高 reasoning,長 plan)
    executor  寫 code 的 sub-agent(可貴 model)
    critic    驗收的 sub-agent(便宜 model 即可)
    merge     git 衝突 AI 解
  field 解釋:
    provider  claude | codex(影響呼叫的 CLI binary)
    model     model ID,例 claude-opus-4-7 / claude-sonnet-4-6 / gpt-5
    effort    reasoning effort hint(low / medium / high),只 codex 用

EXAMPLES
  vbpl config list                                  # 全部 + 預設值
  vbpl config get runner.model                      # 看單 key
  vbpl config set runner.model claude-opus-4-7      # 改 runner model
  vbpl config set critic.model claude-haiku-4-5     # 省 token:critic 走便宜 model
  vbpl config set executor.provider codex           # executor 換 codex
  vbpl config set executor.effort high              # codex 用 high reasoning

SEE ALSO
  vbpl pipeline --help    # 這些 config 在 pipeline run 時生效`;

export async function runConfig(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(CONFIG_USAGE);
    return;
  }
  switch (sub) {
    case "list": return configList();
    case "get":  return configGet(args);
    case "set":  return configSet(args);
    default:
      fail("INVALID_ARGS", `Unknown config subcommand: ${sub ?? "(none)"}. Use list|get|set (or 'vbpl config help')`);
  }
}

async function configList(): Promise<void> {
  const cfg = await userConfig.loadUserConfig();
  if (isJsonMode()) {
    okJson(cfg);
    return;
  }
  const rows: string[][] = [["TASK_CLASS", "PROVIDER", "MODEL", "EFFORT"]];
  for (const tc of TASK_CLASSES) {
    const t = cfg.defaults[tc];
    rows.push([tc, t.provider, t.model, t.effort]);
  }
  printLines([table(rows)]);
}

async function configGet(args: ParsedArgs): Promise<void> {
  const key = args.positional[0] ?? (typeof args.flags["key"] === "string" ? args.flags["key"] : undefined);
  if (!key) fail("INVALID_ARGS", "Usage: vbpl config get <task_class[.field]>");

  const cfg = await userConfig.loadUserConfig();
  const parts = key.split(".");
  const tc = parts[0];
  const field = parts[1];

  if (!TASK_CLASSES.includes(tc as never)) {
    fail("INVALID_ARGS", `Unknown task class: ${tc}. Valid: ${TASK_CLASSES.join(", ")}`);
  }

  const tcCfg = cfg.defaults[tc as (typeof TASK_CLASSES)[number]];
  if (!field) {
    if (isJsonMode()) {
      okJson(tcCfg);
      return;
    }
    printLines([
      `${tc}.provider: ${tcCfg.provider}`,
      `${tc}.model:    ${tcCfg.model}`,
      `${tc}.effort:   ${tcCfg.effort}`,
    ]);
    return;
  }

  const validFields = ["provider", "model", "effort"];
  if (!validFields.includes(field)) {
    fail("INVALID_ARGS", `Unknown field: ${field}. Valid: ${validFields.join(", ")}`);
  }

  const val = tcCfg[field as "provider" | "model" | "effort"];
  if (isJsonMode()) {
    okJson({ [key]: val });
    return;
  }
  print(`${key}: ${val}`);
}

async function configSet(args: ParsedArgs): Promise<void> {
  // Usage: vbpl config set <task_class.field> <value>
  // Or: vbpl config set <task_class> --provider <p> --model <m> --effort <e>
  const keyArg = args.positional[0];
  const valueArg = args.positional[1];

  if (!keyArg) fail("INVALID_ARGS", "Usage: vbpl config set <task_class[.field]> [value]");

  const parts = keyArg.split(".");
  const tc = parts[0];
  const field = parts[1];

  if (!TASK_CLASSES.includes(tc as never)) {
    fail("INVALID_ARGS", `Unknown task class: ${tc}. Valid: ${TASK_CLASSES.join(", ")}`);
  }

  let patchDefaults: Record<string, unknown>;

  if (field && valueArg !== undefined) {
    patchDefaults = { [tc]: { [field]: valueArg } };
  } else {
    // multi-field patch via flags
    const patch: Record<string, unknown> = {};
    if (typeof args.flags["provider"] === "string") patch.provider = args.flags["provider"];
    if (typeof args.flags["model"] === "string") patch.model = args.flags["model"];
    if (typeof args.flags["effort"] === "string") patch.effort = args.flags["effort"];
    if (Object.keys(patch).length === 0) {
      fail("INVALID_ARGS", "Specify value as positional or --provider/--model/--effort flags");
    }
    patchDefaults = { [tc]: patch };
  }

  try {
    const updated = await userConfig.patchUserConfig({ defaults: patchDefaults });
    if (isJsonMode()) {
      okJson(updated);
      return;
    }
    const tcCfg = updated.defaults[tc as (typeof TASK_CLASSES)[number]];
    print(`Updated ${tc}: provider=${tcCfg.provider} model=${tcCfg.model} effort=${tcCfg.effort}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("INVALID_ARGS", msg);
  }
}
