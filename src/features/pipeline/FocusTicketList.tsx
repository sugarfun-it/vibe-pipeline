import { EmptyTickets } from "./EmptyTickets";
import { TicketCard } from "./TicketCard";
import type { Pipeline, Ticket } from "../../types/pipeline";

// pipeline.tickets 渲染區 — 空 list 顯 EmptyTickets,否則 map TicketCard
export function FocusTicketList({
  pipeline,
  tick,
  hasActiveDraft,
  onAddTicket,
  onTicketClick,
  splittingTicketId,
}: {
  pipeline: Pipeline;
  tick: number;
  hasActiveDraft: boolean;
  onAddTicket?: (pipelineId: string) => void;
  onTicketClick?: (ticket: Ticket) => void;
  splittingTicketId?: string | null;
}) {
  return (
    <div className="focus-list">
      {pipeline.tickets.length === 0 ? (
        <EmptyTickets
          hasActiveDraft={hasActiveDraft}
          onAddTicket={() => onAddTicket?.(pipeline.id)}
        />
      ) : (
        pipeline.tickets
          // mode=sync 是舊版 synthetic ticket(已換成 pipeline.syncJob),歷史資料還可能存在 → 過濾不顯
          .filter((t) => t.mode !== "sync")
          .map((t, i) => (
            <TicketCard
              key={t.id}
              ticket={t}
              tick={tick}
              index={i}
              isSplitting={splittingTicketId === t.id}
              onClick={onTicketClick ? () => onTicketClick(t) : undefined}
            />
          ))
      )}
    </div>
  );
}
