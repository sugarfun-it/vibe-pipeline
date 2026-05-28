import * as pipelineStore from "../../lib/domain/pipeline";
import * as draftStore from "../../lib/qa/draftStore";
import { requireJsonUtf8, ok, err, readJson } from "../_http";
import type { Pipeline, Ticket, TicketSpec } from "../../../shared/types";
import { projectFor } from "./shared";

export async function finalize(hash: string, draftId: string, req: Request): Promise<Response> {
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
  const finalSpec = { ...draft.spec, ...edits };
  // 若前端帶 splitInto: TicketSpec[],這次 finalize 寫 N 張 ticket(取代原 finalSpec 寫 1 張)。
  // 用於「preview 後 user 選拆」flow;單張 fallback 走 finalSpec
  const splitInto = Array.isArray(body.splitInto) ? (body.splitInto as TicketSpec[]) : null;

  const required: (keyof typeof finalSpec)[] = ["title", "goal", "acceptance", "prompt", "mode"];
  const missing = required.filter((k) => {
    const v = finalSpec[k];
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });
  if (!splitInto && missing.length > 0)
    return err("invalid_path", `Spec incomplete, missing: ${missing.join(", ")}`);

  // 預檢:pipeline 存在性。mutator 內 readPipeline 為 null 才 throw,外層轉 404
  const existing = await pipelineStore.readPipeline(project.path, draft.pipelineId);
  if (!existing) return err("not_found", `Pipeline not found: ${draft.pipelineId}`, 404);

  // 用同一個 ts 避免 mutator 內呼叫 Date.now() 不一致(append 多張時 id 才齊整)
  const ts = Date.now().toString(16);
  let newTickets: Ticket[] = [];
  let updatedPipeline: Pipeline;
  try {
    updatedPipeline = await pipelineStore.mutatePipeline(project.path, draft.pipelineId, (p) => {
      const existingTickets = Array.isArray(p.tickets) ? p.tickets : [];
      const built: Ticket[] =
        splitInto && splitInto.length > 0
          ? splitInto.map((s, i) => ({
              id: `t${existingTickets.length + i + 1}-${i}-${ts}`,
              n: existingTickets.length + i + 1,
              status: "draft",
              ...s,
            }) as Ticket)
          : [
              {
                id: `t${existingTickets.length + 1}-${ts}`,
                n: existingTickets.length + 1,
                status: "draft",
                ...(finalSpec as TicketSpec),
              } as Ticket,
            ];
      newTickets = built;
      return { ...p, tickets: [...existingTickets, ...built] };
    }, {
      source: "api-qa-finalize",
      sourceDetail: `append ${splitInto && splitInto.length > 0 ? splitInto.length + " split tickets" : "1 ticket"}`,
    });
  } catch (e) {
    return err("internal_error", e instanceof Error ? e.message : String(e), 500);
  }
  await draftStore.deleteDraft(project.path, draftId);

  return ok({
    tickets: newTickets,
    pipeline: updatedPipeline,
    splitCount: newTickets.length,
  });
}
