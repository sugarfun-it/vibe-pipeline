import { useEffect, useId, useRef, useState } from "react";
import "../../../styles/drawer.css";
import "./ticket.css";
import type { Ticket } from "../../../../shared/types";
import { useConfirm } from "../../../ui/ConfirmDialog";
import { AuditTimeline } from "../diff/AuditTimeline";
import { Overlay } from "../../../ui/Overlay";
import { useAsyncAction } from "../../../hooks/useAsyncAction";

import { OutcomeSections } from "./OutcomeSections";
import { SpecSections } from "./SpecSections";
import { TicketActions } from "./TicketActions";
import { TicketDrawerHeader } from "./TicketDrawerHeader";
import { isDeletable, isSplittable, isTerminalStatus } from "./ticketStatus";

export function TicketDrawer({
  ticket,
  pipelineName,
  pipelineId,
  projectHash,
  isSplitting = false,
  onClose,
  onResetTicket,
  onSplitTicket,
  onDeleteTicket,
  onToggleMode,
  onChangeIterLimit,
}: {
  ticket: Ticket;
  pipelineName: string;
  pipelineId: string;
  projectHash: string;
  isSplitting?: boolean;
  onClose: () => void;
  onResetTicket?: (ticketId: string) => Promise<void> | void;
  onSplitTicket?: (ticketId: string) => Promise<void> | void;
  onDeleteTicket?: (ticketId: string) => Promise<void> | void;
  onToggleMode?: (ticketId: string, nextMode: "step" | "iter") => Promise<void> | void;
  onChangeIterLimit?: (ticketId: string, limit: number) => Promise<void> | void;
}) {
  const confirm = useConfirm();
  // inline split confirm:點 ✂ AI 拆分 後不跳 popup,actions 區塊就地展開成 inline 確認卡
  // splitPending 是 UI 開關(顯不顯示 inline 確認卡),不是 async pending,因此維持手寫 useState
  const [splitPending, setSplitPending] = useState(false);
  const titleId = useId();
  const splitConfirmId = useId();
  const splitConfirmTitleId = useId();
  const splitConfirmDescId = useId();
  // 觸發按鈕 ref — 讓 ESC / 取消 收起時把焦點還回原 trigger,維持鍵盤連續性
  const splitTriggerRef = useRef<HTMLButtonElement | null>(null);
  const splitCancelRef = useRef<HTMLButtonElement | null>(null);
  // splitPending true 後把焦點移進確認卡內的「取消」(默認低風險入口),避免鍵盤 / SR
  // 使用者完全不知道 footer 已換成高風險確認狀態。
  useEffect(() => {
    if (splitPending) {
      // 等下一 frame 等 DOM mount 完
      requestAnimationFrame(() => {
        splitCancelRef.current?.focus();
      });
    } else {
      // 收起時若 trigger 仍在 DOM(沒被 isSplitting / status change 摘掉),把焦點還回去
      const t = splitTriggerRef.current;
      if (t && document.contains(t)) {
        requestAnimationFrame(() => t.focus());
      }
    }
  }, [splitPending]);
  // reset / delete:雙擊保護 + 失敗時 caller 自己派 toast(這裡 hook 內 throw,error 不消費也 ok)
  const [resetTicket, { pending: resetPending }] = useAsyncAction(async (id: string) => {
    if (onResetTicket) await onResetTicket(id);
  });
  const [deleteTicket, { pending: deletePending }] = useAsyncAction(async (id: string) => {
    if (onDeleteTicket) await onDeleteTicket(id);
  });
  // isSplitting true → 強制收起 pending UI(已經在跑了)
  useEffect(() => {
    if (isSplitting) setSplitPending(false);
  }, [isSplitting]);
  // Overlay 的 onRequestClose 入口:ESC / scrim 點擊都走這。
  // 攔截 splitPending → 先收起 inline 拆分確認卡,不關 drawer。
  // ESC 在 input / textarea / IterLimitField 上不會觸發到這(Overlay 內已過濾)。
  function handleRequestClose() {
    if (splitPending) { setSplitPending(false); return; }
    onClose();
  }

  const spec = ticket as unknown as {
    goal?: string;
    acceptance?: string[];
    prompt?: string;
    iterLimit?: number;
    iterStopAtLimit?: boolean;
  };
  const isDone = ticket.status === "done";
  const iterLimit = spec.iterLimit ?? 5;
  const iterCurrent = ticket.iter?.current ?? 0;

  const showActions =
    (onResetTicket || onSplitTicket || onDeleteTicket) &&
    (isTerminalStatus(ticket.status) || isSplittable(ticket) || isDeletable(ticket));

  async function handleResetAction() {
    if (resetPending) return;
    const ok = await confirm({
      title: `重開 ticket「${ticket.title}」?`,
      description:
        `會清掉:迭代輪次 / 審核結果 / commit 紀錄;但 worktree 內已 commit 的程式碼會留著。\n` +
        `下次執行 pipeline 會重新跑這張(可能再產生新 commit)。`,
      confirmLabel: "重開 ticket",
      danger: true,
    });
    if (!ok) return;
    await resetTicket(ticket.id);
  }

  async function handleDeleteAction() {
    if (deletePending) return;
    const ok = await confirm({
      title: `刪除 ticket「${ticket.title}」?`,
      description:
        "刪掉這張 ticket(後續 pipeline 不會再跑這張)。\n" +
        "worktree 上已 commit 的程式碼留著(只是 spec 紀錄消失)。",
      confirmLabel: "永久刪除",
      danger: true,
    });
    if (!ok) return;
    await deleteTicket(ticket.id);
  }

  return (
    <Overlay
      role="dialog"
      onRequestClose={handleRequestClose}
      labelledBy={titleId}
      portal={false}
      initialFocus="close"
      stageClassName="tdrw-stage"
      surfaceClassName={"tdrw-drawer" + (splitPending ? " has-split-confirm" : "")}
    >
        <TicketDrawerHeader
          ticket={ticket}
          pipelineName={pipelineName}
          titleId={titleId}
          iterLimit={iterLimit}
          iterCurrent={iterCurrent}
          isDone={isDone}
          onRequestClose={handleRequestClose}
          onToggleMode={onToggleMode}
          onChangeIterLimit={onChangeIterLimit}
        />

        <div className="drawer-body tdrw-body">
          {/* outcome / iter rounds 永遠優先(user 主要關心動態進度 / 結果),spec 排後面 */}
          <OutcomeSections ticket={ticket} />
          <SpecSections
            goal={spec.goal}
            acceptance={spec.acceptance}
            prompt={spec.prompt}
            isDone={isDone}
          />
          {/* pipeline 執行紀錄已移到 pipeline header OverflowMenu「執行紀錄」(整 pipeline scope,不該塞 ticket drawer) */}
          <AuditTimeline
            projectHash={projectHash}
            pipelineId={pipelineId}
            defaultOpen={false}
          />
        </div>

        {/* td-001 / td-009:actions 從 header 下方移到 drawer 底部 sticky footer;
            primary 操作 (重開 / AI 拆分) 在左,destructive (刪除) 推到右,視覺再退一級 */}
        {showActions && (
          <TicketActions
            ticket={ticket}
            isSplitting={isSplitting}
            splitPending={splitPending}
            resetPending={resetPending}
            deletePending={deletePending}
            splitConfirmId={splitConfirmId}
            splitConfirmTitleId={splitConfirmTitleId}
            splitConfirmDescId={splitConfirmDescId}
            splitTriggerRef={splitTriggerRef}
            splitCancelRef={splitCancelRef}
            setSplitPending={setSplitPending}
            onResetTicket={onResetTicket}
            onSplitTicket={onSplitTicket}
            onDeleteTicket={onDeleteTicket}
            onResetAction={handleResetAction}
            onDeleteAction={handleDeleteAction}
          />
        )}
    </Overlay>
  );
}
