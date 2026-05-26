import * as draftStore from "../../lib/qa/draftStore";
import { ok, err } from "../_http";
import { projectFor } from "./shared";

export async function listDrafts(hash: string): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const drafts = await draftStore.listDrafts(r.project.path);
  return ok(drafts);
}

export async function getDraft(hash: string, draftId: string): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const d = await draftStore.readDraft(r.project.path, draftId);
  if (!d) return err("not_found", `Draft not found: ${draftId}`, 404);
  return ok(d);
}
