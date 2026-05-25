// Pipeline run history(per-pipeline JSONL)+ audit timeline。

import type { RunSummary, RunDetail } from "../../shared/types";
import { call } from "./_client";

export function listPipelineRuns(hash: string, pipelineId: string): Promise<RunSummary[]> {
  return call<RunSummary[]>(`/api/projects/${hash}/pipelines/${pipelineId}/runs`);
}

export function getPipelineRun(
  hash: string,
  pipelineId: string,
  filename: string
): Promise<RunDetail> {
  return call<RunDetail>(
    `/api/projects/${hash}/pipelines/${pipelineId}/runs/${encodeURIComponent(filename)}`
  );
}

export type AuditEntry = {
  ts: number;
  pipelineId: string;
  type: "state_change";
  from: string;
  to: string;
  source: string;
  sourceDetail?: string;
};

export function getPipelineAudit(
  hash: string,
  pipelineId: string,
  limit = 50
): Promise<AuditEntry[]> {
  return call<AuditEntry[]>(
    `/api/projects/${hash}/pipelines/${pipelineId}/audit?limit=${limit}`
  );
}
