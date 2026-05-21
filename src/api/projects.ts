import type {
  Project,
  NotifRecord,
  RunSummary,
  RunDetail,
  DiffStat,
  DiffFile,
  FullDiff,
} from "../../shared/types";
import { call, ApiError } from "./_client";

export type { NotifRecord, RunSummary, RunDetail, DiffStat, DiffFile, FullDiff };
export { ApiError };

export function listRecent(): Promise<Project[]> {
  return call<Project[]>("/api/projects");
}

// 從最近專案 list 移除(SSOT state.json)。冪等:hash 不存在仍回 removed:false。
// 不刪 project 本身 fs,只清 recent 紀錄。
export function removeRecent(hash: string): Promise<{ removed: boolean }> {
  return call<{ removed: boolean }>(`/api/projects/${hash}`, { method: "DELETE" });
}

export function selectFolder(): Promise<{ path: string }> {
  return call<{ path: string }>("/api/projects/select", { method: "POST" });
}

export type BrowseResult = {
  path: string;
  parent: string | null;
  sep: string;
  home: string;
  drives: string[]; // Windows 才有,POSIX 空陣列
  entries: Array<{ name: string; isDir: boolean }>;
};

export function browseFolder(path?: string): Promise<BrowseResult> {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return call<BrowseResult>(`/api/projects/browse${q}`);
}

export function openProject(path: string): Promise<Project> {
  return call<Project>("/api/projects/open", { method: "POST", body: { path } });
}

export function status(hash: string): Promise<Project> {
  return call<Project>(`/api/projects/${hash}/status`);
}

export function init(hash: string): Promise<Project> {
  return call<Project>(`/api/projects/${hash}/init`, { method: "POST" });
}

export function gitInit(hash: string): Promise<Project> {
  return call<Project>(`/api/projects/${hash}/git-init`, { method: "POST" });
}

export function reveal(hash: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/reveal`, { method: "POST" });
}

export function listBranches(hash: string): Promise<string[]> {
  return call<string[]>(`/api/projects/${hash}/branches`);
}

export type ProjectConfig = {
  defaults: {
    base_branch: string;
    max_parallel: number;
    cost_limit_usd: number;
    auto_merge: boolean;
  };
};

export type ProjectConfigPatch = {
  defaults?: {
    max_parallel?: number;
    default_base_branch?: string;
    cost_limit_usd?: number;
    auto_merge?: boolean;
  };
};

export function getConfig(hash: string): Promise<ProjectConfig> {
  return call<ProjectConfig>(`/api/projects/${hash}/config`);
}

export function updateConfig(
  hash: string,
  patch: ProjectConfigPatch,
  signal?: AbortSignal
): Promise<ProjectConfig> {
  return call<ProjectConfig>(`/api/projects/${hash}/config`, {
    method: "PUT",
    body: patch,
    signal,
  });
}

export type RuntimeStats = { runningCount: number; maxParallel: number };

export function getRuntime(hash: string): Promise<RuntimeStats> {
  return call<RuntimeStats>(`/api/projects/${hash}/runtime`);
}

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

export function getDiffStat(hash: string, id: string): Promise<DiffStat | null> {
  return call<DiffStat | null>(`/api/projects/${hash}/pipelines/${id}/diff-stat`);
}

export function getFullDiff(hash: string, id: string): Promise<FullDiff | null> {
  return call<FullDiff | null>(`/api/projects/${hash}/pipelines/${id}/diff`);
}

export function listNotifs(hash: string): Promise<NotifRecord[]> {
  return call<NotifRecord[]>(`/api/projects/${hash}/notifs`);
}

export type PostNotifBody = {
  type: "frontend_action_failed" | "frontend_action_warn" | "frontend_action_info";
  title: string;
  sub?: string;
  pipelineId?: string;
  sev?: "block" | "info" | "muted";
};

export function postNotif(hash: string, body: PostNotifBody): Promise<NotifRecord> {
  return call<NotifRecord>(`/api/projects/${hash}/notif`, { method: "POST", body });
}

export function markNotifRead(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/notifs/${id}/read`, { method: "POST" });
}

export function dismissNotif(hash: string, id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/notifs/${id}/dismiss`, { method: "POST" });
}

export function markAllNotifsRead(hash: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/notifs/mark-all-read`, { method: "POST" });
}

export function dismissAllNotifs(hash: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/notifs/dismiss-all`, { method: "POST" });
}

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
