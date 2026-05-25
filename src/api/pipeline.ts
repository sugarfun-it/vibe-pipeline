// Pipeline CRUD + lifecycle actions(worktree / reset / run / pause / merge)。

import { call } from "./_client";

export function listPipelines(hash: string): Promise<unknown[]> {
  return call<unknown[]>(`/api/projects/${hash}/pipelines`);
}

export function createPipeline(hash: string, body: unknown): Promise<unknown> {
  return call<unknown>(`/api/projects/${hash}/pipelines`, { method: "POST", body });
}

export function getPipeline(hash: string, id: string): Promise<unknown> {
  return call<unknown>(`/api/projects/${hash}/pipelines/${id}`);
}

export function savePipeline(hash: string, id: string, body: unknown): Promise<unknown> {
  return call<unknown>(`/api/projects/${hash}/pipelines/${id}`, { method: "PUT", body });
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

export function cleanupWorktree(
  hash: string,
  id: string
): Promise<{ removed: boolean; path: string }> {
  return call<{ removed: boolean; path: string }>(
    `/api/projects/${hash}/pipelines/${id}/worktree/cleanup`,
    { method: "POST" }
  );
}

// Bulk:清 project 內所有 state===merged 的 worktree(磁碟,不動 pipeline.json / branch)
export type CleanupMergedResult = {
  cleaned: Array<{ pipelineId: string; path: string }>;
  skipped_not_merged: string[];
  failed: Array<{ pipelineId: string; error: string }>;
};

export function cleanupMergedWorktrees(hash: string): Promise<CleanupMergedResult> {
  return call<CleanupMergedResult>(
    `/api/projects/${hash}/worktrees/cleanup-merged`,
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
  | { ok: true; mode: "mechanical"; mergeCommit?: { hash: string; subject: string; ts: number }; alreadyMerged?: boolean }
  | { ok: true; mode: "ai"; ticketId: string; conflictFiles?: string[] };

export function mergePipeline(hash: string, id: string): Promise<MergeResult> {
  return call<MergeResult>(
    `/api/projects/${hash}/pipelines/${id}/merge`,
    { method: "POST" }
  );
}
