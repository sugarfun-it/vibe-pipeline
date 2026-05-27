import * as pipelineDir from "../../../server/lib/pipelineDir";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import type { Ticket, TicketMode } from "../../../shared/types";
import { jsonAcceptance, jsonText, readJsonInput, readPipeline, readTextArg, splitAcceptance, validateGoal } from "./_shared";

export async function ticketAdd(args: ParsedArgs): Promise<void> {
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
  validateGoal(goal);

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
