// CodexAdapter:把 vibe-pipeline 的 spawn API 對應到 OpenAI Codex CLI(`codex exec`)。
//
// Codex CLI 與 Claude CLI 的差異與本 adapter 的降級策略:
//
// 1. session resume:codex 有 `codex exec resume <session-id>`,但 session id 由 codex 自己產(rollout file uuid),
//    無法像 claude 那樣 caller 指定 --session-id 預先決定。本 adapter 把多輪 QA 折成「每輪重組整段 history
//    塞進 user prompt」,supportsSessionResume=false。caller 不需改,適 adapter 在 spawn 內處理。
//    註:這是 functional 降級,QA history 會佔 token,但 codex 是 alt provider,trade-off 可接受。
//
// 2. Task tool dispatch:codex 沒對應的 sub-agent 工具,supportsTaskDispatch=false。runner kind 跑起來時
//    主 agent 就是執行 agent(沒有「派 sub-agent 改 code」的層次),system prompt 內預先把「執行 / 審核」流程
//    壓平成主 agent 自駕(Bash + 內建檔案編輯)。runnerPrompt 寫法現階段是 claude-flavored;codex 跑 runner 時
//    capability 標 false 提醒上層「行為不等價」,真正要切 codex runner 需後續另寫 prompt 適配層
//    (本 ticket 不做,標 TODO)。
//
// 3. stream JSON:codex 有 `exec --json` 輸出 JSONL,可解析。但 vibe-pipeline 既有 caller 是 buffer 全量再
//    JSON.parse,本 adapter 用 `-o <tmpfile>` 把最終 assistant message 寫檔,再讀回。supportsStreamJson=false
//    意指「不對外暴露 stream 介面」。
//
// 4. tool whitelist:claude 有 --disallowedTools / --allowedTools,codex 沒等價。codex 用 sandbox mode
//    + approval policy 控制;QA / split 用 read-only sandbox,runner 用 workspace-write。
//    supportsToolWhitelist=false。
//
// Perf flag 對應(對齊 refs/archive/claude-cli-spawn-perf-2026-05-11.md):
//   claude --setting-sources ""        → codex --ignore-user-config + --ignore-rules
//   claude --strict-mcp-config + 空 MCP → codex -c mcp_servers={}(override TOML)
//   claude --disable-slash-commands    → 無對應(codex exec 本就 non-interactive)
//   claude --no-session-persistence    → codex --ephemeral

import { runCapture, spawnStreaming } from "../io/childSpawn";
import type {
  CliAdapter,
  QASpawnOpts,
  RunnerSpawnOpts,
  SplitSpawnOpts,
  SpawnOpts,
  SpawnedProcess,
} from "./adapter";

// codex output last-message file 在 adapter 內管理。spawn 回去後 caller 仍只看 stdout,
// 我們 wrap codex 行程,等 exit 後把 last-message file 內容 echo 到 stdout 以兼容 caller。
// 但 Bun.Subprocess.stdout 是 ReadableStream,沒辦法事後注入。
// 解法:adapter 自己組 shell script — codex exec ... -o <tmp>; cat <tmp> 1>&2 重定向?
// 太脆。改用 parseResult 從 codex `--json` JSONL stdout 取 agent_message 文本。
//
// 結論:CodexAdapter spawn 一律加 --json,parseResult 從 JSONL 掃最後一個 item.completed/agent_message。
//
// Round 2 修正(codex 0.125.0):
//  - 砍 -a/--approval-policy never(已從 codex 移除,改 sandbox 控)。runner 用
//    --dangerously-bypass-approvals-and-sandbox 取代「never approval」語義。
//  - 砍 -m <model>(ChatGPT auth 對 -m 回 400)。改在 prompt header 寫 "[Model preference: <m>]"。
//  - JSONL 形狀改 {type:"item.completed", item:{type:"agent_message", text}}。
//  - prompt 改 stdin 模式(args 最後一個是 "-"),不再 positional 傳。

export class CodexAdapter implements CliAdapter {
  readonly name = "codex";

  async checkAvailable(): Promise<boolean> {
    const r = await runCapture(["codex", "--version"]);
    return r.ok;
  }

  spawn(opts: SpawnOpts): SpawnedProcess {
    if (opts.kind === "qa") return spawnQA(opts);
    if (opts.kind === "runner") return spawnRunner(opts);
    if (opts.kind === "split") return spawnSplit(opts);
    throw new Error(`CodexAdapter: unknown spawn kind ${(opts as { kind?: string }).kind}`);
  }

  parseResult(_kind: "qa" | "split" | "runner", stdout: string): string {
    // codex 0.125.0 exec --json JSONL 形狀:
    //   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
    // 掃所有行,取最後一個 agent_message.text。
    // fallback:最後一段非空 plain text。
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let lastMsg: string | null = null;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as {
          type?: string;
          item?: { type?: string; text?: string; message?: string };
          msg?: { type?: string; message?: string };
          message?: string;
        };
        if (ev?.type === "item.completed" && ev.item?.type === "agent_message") {
          const t = ev.item.text ?? ev.item.message;
          if (typeof t === "string") {
            lastMsg = t;
            continue;
          }
        }
        // 舊形狀 fallback(某些 codex 版本仍可能輸出)
        const inner = ev.msg ?? ev;
        if (inner && typeof inner === "object") {
          const t = (inner as { type?: string }).type;
          const m = (inner as { message?: string }).message;
          if (t === "agent_message" && typeof m === "string") {
            lastMsg = m;
          }
        }
      } catch {
        // 非 JSON 行,忽略
      }
    }
    if (lastMsg !== null) return lastMsg;
    // fallback:回最後一段非空文字
    const tail = lines.slice(-1)[0] ?? "";
    return tail;
  }
}

// 跟 claudeAdapter 對齊:刪 nested-session env、標 entrypoint=worker。codex 不認這些 env 但
// 設了無害;統一 spawn 環境減 caller 心智負擔(Ruflo issue #1395)。
// Windows 雷:Bun.spawn 顯式 env 對 PATH key 大小寫敏感 — Object.entries(process.env) 可能回
// `"Path"`(混合 case),而 uv_spawn 在 Windows 上只認大寫 `"PATH"`,找不到 → 撞 ENOENT
// (例:`spawn codex failed: uv_spawn 'codex'`,因 PATHEXT 也跟著拿不到,bare `codex` 無法解析
// 到 `codex.cmd`)。Normalize 為大寫 PATH 解。
function workerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.CLAUDE_ENTRYPOINT = "worker";
  delete env.CLAUDE_SESSION_ID;
  delete env.CLAUDE_PARENT_SESSION_ID;
  if (process.platform === "win32") {
    if (env.Path && !env.PATH) env.PATH = env.Path;
    if (env.Pathext && !env.PATHEXT) env.PATHEXT = env.Pathext;
  }
  return env;
}

// 用 stdin 模式 spawn codex,把 prompt 寫進 stdin。args 最後一個必為 "-"。
function spawnCodexWithStdinPrompt(args: string[], cwd: string, prompt: string): SpawnedProcess {
  const proc = spawnStreaming<SpawnedProcess>(args, {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: workerEnv(),
  });
  // Bun.spawn stdin 是 FileSink,write + end。
  proc.stdin.write(prompt);
  proc.stdin.end();
  return proc;
}

// 在 prompt 前綴註明 model preference(雙保險:--config 已正確設了,prompt hint 給 AI 一個 hint
// 知道自己應該怎麼回應)。
function modelHint(model: string, effort?: string): string {
  const eff = effort ? `, effort: ${effort}` : "";
  return `[Model preference: ${model}${eff}]\n\n`;
}

// ─── 共用 args ──────────────────────────────────────────────────────
//
// codex `-c key=value` 覆寫 ~/.codex/config.toml 的對應值。比起 -m flag(ChatGPT auth 下會 400),
// `-c model="<name>"` 走 config override path,ChatGPT auth 也吃。同樣的 `-c model_reasoning_effort=`
// 控制推理 effort(對應 OpenAI reasoning_effort enum:minimal/low/medium/high)。

function commonExecArgs(model: string, effort: string): string[] {
  // value 一律當 TOML 字串(double quote 包),簡單情況夠用;特殊字元需要更嚴格 escape 才再加
  //
  // 移除 --ignore-user-config(2026-05-13 雷):那 flag 會把 ~/.codex/config.toml 的
  // provider 設定(e.g. ChatGPT auth 模式 `provider = codex_local_access`)也 ignore 掉,
  // fallback 用 default OpenAI API 模式,但 auth.json 內若是 internal/beta key 會 401。
  // 保留 --ignore-rules(rules 不影響 auth)。
  // 2026-05-17:拔 -c mcp_servers={},允許 user MCP pass-through(例 playwright MCP 截圖驗 UI)。
  // 風險:user 自定 MCP 可能干擾 runner — 接受;不接受可加 whitelist(目前不做)。
  return [
    "codex",
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ignore-rules",
    "-c",
    `model="${model}"`,
    "-c",
    `model_reasoning_effort="${effort}"`,
  ];
}

// 把 system prompt 折進 instructions(codex 沒對應 --system-prompt flag)。
// codex `-c` 可覆寫 instructions,但放 prompt 太長走 TOML 也不雅;改在 user prompt 前面 wrap。
function wrapPrompt(systemPrompt: string, userMessage: string): string {
  return [
    "[System instructions]",
    systemPrompt,
    "",
    "[User message]",
    userMessage,
  ].join("\n");
}

// QA 多輪降級:無 session resume,把 history 串成 user prompt。
// caller(claudeCli.runTurn)目前只給 userMessage(單輪)— 多輪 history 在 claude 用 --resume 取回,
// 換 codex 後沒接住。本 adapter 暫時用「不支援 follow-up」處理:isFirstTurn=false 拋錯,
// caller 看 capability flag 決定降級(其實 caller 用 getTaskConfig 拿 provider 後可走另一條 path,
// 但 ticket 範圍不重寫 caller,僅在 spawn 內回報能力限制)。
function spawnQA(opts: QASpawnOpts): SpawnedProcess {
  const { cwd, userMessage, isFirstTurn, systemPrompt, appendSystemPrompt, model, effort, history } = opts;
  const hint = modelHint(model, effort);
  let prompt: string;
  if (!isFirstTurn) {
    const combined = appendSystemPrompt
      ? systemPrompt + "\n\n" + appendSystemPrompt
      : systemPrompt;
    const transcript = (history && history.length > 0)
      ? history
          .map((t) => (t.role === "user" ? "[User] " : "[Assistant] ") + t.content)
          .join("\n\n")
      : "";
    prompt = hint + (transcript
      ? [
          "[System instructions]",
          combined,
          "",
          "[Conversation history]",
          transcript,
          "",
          "[User message]",
          userMessage,
        ].join("\n")
      : wrapPrompt(combined, userMessage));
  } else {
    prompt = hint + wrapPrompt(systemPrompt, userMessage);
  }
  const args = [
    ...commonExecArgs(model, effort),
    "-C",
    cwd,
    "-s",
    "read-only",
    "--ephemeral",
    "-",
  ];
  return spawnCodexWithStdinPrompt(args, cwd, prompt);
}

function spawnRunner(opts: RunnerSpawnOpts): SpawnedProcess {
  const { cwd, initialMessage, systemPrompt, model, effort } = opts;
  // runner 要改 source code:workspace-write sandbox + bypass approvals。
  // 不加 --ephemeral:跟 QA / split 不對稱是刻意 — runner 長任務跨 round / 多次 spawn,
  // 寫 rollout history 對後續除錯 / resume / 觀測有用。
  const prompt = modelHint(model, effort) + wrapPrompt(systemPrompt, initialMessage);
  const args = [
    ...commonExecArgs(model, effort),
    // 開 multi_agent feature flag,讓主 runner 在 codex 內可呼叫 spawn_agent / wait_agent / close_agent
    // in-process sub-agent 原語(取代 Bash 直呼 codex exec subprocess)。對齊 runnerPrompt
    // dispatchInstructions 的 codex 分支。
    "-c",
    "features.multi_agent=true",
    "-C",
    cwd,
    "-s",
    "workspace-write",
    "--dangerously-bypass-approvals-and-sandbox",
    "-",
  ];
  return spawnCodexWithStdinPrompt(args, cwd, prompt);
}

function spawnSplit(opts: SplitSpawnOpts): SpawnedProcess {
  const { cwd, systemPrompt, model, effort, userMessage } = opts;
  const prompt = modelHint(model, effort) + wrapPrompt(systemPrompt, userMessage);
  const args = [
    ...commonExecArgs(model, effort),
    "-C",
    cwd,
    "-s",
    "read-only",
    "--ephemeral",
    "-",
  ];
  return spawnCodexWithStdinPrompt(args, cwd, prompt);
}

