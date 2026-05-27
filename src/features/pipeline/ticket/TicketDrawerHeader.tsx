import type { Ticket } from "../../../../shared/types";
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
      {/* td-003:desktop 顯完整 breadcrumb;mobile 改 single-line context meta */}
      <div className="drawer-crumb tdrw-breadcrumb">
        <span className="mono">{pipelineName}</span>
        <span className="sep" style={{ color: "var(--fg-faint)" }}>›</span>
        <span className="mono" style={{ color: "var(--fg-mute)" }}>
          Ticket #{String(ticket.n).padStart(2, "0")}
        </span>
        <span className="drawer-crumb-spacer" />
        <button type="button"
          className="create-x tdrw-close"
          onClick={onRequestClose}
          title="關閉 (Esc)"
          aria-label="關閉 ticket drawer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="tdrw-mobile-context" aria-hidden="true">
        <span className="mono tdrw-mobile-context-pipeline" title={pipelineName}>
          pipeline/{pipelineName}
        </span>
        <span className="tdrw-mobile-context-sep">·</span>
        <span className="mono tdrw-mobile-context-ticket">
          Ticket #{String(ticket.n).padStart(2, "0")}
        </span>
      </div>
      <div className="drawer-titlerow tdrw-titlerow">
        <div className="drawer-title tdrw-title" id={titleId}>{ticket.title}</div>
      </div>
      {/* td-005 / td-008:status chip 保留 filled tone 為主狀態,mode/iter 改 meta 文字退一級 */}
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
