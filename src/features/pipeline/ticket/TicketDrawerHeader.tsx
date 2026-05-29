import type { Ticket } from "../../../../shared/types";
import { CloseIcon } from "../../../ui/icons";
import { TicketStatusMeta } from "./TicketStatusMeta";

export function TicketDrawerHeader({
  ticket,
  pipelineName,
  titleId,
  iterLimit,
  iterCurrent,
  isDone,
  onRequestClose,
  onToggleMode,
  onChangeIterLimit,
}: {
  ticket: Ticket;
  pipelineName: string;
  titleId: string;
  iterLimit: number;
  iterCurrent: number;
  isDone: boolean;
  onRequestClose: () => void;
  onToggleMode?: (ticketId: string, nextMode: "step" | "iter") => Promise<void> | void;
  onChangeIterLimit?: (ticketId: string, limit: number) => Promise<void> | void;
}) {
  return (
    <div className="drawer-head tdrw-head">
      <div className="drawer-crumb tdrw-breadcrumb">
        <span className="mono">{pipelineName}</span>
        <span className="drawer-crumb-spacer" />
        <button type="button"
          className="drawer-close create-x tdrw-close"
          onClick={onRequestClose}
          title="關閉 (Esc)"
          aria-label="關閉 ticket drawer"
        >
          <CloseIcon width={16} height={16} aria-hidden />
        </button>
      </div>
      <div className="drawer-titlerow tdrw-titlerow">
        <div className="drawer-title tdrw-title" id={titleId}>{ticket.title}</div>
      </div>
      <TicketStatusMeta
        ticket={ticket}
        iterLimit={iterLimit}
        iterCurrent={iterCurrent}
        isDone={isDone}
        onToggleMode={onToggleMode}
        onChangeIterLimit={onChangeIterLimit}
      />
    </div>
  );
}
