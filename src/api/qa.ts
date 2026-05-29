import type {
  TicketSpec,
  PartialSpec,
  QAReply,
  Turn,
  Draft,
  Pipeline,
} from "../../shared/types";
import { call, ApiError } from "./_client";

export type { TicketSpec, PartialSpec, QAReply, Turn, Draft };
export { MODE_LABELS, DEFAULT_ITER_LIMIT, DEFAULT_ITER_STOP_AT_LIMIT } from "../../shared/types";
export { ApiError };

type StartResp = { draft: Draft; reply: QAReply };
type TurnResp = { draft: Draft; reply: QAReply };
export type FinalizeResp = {
  tickets: Array<{ id: string; n: number; title: string }>;
  pipeline: Pipeline;
  splitCount: number;
};

export function startQA(hash: string, pipelineId: string): Promise<StartResp> {
  return call<StartResp>(`/api/projects/${hash}/pipelines/${pipelineId}/qa/start`, {
    method: "POST",
    body: {},
  });
}

export function turnQA(hash: string, draftId: string, userMessage: string): Promise<TurnResp> {
  return call<TurnResp>(`/api/projects/${hash}/qa/${draftId}/turn`, {
    method: "POST",
    body: { userMessage },
  });
}

export function finalizeQA(
  hash: string,
  draftId: string,
  edits?: Partial<TicketSpec>,
  splitInto?: TicketSpec[]
): Promise<FinalizeResp> {
  return call<FinalizeResp>(`/api/projects/${hash}/qa/${draftId}/finalize`, {
    method: "POST",
    body: { edits: edits ?? {}, ...(splitInto ? { splitInto } : {}) },
  });
}

export function cancelQA(hash: string, draftId: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/projects/${hash}/qa/${draftId}/cancel`, { method: "POST" });
}

export function listDrafts(hash: string): Promise<Draft[]> {
  return call<Draft[]>(`/api/projects/${hash}/qa/drafts`);
}

export function getDraft(hash: string, draftId: string): Promise<Draft> {
  return call<Draft>(`/api/projects/${hash}/qa/${draftId}`);
}

export type SplitResp =
  | { count: number; nothingToSplit: true }
  | { count: number; replacedTicketId: string; newTickets: Array<{ id: string; n: number; title: string }> };

export function splitTicket(
  hash: string,
  pipelineId: string,
  ticketId: string
): Promise<SplitResp> {
  return call<SplitResp>(
    `/api/projects/${hash}/pipelines/${pipelineId}/tickets/${ticketId}/split`,
    { method: "POST" }
  );
}

export function deleteTicket(
  hash: string,
  pipelineId: string,
  ticketId: string
): Promise<{ ok: true; removedId: string }> {
  return call<{ ok: true; removedId: string }>(
    `/api/projects/${hash}/pipelines/${pipelineId}/tickets/${ticketId}`,
    { method: "DELETE" }
  );
}
