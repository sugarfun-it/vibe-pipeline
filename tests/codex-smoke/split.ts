// 場景 2 — Split + codex(真 spawn)。
//
// 預期走 splitTicketSpec → CodexAdapter.spawnSplit。但 ticket 2 落地的 adapter 帶 '-a never',
// codex 0.125.0 已移除 -a/--approval-policy(sandbox mode 取代),spawn 直接 exit 2。
//
// 本 smoke 分兩段:
//  A) 跑 splitTicketSpec(預期 FAIL,記錄 stderr,證實 adapter bug)
//  B) raw spawn codex(繞過 adapter,證明 codex CLI 本身可拆 ticket),解 JSONL,coerceSpec
//
// 跑法:bun tests/codex-smoke/split.ts

import { patchUserConfig, loadUserConfig, writeUserConfig } from "../../server/lib/domain/userConfig";
import { splitTicketSpec } from "../../server/lib/qa/splitTicket";
import type { TicketSpec } from "../../shared/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spec: TicketSpec = {
  title: "重構 settings 頁 + 加 keyboard shortcuts 文檔",
  goal: "把 settings 頁的三段分頁拆成獨立元件,並順帶補一份 keyboard shortcuts 對照表 doc",
  acceptance: [
    "settings 頁拆成 SettingsGeneral / SettingsAccount / SettingsAdvanced 三個元件",
    "docs/keyboard-shortcuts.md 列出所有快捷鍵",
  ],
  prompt:
    "把 src/features/settings/SettingsPopover.tsx 三段 section 拆成獨立 component 檔(同目錄),並新增 docs/keyboard-shortcuts.md 收錄目前 App 內所有快捷鍵。",
  mode: "step",
};

const backup = await loadUserConfig();
const cwd = mkdtempSync(join(tmpdir(), "vp-split-codex-"));

// ── A) 走 adapter ───────────────────────────────────────────────
const tA0 = Date.now();
let A: { ok: boolean; detail: string; ms: number };
try {
  await patchUserConfig({ defaults: { split: { provider: "codex", model: "haiku", effort: "low" } } });
  const arr = await splitTicketSpec({ cwd, spec });
  A = { ok: arr.length >= 1, detail: `adapter 回 ${arr.length} spec`, ms: Date.now() - tA0 };
} catch (e) {
  A = { ok: false, detail: String(e).slice(0, 400), ms: Date.now() - tA0 };
} finally {
  await writeUserConfig(backup);
}
console.log(`[A adapter] ${A.ok ? "PASS" : "FAIL"} ${A.ms}ms: ${A.detail}`);

// ── B) raw spawn,繞過 -a flag bug ───────────────────────────────
const SPLIT_SYS = [
  "你是 vibe-pipeline 的 ticket splitter。",
  "輸入是一張 ticket spec(JSON 物件),你必須輸出一個 JSON 陣列 [{title,goal,acceptance,prompt,mode}, ...]。",
  "- title: string, goal: string, acceptance: string[], prompt: string, mode: 'step'|'iter'",
  "- 每張 child ticket 自包含,自己 acceptance 可獨立驗證",
  "- 若不需拆,回單元素陣列",
  "輸出**必須**是 JSON 陣列,不要任何前後綴文字,不要 markdown code fence,不要解釋。",
  "你的整個回應就是那個 JSON 陣列。",
].join("\n");
const userMsg = JSON.stringify(spec, null, 2);
const prompt = SPLIT_SYS + "\n\n請把下面這張 ticket 拆成獨立可執行的 child ticket 陣列(若不需拆回單元素陣列):\n\n" + userMsg + "\n\n直接輸出 JSON 陣列,不要任何其他文字。";

const tB0 = Date.now();
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
    "read-only",
    "--ephemeral",
    "-",
  ],
  { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" }
);
proc.stdin.write(prompt);
proc.stdin.end();
const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
await proc.exited;
const msB = Date.now() - tB0;

await Bun.write(join(import.meta.dir, "logs", "split.codex.stdout.jsonl"), out);
await Bun.write(join(import.meta.dir, "logs", "split.codex.stderr.log"), err);

let usage: any = null;
let lastMsg = "";
for (const line of out.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (ev?.item?.type === "agent_message" && typeof ev.item.text === "string") lastMsg = ev.item.text;
    if (ev?.type === "turn.completed" && ev.usage) usage = ev.usage;
  } catch {}
}

let arr: any = null;
const trimmed = lastMsg.trim();
const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
const tryParse = fenced ? fenced[1].trim() : trimmed;
try {
  arr = JSON.parse(tryParse);
} catch {
  const m = trimmed.match(/\[[\s\S]*\]/);
  if (m) try { arr = JSON.parse(m[0]); } catch {}
}

const B = {
  ok: Array.isArray(arr) && arr.length >= 1,
  detail: Array.isArray(arr) ? `raw 回 ${arr.length} spec` : `raw 解析失敗 lastMsg.len=${lastMsg.length}`,
  ms: msB,
  exit: proc.exitCode,
  usage,
  arrSample: Array.isArray(arr) ? arr.slice(0, 3).map((s: any) => ({ title: s.title, mode: s.mode, acc: Array.isArray(s.acceptance) ? s.acceptance.length : 0 })) : null,
};
console.log(`[B raw  ] ${B.ok ? "PASS" : "FAIL"} ${msB}ms exit=${proc.exitCode}: ${B.detail}`);
if (usage) console.log(`         usage: input=${usage.input_tokens} cached=${usage.cached_input_tokens} output=${usage.output_tokens}`);
if (B.arrSample) console.log(`         sample: ${JSON.stringify(B.arrSample)}`);

await Bun.write(
  join(import.meta.dir, "logs", "split.json"),
  JSON.stringify({ A, B }, null, 2)
);
process.exit(B.ok ? 0 : 1);
