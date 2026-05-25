import * as notifs from "../lib/notifs/store";
import { ok, err, withProject, withJsonBody } from "./_http";

export async function listNotifs(hash: string): Promise<Response> {
  return withProject(hash, async (p) => ok(notifs.list(p.path)), { requireInit: false });
}

// POST /api/projects/:hash/notif
// Frontend 主動 emit notif(action toast 同步進 inbox history)。
// 只接受 frontend_action_* 三種 type;sev 由 caller 帶,不查 NOTIF_EVENTS 字典預設。
export async function postNotif(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (rawBody) => {
    const body = rawBody as {
      type?: string;
      title?: string;
      sub?: string;
      pipelineId?: string;
      sev?: string;
    };
    const ALLOWED_TYPES = new Set([
      "frontend_action_failed",
      "frontend_action_warn",
      "frontend_action_info",
    ]);
    if (!body.type || !ALLOWED_TYPES.has(body.type)) {
      return err("invalid_path", `notif type must be one of frontend_action_*`, 400);
    }
    if (!body.title || typeof body.title !== "string") {
      return err("invalid_path", `notif.title required`, 400);
    }
    const ALLOWED_SEVS = new Set(["block", "info", "muted"]);
    const sev = body.sev && ALLOWED_SEVS.has(body.sev)
      ? (body.sev as "block" | "info" | "muted")
      : body.type === "frontend_action_failed"
      ? "block"
      : body.type === "frontend_action_warn"
      ? "info"
      : "muted";
    const rec = notifs.emit(project.path, {
      type: body.type as
        | "frontend_action_failed"
        | "frontend_action_warn"
        | "frontend_action_info",
      title: body.title,
      sub: typeof body.sub === "string" ? body.sub : undefined,
      pipelineId: typeof body.pipelineId === "string" ? body.pipelineId : undefined,
      sev,
    });
    return ok(rec);
  }), { requireInit: false });
}

export async function markNotifRead(hash: string, id: string): Promise<Response> {
  return withProject(hash, async (project) => { notifs.markRead(project.path, id); return ok({ ok: true }); }, { requireInit: false });
}

export async function markAllNotifsRead(hash: string): Promise<Response> {
  return withProject(hash, async (project) => { notifs.markAllRead(project.path); return ok({ ok: true }); }, { requireInit: false });
}

export async function dismissNotif(hash: string, id: string): Promise<Response> {
  return withProject(hash, async (project) => { notifs.dismiss(project.path, id); return ok({ ok: true }); }, { requireInit: false });
}

export async function dismissAllNotifs(hash: string): Promise<Response> {
  return withProject(hash, async (project) => { notifs.dismissAll(project.path); return ok({ ok: true }); }, { requireInit: false });
}
