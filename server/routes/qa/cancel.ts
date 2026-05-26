import * as draftStore from "../../lib/qa/draftStore";
import { ok } from "../_http";
import { projectFor } from "./shared";

export async function cancel(hash: string, draftId: string): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  await draftStore.deleteDraft(r.project.path, draftId);
  return ok({ ok: true });
}
