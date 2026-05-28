import * as pipelineStore from "../../lib/domain/pipeline";
import { splitTicketSpec, SplitError } from "../../lib/qa/splitTicket";
import { ok, err } from "../_http";
import type { Ticket, TicketSpec } from "../../../shared/types";
import { projectFor } from "./shared";

// 把單張 ticket 用 AI 拆成 N 張獨立 ticket。
// 回傳:{ count, newTickets[], replacedTicketId } 或 { count: 1, nothingToSplit: true }
// 拆完直接寫回 pipeline.json(取代原 ticket)。AI 認為不用拆 → noop,user 看 toast 提示
export async function splitTicket(
  hash: string,
  pipelineId: string,
  ticketId: string
): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const { project } = r;

  const pipeline = (await pipelineStore.readPipeline(project.path, pipelineId)) as {
    tickets?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return err("not_found", `Pipeline not found: ${pipelineId}`, 404);

  const tickets = Array.isArray(pipeline.tickets) ? pipeline.tickets : [];
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return err("not_found", `Ticket not found: ${ticketId}`, 404);

  const target = tickets[idx];
  // 只有 draft / ready 狀態的 ticket 可拆;running / done / failed 不該動
  const status = target.status;
  if (status !== "draft" && status !== "ready") {
    return err("invalid_path", `ticket 狀態 ${status} 不可拆,只 draft / ready 可`, 409);
  }
  // synthetic ticket(merge / sync)不該拆 — 它們是系統管的
  if (target.mode === "merge" || target.mode === "sync") {
    return err("invalid_path", "merge / sync ticket 是系統管的,不可拆", 409);
  }

  const spec: TicketSpec = {
    title: typeof target.title === "string" ? target.title : "",
    goal: typeof target.goal === "string" ? target.goal : "",
    acceptance: Array.isArray(target.acceptance) ? (target.acceptance as string[]) : [],
    prompt: typeof target.prompt === "string" ? target.prompt : "",
    mode: target.mode === "iter" ? "iter" : "step",
  };
  if (typeof target.iterLimit === "number") spec.iterLimit = target.iterLimit;
  if (typeof target.iterStopAtLimit === "boolean") spec.iterStopAtLimit = target.iterStopAtLimit;

  let split: TicketSpec[];
  try {
    split = await splitTicketSpec({ cwd: project.path, spec, projectHash: hash });
  } catch (e) {
    if (e instanceof SplitError) {
      return err("internal_error", `拆分失敗 (${e.code}): ${e.message}`, 502);
    }
    return err("internal_error", `拆分失敗: ${e instanceof Error ? e.message : String(e)}`, 500);
  }

  if (split.length === 1) {
    // AI 認為不需拆。返回 noop,前端顯 toast 不動 pipeline.json
    return ok({ count: 1, nothingToSplit: true });
  }

  // 取代原 ticket:把 split[] 插入原位置,renumber n。
  // 在 mutator 內基於最新 p.tickets 重找 idx — 不依賴外層 snapshot(慢的 splitTicketSpec 跑期間
  // tickets 可能被其他 route 改動)。同一個 ts 確保 id 整批一致
  const ts = Date.now().toString(16);
  let resultNewTickets: Ticket[] = [];
  let notFound = false;
  let stateConflict = false;
  try {
    await pipelineStore.mutatePipeline(project.path, pipelineId, (p) => {
      const cur = Array.isArray(p.tickets) ? p.tickets : [];
      const curIdx = cur.findIndex((t) => t.id === ticketId);
      if (curIdx === -1) {
        notFound = true;
        return p;
      }
      const curTarget = cur[curIdx];
      // 重檢 status — 慢的 AI call 期間 ticket 可能被 runner 啟動
      if (curTarget.status !== "draft" && curTarget.status !== "ready") {
        stateConflict = true;
        return p;
      }
      if (curTarget.mode === "merge" || curTarget.mode === "sync") {
        stateConflict = true;
        return p;
      }
      const baseN = typeof curTarget.n === "number" ? curTarget.n : curIdx + 1;
      const built: Ticket[] = split.map((s, i) => ({
        id: `t${baseN}-${i}-${ts}`,
        n: 0, // 重編
        status: "draft",
        ...s,
      }) as Ticket);
      const merged = [...cur.slice(0, curIdx), ...built, ...cur.slice(curIdx + 1)];
      // renumber n 1..N(整體 pipeline)
      merged.forEach((t, i) => { t.n = i + 1; });
      resultNewTickets = merged.slice(curIdx, curIdx + built.length);
      return { ...p, tickets: merged };
    }, {
      source: "api-ticket-split",
      sourceDetail: `split ticket ${ticketId} into ${split.length}`,
    });
  } catch (e) {
    return err("internal_error", e instanceof Error ? e.message : String(e), 500);
  }
  if (notFound) return err("not_found", `Ticket not found: ${ticketId}`, 404);
  if (stateConflict) return err("invalid_path", "ticket 狀態已變更,無法拆分", 409);

  return ok({
    count: resultNewTickets.length,
    replacedTicketId: ticketId,
    newTickets: resultNewTickets,
  });
}
