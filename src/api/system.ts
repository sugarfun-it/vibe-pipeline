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

export function getSystemVersion(signal?: AbortSignal): Promise<VersionStatus> {
  return call<VersionStatus>("/api/system/version", { signal });
}

export function triggerSystemUpdate(signal?: AbortSignal): Promise<UpdateStarted> {
  return call<UpdateStarted>("/api/system/update", { method: "POST", signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return call<HealthStatus>("/api/health", { signal });
}
