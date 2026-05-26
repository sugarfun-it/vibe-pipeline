import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, printLines } from "../../lib/output";
import { readPipeline } from "./_shared";

export async function ticketShow(args: ParsedArgs): Promise<void> {
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
