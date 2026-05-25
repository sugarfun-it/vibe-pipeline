// TicketDrawer — reverse handoff SSOT (CC → claude.ai/design).
// DOM / className verbatim from src/features/pipeline/TicketDrawer.tsx + dependencies
// (Overlay, AuditTimeline, NumberField, ConfirmDialog trigger, icons).
//
// Hooks: useState / useEffect / useId / useRef / useMemo from React.
// fetch / API are stubbed via in-memory ticket fixtures; demo controls toggle
// every state branch enumerated in the source.

const { useState, useEffect, useId, useRef, useMemo } = React;

// ─── Icon set (verbatim from src/ui/icons.tsx, only the ones TicketDrawer chain uses) ───
const RefreshIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const ScissorsIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </svg>
);
const TrashIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const ChevronIcon = (p) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const ArrowRightIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);
const WarnIcon = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17.5" r="0.8" fill="currentColor" />
  </svg>
);

// ─── Const dictionaries (verbatim from shared/types.ts + src/data/pipelines.ts) ───
const MODE_LABELS = {
  iter: "迭代任務",
  step: "單次任務",
  merge: "AI 合併",
  sync: "AI 同步",
};
const TICKET_STATUS_LABEL = {
  draft: "未執行",
  ready: "未執行",
  running: "執行中",
  paused: "暫停",
  done: "完成",
  failed: "失敗",
  failed_iter_limit: "達 iter 上限",
  failed_transient: "暫時錯誤",
};
const STATE_COLOR = {
  paused: "var(--paused)",
  running: "var(--running)",
  queued: "var(--queued)",
  ready: "var(--done)",
  planning: "var(--draft)",
  failed: "var(--failed)",
  merged: "var(--fg-faint)",
  done: "var(--done)",
  draft: "var(--draft)",
  failed_iter_limit: "var(--failed)",
  failed_transient: "var(--failed)",
};
const STATE_ARIA_LABELS = {
  planning: "規劃中",
  queued: "排隊中",
  running: "執行中",
  paused: "已暫停",
  ready: "可合併",
  failed: "失敗",
  merged: "已合併",
  done: "完成",
  draft: "草稿",
};
const SOURCE_LABEL = {
  "user-action": "使用者操作",
  "api-handler-explicit": "API 明確指定",
  "runner-self-detected": "Runner 自動偵測",
  "orchestrator.spawnDirect": "Orchestrator 啟動",
  "ticketWatcher-detected": "Ticket Watcher 偵測",
};
const DETAIL_LABELS = {
  "stop button": "停止按鈕",
  resume: "繼續執行",
  "iter_stop_at_limit": "已達 iter 上限",
  "iter_limit": "已達 iter 上限",
  "iter_limit_reached": "已達 iter 上限",
  "pipeline created": "Pipeline 建立",
  "all tickets done": "所有 ticket 完成",
  "click 合併入 main": "點擊「合併入 main」",
  "tickets added (3)": "新增 3 張 ticket",
  "QA draft created": "建立 QA 草稿",
  "QA draft promoted": "QA 草稿轉正",
  "ticket 2 started": "ticket 2 開始執行",
};
function localizeDetail(raw) {
  if (!raw) return raw;
  return DETAIL_LABELS[raw] ?? raw;
}
function ariaState(s) {
  return STATE_ARIA_LABELS[s.toLowerCase()] ?? s;
}

// ─── helpers (verbatim) ───
function fmtElapsed(s) {
  const m = Math.floor(s / 60),
    sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function normalizeVerdict(v) {
  if (v == null) return "UNKNOWN";
  const k = typeof v === "string" ? v.toUpperCase() : String(v);
  if (k === "PASS" || k === "1") return "PASS";
  if (k === "FAIL" || k === "-1") return "FAIL";
  if (k === "PARTIAL" || k === "0") return "PARTIAL";
  return "UNKNOWN";
}
function fmtTimeShort(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── status / mode predicates (verbatim) ───
function isTerminalStatus(s) {
  return s === "done" || s === "failed" || s === "failed_iter_limit" || s === "failed_transient";
}
function isModeToggleable(t) {
  if (t.mode !== "step" && t.mode !== "iter") return false;
  return t.status === "draft" || t.status === "ready";
}
function isSplittable(t) {
  if (t.mode === "merge" || t.mode === "sync") return false;
  return t.status === "draft" || t.status === "ready";
}
function isDeletable(t) {
  if (t.mode === "merge" || t.mode === "sync") return false;
  return t.status !== "running";
}

// ─── Overlay primitive (verbatim DOM contract from src/ui/Overlay.tsx) ───
function Overlay({
  role = "dialog",
  onRequestClose,
  labelledBy,
  describedBy,
  stageClassName,
  surfaceClassName,
  scrimClassName,
  children,
}) {
  const surfaceRef = useRef(null);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onRequestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose]);
  return (
    <div className={"drawer-stage" + (stageClassName ? " " + stageClassName : "")}>
      <div
        className={"drawer-scrim" + (scrimClassName ? " " + scrimClassName : "")}
        onClick={onRequestClose}
        aria-hidden="true"
      />
      <div
        ref={surfaceRef}
        className={"drawer" + (surfaceClassName ? " " + surfaceClassName : "")}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

// ─── NumberField (verbatim DOM from src/ui/forms/NumberField.tsx) ───
function NumberField({
  label,
  hint,
  error,
  value,
  onChange,
  min,
  max,
  step,
  fieldClassName,
  inputClassName,
  labelHidden,
  onBlur,
  onKeyDown,
  title,
  ariaLabel,
}) {
  const reactId = useId();
  const id = `vp-field-${reactId.replace(/[^a-z0-9]/gi, "")}`;
  const describedId = error || hint ? `${id}-desc` : undefined;
  const describedText = error ?? hint;
  return (
    <div className={"form-field" + (fieldClassName ? ` ${fieldClassName}` : "")}>
      <label htmlFor={id} className={"form-label" + (labelHidden ? " form-label--sr" : "")}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={"form-input" + (inputClassName ? ` ${inputClassName}` : "")}
        value={value === "" ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          onChange(n);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedId}
        min={min}
        max={max}
        step={step}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        title={title}
        aria-label={ariaLabel}
      />
      {describedText !== undefined && describedText !== null && describedText !== "" && (
        <div id={describedId} className={"form-hint" + (error ? " form-hint--error" : "")}>
          {describedText}
        </div>
      )}
    </div>
  );
}

// ─── ConfirmDialog stub (real impl in src/ui/ConfirmDialog.tsx).
// 在 prototype 內 confirm 用 demo control 切「自動確認 / 自動取消」決定 callback 結果,
// design 端能看到「按下去之後彈出 alertdialog」的視覺。 ───
function ConfirmDialog({ open, opts, onResult }) {
  const titleId = useId();
  const descId = useId();
  if (!open || !opts) return null;
  return (
    <Overlay
      role={opts.danger ? "alertdialog" : "dialog"}
      onRequestClose={() => { if (!opts.danger) onResult("cancel"); }}
      labelledBy={titleId}
      describedBy={opts.description ? descId : undefined}
      stageClassName="drawer-stage--modal confirm-stage"
      scrimClassName="confirm-scrim"
      surfaceClassName="drawer--modal confirm-card fade-up"
    >
      <div id={titleId} className="confirm-title">{opts.title}</div>
      {opts.warning && (
        <div className="confirm-warning">
          <span className="confirm-warning-icon" aria-hidden><WarnIcon /></span>
          <span className="confirm-warning-text">{opts.warning}</span>
        </div>
      )}
      {opts.description && (
        <div id={descId} className="confirm-desc">{opts.description}</div>
      )}
      <div className="confirm-actions">
        <button
          type="button"
          className={"btn confirm-cancel" + (opts.danger ? " confirm-cancel--autofocused" : "")}
          onClick={() => onResult("cancel")}
        >
          {opts.cancelLabel ?? "取消"}
        </button>
        <button
          type="button"
          className={"btn " + (opts.danger ? "btn-danger" : "btn-primary")}
          onClick={() => onResult("confirm")}
        >
          {opts.confirmLabel ?? "確認"}
          {!opts.danger && (
            <>
              <span className="kbd-inline mono" aria-hidden="true">↵</span>
              <span className="sr-only">(按 Enter 鍵確認)</span>
            </>
          )}
        </button>
      </div>
    </Overlay>
  );
}

// ─── AuditTimeline (verbatim DOM from src/features/pipeline/AuditTimeline.tsx).
// entries 由 prop 注入(在 prototype 內不發 HTTP);entries===null=loading、[]=empty、>0=list。 ───
function AuditTimeline({ entries, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const countDisplay = entries === null ? "···" : String(entries.length);
  return (
    <div className="tdrw-section">
      <button
        type="button"
        className="audit-toggle tdrw-section-label"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="audit-chev" aria-hidden data-open={open || undefined}>
          <ChevronIcon />
        </span>
        <span className="audit-toggle-label">狀態變動歷史</span>
        <span
          className="audit-count-badge"
          aria-label={entries == null ? "載入中" : `共 ${entries.length} 筆`}
          data-empty={entries?.length === 0 || undefined}
        >
          {countDisplay}
        </span>
      </button>
      {open && (
        <div className="tdrw-section-body" id={panelId} role="region" aria-label="狀態變動歷史">
          {entries === null && (
            <div className="tdrw-empty" role="status" aria-live="polite">
              載入狀態變動歷史中…
            </div>
          )}
          {entries && entries.length === 0 && (
            <div className="audit-empty-state" role="status" aria-live="polite">
              <div className="audit-empty-title">尚無狀態變動</div>
              <div className="audit-empty-hint">
                這個 pipeline 還沒發生過狀態變更(例如:從「規劃中」進入「執行中」、或從「可合併」進入「已合併」)。
              </div>
            </div>
          )}
          {entries && entries.length > 0 && (
            <>
              <div className="audit-sort-hint">
                共 {entries.length} 筆 · 依時間由新到舊
              </div>
              <ol className="audit-list" role="list">
                {entries.map((e, i) => (
                  <AuditRow key={`${e.ts}-${i}`} entry={e} />
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry }) {
  const srcLabel = SOURCE_LABEL[entry.source] ?? entry.source;
  const detailLabel = localizeDetail(entry.sourceDetail);
  const ariaLabel = `${fmtTime(entry.ts)}:由「${ariaState(entry.from)}」變為「${ariaState(entry.to)}」,來源 ${srcLabel}${detailLabel ? `(${detailLabel})` : ""}`;
  return (
    <li className="audit-row" role="listitem" aria-label={ariaLabel}>
      <span className="audit-ts mono" aria-hidden>{fmtTime(entry.ts)}</span>
      <span className="audit-states" aria-hidden>
        <span className="audit-from mono">{entry.from}</span>
        <span className="audit-arrow" aria-hidden>
          <ArrowRightIcon />
        </span>
        <span className="audit-to mono">{entry.to}</span>
      </span>
      <span className="audit-source-line" aria-hidden>
        <span className="audit-source" title={entry.source}>{srcLabel}</span>
        {detailLabel && (
          <span
            className={DETAIL_LABELS[entry.sourceDetail ?? ""] ? "audit-detail" : "audit-detail mono"}
            title={entry.sourceDetail !== detailLabel ? entry.sourceDetail : undefined}
          >
            {" · "}
            {detailLabel}
          </span>
        )}
      </span>
    </li>
  );
}

// ─── Section / ReadOnlyValue (verbatim) ───
function Section({ label, children }) {
  return (
    <div className="tdrw-section">
      <div className="tdrw-section-label tdrw-section-title mono">{label}</div>
      <div className="tdrw-section-body">{children}</div>
    </div>
  );
}
function ReadOnlyValue({ value }) {
  if (!value) return <span className="tdrw-empty">(空)</span>;
  return <div className="tdrw-text">{value}</div>;
}

// ─── CollapsiblePrompt (verbatim DOM; ReactMarkdown 在 prototype 內 fallback 為 pre-wrap text — 避免 CDN 多裝一個 markdown lib;
//      DOM .tdrw-prompt-md 仍存在,fade / collapsed / toggle 視覺一致) ───
function CollapsiblePrompt({ text, defaultCollapsed = false }) {
  const LONG = 400;
  const isLong = text.length > LONG;
  const shouldCollapse = isLong || defaultCollapsed;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const collapsed = shouldCollapse && !expanded;
  return (
    <div className="tdrw-prompt-collapse">
      {shouldCollapse && collapsed && (
        <span className="sr-only">
          提示詞目前為視覺折疊預覽,共 {text.length} 字,可按下「展開全部」查看完整內容。
        </span>
      )}
      <div
        inert={collapsed ? "" : undefined}
        className={"tdrw-prompt-md" + (collapsed ? " is-collapsed" : "")}
      >
        <p style={{whiteSpace:'pre-wrap', margin:0}}>{text}</p>
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
          {expanded ? "收合" : `展開全部 · 共 ${text.length} 字`}
        </button>
      )}
    </div>
  );
}

// ─── IterRounds (verbatim) ───
function IterRounds({ rounds }) {
  return (
    <div className="tdrw-iter-rounds">
      {rounds.map((r) => {
        const n = normalizeVerdict(r.criticVerdict);
        const cls = n === "PASS" ? "is-pass" : n === "FAIL" ? "is-fail" : "is-partial";
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
            <div className="tdrw-iter-round-block">
              <div className="tdrw-iter-round-label">審核 AI 回饋</div>
              {r.criticFeedback ? (
                <div className="tdrw-text">{r.criticFeedback}</div>
              ) : (
                <div className="tdrw-text tdrw-feedback-empty">
                  {n === "PASS" ? "(通過,無補充意見)" : "(無 feedback)"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Commits (verbatim DOM; clipboard 真實呼叫,fallback path 仍保留) ───
function Commits({ commits }) {
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const liveMsg = copied ? `已複製完整 commit hash ${copied.hash} 到剪貼簿` : "";

  async function copy(hash) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied({ hash, nonce: Date.now() });
    } catch {
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
              <span
                className="tdrw-commit-copied"
                aria-hidden="true"
                data-visible={isCopied || undefined}
                key={isCopied ? copied.nonce : "idle"}
              >
                已複製完整 hash
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

// ─── IterLimitField (verbatim) ───
function IterLimitField({ ticket, value, onChange }) {
  const editable =
    !!onChange &&
    ticket.mode === "iter" &&
    (ticket.status === "draft" || ticket.status === "ready");
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  if (!editable) {
    return <span>上限 {value} 輪</span>;
  }
  const draftNum = Number(draft);
  const invalid =
    draft === "" || !Number.isFinite(draftNum) || draftNum < 1 || draftNum > 5 || !Number.isInteger(draftNum);
  function commit() {
    if (invalid) return;
    if (draftNum !== value) onChange?.(ticket.id, draftNum);
  }
  return (
    <span className={"tdrw-iter-limit-wrap" + (invalid ? " is-invalid" : "")}>
      <span className="tdrw-iter-limit-label">上限</span>
      <NumberField
        label="迭代上限輪數"
        labelHidden
        ariaLabel="迭代上限輪數(1 至 5)"
        title="迭代上限輪數,範圍 1 至 5。按 Enter 送出,按 Esc 還原"
        min={1}
        max={5}
        value={draft === "" ? "" : Number(draft)}
        onChange={(v) => setDraft(v === "" ? "" : String(v))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            e.target.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(String(value));
            e.target.blur();
          }
        }}
        error={invalid ? "請輸入 1 至 5 的整數。按 Esc 還原" : undefined}
        fieldClassName="tdrw-iter-limit-field"
        inputClassName={"tdrw-iter-limit" + (invalid ? " is-invalid" : "")}
      />
      <span className="tdrw-iter-limit-unit">輪(1 至 5)</span>
    </span>
  );
}

// ─── Main: TicketDrawer (verbatim DOM / className) ───
function TicketDrawer({
  ticket,
  pipelineName,
  pipelineBranch,
  pipelineId,
  projectHash,
  auditEntries,
  isSplitting = false,
  onClose,
  onResetTicket,
  onSplitTicket,
  onDeleteTicket,
  onToggleMode,
  onChangeIterLimit,
  onRequestConfirm, // (opts) => Promise<boolean>
}) {
  const [splitPending, setSplitPending] = useState(false);
  const titleId = useId();
  const splitConfirmId = useId();
  const splitConfirmTitleId = useId();
  const splitConfirmDescId = useId();
  const splitTriggerRef = useRef(null);
  const splitCancelRef = useRef(null);
  useEffect(() => {
    if (splitPending) {
      requestAnimationFrame(() => splitCancelRef.current?.focus());
    } else {
      const t = splitTriggerRef.current;
      if (t && document.contains(t)) requestAnimationFrame(() => t.focus());
    }
  }, [splitPending]);
  const [resetPending, setResetPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  useEffect(() => {
    if (isSplitting) setSplitPending(false);
  }, [isSplitting]);
  function handleRequestClose() {
    if (splitPending) { setSplitPending(false); return; }
    onClose();
  }

  const accent = STATE_COLOR[ticket.status] || "var(--fg-mute)";
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] || ticket.status;
  const modeLabel = MODE_LABELS[ticket.mode] ?? ticket.mode;
  const spec = ticket;
  const isDone = ticket.status === "done";
  const iterLimit = spec.iterLimit ?? 5;
  const iterCurrent = ticket.iter?.current ?? 0;

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
          <pre className="tdrw-prompt" role="log" aria-live="polite" aria-atomic="false">
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
      stageClassName="tdrw-stage"
      surfaceClassName={"tdrw-drawer" + (splitPending ? " has-split-confirm" : "")}
    >
      <div className="drawer-head tdrw-head">
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
            const next = ticket.mode === "iter" ? "step" : "iter";
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
        <AuditTimeline entries={auditEntries} defaultOpen={false} />
      </div>

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
              原 ticket 會被 AI 產生的新 tickets 取代;若 AI 判斷不需拆分則維持原樣。
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
                    setResetPending(true);
                    const ok = await onRequestConfirm({
                      title: `重開 ticket「${ticket.title}」?`,
                      description:
                        `會清掉:迭代輪次 / 審核結果 / commit 紀錄;但 worktree 內已 commit 的程式碼會留著。\n` +
                        `下次執行 pipeline 會重新跑這張(可能再產生新 commit)。`,
                      confirmLabel: "重開 ticket",
                      danger: true,
                    });
                    if (ok) await onResetTicket(ticket.id);
                    setResetPending(false);
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
            {onDeleteTicket && isDeletable(ticket) && (
              <button type="button"
                className="tdrw-action tdrw-action-danger tdrw-delete-btn tdrw-delete-icon"
                disabled={deletePending}
                aria-busy={deletePending || undefined}
                aria-label={`刪除 ticket「${ticket.title}」`}
                title="刪除 ticket"
                onClick={async () => {
                  if (deletePending) return;
                  setDeletePending(true);
                  const ok = await onRequestConfirm({
                    title: `刪除 ticket「${ticket.title}」?`,
                    description:
                      "刪掉這張 ticket(後續 pipeline 不會再跑這張)。\n" +
                      "worktree 上已 commit 的程式碼留著(只是 spec 紀錄消失)。",
                    confirmLabel: "永久刪除",
                    danger: true,
                  });
                  if (ok) await onDeleteTicket(ticket.id);
                  setDeletePending(false);
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


// ─── Export to window so sibling Babel scripts can use these ───
Object.assign(window, {
  TicketDrawer, ConfirmDialog, Overlay, AuditTimeline, NumberField,
  IterRounds, Commits, IterLimitField, CollapsiblePrompt,
  RefreshIcon, ScissorsIcon, TrashIcon, ChevronIcon, ArrowRightIcon, WarnIcon,
  MODE_LABELS, TICKET_STATUS_LABEL, STATE_COLOR, STATE_ARIA_LABELS, SOURCE_LABEL,
  fmtElapsed, normalizeVerdict, fmtTimeShort, fmtTime,
  isTerminalStatus, isModeToggleable, isSplittable, isDeletable,
});
