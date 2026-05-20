// ClaudeAdapter:把既有 4 處 claude CLI spawn 行為搬進統一介面。
// 行為必須 bit-exact 對齊原檔(server/lib/qa/claudeCli.ts、splitTicket.ts、runner/orchestrator.ts):
// args 順序、flag 內容、stdin/stdout/stderr 設定都不能變。
//
// 任何修改/優化都不該寫在這裡 — 這層只負責「搬家」。

import { runCapture, spawnStreaming } from "../spawn";
import type {
  CliAdapter,
  CliCapabilities,
  QASpawnOpts,
  RunnerSpawnOpts,
  SplitSpawnOpts,
  SpawnOpts,
  SpawnedProcess,
} from "./adapter";

// Windows cmd.exe re-tokenize bug(Ruflo issue #1852):長 prompt 當 positional arg 經 cmd.exe
// 再解析會被 re-tokenize → 引號 / 空白 / 控制字元錯位。永遠把 prompt 走 stdin 不走 positional。
// Nested Claude Code session 偵測(Ruflo issue #1395):claude CLI 看到 CLAUDE_SESSION_ID /
// CLAUDE_PARENT_SESSION_ID env 會誤判為 nested session 拒跑。spawn 前刪掉並標 entrypoint=worker。
function workerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.CLAUDE_ENTRYPOINT = "worker";
  delete env.CLAUDE_SESSION_ID;
  delete env.CLAUDE_PARENT_SESSION_ID;
  return env;
}

export class ClaudeAdapter implements CliAdapter {
  readonly name = "claude";

  readonly capabilities: CliCapabilities = {
    supportsSessionResume: true,
    supportsTaskDispatch: true,
    supportsStreamJson: true,
    supportsToolWhitelist: true,
  };

  async checkAvailable(): Promise<boolean> {
    const r = await runCapture(["claude", "--version"]);
    return r.ok;
  }

  spawn(opts: SpawnOpts): SpawnedProcess {
    if (opts.kind === "qa") return spawnQA(opts);
    if (opts.kind === "runner") return spawnRunner(opts);
    if (opts.kind === "split") return spawnSplit(opts);
    // "merge" 目前不獨立 spawn — merge ticket 走 runner 主 agent + Task tool 路徑;
    // 保留 placeholder 給未來其他 CLI(例如 codex)若改成獨立 spawn 模式時填。
    throw new Error("ClaudeAdapter: 'merge' task class 不獨立 spawn,呼叫端應走 orchestrator.start");
  }

  parseResult(_kind: "qa" | "split" | "runner", stdout: string): string {
    // claude --output-format json 包成 { type:"result", result:"<text>", session_id, ... }
    const outerJson = JSON.parse(stdout) as { result?: string; text?: string; [k: string]: unknown };
    const inner = outerJson.result ?? outerJson.text ?? outerJson;
    return typeof inner === "string" ? inner : JSON.stringify(inner);
  }
}

function spawnQA(opts: QASpawnOpts): SpawnedProcess {
  const { cwd, sessionId, userMessage, isFirstTurn, systemPrompt, appendSystemPrompt, model, effort } = opts;
  const args = [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--effort",
    effort,
  ];
  // 隔離 flags(QA 不能加 --no-session-persistence,follow-up turn 需 --resume 讀 disk)
  // 註:刻意不加 --setting-sources ""。QA 少用、要的是準確 —— 載 user CLAUDE.md +
  // skills 索引讓 QA AI 拿到 project 脈絡(否則只有 QA_BEHAVIOR_PROMPT,專案知識零,
  // spec 品質落差大)。token cost +~19k/spawn 可接受(rare path)。
  args.push("--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
  args.push("--disable-slash-commands");
  args.push("--disallowedTools", "Edit Write Task");
  if (isFirstTurn) {
    args.push("--session-id", sessionId);
    args.push("--system-prompt", systemPrompt);
  } else {
    args.push("--resume", sessionId);
    if (appendSystemPrompt !== undefined) {
      args.push("--append-system-prompt", appendSystemPrompt);
    }
  }
  // prompt 走 stdin(雷區:Windows cmd.exe re-tokenize)
  const proc = spawnStreaming<SpawnedProcess>(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: workerEnv(),
  });
  const sink = proc.stdin as { write: (s: string) => unknown; end: () => unknown };
  sink.write(userMessage);
  sink.end();
  return proc;
}

function spawnRunner(opts: RunnerSpawnOpts): SpawnedProcess {
  const { cwd, sessionId, initialMessage, systemPrompt, model, effort, needsBypassPermissions } = opts;
  const args = [
    "claude",
    "-p",
    "--output-format",
    "json",
    // perf:保留 --setting-sources 預設(user/project/local),因為 Task sub-agent 改 source code 時
    // 仍可能需要 user CLAUDE.md / project lint config 等繼承。
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--no-session-persistence",
    "--disable-slash-commands",
    "--session-id",
    sessionId,
    "--model",
    model,
    "--effort",
    effort,
  ];
  // 跨 provider:Task(codex-rescue) sub-agent 需要 Bash 跑 codex-companion.mjs,
  // user 設 `permissions.defaultMode: auto` 對這種 absolute path node 不一定吃,
  // 實測會 permission_denials → 主 agent 幻覺成功。同 provider (純 claude) 不需要。
  if (needsBypassPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  args.push("--system-prompt", systemPrompt);
  // initialMessage 走 stdin(雷區:Windows cmd.exe re-tokenize)
  const proc = spawnStreaming<SpawnedProcess>(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: workerEnv(),
  });
  const sink = proc.stdin as { write: (s: string) => unknown; end: () => unknown };
  sink.write(initialMessage);
  sink.end();
  return proc;
}

function spawnSplit(opts: SplitSpawnOpts): SpawnedProcess {
  const { cwd, systemPrompt, model, effort, userMessage } = opts;
  const args = [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--effort",
    effort,
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--no-session-persistence",
    "--disable-slash-commands",
    "--system-prompt",
    systemPrompt,
    "--disallowedTools",
    "Edit Write Task",
  ];
  const proc = spawnStreaming<SpawnedProcess>(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: workerEnv(),
  });
  // userMessage 走 stdin(沿用既有行為);呼叫端不再自己寫 stdin
  proc.stdin.write(userMessage);
  proc.stdin.end();
  return proc;
}
