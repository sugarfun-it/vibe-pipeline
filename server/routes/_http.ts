import type { ApiResponse, ApiErrorCode } from "../../shared/types";
import * as projectStore from "../lib/projectStore";
import * as pipelineDir from "../lib/pipelineDir";
import * as auditLog from "../lib/auditLog";

export type ProjectInfo = NonNullable<Awaited<ReturnType<typeof projectStore.findByHash>>>;

export async function withProject(
  hash: string,
  fn: (project: ProjectInfo) => Promise<Response>,
  opts?: { requireInit?: boolean }
): Promise<Response> {
  const project = await projectStore.findByHash(hash);
  if (!project) return err("not_found", `Project not found: ${hash}`, 404);
  if (opts?.requireInit !== false && !pipelineDir.hasInit(project.path)) {
    return err("not_initialized", `.vibe-pipeline/ not found in ${project.path}`);
  }
  return fn(project);
}

export async function withPipeline(
  hash: string,
  pipelineId: string,
  fn: (project: ProjectInfo, pipeline: Record<string, unknown>) => Promise<Response>,
  opts?: { requireInit?: boolean }
): Promise<Response> {
  return withProject(hash, async (project) => {
    const pipeline = await pipelineDir.readPipeline(project.path, pipelineId);
    if (!pipeline) return err("not_found", `Pipeline not found: ${pipelineId}`, 404);
    return fn(project, pipeline as Record<string, unknown>);
  }, opts);
}

export async function withJsonBody(
  req: Request,
  fn: (body: Record<string, unknown>) => Promise<Response>
): Promise<Response> {
  const guardErr = requireJsonUtf8(req);
  if (guardErr) return guardErr;
  const body = await readJson(req);
  return fn(body);
}

export function ok<T>(data: T): Response {
  return Response.json({ ok: true, data } satisfies ApiResponse<T>);
}

export function err(code: ApiErrorCode, message: string, status = 400): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies ApiResponse<never>, {
    status,
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Guard:吃 JSON body 的寫入端點要求 content-type: application/json; charset=utf-8
// 防 shell 端 caller 沒指定 charset 導致中文寫入 pipeline.json 變亂碼。
// 通過回 null;失敗回 400 Response。
//
// 規則(case-insensitive):
//   - 主類型必須是 application/json
//   - 必須有 charset 參數且值為 utf-8
//   - 允許 parameter 順序任意 + 大小寫 + 寬鬆空白
export function requireJsonUtf8(req: Request): Response | null {
  const raw = req.headers.get("content-type") ?? "";
  if (!isJsonUtf8(raw)) {
    return err(
      "invalid_path",
      "content-type must be application/json; charset=utf-8",
      400
    );
  }
  return null;
}

// 包 fn 自動 audit 寫入 / 失敗。從 projects.ts 搬出共用,sync / pipeline routes 都會用到。
export async function withUserAudit(
  projectPath: string,
  meta: { action: string; pipelineId?: string; ticketId?: string; via?: auditLog.ViaKind },
  fn: () => Promise<Response>
): Promise<Response> {
  const handle = auditLog.beginUserAction({
    projectPath,
    action: meta.action,
    pipelineId: meta.pipelineId,
    ticketId: meta.ticketId,
    via: meta.via,
  });
  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    handle.error(String(e), "thrown");
    throw e;
  }
  // 嘗試 inspect response envelope 判斷 ok/err。clone 才不會耗掉 body。
  try {
    const cloned = res.clone();
    const parsed = (await cloned.json()) as
      | { ok: true }
      | { ok: false; error?: { code?: string; message?: string } };
    if (parsed && parsed.ok === true) {
      handle.ok();
    } else if (parsed && parsed.ok === false) {
      const code = parsed.error?.code;
      const msg = parsed.error?.message ?? "(no message)";
      handle.error(msg, code);
    } else {
      // 非預期 envelope(理論不會發生)— 看 HTTP status 推斷
      if (res.ok) handle.ok();
      else handle.error(`http ${res.status}`, "non_envelope");
    }
  } catch {
    if (res.ok) handle.ok();
    else handle.error(`http ${res.status}`, "envelope_parse_failed");
  }
  return res;
}

export function isJsonUtf8(contentType: string): boolean {
  if (!contentType) return false;
  const parts = contentType.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const mime = parts[0].toLowerCase();
  if (mime !== "application/json") return false;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim().toLowerCase();
    if (k !== "charset") continue;
    let v = p.slice(eq + 1).trim().toLowerCase();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1);
    }
    return v === "utf-8";
  }
  return false;
}
