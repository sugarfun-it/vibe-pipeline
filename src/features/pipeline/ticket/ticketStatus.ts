import type { Ticket } from "../../../../shared/types";

export function isTerminalStatus(s: string): boolean {
  return s === "done" || s === "failed" || s === "failed_iter_limit" || s === "failed_transient";
}

// 只 draft / ready 可切 mode(step ↔ iter);跑過後切 mode 影響已產生的 iter rounds 顯示語意
export function isModeToggleable(t: Ticket): boolean {
  if (t.mode !== "step" && t.mode !== "iter") return false; // synthetic 不切
  return t.status === "draft" || t.status === "ready";
}

// 只 draft / ready 可拆;running 中拆會撞 runner;done / failed 拆完也派不出去(已跑過)
export function isSplittable(t: Ticket): boolean {
  if (t.mode === "merge" || t.mode === "sync") return false; // synthetic 不可拆
  return t.status === "draft" || t.status === "ready";
}

// running 不可刪(撞 runner);synthetic 系統管的不可刪;其他 (draft/ready/paused/done/failed_*) 都可
export function isDeletable(t: Ticket): boolean {
  if (t.mode === "merge" || t.mode === "sync") return false;
  return t.status !== "running";
}
