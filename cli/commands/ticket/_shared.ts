import * as pipelineStore from "../../../server/lib/domain/pipeline";
import type { ParsedArgs } from "../../lib/args";
import { fail } from "../../lib/output";
import type { Ticket } from "../../../shared/types";

export const TICKET_USAGE = `vbpl ticket — manage tickets within a pipeline

  vbpl ticket list   --pipeline <id>
  vbpl ticket show   --pipeline <id> --ticket <n|id>
  vbpl ticket add    --pipeline <id> --title <t> --goal <g> --prompt <p> --acceptance <a> [--mode step|iter] [--iter-limit <n>]
  vbpl ticket update --pipeline <id> --ticket <n|id> [--title ...] [--goal ...] [--prompt ...] [--acceptance ...] [--mode step|iter] [--status ...] [--iter-limit <n>]
  vbpl ticket remove --pipeline <id> --ticket <n|id>

  --pipeline / --ticket also accept first / second positional arg.

  Long / multi-line fields (Windows cmd shim mangles newlines in args):
    --goal-file <path>        從檔讀;值為 "-" 走 stdin
    --prompt-file <path>      從檔讀;值為 "-" 走 stdin
    --acceptance-file <path>  從檔讀;值為 "-" 走 stdin
  --acceptance items: 用 ; 或換行分隔;單條免分隔。
  注意:同一條指令只能有一個 *-file 用 "-" 讀 stdin(stream 只能消費一次)。

  Bulk input 模式(避 shell quoting + 一次塞所有 text 欄位,推薦給 agent 用):
    --input-json <path|->     讀 JSON {title, goal, prompt, acceptance}。acceptance 可
                              是 string[](推薦)或 string(用 ; / 換行 分隔)。
                              個別 --title / --goal / ... inline flag 仍可覆寫 JSON 欄位。
                              update 用:JSON 內出現的欄位才更新,缺的保留原值。
                              --input-json - 跟其他 *-file - 互斥(stdin 只能消費一次)。
                              可跟全域 --json output mode 同時用(input/output 分離)。

    範例(agent heredoc,markdown 含 backtick / $ / ! 全部安全):
      vbpl ticket add --pipeline X --input-json - --json <<'EOF'
      {"title":"...","goal":"...","prompt":"...","acceptance":["a","b"]}
      EOF

  ─────────────────────────────────────────────────────────────────
  ★ 三欄分流(寫對才不會白跑 — runner 對 goal/prompt/acceptance 讀法不同)

  goal        UI display + git commit body + critic 不讀
              → 給「人類」看(列表 preview / git log)
              → 1 句「一塊完整可交付是什麼」
              → 上限:≤ 80 char(120 hard cap)
  prompt      executor sub-agent 真實讀的指示(runnerPrompt.ts:173)
              → 給「executor AI」看
              → 實作規則 / 範圍 / 風險點 / Why
              → 上限:不限,中等(500-2000 char 合理)
  acceptance  critic 結構化驗收 + executor 一併收到「驗收條件」
              → 給「executor + critic」看
              → array of strings,每條 1 行可機械驗(grep / tsc / build / 行為等價)
              → 上限:5-10 條,每條 ≤ 100 char

  踩雷:把整份 spec 塞 goal → executor 收到空白 prompt + critic 收空 acceptance,兩個 AI 都在猜。

  建 ticket 前自查:
    1. goal 一句塞得下嗎?塞不下 → 內容該移 prompt(或拆 ticket)
    2. prompt 是 executor 該怎麼動手嗎?(規則 / 範圍 / 風險點)
    3. acceptance 每條 critic 能機械驗嗎?(寫「程式碼乾淨」這種主觀條件 = critic 抓不到)
    4. 用 --input-json - <<'EOF' heredoc(別 inline 各 flag,避 shell quoting + 一次填齊三欄)

  更多範例 / 拆 ticket 原則:看 ~/.claude/skills/vibe-pipeline/SKILL.md
  ─────────────────────────────────────────────────────────────────`;

// goal 上限 — 對應 runner 用法(UI display + git commit body + critic 不讀):
// - runner mergeTicketPrompt.ts 已 truncate(200);超過直接被切掉
// - git commit message 慣例 72/行;120 = 1-2 行給人類掃讀 OK
// - 超過 = 用戶把 spec / 規則 / acceptance 全塞 goal,該分流到 --prompt / --acceptance
// 詳見 ~/.claude/skills/vibe-pipeline/SKILL.md「三欄分流」段。
export const MAX_GOAL_CHARS = 120;

export function validateGoal(goal: string): void {
  if (goal.length <= MAX_GOAL_CHARS) return;
  fail(
    "INVALID_ARGS",
    `--goal 超過 ${MAX_GOAL_CHARS} char(實際 ${goal.length}),runner 只用 goal 做「UI display + git commit body」,寫長無效。\n\n` +
      `三欄分流:\n` +
      `  goal       1 句「一塊完整可交付是什麼」(≤ 80 char 最佳, ${MAX_GOAL_CHARS} hard cap)→ 給人類\n` +
      `  prompt     實作規則 / 範圍 / 風險點 / Why → 給 executor sub-agent\n` +
      `  acceptance array of strings,每條機械可驗 → 給 critic + executor\n\n` +
      `修法:goal 縮成 1 句,規則 / 風險點移 --prompt,驗收條件移 --acceptance。\n` +
      `範例見 \`vbpl ticket add --help\`(看「★ 三欄分流」段)或 ~/.claude/skills/vibe-pipeline/SKILL.md`,
  );
}

// 讀 multi-line 文字 arg:優先 --<name>-file(path 或 "-"=stdin),fallback --<name> inline。
// stdinClaim 共享計數,保證一條指令只一個 *-file 吃 stdin(stream 只能消費一次)。
export async function readTextArg(
  args: ParsedArgs,
  name: string,
  stdinClaim: { v: boolean },
): Promise<string | undefined> {
  const fileFlag = args.flags[`${name}-file`];
  if (typeof fileFlag === "string" && fileFlag.length > 0) {
    if (fileFlag === "-") {
      if (stdinClaim.v) fail("INVALID_ARGS", `--${name}-file: 同指令已有別的 *-file 占用 stdin,只能擇一`);
      stdinClaim.v = true;
      return await Bun.stdin.text();
    }
    try {
      return await Bun.file(fileFlag).text();
    } catch (e) {
      fail("IO_ERROR", `--${name}-file: 讀檔失敗 ${fileFlag}: ${(e as Error).message}`);
    }
  }
  const inline = args.flags[name];
  return typeof inline === "string" ? inline : undefined;
}

// acceptance 拆 N 條:支援 ; 或換行(file 模式常見一行一條)+ trim + 過濾空字串
export function splitAcceptance(raw: string): string[] {
  return raw.split(/[;\r\n]+/).map((s) => s.trim()).filter(Boolean);
}

export type JsonInput = {
  title?: string;
  goal?: string;
  prompt?: string;
  acceptance?: string | string[];
};

// --input-json <path|->:讀 bulk JSON 輸入。給 agent 用 heredoc 一次塞所有 text 欄位,避 shell quoting 雷。
// 跟 *-file - 共用 stdinClaim(一條指令 stdin 只能被一個 reader 消費)。
// 命名故意跟全域 --json output mode 區分,兩者可同時使用(in/out 分離)。
export async function readJsonInput(
  args: ParsedArgs,
  stdinClaim: { v: boolean },
): Promise<JsonInput | undefined> {
  const v = args.flags["input-json"];
  if (typeof v !== "string" || v.length === 0) return undefined;
  let raw: string;
  if (v === "-") {
    if (stdinClaim.v) fail("INVALID_ARGS", "--input-json -: 同指令已有別的 *-file 占用 stdin,只能擇一");
    stdinClaim.v = true;
    raw = await Bun.stdin.text();
  } else {
    try {
      raw = await Bun.file(v).text();
    } catch (e) {
      fail("IO_ERROR", `--input-json: 讀檔失敗 ${v}: ${(e as Error).message}`);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw!);
  } catch (e) {
    fail("INVALID_ARGS", `--input-json: JSON 解析失敗: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("INVALID_ARGS", "--input-json: 內容必須是 object {title, goal, prompt, acceptance}");
  }
  return parsed as JsonInput;
}

// 從 JSON 取單一文字欄位,並 normalize 成 string | undefined(allow null = unset)
export function jsonText(j: JsonInput | undefined, key: keyof JsonInput): string | undefined {
  if (!j) return undefined;
  const v = j[key];
  return typeof v === "string" ? v : undefined;
}

// acceptance 從 JSON 取:string[] 直接用,string 走 splitAcceptance,缺 = undefined
export function jsonAcceptance(j: JsonInput | undefined): string[] | undefined {
  if (!j) return undefined;
  const a = j.acceptance;
  if (Array.isArray(a)) return a.map((s) => String(s).trim()).filter(Boolean);
  if (typeof a === "string") return splitAcceptance(a);
  return undefined;
}

export function getPipelineId(args: ParsedArgs): string {
  const id = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  if (!id) fail("INVALID_ARGS", "Specify pipeline id with --pipeline <id> or as first positional arg");
  return id;
}

export async function readPipeline(projectPath: string, pipelineId: string) {
  const pipeline = await pipelineStore.readPipeline(projectPath, pipelineId) as {
    id: string;
    name: string;
    state: string;
    tickets: Ticket[];
    [k: string]: unknown;
  } | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${pipelineId}`);
  return pipeline!;
}
