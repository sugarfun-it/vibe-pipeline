import * as pipelineStore from "../../../server/lib/domain/pipeline";
import { resolveProject, requireInit } from "../../lib/project";
import { get } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

// pipeline 靜態資料(name / state / tickets)直讀 fs(reuse server/lib/*)。
// 執行態(running / queued / queuePosition)由 backend orchestrator in-memory map 持有,
// CLI 是獨立 process 那 Map 永遠空 → 走 HTTP 查 backend(設計信條 #6:ground truth 由 backend 驗)。
export async function pipelineStatus(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline status <id>");

  const pipeline = (await pipelineStore.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);

  const exec = await get<{ running: boolean; queued: boolean; queuePosition: number | null }>(
    `/api/projects/${proj.hash}/pipelines/${id}/exec-state`
  );
  const { running, queued } = exec;
  const queuePos = exec.queuePosition;

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
