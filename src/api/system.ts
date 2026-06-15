import { call } from "./_client";

export type LatestRelease = {
  tag: string;
  url: string;
  publishedAt: string;
};

export type VersionStatus = {
  current: string;
  latest: LatestRelease | null;
  isLatest: boolean;
  hasUpdate: boolean;
};

export type HealthStatus = {
  status: string;
  testMode?: boolean;
  pid?: number;
  repo_path?: string;
};

export type UpdateStarted = {
  started: true;
  message?: string;
};

// force=true → 後端跳過 release-info cache 強制重抓(user 點「檢查更新」用);
// 預設(mount / 背景刷新)走 cache 不打爆 GitHub rate-limit。
export function getSystemVersion(signal?: AbortSignal, force = false): Promise<VersionStatus> {
  return call<VersionStatus>(`/api/system/version${force ? "?force=1" : ""}`, { signal });
}

export function triggerSystemUpdate(signal?: AbortSignal): Promise<UpdateStarted> {
  return call<UpdateStarted>("/api/system/update", { method: "POST", signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return call<HealthStatus>("/api/health", { signal });
}
