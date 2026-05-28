import { readPipeline, writePipeline } from "../../domain/pipeline";
import type { SyncJob } from "../../../../shared/types";

export type PipelineLike = {
  name?: string;
  state?: string;
  branch?: string;
  baseBranch?: string;
  syncJob?: SyncJob;
  [k: string]: unknown;
};

export async function writeSyncJob(
  projectPath: string,
  pipelineId: string,
  job: SyncJob | null
): Promise<void> {
  const p = (await readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return;
  const prevState = typeof p.state === "string" ? p.state : undefined;
  const source = job === null ? "sync-dismiss" : `sync-${job.state}`;
  if (job === null) {
    const { syncJob: _drop, ...rest } = p;
    void _drop;
    await writePipeline(projectPath, pipelineId, rest, {
      source,
      prevStateHint: prevState,
    });
  } else {
    await writePipeline(projectPath, pipelineId, { ...p, syncJob: job }, {
      source,
      sourceDetail: job.reason,
      prevStateHint: prevState,
    });
  }
}
