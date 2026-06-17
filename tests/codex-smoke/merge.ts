// 場景 4 — Merge + codex (config wire-through smoke,不實際跑 AI)。
//
// merge task class 由 backend code orchestrator 直接以 subagent spawn。
//
// 本檔驗:
// 1. patchUserConfig 寫 merge.provider=codex 後 getTaskConfigWithAdapter("merge") 回 CodexAdapter
// 2. CodexAdapter.spawn({kind:"merge"}) 這種舊呼叫仍會 throw
// 3. mergeTicketPrompt 拿 modelHint 後 prompt 內有對應字串
//
// 跑法:bun tests/codex-smoke/merge.ts

import { patchUserConfig, getTaskConfigWithAdapter, loadUserConfig, writeUserConfig } from "../../server/lib/domain/userConfig";
import { CodexAdapter } from "../../server/lib/cli/codexAdapter";
import { mergeTicketPrompt } from "../../server/lib/runner/mergeTicketPrompt";

const results: Record<string, { ok: boolean; detail: string }> = {};

async function step1() {
  const backup = await loadUserConfig();
  try {
    await patchUserConfig({ defaults: { merge: { provider: "codex", model: "opus", effort: "high" } } });
    const cfg = await getTaskConfigWithAdapter("merge");
    const ok = cfg.adapter instanceof CodexAdapter && cfg.provider === "codex";
    results.config_wire = {
      ok,
      detail: `provider=${cfg.provider} model=${cfg.model} effort=${cfg.effort} adapter=${cfg.adapter.name}`,
    };
  } finally {
    await writeUserConfig(backup);
  }
}

async function step2() {
  const adapter = new CodexAdapter();
  try {
    adapter.spawn({ kind: "merge" } as any);
    results.merge_spawn_throws = { ok: false, detail: "did not throw" };
  } catch (e) {
    results.merge_spawn_throws = { ok: true, detail: String(e).slice(0, 200) };
  }
}

async function step3() {
  const prompt = mergeTicketPrompt({
    projectPath: "/tmp/fake",
    branch: "feat/x",
    baseBranch: "main",
    strategy: "merge",
    history: [{ n: 1, title: "test", commits: [{ hash: "abc", subject: "init" }] }],
    modelHint: { model: "opus", effort: "high" },
  });
  const hasModel = prompt.includes("opus");
  const hasEffort = prompt.includes("high");
  results.merge_prompt_modelhint = {
    ok: hasModel,
    detail: `len=${prompt.length} hasModel=${hasModel} hasEffort=${hasEffort}`,
  };
}

await step1();
await step2();
await step3();

let pass = 0,
  fail = 0;
for (const [k, v] of Object.entries(results)) {
  const tag = v.ok ? "PASS" : "FAIL";
  if (v.ok) pass++;
  else fail++;
  console.log(`[${tag}] ${k}: ${v.detail}`);
}
console.log(`\nmerge smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
