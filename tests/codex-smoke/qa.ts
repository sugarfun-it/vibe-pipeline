// 場景 1 — QA + codex(真 spawn,單輪)。
//
// QA AI 契約:回 JSON {message, options, complete, spec, splitInto?}。
// 用 raw spawn(adapter 的 '-a never' 在 codex 0.125.0 被拒絕,記 capability gap)。
// 同時跑 adapter 路徑記下 FAIL 證據。
//
// 跑法:bun tests/codex-smoke/qa.ts

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../server/lib/qa/claudeCli";
import { patchUserConfig, loadUserConfig, writeUserConfig } from "../../server/lib/domain/userConfig";

const cwd = mkdtempSync(join(tmpdir(), "vp-qa-codex-"));
const userMessage = "想把 vibe-pipeline 的 TopBar 加個 keyboard shortcuts cheatsheet 浮窗,按 ? 開";

// ── A) adapter 路徑(預期 FAIL,因 '-a never' bug) ─────────────────
const backup = await loadUserConfig();
const tA0 = Date.now();
let A: { ok: boolean; detail: string; ms: number };
try {
  await patchUserConfig({ defaults: { qa: { provider: "codex", model: "sonnet", effort: "low" } } });
  const reply = await runTurn({
    cwd,
    sessionId: crypto.randomUUID(),
    userMessage,
    isFirstTurn: true,
  });
  A = {
    ok: typeof reply.message === "string",
    detail: `adapter ok reply.message.len=${reply.message?.length ?? 0} complete=${reply.complete}`,
    ms: Date.now() - tA0,
  };
} catch (e) {
  A = { ok: false, detail: String(e).slice(0, 400), ms: Date.now() - tA0 };
} finally {
  await writeUserConfig(backup);
}
console.log(`[A adapter] ${A.ok ? "PASS" : "FAIL"} ${A.ms}ms: ${A.detail}`);

// ── B) raw spawn(繞 -a flag bug),驗 QA-style JSON 回應 ──────────
const QA_SYS = [
  "你是 vibe-pipeline 的需求 QA。每輪要回 single JSON object,不要任何其他文字、不要 markdown fence。",
  "格式: {\"message\": string, \"options\": string[], \"complete\": boolean, \"spec\": null|object}",
  "- message: 給 user 的下一句話(問題或確認)",
  "- options: 預設選項陣列(可空)",
  "- complete: 還沒收齊就 false",
  "- spec: 收齊前 null,收齊後填 {title,goal,acceptance,prompt,mode}",
  "現在開始第一輪。",
].join("\n");

const prompt = QA_SYS + "\n\n[User 第一句]\n" + userMessage + "\n\n回覆 JSON。";

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

await Bun.write(join(import.meta.dir, "logs", "qa.codex.stdout.jsonl"), out);
await Bun.write(join(import.meta.dir, "logs", "qa.codex.stderr.log"), err);

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

let parsed: any = null;
const trimmed = lastMsg.trim();
const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
const tryStr = fenced ? fenced[1].trim() : trimmed;
try { parsed = JSON.parse(tryStr); } catch {
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) try { parsed = JSON.parse(m[0]); } catch {}
}

const B = {
  ok: parsed != null && typeof parsed.message === "string",
  detail: parsed
    ? `raw 回 JSON message.len=${parsed.message?.length ?? 0} complete=${parsed.complete} options=${Array.isArray(parsed.options) ? parsed.options.length : "?"}`
    : `raw 解析失敗 lastMsg.len=${lastMsg.length}`,
  ms: msB,
  exit: proc.exitCode,
  usage,
  message_preview: parsed?.message?.slice?.(0, 120),
};
console.log(`[B raw  ] ${B.ok ? "PASS" : "FAIL"} ${msB}ms exit=${proc.exitCode}: ${B.detail}`);
if (usage) console.log(`         usage: input=${usage.input_tokens} cached=${usage.cached_input_tokens} output=${usage.output_tokens}`);
if (B.message_preview) console.log(`         preview: ${B.message_preview}`);

await Bun.write(join(import.meta.dir, "logs", "qa.json"), JSON.stringify({ A, B }, null, 2));
process.exit(B.ok ? 0 : 1);
