import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "../../styles/drawer.css";
import "./ticketDrawer.css";
import type { Ticket, IterRound, CommitRef } from "../../types/pipeline";
import { MODE_LABELS } from "../../api/qa";
import { STATE_COLOR, fmtElapsed, normalizeVerdict } from "../../data/pipelines";
import { useConfirm } from "../../ui/ConfirmDialog";
import { RefreshIcon, ScissorsIcon, TrashIcon } from "../../ui/icons";
import { AuditTimeline } from "./AuditTimeline";
import { Overlay } from "../../ui/Overlay";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useTimeout } from "../../hooks/useTimeout";
import { NumberField } from "../../ui/forms/NumberField";

import { TICKET_STATUS_LABEL } from "../../data/pipelines";

export function TicketDrawer({
  ticket,
  pipelineName,
  pipelineBranch,
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
  pipelineBranch: string;
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
      surfaceClassName="tdrw-drawer"
    >
        <div className="drawer-head tdrw-head">
          {/* td-003:desktop 顯完整 breadcrumb;mobile 改 single-line context meta */}
          <div className="drawer-crumb tdrw-breadcrumb">
            <span className="mono">{pipelineName}</span>
            <span className="sep" style={{ color: "var(--fg-faint)" }}>›</span>
            {pipelineBranch && (
              <>
                <span className="mono tdrw-crumb-branch" title={`pipeline branch:${pipelineBranch}`}>
                  {pipelineBranch}
                </span>
                <span className="sep" style={{ color: "var(--fg-faint)" }}>›</span>
              </>
            )}
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
              // td-007:iter mode 把 mode label + 上限 / 已跑輪次 合併成單一 chip
              const isIter = ticket.mode === "iter";
              const iterSuffix = isIter
                ? (isDone || ticket.iter
                  ? ` · 已跑 ${iterCurrent}/${iterLimit} 輪`
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
            <div className="tdrw-footer tdrw-split-confirm" role="group" aria-label="AI 拆分確認">
              <div className="tdrw-split-confirm-title">
                用 AI 把這張 ticket 拆成多張獨立 ticket?
              </div>
              <div className="tdrw-split-confirm-desc">
                AI 會分析目前的目標與驗收,拆成數張各自可獨立執行的 ticket,
                原本這張會被取代(AI 判斷不需拆時則維持原樣)。
                執行約 10-30 秒,期間 pipeline 暫不可動。
              </div>
              <div className="tdrw-split-confirm-actions">
                <button type="button" className="tdrw-action" onClick={() => setSplitPending(false)}>
                  取消
                </button>
                <button type="button" className="tdrw-action tdrw-action-primary"
                  onClick={() => {
                    setSplitPending(false);
                    onSplitTicket(ticket.id);
                  }}
                >
                  <ScissorsIcon /> 確認 AI 拆分
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
                    <RefreshIcon /> 重開 ticket
                  </button>
                )}
                {onSplitTicket && isSplittable(ticket) && (
                  <button type="button"
                    className="tdrw-action"
                    onClick={() => setSplitPending(true)}
                    title="點擊後會先顯示確認卡,不會立即拆分"
                    aria-label="AI 拆分,點擊後出現確認步驟"
                  >
                    <ScissorsIcon /> AI 拆分…
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
                  <TrashIcon />
                  <span className="tdrw-delete-icon-label">刪除</span>
                </button>
              )}
            </div>
          )
        )}
    </Overlay>
  );
}

// 迭代上限欄位:draft / ready 狀態的 iter ticket 顯 number input,點 ▲▼ / 直接打字改;
// 失焦或 Enter 才送(避免每按一下都打 API)。其他狀態 read-only 顯「上限 N 輪」。
function IterLimitField({
  ticket,
  value,
  onChange,
}: {
  ticket: Ticket;
  value: number;
  onChange?: (ticketId: string, limit: number) => Promise<void> | void;
}) {
  const editable =
    !!onChange &&
    ticket.mode === "iter" &&
    (ticket.status === "draft" || ticket.status === "ready");
  const [draft, setDraft] = useState(String(value));
  // ticket value 從外部變化(別人改 / refetch)→ 同步進來
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  if (!editable) {
    return <span>上限 {value} 輪</span>;
  }
  const draftNum = Number(draft);
  const invalid =
    draft === "" || !Number.isFinite(draftNum) || draftNum < 1 || draftNum > 5 || !Number.isInteger(draftNum);
  // 不自動 clamp:invalid 時還原回前一個有效值,不偷偷存錯誤值。只 valid 才 commit
  function commit() {
    if (invalid) {
      setDraft(String(value));
      return;
    }
    if (draftNum !== value) onChange?.(ticket.id, draftNum);
  }
  return (
    <span className="tdrw-iter-limit-wrap">
      <span style={{ color: "var(--fg-mute)" }}>上限</span>
      <NumberField
        label="迭代上限輪數"
        labelHidden
        ariaLabel="迭代上限輪數(1 至 5)"
        title="迭代上限輪數,範圍 1-5。Enter 送出 / Esc 還原"
        min={1}
        max={5}
        value={draft === "" ? "" : Number(draft)}
        onChange={(v) => setDraft(v === "" ? "" : String(v))}
        onBlur={commit}
        onKeyDown={(e) => {
          // ESC 在 input 內只還原,不冒泡(免 TicketDrawer 全域 ESC 又收掉 drawer)
          if (e.key === "Enter") {
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        error={invalid ? "請輸入 1-5 的整數,Esc 還原" : undefined}
        fieldClassName="tdrw-iter-limit-field"
        inputClassName={"tdrw-iter-limit" + (invalid ? " is-invalid" : "")}
      />
      <span style={{ color: "var(--fg-mute)" }}>輪 (1-5)</span>
    </span>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tdrw-section">
      <div className="tdrw-section-label tdrw-section-title mono">{label}</div>
      <div className="tdrw-section-body">{children}</div>
    </div>
  );
}

function ReadOnlyValue({ value }: { value: string | undefined }) {
  if (!value) return <span className="tdrw-empty">(空)</span>;
  return <div className="tdrw-text">{value}</div>;
}

// 長 prompt 內容預設折疊,避免推走後續操作型 section(迭代輪次 / commit / 日誌 / 原因 / 狀態歷史)。
// 短內容(< 400 字)直接全顯,不放折疊鈕(不浪費 click)。
// 重點:永遠把完整 markdown 餵給 ReactMarkdown,不切原文(切 raw markdown 會切壞 fenced code block / list / table);
// 折疊用 CSS max-height + 漸層遮罩做視覺裁切。
// a11y:折疊時把所有可 focus 子元素 tabindex=-1,避免 Tab 跑到看不見的連結。
// 注意:不對整塊 aria-hidden — collapsed preview 仍是可見內容,設 aria-hidden 會讓 SR 連可見部分都讀不到。
// SR 可讀完整 markdown(內容仍在 DOM),視覺端用 max-height + fade 裁切;Tab 鏈不會跑到視覺外。
function CollapsiblePrompt({ text, defaultCollapsed = false }: { text: string; defaultCollapsed?: boolean }) {
  const LONG = 400;
  const isLong = text.length > LONG;
  // done 狀態下短 prompt 也預設折疊(td-006:done 時 outcome 在前,原始 spec 退到後面收合)
  const shouldCollapse = isLong || defaultCollapsed;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const collapsed = shouldCollapse && !expanded;
  const ref = useRef<HTMLDivElement | null>(null);
  // 折疊狀態變動 → 重新把所有 focusable 子元素 tabindex 設成 -1(否則 Tab 會跑到看不見的連結)
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, [tabindex]");
    focusables.forEach((el) => {
      if (collapsed) {
        if (el.dataset.tdrwPrevTabindex === undefined) {
          el.dataset.tdrwPrevTabindex = el.getAttribute("tabindex") ?? "";
        }
        el.setAttribute("tabindex", "-1");
      } else if (el.dataset.tdrwPrevTabindex !== undefined) {
        const prev = el.dataset.tdrwPrevTabindex;
        if (prev === "") el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", prev);
        delete el.dataset.tdrwPrevTabindex;
      }
    });
  }, [collapsed, text]);
  return (
    <div className="tdrw-prompt-collapse">
      <div
        ref={ref}
        className={"tdrw-prompt-md" + (collapsed ? " is-collapsed" : "")}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
        {collapsed && <div className="tdrw-prompt-fade" aria-hidden />}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          className="tdrw-prompt-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `收合提示詞,共 ${text.length} 字`
              : `展開提示詞,共 ${text.length} 字(目前折疊預覽)`
          }
        >
          {expanded ? "收合" : `展開全部(共 ${text.length} 字)`}
        </button>
      )}
    </div>
  );
}

function IterRounds({ rounds }: { rounds: IterRound[] }) {
  return (
    <div className="tdrw-iter-rounds">
      {rounds.map((r) => {
        const n = normalizeVerdict(r.criticVerdict);
        const cls =
          n === "PASS"
            ? "is-pass"
            : n === "FAIL"
            ? "is-fail"
            : "is-partial";
        // td-012:PASS / FAIL 顯示中文化標籤(domain term Runner / commit / branch 保留英文,
        // 但審核結果 verdict 是純語意判定,翻譯不影響領域語)
        const verdictLabel = n === "PASS" ? "通過" : n === "FAIL" ? "失敗" : r.criticVerdict;
        const dur =
          r.endedAt && r.startedAt
            ? fmtElapsed(Math.round((r.endedAt - r.startedAt) / 1000))
            : "—";
        return (
          <div key={r.n} className="tdrw-iter-round">
            <div className="tdrw-iter-round-head">
              <span className="mono tdrw-iter-round-n">#{r.n}</span>
              <span
                className={"tdrw-iter-verdict " + cls}
                title={r.criticVerdict}
                aria-label={`審核結果 ${verdictLabel}(原值 ${r.criticVerdict})`}
              >
                {verdictLabel}
              </span>
              <span className="mono tdrw-iter-round-dur">{dur}</span>
            </div>
            {r.executorSummary && (
              <div className="tdrw-iter-round-block">
                <div className="tdrw-iter-round-label">執行 AI 摘要</div>
                <div className="tdrw-text">{r.executorSummary}</div>
              </div>
            )}
            {/* 審核 block 永遠顯,空 feedback 顯 placeholder(PASS 時 runner prompt 允許省略 feedback,
                若 UI 整段隱掉,user 會誤以為審核沒跑) */}
            <div className="tdrw-iter-round-block">
              <div className="tdrw-iter-round-label">審核 AI 回饋</div>
              {r.criticFeedback ? (
                <div className="tdrw-text">{r.criticFeedback}</div>
              ) : (
                <div className="tdrw-text tdrw-feedback-empty">
                  ({n === "PASS" ? "通過,無補充意見" : "(無 feedback)"})
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Commits({ commits }: { commits: CommitRef[] }) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  useTimeout(() => setCopiedHash(null), copiedHash ? 1500 : null, [copiedHash]);

  async function copy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
    } catch {
      // 部分環境(non-https / older browsers)沒 clipboard API,fallback 暴力 select
      const ta = document.createElement("textarea");
      ta.value = hash;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopiedHash(hash); } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="tdrw-commits">
      {commits.map((c) => {
        const isCopied = copiedHash === c.hash;
        const shortHash = c.hash.slice(0, 7);
        return (
          <div key={c.hash} className="tdrw-commit">
            <button type="button"
              className={"mono tdrw-commit-hash tdrw-commit-hash-btn" + (isCopied ? " is-copied" : "")}
              title={isCopied ? `已複製完整 commit hash:${c.hash}` : `點擊複製完整 commit hash:${c.hash}`}
              aria-label={`複製 commit hash ${c.hash}${isCopied ? "(已複製)" : ""}`}
              onClick={() => copy(c.hash)}
            >
              {shortHash}
              {/* 浮層 chip(position:absolute),不擠進 row 寬度,所以不會 shift subject;
                  user 看到 chip 漂在 hash 旁,1.4s 後消失 */}
              <span
                className="tdrw-commit-copied"
                role="status"
                aria-live="polite"
                aria-hidden={!isCopied}
                data-visible={isCopied || undefined}
              >
                {isCopied ? "已複製" : ""}
              </span>
            </button>
            <span className="tdrw-commit-subject">{c.subject}</span>
            <span className="mono tdrw-commit-ts">{fmtTimeShort(c.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}

function fmtTimeShort(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}
