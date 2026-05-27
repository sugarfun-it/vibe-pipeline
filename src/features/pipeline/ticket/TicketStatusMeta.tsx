import type { Ticket } from "../../../../shared/types";
import { MODE_LABELS } from "../../../api/qa";
import { TICKET_STATUS_LABEL } from "../../../lib/pipelines";
import { IterLimitField } from "../run/IterLimitField";
import { isModeToggleable } from "./ticketStatus";

export function TicketStatusMeta({
  ticket,
  iterLimit,
  iterCurrent,
  isDone,
  onToggleMode,
  onChangeIterLimit,
}: {
  ticket: Ticket;
  iterLimit: number;
  iterCurrent: number;
  isDone: boolean;
  onToggleMode?: (ticketId: string, nextMode: "step" | "iter") => Promise<void> | void;
  onChangeIterLimit?: (ticketId: string, limit: number) => Promise<void> | void;
}) {
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] || ticket.status;
  const modeLabel = MODE_LABELS[ticket.mode as "step" | "iter"] ?? ticket.mode;

  return (
    <div className="drawer-meta tdrw-status-row mono">
      <span
        className="tdrw-status-chip tdrw-status-pill"
        data-state={ticket.status}
      >
        <span className="dot" />
        {statusLabel}
      </span>
      {(() => {
        const canToggle =
          onToggleMode && (ticket.mode === "step" || ticket.mode === "iter") && isModeToggleable(ticket);
        const next: "step" | "iter" = ticket.mode === "iter" ? "step" : "iter";
        // td-007:iter mode 把 mode label + 上限 / 已跑輪次 合併成單一 chip。
        // TDRW-SPEC-001:editable 狀態下(draft/ready + onChangeIterLimit 在),iter 上限交給旁邊的
        // IterLimitField 顯示,chip 內不再帶「· 上限 N 輪」否則同一資訊出現兩次,使用者不清楚兩處哪個權威。
        const isIter = ticket.mode === "iter";
        const iterFieldEditable =
          isIter && !!onChangeIterLimit && (ticket.status === "draft" || ticket.status === "ready");
        const iterSuffix = isIter
          ? (isDone || ticket.iter
            ? ` · 已跑 ${iterCurrent}/${iterLimit} 輪`
            : iterFieldEditable
              ? ""
              : ` · 上限 ${iterLimit} 輪`)
          : "";
        const baseLabel = `${modeLabel}${iterSuffix}`;
        const className =
          "tdrw-meta-chip ticket-mode" +
          (isIter ? " is-iter" : "") +
          (canToggle ? " is-toggle" : "");
        const label = canToggle ? `${baseLabel} ⇄` : baseLabel;
        const title = canToggle
          ? `點擊切換為 ${next === "iter" ? "迭代任務" : "單次任務"}`
          : ticket.mode === "merge" || ticket.mode === "sync"
          ? "synthetic ticket 不可切 mode"
          : "ticket 已跑過 / 在跑,不可切 mode";
        if (canToggle) {
          return (
            <button
              type="button"
              className={className}
              onClick={() => onToggleMode?.(ticket.id, next)}
              title={title}
              aria-pressed={isIter}
              aria-label={`目前 ${baseLabel}。點擊切換為 ${next === "iter" ? "迭代任務" : "單次任務"}`}
              style={{ cursor: "pointer" }}
            >
              {label}
            </button>
          );
        }
        return (
          <span
            className={className}
            title={title}
            role="text"
            aria-label={`${baseLabel}(無法切換:${title})`}
          >
            {baseLabel}
          </span>
        );
      })()}
      {/* iter 上限 editable 時(draft/ready)仍提供 input — 非 editable 狀態已併入上方 chip 顯示 */}
      {ticket.mode === "iter" && onChangeIterLimit && (ticket.status === "draft" || ticket.status === "ready") && (
        <IterLimitField
          ticket={ticket}
          value={iterLimit}
          onChange={onChangeIterLimit}
        />
      )}
    </div>
  );
}
