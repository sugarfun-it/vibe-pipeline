import * as pipelineStore from "../../../server/lib/domain/pipeline";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

export async function pipelineShow(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline show <id>");
  const pipeline = (await pipelineStore.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);
  if (isJsonMode()) {
    okJson(pipeline);
    return;
  }
  printLines([
    `id:        ${pipeline!.id}`,
    `name:      ${pipeline!.name}`,
    `state:     ${pipeline!.state}`,
    `branch:    ${pipeline!.branch}`,
    `baseBranch: ${pipeline!.baseBranch ?? "main"}`,
    `tickets:   ${pipeline!.tickets?.length ?? 0}`,
    `autoMerge: ${pipeline!.autoMerge ?? false}`,
  ]);
  if ((pipeline!.tickets ?? []).length > 0) {
    print("");
    print("Tickets:");
    const rows: string[][] = [["N", "TITLE", "STATUS", "MODE"]];
    for (const t of pipeline!.tickets) {
      rows.push([
        String(t.n),
        t.title,
        t.status,
        t.mode,
      ]);
    }
    printLines([table(rows)]);
  }
}
