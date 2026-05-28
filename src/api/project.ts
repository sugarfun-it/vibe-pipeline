// Project lifecycle / config / runtime stats.
// 切自 api/projects.ts 第一段(L15-105)— recent / browse / open / init / config / runtime。

import type { Project } from "../../shared/types";
import { call } from "./_client";

export function listRecent(): Promise<Project[]> {
  return call<Project[]>("/api/projects");
}

// 從最近專案 list 移除(SSOT state.json)。冪等:hash 不存在仍回 removed:false。
// 不刪 project 本身 fs,只清 recent 紀錄。
export function removeRecent(hash: string): Promise<{ removed: boolean }> {
  return call<{ removed: boolean }>(`/api/projects/${hash}`, { method: "DELETE" });
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
