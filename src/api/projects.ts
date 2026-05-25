// Barrel re-export — 對外維持單一 import surface(`import * as api from "../../api/projects"`),
// 內部依 domain 拆 project / pipeline / sync / diff / notifs / run 6 個檔。

export { ApiError } from "./_client";
export type { NotifRecord, RunSummary, RunDetail, DiffStat, DiffFile, FullDiff } from "../../shared/types";

export * from "./project";
export * from "./pipeline";
export * from "./sync";
export * from "./diff";
export * from "./notifs";
export * from "./run";
