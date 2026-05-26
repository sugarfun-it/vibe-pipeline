import * as draftStore from "../../lib/qa/draftStore";
import { splitTicketSpec } from "../../lib/qa/splitTicket";
import { requireJsonUtf8, ok, err, readJson } from "../_http";
import type { TicketSpec } from "../../../shared/types";
import { projectFor } from "./shared";

// 跑 splitTicketSpec 評估 draft 的 spec 是否該拆;不寫 pipeline.json。
// 給前端「卡 drawer 等分析」流程用 — preview → user 決定 → 再 finalize。
export async function previewSplit(hash: string, draftId: string, req: Request): Promise<Response> {
  const guardErr = requireJsonUtf8(req);
  if (guardErr) return guardErr;
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const { project } = r;

  const draft = await draftStore.readDraft(project.path, draftId);
  if (!draft) return err("not_found", `Draft not found: ${draftId}`, 404);
  if (!draft.spec) return err("invalid_path", "Draft spec not ready");

  const body = await readJson(req);
  const edits = (body.edits as Partial<typeof draft.spec>) ?? {};
  const finalSpec = { ...draft.spec, ...edits } as TicketSpec;

  try {
    const specs = await splitTicketSpec({ cwd: project.path, spec: finalSpec, projectHash: hash });
    return ok({ count: specs.length, specs });
  } catch (e) {
    // 失敗 → 回 count=1,讓前端走預設「直接 finalize 1 張」path,不擋 user
    console.warn(`[previewSplit] 失敗,假裝 count=1: ${e instanceof Error ? e.message : String(e)}`);
    return ok({ count: 1, specs: [finalSpec] });
  }
}
