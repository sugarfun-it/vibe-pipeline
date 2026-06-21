// Pipeline CRUD + lifecycle actions(worktree / reset / run / pause / merge)。

import { call } from "./_client";
import type { Pipeline, CommitRef } from "../../shared/types";

// createPipeline 送的 body:無 id(backend 生),其餘 pipeline 欄位可帶
export type CreatePipelineBody = {
  name: string;
  branch: string;
  baseBranch?: string;
  state?: Pipeline["state"];
  tickets?: Pipeline["tickets"];
  autoMerge?: boolean;
};

export function listPipelines(hash: string): Promise<Pipeline[]> {
  return call<Pipeline[]>(`/api/projects/${hash}/pipelines`);
}

export function createPipeline(hash: string, body: CreatePipelineBody): Promise<Pipeline> {
  return call<Pipeline>(`/api/projects/${hash}/pipelines`, { method: "POST", body });
}

export function getPipeline(hash: string, id: string): Promise<Pipeline> {
  return call<Pipeline>(`/api/projects/${hash}/pipelines/${id}`);
}

export function savePipeline(hash: string, id: string, body: Pipeline): Promise<Pipeline> {
  return call<Pipeline>(`/api/projects/${hash}/pipelines/${id}`, { method: "PUT", body });
}

export function deletePipeline(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/pipelines/${id}`, { method: "DELETE" });
}

export function revealWorktree(hash: string, id: string): Promise<{ ok: true; path: string }> {
  return call<{ ok: true; path: string }>(
    `/api/projects/${hash}/pipelines/${id}/worktree/reveal`,
    { method: "POST" }
  );
}

// Bulk:刪 project 內所有 state===merged 的 pipeline,cascade = worktree + branch + pipeline.json
//   deleted        — pipeline.json 已刪(卡片消失)+ worktree/branch 也清乾淨
//   partial        — 卡片已消失,但 worktree/branch 有殘留(多半 file lock)
//   skipped_active — running/queued,跳過
//   failed         — pipeline.json 刪不掉(卡片還在)
export type DeleteMergedResult = {
  deleted: string[];
  partial: Array<{ pipelineId: string; error: string }>;
  skipped_active: string[];
  failed: Array<{ pipelineId: string; error: string }>;
};

export function deleteMergedPipelines(hash: string): Promise<DeleteMergedResult> {
  return call<DeleteMergedResult>(
    `/api/projects/${hash}/pipelines/delete-merged`,
    { method: "POST" }
  );
}

export function resetPipeline(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(
    `/api/projects/${hash}/pipelines/${id}/reset`,
    { method: "POST" }
  );
}

export function runPipeline(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/pipelines/${id}/run`, { method: "POST" });
}

// backend /pause 與 /stop 同義:立即停止 runner child,並把 running ticket 標 paused。
export function pausePipeline(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/pipelines/${id}/pause`, {
    method: "POST",
  });
}

// 合併:2026-05-13 後二段式
//   mode="mechanical" → 純 git merge --no-ff,clean 立即完成(寫 mergeCommit / alreadyMerged)
//   mode="ai"         → 撞衝突,自動 fallback spawn AI runner;前端 polling 看 ticket 進度
export type MergeResult =
  | { ok: true; mode: "mechanical"; mergeCommit?: CommitRef; alreadyMerged?: boolean }
  | { ok: true; mode: "ai"; ticketId: string; conflictFiles?: string[] };

export function mergePipeline(hash: string, id: string): Promise<MergeResult> {
  return call<MergeResult>(
    `/api/projects/${hash}/pipelines/${id}/merge`,
    { method: "POST" }
  );
}
