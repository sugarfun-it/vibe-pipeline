import * as pipelineDir from "../../../server/lib/pipelineDir";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { isJsonMode, okJson, print, printLines, table } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

export async function pipelineList(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const pipelines = (await pipelineDir.listPipelines(proj.path)) as Pipeline[];
  if (isJsonMode()) {
    okJson(pipelines);
    return;
  }
  if (pipelines.length === 0) {
    print("No pipelines.");
    return;
  }
  const rows: string[][] = [["ID", "NAME", "STATE", "TICKETS", "BRANCH"]];
  for (const p of pipelines) {
    rows.push([
      p.id,
      p.name,
      p.state,
      String(p.tickets?.length ?? 0),
      p.branch ?? "-",
    ]);
  }
  printLines([table(rows)]);
}
