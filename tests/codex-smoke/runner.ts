// 場景 3 — Runner + codex(降級為 wire smoke,不跑完整 orchestrator)。
//
// 驗:
// A) getTaskConfigWithAdapter('runner') 在 provider=codex 下回 CodexAdapter
// B) adapter.spawn({kind:'runner',...}) 起得來,印 codex stdout(同樣繞 -a flag bug:adapter 路徑預期 FAIL,raw spawn workspace-write PASS)
//
// 注意:不要求 file 真被建(codex sandbox + 短 prompt 通常不主動執行 shell)。
//
// 跑法:bun tests/codex-smoke/runner.ts

import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTaskConfigWithAdapter, patchUserConfig, loadUserConfig, writeUserConfig } from "../../server/lib/domain/userConfig";
import { CodexAdapter } from "../../server/lib/cli/codexAdapter";

const cwd = mkdtempSync(join(tmpdir(), "vp-runner-codex-"));
const backup = await loadUserConfig();

// ── A) config wire ──────────────────────────────────────────────
let A: { ok: boolean; detail: string };
try {
  await patchUserConfig({ defaults: { runner: { provider: "codex", model: "opus", effort: "medium" } } });
  const cfg = await getTaskConfigWithAdapter("runner");
  A = {
    ok: cfg.adapter instanceof CodexAdapter && cfg.provider === "codex",
    detail: `provider=${cfg.provider} model=${cfg.model} effort=${cfg.effort} adapter=${cfg.adapter.name}`,
  };
} catch (e) {
  A = { ok: false, detail: String(e) };
}
console.log(`[A config ] ${A.ok ? "PASS" : "FAIL"}: ${A.detail}`);

// ── B) adapter.spawn 走 runner kind(預期 FAIL,-a flag) ────────
const adapter = new CodexAdapter();
const tB0 = Date.now();
let B: { ok: boolean; detail: string; ms: number };
try {
  const proc = adapter.spawn({
    kind: "runner",
    cwd,
    sessionId: crypto.randomUUID(),
    initialMessage: "在 cwd 建一個叫 test-codex-runner.txt 的檔案,內容寫 hello。然後回報你做了什麼。",
    systemPrompt: "你是 vibe-pipeline runner 主 agent,可用 shell 改檔。最後一句總結你做了什麼。",
    model: "opus",
    effort: "medium",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  await Bun.write(join(import.meta.dir, "logs", "runner.adapter.stdout.jsonl"), out);
  await Bun.write(join(import.meta.dir, "logs", "runner.adapter.stderr.log"), err);
  B = {
    ok: proc.exitCode === 0,
    detail: `exit=${proc.exitCode} stdoutLen=${out.length} stderrLen=${err.length} stderrHead=${err.slice(0, 200)}`,
    ms: Date.now() - tB0,
  };
} catch (e) {
  B = { ok: false, detail: String(e).slice(0, 400), ms: Date.now() - tB0 };
}
console.log(`[B adapter] ${B.ok ? "PASS" : "FAIL"} ${B.ms}ms: ${B.detail}`);

// ── C) raw spawn workspace-write(繞 bug,證明 codex 跑得起 runner) ─
const RUNNER_SYS = "你是 vibe-pipeline runner 主 agent。可用 shell 改檔。完成任務後最後輸出一句總結你做了什麼。";
const initial = "在當前工作目錄建一個檔案 test-codex-runner.txt,內容寫 hello-from-codex。然後回報你做了什麼。";
const prompt = "[System]\n" + RUNNER_SYS + "\n\n[Task]\n" + initial;

const tC0 = Date.now();
const proc = Bun.spawn(
  [
    "codex",
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    "mcp_servers={}",
    "-C",
    cwd,
    "-s",
    "workspace-write",
    "--dangerously-bypass-approvals-and-sandbox",
    "--ephemeral",
    "-",
  ],
  { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" }
);
proc.stdin.write(prompt);
proc.stdin.end();
const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
await proc.exited;
const msC = Date.now() - tC0;

await Bun.write(join(import.meta.dir, "logs", "runner.codex.stdout.jsonl"), out);
await Bun.write(join(import.meta.dir, "logs", "runner.codex.stderr.log"), err);

let usage: any = null;
let lastMsg = "";
let toolCalls = 0;
for (const line of out.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (ev?.item?.type === "agent_message" && typeof ev.item.text === "string") lastMsg = ev.item.text;
    if (ev?.type === "turn.completed" && ev.usage) usage = ev.usage;
    if (ev?.type === "item.completed" && ev.item?.type && ev.item.type !== "agent_message") toolCalls++;
  } catch {}
}

const fileExists = existsSync(join(cwd, "test-codex-runner.txt"));
const C = {
  ok: proc.exitCode === 0 && lastMsg.length > 0,
  detail: `exit=${proc.exitCode} lastMsg.len=${lastMsg.length} toolCalls=${toolCalls} fileBuilt=${fileExists}`,
  ms: msC,
  usage,
  preview: lastMsg.slice(0, 200),
  fileExists,
};
console.log(`[C raw    ] ${C.ok ? "PASS" : "FAIL"} ${msC}ms: ${C.detail}`);
if (usage) console.log(`           usage: input=${usage.input_tokens} cached=${usage.cached_input_tokens} output=${usage.output_tokens}`);
console.log(`           preview: ${C.preview}`);

await writeUserConfig(backup);
await Bun.write(join(import.meta.dir, "logs", "runner.json"), JSON.stringify({ A, B, C }, null, 2));
process.exit(A.ok && C.ok ? 0 : 1);
