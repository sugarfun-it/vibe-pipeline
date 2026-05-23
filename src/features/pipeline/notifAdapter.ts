import type { NotifItem } from "../../types/notif";
import type * as api from "../../api/projects";

// ── Notif adapter: backend NotifRecord → frontend NotifItem ──
export const SEV_BY_EVENT: Record<string, "block" | "info" | "muted"> = {
  pipeline_started: "muted",
  pipeline_paused: "info",
  pipeline_ready_to_merge: "info",
  pipeline_failed: "block",
  pipeline_merged: "info",
  pipeline_merge_cleanup_failed: "info",
  pipeline_auto_merge_started: "info",
  merge_started: "muted",
  merge_blocked: "block",
  ticket_started: "muted",
  ticket_done: "info",
  ticket_failed: "block",
  iter_critic_pass: "info",
  iter_critic_fail: "muted",
  budget_warn: "info",
  budget_hard_cap: "block",
  runner_stall: "block",
  runner_crash: "block",
};

export function fmtTs(ms: number): string {
  const since = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (since < 60) return "just now";
  if (since < 3600) return `${Math.floor(since / 60)} min`;
  if (since < 86400) return `${Math.floor(since / 3600)} h`;
  return `${Math.floor(since / 86400)} d`;
}

export function toNotifItem(r: api.NotifRecord): NotifItem {
  const sev = (r.sev ?? SEV_BY_EVENT[r.type] ?? "muted") as "block" | "info" | "muted";
  return {
    id: r.id,
    type: r.type,
    sev,
    title: r.title,
    sub: r.sub ?? "",
    ts: fmtTs(r.ts),
    unread: r.unread,
    pipelineId: r.pipelineId,
  };
}
