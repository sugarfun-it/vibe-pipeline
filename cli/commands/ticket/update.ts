import * as pipelineStore from "../../../server/lib/domain/pipeline";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import type { Ticket, TicketMode, TicketStatus } from "../../../shared/types";
import { jsonAcceptance, jsonText, readJsonInput, readPipeline, readTextArg, splitAcceptance, validateGoal } from "./_shared";

export async function ticketUpdate(args: ParsedArgs): Promise<void> {
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
  if (newGoal !== undefined) {
    validateGoal(newGoal.trim());
    updated.goal = newGoal;
  }
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

  await pipelineStore.mutatePipeline(proj.path, pipelineId!, (p) => {
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
