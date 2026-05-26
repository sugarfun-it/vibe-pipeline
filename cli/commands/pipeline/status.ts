import * as pipelineDir from "../../../server/lib/pipelineDir";
import * as orchestrator from "../../../server/lib/runner/orchestrator";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

export async function pipelineStatus(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline status <id>");

  const pipeline = (await pipelineDir.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);

  const running = orchestrator.isRunning(proj.hash, id);
  const queued = orchestrator.isQueued(proj.hash, id);
  const queuePos = queued ? orchestrator.queuePosition(proj.hash, id) : null;

  const statusObj = {
    id,
    name: pipeline!.name,
    state: pipeline!.state,
    running,
    queued,
    queuePosition: queuePos,
    tickets: (pipeline!.tickets ?? []).map((t) => ({ id: t.id, n: t.n, title: t.title, status: t.status, mode: t.mode })),
  };

  if (isJsonMode()) {
    okJson(statusObj);
    return;
  }
  printLines([
    `Pipeline: ${pipeline!.name} (${id})`,
    `state:    ${pipeline!.state}${running ? " [in-process running]" : ""}${queued ? ` [queued #${queuePos}]` : ""}`,
  ]);
  if ((pipeline!.tickets ?? []).length > 0) {
    print("");
    const rows: string[][] = [["N", "TITLE", "STATUS"]];
    for (const t of pipeline!.tickets) {
      rows.push([String(t.n), t.title, t.status]);
    }
    printLines([table(rows)]);
  }
}
