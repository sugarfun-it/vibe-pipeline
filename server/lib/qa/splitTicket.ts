// 一次性 claude CLI 呼叫,把一張 ticket 的 spec 拆成 N 張獨立 spec。
// 不走 QA 多輪對話,不存 draft;single-shot。
//
// 重要:不能用 inline backtick(踩過兩次),所有 inline code 用單引號或不框。

import { isTestMode, getSplitScript } from "../testMode";
import type { TicketSpec } from "../../../shared/types";
import { getTaskConfigWithAdapter } from "../domain/userConfig";

export class SplitError extends Error {
  constructor(public code: "not_available" | "exec_failed" | "parse_failed" | "empty_split", message: string) {
    super(message);
  }
}

const SPLIT_BEHAVIOR_PROMPT = [
  "你是 vibe-pipeline 的 ticket splitter。輸入是一張既有 ticket spec,輸出是把它拆成 N 張(N>=1)獨立可執行 ticket spec 的 JSON 陣列。",
  "",
  "## 輸出格式(嚴格)",
  "",
  "回應**必須**是單一 JSON 陣列,陣列元素是 ticket spec 物件:",
  "[",
  "  {",
  "    \"title\": string,           // 簡短(<=40 字),動詞開頭",
  "    \"goal\": string,            // 一句話講為什麼做這張(<=200 字)",
  "    \"acceptance\": string[],    // 驗收條件,每條獨立可驗證",
  "    \"prompt\": string,          // 給執行AI 的完整工作描述(可 markdown,通常 100-1500 字)",
  "    \"mode\": \"step\" | \"iter\",   // step=單次, iter=驗收 AI 來回逼到通過",
  "    \"iterLimit\"?: number,      // iter 模式上限輪數,預設 5,可省略",
  "    \"iterStopAtLimit\"?: boolean // iter 達上限是否整條停,預設 true,可省略",
  "  },",
  "  ...",
  "]",
  "",
  "**只回 JSON 陣列**。不要 markdown fence、不要解釋、不要前後綴。",
  "",
  "## 拆分原則",
  "",
  "- 看輸入 ticket 的 prompt / acceptance,識別「可獨立交付的 N 件事」",
  "- 每張 child ticket 必須:",
  "  - 自己 acceptance 完整可驗(不依賴其他 child 結果)",
  "  - 自己 prompt 完整可獨立派執行AI(不寫『見上一張』)",
  "  - 範圍適中(不要把 1 個改動拆成 10 張瑣碎 ticket;也不要把 5 件事塞 1 張)",
  "- title 動詞開頭,簡短具體(避免「Settings 補欄位」這種模糊;改「Settings 露 default base branch 欄位」具體點)",
  "- mode 選擇:",
  "  - 純機械改 / 寫一次過 → step",
  "  - 需要驗收 AI 反覆驗(衝突邏輯 / UX 體感 / 多重邊界)→ iter",
  "- **如果原 ticket 本來就是單一任務沒得拆,就回單元素陣列 `[<原 spec 略整理>]`,不要硬拆**",
  "",
  "## 不踩",
  "",
  "- 不要在 child prompt 寫「見原 ticket」/「見 ticket A」這種跨 ticket 引用",
  "- 不要產 acceptance 為單字串(必須是陣列)",
  "- 不要回 mode 為 'iterative' / 'one-shot' / 'loop' 等同義詞,只能 'step' / 'iter'",
  "- 不要塞 scope / loop / deliverable / dependsOn 這些非 spec 欄位",
].join("\n");

export type SplitResult = TicketSpec[];

// 把單一 ticket spec 拆成 N 張。
// cwd 用 project path(讓 claude CLI 有專案 context,雖然只 -p 一次過)。
export async function splitTicketSpec(opts: {
  cwd: string;
  spec: TicketSpec;
  projectHash?: string;
}): Promise<SplitResult> {
  const { cwd, spec, projectHash } = opts;

  // E2E mock:有設 split script 走預定義 splitInto;沒設則回單元素「不拆」path。
  // 真實拆要靠真 claude
  if (isTestMode()) {
    if (projectHash) {
      const scripted = getSplitScript(projectHash);
      if (scripted && scripted.length > 0) return scripted;
    }
    return [spec];
  }

  const userMessage = [
    "請拆以下 ticket(若不需拆回單元素陣列):",
    "",
    JSON.stringify(spec, null, 2),
  ].join("\n");

  // userMessage 走 stdin,別當 positional arg(Windows 下 --system-prompt 後接 long positional 會被
  // claude CLI 當成 input 缺失,踩過)
  // model:default haiku(便宜快;split 是結構化輸出,不需深度推理),但走 user config —
  // user 在 SettingsPopover 可改 provider / model / effort。
  const splitCfg = await getTaskConfigWithAdapter("split");
  let proc: import("../cli/adapter").SpawnedProcess;
  try {
    proc = splitCfg.adapter.spawn({
      kind: "split",
      cwd,
      userMessage,
      systemPrompt: SPLIT_BEHAVIOR_PROMPT,
      model: splitCfg.model,
      effort: splitCfg.effort,
    });
  } catch (e) {
    throw new SplitError("not_available", `${splitCfg.adapter.name} CLI not found: ${e}`);
  }
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new SplitError(
      "exec_failed",
      `${splitCfg.adapter.name} exited ${proc.exitCode}: ${stderrText.trim() || stdoutText.trim()}`
    );
  }

  // adapter.parseResult 統一抽取 LLM 最終訊息字串(claude=outer JSON.result;codex=JSONL agent_message)
  let innerStr: string;
  try {
    innerStr = splitCfg.adapter.parseResult("split", stdoutText);
  } catch (e) {
    throw new SplitError(
      "parse_failed",
      `${splitCfg.adapter.name} output not parseable: ${String(e).slice(0, 200)}`
    );
  }

  const arr = parseSplitArray(innerStr);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new SplitError("empty_split", "AI 回了空 / 非陣列,無法拆");
  }
  // 過濾 / coerce 每張 spec(沿用 QA enforceContract 邏輯,簡化版)
  const cleaned: TicketSpec[] = [];
  for (const raw of arr) {
    const c = coerceSpec(raw);
    if (c) cleaned.push(c);
  }
  if (cleaned.length === 0) {
    throw new SplitError("empty_split", "AI 回的陣列裡沒有合法 spec");
  }
  return cleaned;
}

function parseSplitArray(raw: string): unknown {
  // 1. fenced
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  // 2. raw trimmed
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  // 3. first [ ... ] inside text
  const arrM = trimmed.match(/\[[\s\S]*\]/);
  if (arrM) {
    try {
      return JSON.parse(arrM[0]);
    } catch {}
  }
  return null;
}

function coerceSpec(raw: unknown): TicketSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const goal = typeof o.goal === "string" ? o.goal.trim() : "";
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  let acceptance: string[] = [];
  if (Array.isArray(o.acceptance)) {
    acceptance = o.acceptance
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
  } else if (typeof o.acceptance === "string") {
    acceptance = (o.acceptance as string)
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*[-*•]?\s*\d*[.)]?\s*/, "").trim())
      .filter((s) => s.length > 0);
  }
  let mode: "step" | "iter" | null = null;
  if (typeof o.mode === "string") {
    const m = o.mode.toLowerCase();
    if (m === "step" || m === "single" || m === "one-shot" || m === "oneshot") mode = "step";
    else if (m === "iter" || m === "iterative" || m === "loop" || m === "iterate") mode = "iter";
  }
  if (!title || !goal || !prompt || acceptance.length === 0 || !mode) return null;
  const spec: TicketSpec = { title, goal, acceptance, prompt, mode };
  if (typeof o.iterLimit === "number" && o.iterLimit > 0)
    spec.iterLimit = Math.max(1, Math.min(5, Math.floor(o.iterLimit)));
  if (typeof o.iterStopAtLimit === "boolean") spec.iterStopAtLimit = o.iterStopAtLimit;
  return spec;
}
