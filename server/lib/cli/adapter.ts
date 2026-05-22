// CliAdapter:統一 claude / 將來 codex 等不同 AI CLI 的 spawn 介面。
// 4 處原本散落的 spawn(QA / runner / split / merge dispatch)走這層介面,
// adapter 內負責對應 CLI 的 args / parseReply 行為差異。
//
// 重要:每個 adapter 內 spawn 行為必須與既有實作 bit-exact 等價(包含 args 順序、
// stdin / stdout / stderr piping、cwd 行為)。本介面不做「優化」/「補強」,純抽象搬家。

import type { TicketSpec } from "../../../shared/types";
import type { QAReply } from "../qa/schema";

// 跟 shared/types 同步 — adapter.ts 維持自己一份(server/lib/cli 不依賴 shared)
export type TaskClass = "qa" | "runner" | "split" | "executor" | "critic" | "merge";

// QA spawn opts:多輪對話、--resume / --session-id 視 isFirstTurn 切。
export type QASpawnOpts = {
  kind: "qa";
  cwd: string;
  sessionId: string;
  userMessage: string;
  isFirstTurn: boolean;
  systemPrompt: string;           // first turn 帶 system prompt
  appendSystemPrompt?: string;    // follow-up turn 用 --append-system-prompt
  model: string;
  effort: string;
  // 之前已完成的輪次(不含本輪 userMessage)。
  // claude adapter:忽略(用 --resume sessionId 從 disk session 接續)。
  // codex adapter:isFirstTurn=false 時把 history 折成 transcript 串進 prompt,補上 codex 無 session resume 的失憶問題。
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

// Runner spawn opts:主 agent,長跑,系統 prompt 自定流程。
export type RunnerSpawnOpts = {
  kind: "runner";
  cwd: string;
  sessionId: string;
  initialMessage: string;
  systemPrompt: string;
  model: string;
  effort: string;
  // 跨 provider sub-agent(claude main → codex sub via codex-rescue plugin)需要
  // 放寬 Bash 權限 — 否則 Task sub-agent 想跑 `node .../codex-companion.mjs` 被
  // permission_denials 擋,主 agent 拿不到結果還會幻覺成功訊息(實測)。
  // 由 orchestrator 偵測 subAgent.provider===codex || merge.provider===codex 時 true。
  needsBypassPermissions?: boolean;
};

// Split spawn opts:one-shot,structured array output。
export type SplitSpawnOpts = {
  kind: "split";
  cwd: string;
  userMessage: string;            // 透過 stdin 餵入
  systemPrompt: string;
  model: string;                  // 通常 hard-coded haiku
  effort: string;
};

export type SpawnOpts = QASpawnOpts | RunnerSpawnOpts | SplitSpawnOpts;

// adapter spawn 結果:stdout/stderr 一律 pipe(ReadableStream),caller 直接 new Response(proc.stdout).text()
export type SpawnedProcess = Bun.PipedSubprocess;

export type ParseQA = (rawStdout: string) => QAReply;
export type ParseSplit = (rawStdout: string) => TicketSpec[] | null;

export interface CliAdapter {
  readonly name: string;

  // 檢查 CLI 是否在 PATH 可呼叫(--version 試 spawn)
  checkAvailable(): Promise<boolean>;

  // 起一個對應 task class 的子行程
  spawn(opts: SpawnOpts): SpawnedProcess;

  // 從 stdout 萃取「LLM 最終訊息文字」(callers 再丟給 parseReply / parseSplitArray)。
  // claude:JSON.parse(stdout).result;codex:JSONL 掃 agent_message,或 fallback last line。
  // 拋例外 = 解析失敗,caller 走 parse_failed code。
  parseResult(kind: "qa" | "split" | "runner", stdout: string): string;
}
