// Notifs(per-project)— list / post / read / dismiss(single + bulk)。

import type { NotifRecord } from "../../shared/types";
import { call } from "./_client";

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
