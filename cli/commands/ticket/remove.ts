import * as pipelineDir from "../../../server/lib/pipelineDir";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import { readPipeline } from "./_shared";

export async function ticketRemove(args: ParsedArgs): Promise<void> {
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
