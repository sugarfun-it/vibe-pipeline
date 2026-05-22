// CLI adapter helper:依 taskClass + provider 選對應 adapter。
// Ticket 2:provider 由 ~/.vibe-pipeline/config.json defaults.<taskClass>.provider 決定,
// caller 透過 userConfig.getTaskConfigWithAdapter() 一次拿 config + adapter。

import type { CliAdapter, TaskClass } from "./adapter";
import { ClaudeAdapter } from "./claudeAdapter";
import { CodexAdapter } from "./codexAdapter";
import type { Provider } from "../../../shared/types";

export type { CliAdapter, TaskClass } from "./adapter";
export type {
  SpawnOpts,
  QASpawnOpts,
  RunnerSpawnOpts,
  SplitSpawnOpts,
  SpawnedProcess,
} from "./adapter";
export { ClaudeAdapter } from "./claudeAdapter";
export { CodexAdapter } from "./codexAdapter";

const claudeAdapter = new ClaudeAdapter();
const codexAdapter = new CodexAdapter();

// 取 adapter。provider 缺省走 claude(舊 caller / 舊 config 相容)。
export function getAdapter(_taskClass: TaskClass, provider: Provider = "claude"): CliAdapter {
  if (provider === "codex") return codexAdapter;
  return claudeAdapter;
}
