import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { isJsonMode, okJson, print, printLines, table } from "../../lib/output";
import { getPipelineId, readPipeline } from "./_shared";

export async function ticketList(args: ParsedArgs): Promise<void> {
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
