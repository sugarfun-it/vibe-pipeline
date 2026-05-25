// Sync(rebase / merge base 同步)— status / start / confirmAi / cancel / dismiss。

import { call } from "./_client";

export type SyncStatus = { behind: number | null; baseBranch?: string };

export function getSyncStatus(hash: string, id: string): Promise<SyncStatus> {
  return call<SyncStatus>(`/api/projects/${hash}/pipelines/${id}/sync-status`);
}

// POST /sync 結果。state="conflict_await" 時 frontend 跳 modal,user 點「讓 AI 解」再呼 syncConfirmAi
export type SyncStartResult = {
  ok: true;
  state: "merging" | "conflict_await" | "ai_running" | "failed" | "done";
  behind?: number;
  conflictFiles?: string[];
};

export function syncPipeline(hash: string, id: string): Promise<SyncStartResult> {
  return call<SyncStartResult>(
    `/api/projects/${hash}/pipelines/${id}/sync`,
    { method: "POST" }
  );
}

export function syncConfirmAi(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(
    `/api/projects/${hash}/pipelines/${id}/sync/ai`,
    { method: "POST" }
  );
}

export function syncCancel(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(
    `/api/projects/${hash}/pipelines/${id}/sync/cancel`,
    { method: "POST" }
  );
}

export function syncDismiss(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(
    `/api/projects/${hash}/pipelines/${id}/sync/dismiss`,
    { method: "POST" }
  );
}
