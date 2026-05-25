import * as pipelineDir from "../../server/lib/pipelineDir";
import { resolveProject, requireInit } from "../lib/project";
import type { ParsedArgs } from "../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../lib/output";
import type { Ticket, TicketMode, TicketStatus } from "../../shared/types";

const TICKET_USAGE = `vbpl ticket — manage tickets within a pipeline

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
      EOF`;

export async function runTicket(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(TICKET_USAGE);
    return;
  }
  switch (sub) {
    case "list":   return ticketList(args);
    case "show":   return ticketShow(args);
    case "add":    return ticketAdd(args);
    case "update": return ticketUpdate(args);
    case "remove": return ticketRemove(args);
    default:
      fail("INVALID_ARGS", `Unknown ticket subcommand: ${sub ?? "(none)"}. Use list|show|add|update|remove (or 'vbpl ticket help')`);
  }
}

// 讀 multi-line 文字 arg:優先 --<name>-file(path 或 "-"=stdin),fallback --<name> inline。
// stdinClaim 共享計數,保證一條指令只一個 *-file 吃 stdin(stream 只能消費一次)。
async function readTextArg(
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
function splitAcceptance(raw: string): string[] {
  return raw.split(/[;\r\n]+/).map((s) => s.trim()).filter(Boolean);
}

type JsonInput = {
  title?: string;
  goal?: string;
  prompt?: string;
  acceptance?: string | string[];
};

// --input-json <path|->:讀 bulk JSON 輸入。給 agent 用 heredoc 一次塞所有 text 欄位,避 shell quoting 雷。
// 跟 *-file - 共用 stdinClaim(一條指令 stdin 只能被一個 reader 消費)。
// 命名故意跟全域 --json output mode 區分,兩者可同時使用(in/out 分離)。
async function readJsonInput(
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
function jsonText(j: JsonInput | undefined, key: keyof JsonInput): string | undefined {
  if (!j) return undefined;
  const v = j[key];
  return typeof v === "string" ? v : undefined;
}

// acceptance 從 JSON 取:string[] 直接用,string 走 splitAcceptance,缺 = undefined
function jsonAcceptance(j: JsonInput | undefined): string[] | undefined {
  if (!j) return undefined;
  const a = j.acceptance;
  if (Array.isArray(a)) return a.map((s) => String(s).trim()).filter(Boolean);
  if (typeof a === "string") return splitAcceptance(a);
  return undefined;
}

function getPipelineId(args: ParsedArgs): string {
  const id = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  if (!id) fail("INVALID_ARGS", "Specify pipeline id with --pipeline <id> or as first positional arg");
  return id;
}

async function readPipeline(projectPath: string, pipelineId: string) {
  const pipeline = await pipelineDir.readPipeline(projectPath, pipelineId) as {
    id: string;
    name: string;
    state: string;
    tickets: Ticket[];
    [k: string]: unknown;
  } | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${pipelineId}`);
  return pipeline!;
}

async function ticketList(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const pipelineId = getPipelineId(args);
  const pipeline = await readPipeline(proj.path, pipelineId);
  const tickets = pipeline.tickets ?? [];

  if (isJsonMode()) {
    okJson(tickets);
    return;
  }
  if (tickets.length === 0) {
    print("No tickets.");
    return;
  }
  const rows: string[][] = [["N", "TITLE", "STATUS", "MODE"]];
  for (const t of tickets) {
    rows.push([String(t.n), t.title, t.status, t.mode]);
  }
  printLines([table(rows)]);
}

async function ticketShow(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const pipelineId = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  const ticketN = typeof args.flags["ticket"] === "string" ? args.flags["ticket"] : args.positional[1];
  if (!pipelineId || !ticketN) {
    fail("INVALID_ARGS", "Usage: vbpl ticket show --pipeline <id> --ticket <n|id>");
  }
  const pipeline = await readPipeline(proj.path, pipelineId!);
  const tickets = pipeline.tickets ?? [];
  const ticket = tickets.find((t) => String(t.n) === ticketN || t.id === ticketN);
  if (!ticket) fail("NO_TICKET", `Ticket ${ticketN} not found in pipeline ${pipelineId}`);

  if (isJsonMode()) {
    okJson(ticket);
    return;
  }
  printLines([
    `n:          ${ticket!.n}`,
    `id:         ${ticket!.id}`,
    `title:      ${ticket!.title}`,
    `mode:       ${ticket!.mode}`,
    `status:     ${ticket!.status}`,
    `goal:       ${ticket!.goal ?? "-"}`,
    `prompt:     ${ticket!.prompt ?? "-"}`,
    `acceptance: ${(ticket!.acceptance ?? []).join("; ") || "-"}`,
    `iterLimit:  ${ticket!.iterLimit ?? "-"}`,
  ]);
}

async function ticketAdd(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);

  // Pipeline id: --pipeline flag or first positional
  const pipelineId = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  if (!pipelineId) fail("INVALID_ARGS", "Usage: vbpl ticket add --pipeline <id> --title <title> --goal <goal> --prompt <prompt> --acceptance \"a;b\" [--mode step|iter]");

  const stdinClaim = { v: false };
  // --input-json 先讀(可能占用 stdin),inline / *-file flag 覆寫個別欄位
  const jsonIn = await readJsonInput(args, stdinClaim);

  const title = ((await readTextArg(args, "title", stdinClaim)) ?? jsonText(jsonIn, "title") ?? "").trim();
  if (!title) fail("INVALID_ARGS", "--title is required");

  const goal = ((await readTextArg(args, "goal", stdinClaim)) ?? jsonText(jsonIn, "goal") ?? "").trim();
  if (!goal) fail("INVALID_ARGS", "--goal is required (一句話描述這 ticket 做什麼;runner 不用但給人 review)。多行可用 --goal-file <path> / --goal-file - / --input-json -");

  const prompt = ((await readTextArg(args, "prompt", stdinClaim)) ?? jsonText(jsonIn, "prompt") ?? "").trim();
  if (!prompt) fail("INVALID_ARGS", "--prompt is required (給 executor 的完整任務指示)。多行可用 --prompt-file <path> / --prompt-file - / --input-json -");

  const acceptanceRaw = await readTextArg(args, "acceptance", stdinClaim);
  const acceptance = acceptanceRaw ? splitAcceptance(acceptanceRaw) : (jsonAcceptance(jsonIn) ?? []);
  if (acceptance.length === 0) fail("INVALID_ARGS", "--acceptance is required (critic 拿來判 PASS/FAIL)。單條免分隔,多條用 ; 或換行分隔;或用 --acceptance-file <path> / --input-json -");
  const rawMode = typeof args.flags["mode"] === "string" ? args.flags["mode"] : "step";
  const mode: TicketMode = (rawMode === "iter" ? "iter" : "step");
  const iterLimit = typeof args.flags["iter-limit"] === "string" ? Number(args.flags["iter-limit"]) : undefined;

  const pipeline = await readPipeline(proj.path, pipelineId!);
  const existingTickets = pipeline.tickets ?? [];
  const n = existingTickets.reduce((m, t) => Math.max(m, typeof t.n === "number" ? t.n : 0), 0) + 1;
  const ts = Date.now().toString(16).padStart(12, "0");

  const ticket: Ticket = {
    id: `t${n}-${ts}`,
    n,
    title: title!,
    goal,
    acceptance,
    prompt,
    mode,
    status: "ready",
    ...(iterLimit != null && !isNaN(iterLimit) ? { iterLimit } : {}),
  };

  await pipelineDir.mutatePipeline(proj.path, pipelineId!, (p) => ({
    ...p,
    tickets: [...(p.tickets ?? []), ticket],
  }), {
    source: "cli-ticket-add",
    sourceDetail: `add ticket ${ticket.title}`,
  });

  if (isJsonMode()) {
    okJson(ticket);
    return;
  }
  print(`Added ticket ${n}: ${title!} (${mode}) to pipeline ${pipelineId}`);
}

async function ticketUpdate(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);

  const pipelineId = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  const ticketRef = typeof args.flags["ticket"] === "string" ? args.flags["ticket"] : args.positional[1];
  if (!pipelineId || !ticketRef) {
    fail("INVALID_ARGS", "Usage: vbpl ticket update --pipeline <id> --ticket <n|id> [--title ...] [--goal ...] [--prompt ...] [--acceptance \"a;b\"] [--mode step|iter] [--status ...] [--iter-limit <n>]");
  }

  const pipeline = await readPipeline(proj.path, pipelineId!);
  const tickets = pipeline.tickets ?? [];
  const idx = tickets.findIndex((t) => String(t.n) === ticketRef || t.id === ticketRef);
  if (idx === -1) fail("NO_TICKET", `Ticket ${ticketRef} not found`);

  const orig = tickets[idx];
  const updated: Ticket = { ...orig };

  const stdinClaim = { v: false };
  const jsonIn = await readJsonInput(args, stdinClaim);

  const newTitle = (await readTextArg(args, "title", stdinClaim)) ?? jsonText(jsonIn, "title");
  if (newTitle !== undefined) updated.title = newTitle;
  const newGoal = (await readTextArg(args, "goal", stdinClaim)) ?? jsonText(jsonIn, "goal");
  if (newGoal !== undefined) updated.goal = newGoal;
  const newPrompt = (await readTextArg(args, "prompt", stdinClaim)) ?? jsonText(jsonIn, "prompt");
  if (newPrompt !== undefined) updated.prompt = newPrompt;
  const newAcceptanceRaw = await readTextArg(args, "acceptance", stdinClaim);
  if (newAcceptanceRaw !== undefined) {
    updated.acceptance = splitAcceptance(newAcceptanceRaw);
  } else {
    const fromJson = jsonAcceptance(jsonIn);
    if (fromJson !== undefined) updated.acceptance = fromJson;
  }
  if (typeof args.flags["mode"] === "string") {
    const m = args.flags["mode"];
    updated.mode = (m === "iter" ? "iter" : "step") as TicketMode;
    // 切到 iter 但原 ticket 無 iter 結構 → 補預設;反向切 step 保留 iter(user 反悔餘地)
    if (updated.mode === "iter" && !updated.iter) {
      updated.iter = { current: 0, stage: "doer", verdicts: [], rounds: [] };
    }
  }
  if (typeof args.flags["status"] === "string") {
    updated.status = args.flags["status"] as TicketStatus;
  }
  if (typeof args.flags["iter-limit"] === "string") {
    const n = Number(args.flags["iter-limit"]);
    if (!isNaN(n)) updated.iterLimit = n;
  }

  await pipelineDir.mutatePipeline(proj.path, pipelineId!, (p) => {
    const arr = [...(p.tickets ?? [])];
    const i = arr.findIndex((t) => String(t.n) === ticketRef || t.id === ticketRef);
    if (i !== -1) arr[i] = updated;
    return { ...p, tickets: arr };
  }, {
    source: "cli-ticket-update",
    sourceDetail: `update ticket ${ticketRef}`,
  });

  if (isJsonMode()) {
    okJson(updated);
    return;
  }
  print(`Updated ticket ${orig.n}: ${updated.title}`);
}

async function ticketRemove(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);

  const pipelineId = typeof args.flags["pipeline"] === "string" ? args.flags["pipeline"] : args.positional[0];
  const ticketRef = typeof args.flags["ticket"] === "string" ? args.flags["ticket"] : args.positional[1];
  if (!pipelineId || !ticketRef) {
    fail("INVALID_ARGS", "Usage: vbpl ticket remove --pipeline <id> --ticket <n|id>");
  }

  const pipeline = await readPipeline(proj.path, pipelineId!);
  const tickets = pipeline.tickets ?? [];
  const idx = tickets.findIndex((t) => String(t.n) === ticketRef || t.id === ticketRef);
  if (idx === -1) fail("NO_TICKET", `Ticket ${ticketRef} not found`);

  const removed = tickets[idx];
  await pipelineDir.mutatePipeline(proj.path, pipelineId!, (p) => ({
    ...p,
    tickets: (p.tickets ?? []).filter((t) => !(String(t.n) === ticketRef || t.id === ticketRef)),
  }), {
    source: "cli-ticket-remove",
    sourceDetail: `remove ticket ${ticketRef}`,
  });

  if (isJsonMode()) {
    okJson({ removed: true, id: removed.id, n: removed.n });
    return;
  }
  print(`Removed ticket ${removed.n}: ${removed.title}`);
}
