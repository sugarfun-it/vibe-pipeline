import type { RefObject } from "react";
import type { Ticket } from "../../../../shared/types";
import { RefreshIcon, ScissorsIcon, TrashIcon } from "../../../ui/icons";
import { isDeletable, isSplittable, isTerminalStatus } from "./ticketStatus";

export function TicketActions({
  ticket,
  isSplitting,
  splitPending,
  resetPending,
  deletePending,
  splitConfirmId,
  splitConfirmTitleId,
  splitConfirmDescId,
  splitTriggerRef,
  splitCancelRef,
  setSplitPending,
  onResetTicket,
  onSplitTicket,
  onDeleteTicket,
  onResetAction,
  onDeleteAction,
}: {
  ticket: Ticket;
  isSplitting: boolean;
  splitPending: boolean;
  resetPending: boolean;
  deletePending: boolean;
  splitConfirmId: string;
  splitConfirmTitleId: string;
  splitConfirmDescId: string;
  splitTriggerRef: RefObject<HTMLButtonElement>;
  splitCancelRef: RefObject<HTMLButtonElement>;
  setSplitPending: (v: boolean) => void;
  onResetTicket?: (ticketId: string) => Promise<void> | void;
  onSplitTicket?: (ticketId: string) => Promise<void> | void;
  onDeleteTicket?: (ticketId: string) => Promise<void> | void;
  onResetAction: () => Promise<void>;
  onDeleteAction: () => Promise<void>;
}) {
  return isSplitting ? (
    <div
      className="tdrw-footer tdrw-actions-running"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="tdrw-spinner" aria-hidden />
      <span className="tdrw-running-label">AI 拆分中…(約 10-30 秒)</span>
    </div>
  ) : splitPending && onSplitTicket && isSplittable(ticket) ? (
    <div
      id={splitConfirmId}
      className="tdrw-footer tdrw-split-confirm"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={splitConfirmTitleId}
      aria-describedby={splitConfirmDescId}
    >
      <div className="tdrw-split-confirm-head">
        <ScissorsIcon className="tdrw-split-confirm-icon" aria-hidden="true" />
        <div id={splitConfirmTitleId} className="tdrw-split-confirm-title">
          以 AI 拆分並取代這張 ticket
        </div>
      </div>
      <div id={splitConfirmDescId} className="tdrw-split-confirm-desc">
        原 ticket 會被 AI 產生的新 tickets 取代；若 AI 判斷不需拆分則維持原樣。
        執行約 10–30 秒,期間 pipeline 暫不可動。
      </div>
      <div className="tdrw-split-confirm-actions">
        <button
          ref={splitCancelRef}
          type="button"
          className="tdrw-action"
          onClick={() => setSplitPending(false)}
        >
          取消
        </button>
        <button
          type="button"
          className="tdrw-action tdrw-action-danger tdrw-split-confirm-cta"
          onClick={() => {
            setSplitPending(false);
            onSplitTicket(ticket.id);
          }}
        >
          <ScissorsIcon aria-hidden="true" /> 拆分並取代原 ticket
        </button>
      </div>
    </div>
  ) : (
    <div className="tdrw-footer tdrw-actions">
      <div className="tdrw-actions-primary">
        {onResetTicket && isTerminalStatus(ticket.status) && (
          <button type="button"
            className="tdrw-action"
            disabled={resetPending}
            aria-busy={resetPending || undefined}
            aria-label="重開 ticket 並清除目前執行狀態"
            onClick={onResetAction}
          >
            <RefreshIcon aria-hidden="true" /> 重開 ticket
          </button>
        )}
        {onSplitTicket && isSplittable(ticket) && (
          <button type="button"
            ref={splitTriggerRef}
            className="tdrw-action"
            onClick={() => setSplitPending(true)}
            title="點擊後會先顯示確認卡,不會立即拆分"
            aria-label="AI 拆分,點擊後出現確認步驟"
            aria-haspopup="dialog"
            aria-controls={splitConfirmId}
            aria-expanded={splitPending}
          >
            <ScissorsIcon aria-hidden="true" /> AI 拆分…
          </button>
        )}
      </div>
      {/* td-011:delete 走 ConfirmDialog 「永久刪除」label + danger tone(bg-soft + danger-border) */}
      {onDeleteTicket && isDeletable(ticket) && (
        <button type="button"
          className="tdrw-action btn-danger btn-ghost tdrw-delete-icon"
          disabled={deletePending}
          aria-busy={deletePending || undefined}
          aria-label={`刪除 ticket「${ticket.title}」`}
          title="刪除 ticket"
          onClick={onDeleteAction}
        >
          <TrashIcon aria-hidden="true" />
          <span className="tdrw-delete-icon-label">刪除</span>
        </button>
      )}
    </div>
  );
}
