// Pipeline run history(per-pipeline JSONL)+ audit timeline。

import type { RunSummary, RunDetail, StateChangeEntry } from "../../shared/types";
import { call } from "./_client";

// audit timeline entry 用 shared StateChangeEntry 單一來源(原本本地複製 backend 型別,已去重)。
export type AuditEntry = StateChangeEntry;

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

export function getPipelineAudit(
  hash: string,
  pipelineId: string,
  limit = 50
): Promise<AuditEntry[]> {
  return call<AuditEntry[]>(
    `/api/projects/${hash}/pipelines/${pipelineId}/audit?limit=${limit}`
  );
}
