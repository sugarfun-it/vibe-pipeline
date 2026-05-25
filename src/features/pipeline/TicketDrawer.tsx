import { useEffect, useId, useRef, useState } from "react";
import "../../styles/drawer.css";
import "./ticketDrawer.css";
import type { Ticket, CommitRef } from "../../types/pipeline";
import { MODE_LABELS } from "../../api/qa";
import { STATE_COLOR } from "../../data/pipelines";
import { formatDateTime } from "../../lib/format";
import { useConfirm } from "../../ui/ConfirmDialog";
import { RefreshIcon, ScissorsIcon, TrashIcon } from "../../ui/icons";
import { AuditTimeline } from "./AuditTimeline";
import { Overlay } from "../../ui/Overlay";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useTimeout } from "../../hooks/useTimeout";

import { TICKET_STATUS_LABEL } from "../../data/pipelines";
import { IterLimitField } from "./IterLimitField";
import { IterRounds } from "./IterRounds";
import { CollapsiblePrompt, ReadOnlyValue, Section } from "./TicketDrawerParts";

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

  const accent = STATE_COLOR[ticket.status] || "var(--fg-mute)";
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] || ticket.status;
  const modeLabel = MODE_LABELS[ticket.mode as "step" | "iter"] ?? ticket.mode;
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

  // td-006:done 狀態下優先顯示結果(iter rounds / commits / liveLog / reason),原始 spec(目標/驗收/提示詞)排後面。
  const specSections = (
    <>
      <Section label="目標">
        <ReadOnlyValue value={spec.goal} />
      </Section>
      <Section label="驗收">
        {Array.isArray(spec.acceptance) && spec.acceptance.length > 0 ? (
          <ul className="tdrw-list">
            {spec.acceptance.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : (
          <ReadOnlyValue value={undefined} />
        )}
      </Section>
      <Section label="提示詞">
        {spec.prompt ? (
          <CollapsiblePrompt text={spec.prompt} defaultCollapsed={isDone} />
        ) : (
          <span className="tdrw-empty">(空)</span>
        )}
      </Section>
    </>
  );
  const outcomeSections = (
    <>
      {ticket.iter && (
        <Section label="迭代輪次">
          <div
            className="mono tdrw-iter-summary"
            style={{
              marginBottom: ticket.iter.rounds && ticket.iter.rounds.length > 0 ? 10 : 0,
            }}
          >
            第 {ticket.iter.current} 輪 · {ticket.iter.verdicts.length} 次審核
          </div>
          {ticket.iter.rounds && ticket.iter.rounds.length > 0 && (
            <IterRounds rounds={ticket.iter.rounds} />
          )}
        </Section>
      )}
      {ticket.commits && ticket.commits.length > 0 && (
        <Section label="commit 紀錄">
          <Commits commits={ticket.commits} />
        </Section>
      )}
      {ticket.liveLog && (
        <Section label="即時日誌">
          <pre
            className="tdrw-prompt"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {ticket.liveLog}
          </pre>
        </Section>
      )}
      {ticket.reason && (
        <Section label="原因說明">
          <ReadOnlyValue value={ticket.reason} />
        </Section>
      )}
    </>
  );

  const showActions =
    (onResetTicket || onSplitTicket || onDeleteTicket) &&
    (isTerminalStatus(ticket.status) || isSplittable(ticket) || isDeletable(ticket));

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
              onClick={handleRequestClose}
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
          <div className="drawer-meta tdrw-status-row mono">
            <span
              className="tdrw-status-chip tdrw-status-pill"
              data-state={ticket.status}
              style={{
                color: accent,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
              }}
            >
              <span className="dot" style={{ background: accent }} />
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
        </div>

        <div className="drawer-body tdrw-body">
          {/* td-006:done 狀態下 outcome(結果)優先,spec(目標 / 驗收 / 提示詞)排後面 */}
          {isDone ? (
            <>
              {outcomeSections}
              {specSections}
            </>
          ) : (
            <>
              {specSections}
              {outcomeSections}
            </>
          )}
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
          isSplitting ? (
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
                    onClick={async () => {
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
                    }}
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
                  className="tdrw-action tdrw-action-danger tdrw-delete-btn tdrw-delete-icon"
                  disabled={deletePending}
                  aria-busy={deletePending || undefined}
                  aria-label={`刪除 ticket「${ticket.title}」`}
                  title="刪除 ticket"
                  onClick={async () => {
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
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                  <span className="tdrw-delete-icon-label">刪除</span>
                </button>
              )}
            </div>
          )
        )}
    </Overlay>
  );
}

function isTerminalStatus(s: string): boolean {
  return s === "done" || s === "failed" || s === "failed_iter_limit" || s === "failed_transient";
}

// 只 draft / ready 可切 mode(step ↔ iter);跑過後切 mode 影響已產生的 iter rounds 顯示語意
function isModeToggleable(t: Ticket): boolean {
  if (t.mode !== "step" && t.mode !== "iter") return false; // synthetic 不切
  return t.status === "draft" || t.status === "ready";
}

// 只 draft / ready 可拆;running 中拆會撞 runner;done / failed 拆完也派不出去(已跑過)
function isSplittable(t: Ticket): boolean {
  if (t.mode === "merge" || t.mode === "sync") return false; // synthetic 不可拆
  return t.status === "draft" || t.status === "ready";
}

// running 不可刪(撞 runner);synthetic 系統管的不可刪;其他 (draft/ready/paused/done/failed_*) 都可
function isDeletable(t: Ticket): boolean {
  if (t.mode === "merge" || t.mode === "sync") return false;
  return t.status !== "running";
}

function Commits({ commits }: { commits: CommitRef[] }) {
  // TD-COPY-003:用 {hash, nonce} 而不是只存 hash → 同一 hash 連點兩次也能 reset timer + 重播 SR live message
  const [copied, setCopied] = useState<{ hash: string; nonce: number } | null>(null);
  useTimeout(() => setCopied(null), copied ? 1500 : null, [copied]);
  // TD-COPY-004:SR live region 從 button 內抽出來,放在 container 外,避免 aria-hidden / aria-label 動態切換 race
  const liveMsg = copied ? `已複製完整 commit hash ${copied.hash} 到剪貼簿` : "";

  async function copy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied({ hash, nonce: Date.now() });
    } catch {
      // 部分環境(non-https / older browsers)沒 clipboard API,fallback 暴力 select
      const ta = document.createElement("textarea");
      ta.value = hash;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied({ hash, nonce: Date.now() }); } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="tdrw-commits">
      {/* 共用 visually-hidden live region,跟視覺 chip 解耦 — 視覺只負「我複製了哪個」,SR 負完整訊息 */}
      <span className="sr-only" role="status" aria-live="polite">{liveMsg}</span>
      {commits.map((c) => {
        const isCopied = copied?.hash === c.hash;
        const shortHash = c.hash.slice(0, 7);
        return (
          <div key={c.hash} className="tdrw-commit">
            <button type="button"
              className={"mono tdrw-commit-hash tdrw-commit-hash-btn" + (isCopied ? " is-copied" : "")}
              title={isCopied ? `已複製完整 commit hash:${c.hash}` : `點擊複製完整 commit hash:${c.hash}`}
              aria-label={`複製完整 commit hash ${c.hash}`}
              onClick={() => copy(c.hash)}
            >
              {shortHash}
              {/* TD-COPY-001:chip 改錨在 hash button 上方,不再蓋住 hash 文字。
                  chip 純視覺(aria-hidden),SR 訊息走上面的 .sr-only live region。 */}
              <span
                className="tdrw-commit-copied"
                aria-hidden="true"
                data-visible={isCopied || undefined}
                // key on nonce 強制 re-mount → CSS transition / animation 從頭播
                key={isCopied ? copied!.nonce : "idle"}
              >
                已複製完整 hash
              </span>
            </button>
            <span className="tdrw-commit-subject">{c.subject}</span>
            <span className="mono tdrw-commit-ts">{formatDateTime(c.ts, "short")}</span>
          </div>
        );
      })}
    </div>
  );
}
