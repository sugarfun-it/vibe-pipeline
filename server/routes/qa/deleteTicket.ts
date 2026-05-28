import * as pipelineStore from "../../lib/domain/pipeline";
import { ok, err } from "../_http";
import { projectFor } from "./shared";

// 刪一張 ticket。只 draft / ready / failed_* / paused / done 可刪;running / synthetic 不可
// running 中刪會撞 runner;synthetic (merge/sync) 是系統管的
export async function deleteTicket(
  hash: string,
  pipelineId: string,
  ticketId: string
): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const { project } = r;

  // 預檢:pipeline 存在性與 ticket 狀態。mutator 內基於最新 p.tickets 重找 idx,
  // 不依賴外層 snapshot(防慢操作期間 tickets 被改動)
  const existing = await pipelineStore.readPipeline(project.path, pipelineId);
  if (!existing) return err("not_found", `Pipeline not found: ${pipelineId}`, 404);

  let notFound = false;
  let runningConflict = false;
  let syntheticConflict = false;
  try {
    await pipelineStore.mutatePipeline(project.path, pipelineId, (p) => {
      const cur = Array.isArray(p.tickets) ? p.tickets : [];
      const curIdx = cur.findIndex((t) => t.id === ticketId);
      if (curIdx === -1) {
        notFound = true;
        return p;
      }
      const target = cur[curIdx];
      if (target.status === "running") {
        runningConflict = true;
        return p;
      }
      if (target.mode === "merge" || target.mode === "sync") {
        syntheticConflict = true;
        return p;
      }
      const merged = cur.filter((_, i) => i !== curIdx);
      // renumber n 1..N
      merged.forEach((t, i) => { t.n = i + 1; });
      return { ...p, tickets: merged };
    }, {
      source: "api-ticket-delete",
      sourceDetail: `delete ticket ${ticketId}`,
    });
  } catch (e) {
    return err("internal_error", e instanceof Error ? e.message : String(e), 500);
  }
  if (notFound) return err("not_found", `Ticket not found: ${ticketId}`, 404);
  if (runningConflict) return err("invalid_path", "ticket 在跑,先 pause 再刪", 409);
  if (syntheticConflict)
    return err("invalid_path", "merge / sync 是 synthetic ticket,系統管的不可刪(reset all 會清掉)", 409);
  return ok({ ok: true, removedId: ticketId });
}
