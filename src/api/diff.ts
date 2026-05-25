// Pipeline diff(stat / full)— DiffStat / FullDiff 型別在 shared/types.ts。

import type { DiffStat, FullDiff } from "../../shared/types";
import { call } from "./_client";

export function getDiffStat(hash: string, id: string): Promise<DiffStat | null> {
  return call<DiffStat | null>(`/api/projects/${hash}/pipelines/${id}/diff-stat`);
}

export function getFullDiff(hash: string, id: string): Promise<FullDiff | null> {
  return call<FullDiff | null>(`/api/projects/${hash}/pipelines/${id}/diff`);
}
