// ────────────────────────────────────────────────────────────────
// QADrawer — JSX SSOT (DOM/className verbatim from
// src/features/qa/QADrawer.tsx). Stubs API calls + Overlay focus
// trap; no real fetch / portal / inert sibling logic. All states
// surfaced via the bottom-left demo panel (props injection).
//
// All shipping behaviour:
//  - 3 top-level views: bootstrap / chat / review (showReview gate)
//  - viewOverride sticky tri-state (null / "chat" / "review")
//  - SpecChecklist in head with 4 per-chip states (filled × expanded)
//  - chat body: welcome bubble + starter chips OR turns + thinking
//    + InlineMultiSelect (when last AI turn has multi options)
//  - spec-ready-bar shown when 5/5 but user is still in chat
//  - Composer: single quick-reply chips + textarea + send + cancel
//    link, busy state (lock textarea + send)
//  - close-confirm inline alert when textarea has unsent text
//  - SpecReview: 5 fields + split-proposal (when ≥2 splitInto) +
//    iter-only fields when mode=iter
//  - All copy/constant strings verbatim (zh-Hant)
// ────────────────────────────────────────────────────────────────

const { useEffect, useId, useRef, useState } = React;

// ── Constants verbatim from src/features/qa/QADrawer.tsx ────────
const FIRST_AI_MESSAGE = "描述需求、完成標準與限制條件，我會整理成需求單規格。";
const FIRST_AI_OPTIONS = [
  "建立功能需求",
  "整理錯誤回報",
  "盤點可建立的需求單",
];
const BOOTSTRAP_LABEL = "啟動需求整理";

// shared/types.ts — FIELD_LABELS (used both inline below and in checklist)
const FIELD_LABELS = [
  { key: "title", label: "標題" },
  { key: "goal", label: "目標" },
  { key: "acceptance", label: "驗收" },
  { key: "prompt", label: "提示詞" },
  { key: "mode", label: "模式" },
];

// ── Icons verbatim from src/ui/icons.tsx ────────────────────────
function ArrowRightIcon(p) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
function CheckIconSm(p) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 12.5 9.5 18 20 6" />
    </svg>
  );
}

// ── Overlay stub — keeps stage / scrim / drawer DOM shape so all
// CSS hooks (`drawer-stage`, `drawer-scrim`, `drawer`, etc) match
// source. Drops portal + inert sibling logic (not needed for static
// preview). ESC = onRequestClose. Scrim click = onRequestClose.
function Overlay({
  role = "dialog",
  onRequestClose,
  labelledBy,
  stageClassName,
  surfaceClassName,
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
        className="drawer-scrim"
        onClick={onRequestClose}
        aria-hidden="true"
      />
      <div
        ref={surfaceRef}
        className={"drawer" + (surfaceClassName ? " " + surfaceClassName : "")}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

// ── isSpecComplete: verbatim ─────────────────────────────────────
function isSpecComplete(s) {
  if (!s) return false;
  return (
    !!s.title &&
    !!s.goal &&
    Array.isArray(s.acceptance) &&
    s.acceptance.length > 0 &&
    !!s.prompt &&
    (s.mode === "step" || s.mode === "iter")
  );
}

// ── ThinkingDots: verbatim ───────────────────────────────────────
function ThinkingDots() {
  return (
    <span className="qadr-thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

// ── Bubble: verbatim ────────────────────────────────────────────
function Bubble({ kind, message }) {
  return (
    <div className={"qadr-bubble qadr-bubble-" + kind}>
      <div className="qadr-bubble-role mono">{kind === "user" ? "你" : "助理"}</div>
      <div className="qadr-bubble-msg">{message}</div>
    </div>
  );
}

// ── lastAiOptions: verbatim ─────────────────────────────────────
function lastAiOptions(draft) {
  if (!draft) return { options: [], mode: "single" };
  if (draft.turns.length === 0) return { options: FIRST_AI_OPTIONS, mode: "single" };
  const last = draft.turns[draft.turns.length - 1];
  if (last.role !== "ai") return { options: [], mode: "single" };
  return { options: last.options ?? [], mode: last.optionsMode ?? "single" };
}

// ── InlineMultiSelect: verbatim ─────────────────────────────────
function InlineMultiSelect({ options, busy, onSendMulti }) {
  const [picked, setPicked] = useState(new Set());
  const sendBtnRef = useRef(null);
  const statusId = "qadr-inline-multi-status";
  useEffect(() => { setPicked(new Set()); }, [options]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      sendBtnRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    return () => cancelAnimationFrame(id);
  }, [picked.size]);

  function toggle(i) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function send() {
    if (busy || picked.size === 0) return;
    const chosen = Array.from(picked).sort((a, b) => a - b).map((i) => options[i]);
    onSendMulti(chosen);
    setPicked(new Set());
  }

  return (
    <div
      className="qadr-inline-multi"
      role="group"
      aria-label="多選回覆"
      aria-describedby={statusId}
    >
      <div
        className="qadr-options qadr-options-multi"
        role="group"
        aria-label="多選回覆選項"
      >
        {options.map((o, i) => {
          const checked = picked.has(i);
          return (
            <button
              key={`${i}-${o}`}
              type="button"
              role="checkbox"
              aria-checked={checked}
              className={"btn qadr-option qadr-option-multi" + (checked ? " is-picked" : "")}
              onClick={() => toggle(i)}
              disabled={busy}
            >
              <span className="qadr-option-check" aria-hidden>
                {checked ? <CheckIconSm /> : null}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      <div id={statusId} role="status" aria-live="polite" className="qadr-multi-status">
        {picked.size === 0 ? "尚未選擇任何選項" : `已選 ${picked.size} 項`}
      </div>
      <button
        ref={sendBtnRef}
        className="btn btn-primary qadr-multi-send"
        onClick={send}
        disabled={busy || picked.size === 0}
        type="button"
      >
        送出已選（{picked.size}）
      </button>
    </div>
  );
}

// ── Composer: verbatim ──────────────────────────────────────────
function Composer({ options, optionsMode = "single", busy, onSend, onCancel, onTextChange, inputRef }) {
  const [text, setText] = useState("");
  const taRef = useRef(null);
  const setTaRef = (el) => {
    taRef.current = el;
    if (inputRef) inputRef.current = el;
  };
  const taId = "qadr-composer-textarea";

  function send(value) {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
    onTextChange?.("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  return (
    <div className="qadr-composer">
      {options.length > 0 && optionsMode === "single" && (
        <div className="qadr-options">
          {options.map((o) => (
            <button
              type="button"
              key={o}
              className="btn qadr-option"
              onClick={() => send(o)}
              disabled={busy}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="qadr-composer-row">
        <label
          htmlFor={taId}
          style={{
            position: "absolute",
            width: 1, height: 1, padding: 0, margin: -1,
            overflow: "hidden", clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap", border: 0,
          }}
        >
          描述要建立的需求單內容
        </label>
        <textarea
          ref={setTaRef}
          id={taId}
          className="qadr-input qadr-input-multiline"
          value={text}
          placeholder={busy ? "助理回覆後即可繼續補充…" : "描述要建立的需求單內容…"}
          rows={1}
          aria-label="描述要建立的需求單內容"
          aria-describedby={busy ? "qadr-thinking-status" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onTextChange?.(e.target.value);
            const ta = e.target;
            ta.style.height = "auto";
            const max = parseFloat(getComputedStyle(ta).lineHeight) * 8;
            ta.style.height = Math.min(ta.scrollHeight, max) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="qadr-send"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-disabled={busy || !text.trim() ? "true" : undefined}
          title={!text.trim() ? "輸入內容後可送出（Enter）" : "送出（Enter）"}
          aria-label="送出訊息"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="qadr-composer-footer">
        <button
          className="qadr-cancel-link"
          onClick={onCancel}
          disabled={busy}
          type="button"
          title="放棄當前草稿，本次對話不會保留"
        >
          捨棄草稿
        </button>
        <div className="qadr-composer-hint mono" aria-hidden="true">
          Enter 送出 · Shift+Enter 換行
        </div>
      </div>
    </div>
  );
}

// ── Field: verbatim ─────────────────────────────────────────────
function Field({ label, htmlId, children }) {
  return (
    <div className="qadr-field">
      <div className="qadr-field-label" id={htmlId ? `${htmlId}-label` : undefined}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── SpecChecklist: verbatim ─────────────────────────────────────
function SpecChecklist({ spec }) {
  const [expanded, setExpanded] = useState(null);
  const filled = (key) => {
    if (!spec) return false;
    const v = spec[key];
    if (v == null || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (key === "mode") return v === "step" || v === "iter";
    return true;
  };
  const doneCount = FIELD_LABELS.filter((f) => filled(f.key)).length;
  const expandedField = expanded ? FIELD_LABELS.find((f) => f.key === expanded) : null;
  const expandedValue = expanded && spec ? spec[expanded] : undefined;

  function toggle(key) {
    setExpanded((cur) => (cur === key ? null : key));
  }
  const baseId = useId();
  const panelId = `${baseId}-chip-panel`;
  return (
    <div className="qadr-checklist">
      <div
        className="qadr-checklist-row"
        role="group"
        aria-label={`規格進度 ${doneCount} / ${FIELD_LABELS.length}`}
      >
        {FIELD_LABELS.map((f) => {
          const isFilled = filled(f.key);
          const isOpen = expanded === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className={"qadr-chip" + (isFilled ? " is-filled" : "") + (isOpen ? " is-expanded" : "")}
              title={`${f.label}・${isFilled ? "已填" : "未填"}`}
              aria-label={`${f.label}（${isFilled ? "已填" : "未填"}）`}
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              onClick={() => toggle(f.key)}
            >
              <span className="qadr-chip-dot" aria-hidden />
              <span className="qadr-chip-label">{f.label}</span>
            </button>
          );
        })}
        <span className="qadr-checklist-count mono" aria-hidden>
          {doneCount}/{FIELD_LABELS.length}
        </span>
      </div>
      {expandedField && (
        <div
          className="qadr-chip-panel"
          id={panelId}
          role="region"
          aria-label={`${expandedField.label}內容`}
        >
          <div className="qadr-chip-panel-label mono">{expandedField.label}</div>
          <div className="qadr-chip-panel-value">
            {!filled(expandedField.key) ? (
              <span className="qadr-chip-panel-empty">（未填）</span>
            ) : Array.isArray(expandedValue) ? (
              <ul className="qadr-chip-panel-list">
                {expandedValue.map((v) => (
                  <li key={String(v)}>{v}</li>
                ))}
              </ul>
            ) : (
              <span>{String(expandedValue)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SpecReview: verbatim ────────────────────────────────────────
function SpecReview({ spec, splitInto, busy, onCancel, onFinalize, onResumeChat }) {
  const [edited, setEdited] = useState(spec);
  useEffect(() => { setEdited(spec); }, [spec]);
  const hasSplit = Array.isArray(splitInto) && splitInto.length >= 2;
  const [useSplit, setUseSplit] = useState(false);
  return (
    <div className="qadr-spec">
      <div className="qadr-spec-head">最終預覽 — 微調後送出建立需求單。</div>
      {hasSplit && (
        <section className="qadr-split-proposal" aria-labelledby="qadr-split-title">
          <header className="qadr-split-header">
            <h3 id="qadr-split-title" className="qadr-split-title">
              助理評估這張需求單範圍橫跨 {splitInto.length} 件獨立工作
            </h3>
            <p className="qadr-split-subtitle">
              若拆分送出，會建立 {splitInto.length} 張獨立需求單分別執行；
              若不拆分，以下方單張 spec 為準。
            </p>
          </header>
          <ol className="qadr-split-list">
            {splitInto.map((s, i) => (
              <li key={i} className="qadr-split-item">
                <span className="qadr-split-num mono">#{i + 1}</span>
                <span className="qadr-split-item-title">{s.title}</span>
                <span className={"chip ticket-mode qadr-split-mode-chip" + (s.mode === "iter" ? " is-iter" : "")}>
                  {s.mode === "iter" ? "迭代" : "單次"}
                </span>
              </li>
            ))}
          </ol>
          <div className="qadr-split-toggle">
            <label className="qadr-split-toggle-label">
              <input
                type="checkbox"
                checked={useSplit}
                onChange={(e) => setUseSplit(e.target.checked)}
                aria-describedby="qadr-split-outcome"
              />
              <span>
                <strong>送出時拆成 {splitInto.length} 張獨立需求單</strong>
                <span className="qadr-split-toggle-hint">
                  （取消勾選 = 合 1 張下方 spec）
                </span>
              </span>
            </label>
            <div id="qadr-split-outcome" className="qadr-split-outcome" role="status" aria-live="polite">
              {useSplit
                ? `目前送出會建立 ${splitInto.length} 張獨立需求單。`
                : "目前送出會建立 1 張合併需求單（以下方 spec 為準）。"}
            </div>
          </div>
        </section>
      )}
      <Field label="標題">
        <input
          className="qadr-input"
          value={edited.title}
          onChange={(e) => setEdited({ ...edited, title: e.target.value })}
        />
      </Field>
      <Field label="目標">
        <textarea
          className="qadr-input qadr-textarea"
          rows={3}
          value={edited.goal}
          onChange={(e) => setEdited({ ...edited, goal: e.target.value })}
        />
      </Field>
      <Field label="驗收">
        <textarea
          className="qadr-input qadr-textarea"
          rows={Math.max(4, edited.acceptance.length + 1)}
          value={edited.acceptance.join("\n")}
          onChange={(e) =>
            setEdited({ ...edited, acceptance: e.target.value.split("\n").filter(Boolean) })
          }
        />
      </Field>
      <Field label="提示詞">
        <textarea
          className="qadr-input qadr-textarea"
          rows={10}
          value={edited.prompt}
          onChange={(e) => setEdited({ ...edited, prompt: e.target.value })}
        />
      </Field>
      <Field label="模式" htmlId="qadr-mode-group">
        <div className="qadr-choice-row" role="radiogroup" aria-labelledby="qadr-mode-group-label">
          <label className="qadr-radio-label">
            <input type="radio" name="qadr-mode"
              checked={edited.mode === "iter"}
              onChange={() => setEdited({ ...edited, mode: "iter" })} />
            迭代任務 (iter)
          </label>
          <label className="qadr-radio-label">
            <input type="radio" name="qadr-mode"
              checked={edited.mode === "step"}
              onChange={() => setEdited({ ...edited, mode: "step" })} />
            單次任務 (step)
          </label>
        </div>
      </Field>
      {edited.mode === "iter" && (
        <>
          <Field label="迭代上限輪數">
            <input
              className="qadr-input qadr-iter-limit-input"
              type="number"
              min={1}
              max={5}
              value={edited.iterLimit ?? 5}
              onChange={(e) => {
                const v = Math.max(1, Math.min(5, Number(e.target.value) || 5));
                setEdited({ ...edited, iterLimit: v });
              }}
            />
          </Field>
          <Field label="達上限後" htmlId="qadr-stoplimit-group">
            <div className="qadr-choice-row" role="radiogroup" aria-labelledby="qadr-stoplimit-group-label">
              <label className="qadr-radio-label">
                <input type="radio" name="qadr-iter-stop"
                  checked={(edited.iterStopAtLimit ?? true) === true}
                  onChange={() => setEdited({ ...edited, iterStopAtLimit: true })} />
                整條 pipeline 暫停 (建議)
              </label>
              <label className="qadr-radio-label">
                <input type="radio" name="qadr-iter-stop"
                  checked={(edited.iterStopAtLimit ?? true) === false}
                  onChange={() => setEdited({ ...edited, iterStopAtLimit: false })} />
                標記為失敗，跳下一張
              </label>
            </div>
          </Field>
        </>
      )}
      <div className="qadr-spec-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          捨棄草稿
        </button>
        {onResumeChat && (
          <button
            type="button"
            className="btn"
            onClick={onResumeChat}
            disabled={busy}
            title="退回對話跟 AI 補充 / 修正細節,送出新訊息後 AI 會再整理 spec"
          >
            <ArrowRightIcon aria-hidden style={{ transform: "scaleX(-1)" }} /> 繼續討論
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onFinalize(edited, useSplit ? splitInto : undefined)}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="qadr-thinking-dots">
                <span /><span /><span />
              </span>{" "}
              送出中…
            </>
          ) : useSplit && hasSplit ? (
            `送出建立 ${splitInto.length} 張需求單`
          ) : hasSplit ? (
            "送出建立 1 張合併需求單"
          ) : (
            "送出建立需求單"
          )}
        </button>
      </div>
    </div>
  );
}

// ── QADrawer (main): verbatim ───────────────────────────────────
function QADrawer({ pipelineName, draft, busy, onSendTurn, onFinalize, onCancel, onClose }) {
  const transcriptRef = useRef(null);
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const composerTextRef = useRef("");
  const composerInputRef = useRef(null);
  const titleId = "qadr-title";

  const [viewOverride, setViewOverride] = useState(null);
  useEffect(() => { setViewOverride(null); }, [draft?.draftId]);

  const specComplete = isSpecComplete(draft?.spec ?? null);
  const showReview =
    specComplete &&
    (viewOverride === "review" || (draft?.complete === true && viewOverride !== "chat"));
  const hasAnyTurn = (draft?.turns.length ?? 0) > 0;

  useEffect(() => {
    if (!draft) return;
    if (showReview) return;
    const id = requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.draftId, showReview]);

  const showChecklist = !!draft && (hasAnyTurn || specComplete);

  const prevTurnsLenRef = useRef(-1);
  useEffect(() => { prevTurnsLenRef.current = -1; }, [draft?.draftId]);
  useEffect(() => {
    if (showReview) return;
    const turnsLen = draft?.turns.length ?? 0;
    const prev = prevTurnsLenRef.current;
    prevTurnsLenRef.current = turnsLen;
    const id = requestAnimationFrame(() => {
      const el = transcriptRef.current;
      if (!el) return;
      if (prev === -1) { el.scrollTo({ top: 0 }); return; }
      if (turnsLen > prev) el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.turns.length, draft?.draftId, showReview]);

  const [pendingClose, setPendingClose] = useState(false);
  const pendingCancelBtnRef = useRef(null);
  const requestClose = () => {
    if (composerTextRef.current.trim().length > 0) {
      setPendingClose(true);
      return;
    }
    onClose();
  };
  useEffect(() => {
    if (!pendingClose) return;
    const id = requestAnimationFrame(() => {
      pendingCancelBtnRef.current?.focus({ preventScroll: true });
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPendingClose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [pendingClose]);

  return (
    <Overlay
      role="dialog"
      onRequestClose={requestClose}
      labelledBy={titleId}
      stageClassName="qadr-stage"
      surfaceClassName="qadr-drawer"
    >
      <div className="drawer-head qadr-head">
        <div className="drawer-crumb qadr-crumb">
          <span className="qadr-crumb-text">
            <span className="mono qadr-crumb-project" title={pipelineName}>
              {pipelineName}
            </span>
            <span className="sep qadr-crumb-current-sep">/</span>
            <span className="qadr-crumb-current">新需求單</span>
          </span>
          <button type="button"
            ref={closeBtnRef}
            className="drawer-close create-x"
            onClick={requestClose}
            title={hasAnyTurn ? "關閉並保留草稿（下次可接續）" : "關閉並取消空白草稿"}
            aria-label={hasAnyTurn ? "關閉並保留草稿" : "關閉並取消空白草稿"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-titlerow">
          <div className="drawer-title" id={titleId}>
            {draft?.spec?.title
              || (draft
                ? hasAnyTurn
                  ? "收斂中…"
                  : "新需求單"
                : "新需求單")}
          </div>
        </div>
        <div className="drawer-meta mono">
          <span>{draft ? `${draft.turns.length} 輪對話` : "啟動中…"}</span>
          {draft && (
            <>
              <span className="sep">·</span>
              <span
                className="qadr-draft-status"
                title={`draftId: ${draft.draftId}`}
                aria-label={hasAnyTurn ? "草稿已自動保留,關閉後可接續" : "尚未對話,關閉會自動取消空白草稿"}
              >
                {hasAnyTurn ? "草稿已自動保留" : "空白草稿"}
              </span>
            </>
          )}
        </div>
        {showChecklist && <SpecChecklist spec={draft?.spec ?? null} />}
      </div>

      {pendingClose && (
        <section
          className="qadr-close-confirm"
          role="group"
          aria-labelledby="qadr-close-confirm-msg"
        >
          <p
            id="qadr-close-confirm-msg"
            className="qadr-close-confirm-msg"
            role="status"
            aria-live="polite"
          >
            輸入框還有未送出的內容，要關閉嗎？（草稿仍會保留，下次可接續）
          </p>
          <div className="qadr-close-confirm-actions">
            <button
              ref={pendingCancelBtnRef}
              type="button"
              className="btn"
              onClick={() => setPendingClose(false)}
            >
              繼續編輯
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPendingClose(false);
                onClose();
              }}
            >
              關閉並保留草稿
            </button>
          </div>
        </section>
      )}

      {showReview ? (
        <div className="drawer-body qadr-body qadr-spec-body">
          <SpecReview
            spec={draft.spec}
            splitInto={draft?.splitInto}
            busy={busy}
            onCancel={onCancel}
            onFinalize={onFinalize}
            onResumeChat={() => setViewOverride("chat")}
          />
        </div>
      ) : (
        <>
          {specComplete && !showReview && (
            <div className="qadr-spec-ready-bar">
              <span
                className="qadr-spec-ready-bar-text"
                role="status"
                aria-live="polite"
              >
                規格已備齊，可隨時送出建立需求單。
              </span>
              <button
                type="button"
                className="btn btn-primary qadr-spec-ready-bar-btn"
                onClick={() => setViewOverride("review")}
                disabled={busy}
              >
                查看最終預覽
                <ArrowRightIcon aria-hidden focusable="false" />
              </button>
            </div>
          )}
          <div
            className="drawer-body qadr-body"
            ref={transcriptRef}
            aria-busy={
              (!draft && busy) ||
              (draft &&
                (busy || draft.turns[draft.turns.length - 1]?.role === "user"))
                ? true
                : undefined
            }
          >
            {!draft && busy && (
              <div className="qadr-bootstrap" role="status" aria-live="polite">
                <ThinkingDots />
                <span className="qadr-bootstrap-label">{BOOTSTRAP_LABEL}</span>
                <span className="qadr-bootstrap-sub">
                  正在準備這次的需求對話，稍候即可開始描述。
                </span>
              </div>
            )}
            {draft && (() => {
              const lastTurn = draft.turns[draft.turns.length - 1];
              const waitingForAI = lastTurn?.role === "user";
              const showThinking = busy || waitingForAI;
              const emptyTurns = draft.turns.length === 0;
              const last = lastAiOptions(draft);
              const showInlineMulti =
                !emptyTurns &&
                !showThinking &&
                last.mode === "multi" &&
                last.options.length > 0;
              return (
                <>
                  <Bubble kind="ai" message={FIRST_AI_MESSAGE} />
                  {emptyTurns && (
                    <div className="qadr-empty-starter">
                      <div className="qadr-starter-label" id="qadr-starter-label">
                        快速起點（可直接點選，或在下方輸入自訂內容）
                      </div>
                      <div
                        className="qadr-suggestions"
                        role="group"
                        aria-labelledby="qadr-starter-label"
                      >
                        {FIRST_AI_OPTIONS.map((o) => (
                          <button
                            type="button"
                            key={o}
                            className="vp-chip vp-chip--action qadr-suggestion"
                            onClick={() => onSendTurn(o)}
                            disabled={busy}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {draft.turns.map((t) => (
                    <Bubble key={t.ts + ":" + t.role} kind={t.role} message={t.message} />
                  ))}
                  {showInlineMulti && (
                    <InlineMultiSelect
                      options={last.options}
                      busy={busy}
                      onSendMulti={(picks) => onSendTurn(picks.join("、"))}
                    />
                  )}
                  {showThinking && (
                    <div
                      className="qadr-loading"
                      role="status"
                      aria-live="polite"
                      id="qadr-thinking-status"
                    >
                      <span>助理思考中</span>
                      <ThinkingDots />
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          {draft && (
            <div className="drawer-foot qadr-foot">
              {draft.spec && (() => {
                const missing = FIELD_LABELS.filter((f) => {
                  const v = draft.spec?.[f.key];
                  if (v == null || v === "") return true;
                  if (Array.isArray(v) && v.length === 0) return true;
                  if (f.key === "mode") return v !== "step" && v !== "iter";
                  return false;
                });
                if (missing.length === 0) return null;
                const filled = FIELD_LABELS.length - missing.length;
                const labels = missing.map((m) => m.label);
                const srSentence = `規格已完成 ${filled} / ${FIELD_LABELS.length}，待補：${labels.join("、")}。`;
                return (
                  <div
                    className="qadr-progress mono"
                    role="status"
                    aria-live="polite"
                    aria-label={srSentence}
                  >
                    <span aria-hidden="true">
                      規格 {filled}/{FIELD_LABELS.length} · 待補
                    </span>
                    {missing.map((m, i) => (
                      <span key={m.key} className="qadr-progress-missing" aria-hidden="true">
                        {m.label}
                        {i < missing.length - 1 ? "" : ""}
                      </span>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const last = lastAiOptions(draft);
                const isFirstTurn = draft.turns.length === 0;
                const composerOptions =
                  isFirstTurn || last.mode === "multi" ? [] : last.options;
                const lastTurn = draft.turns[draft.turns.length - 1];
                const waitingForAI = lastTurn?.role === "user";
                const composerBusy = busy || waitingForAI;
                return (
                  <Composer
                    options={composerOptions}
                    optionsMode={last.mode}
                    busy={composerBusy}
                    onSend={(msg) => { onSendTurn(msg); }}
                    onCancel={onCancel}
                    onTextChange={(v) => { composerTextRef.current = v; }}
                    inputRef={composerInputRef}
                  />
                );
              })()}
            </div>
          )}
        </>
      )}
    </Overlay>
  );
}

// ──────────────────────────────────────────────────────────────
// Demo harness — bottom-left panel exposes every (unit, state)
// pair surfaced by QADrawer. Mock drafts cover all branches.
// ──────────────────────────────────────────────────────────────

// Mock turns by scenario
const NOW = Date.now();
const MOCK_DRAFTS = {
  // 1. 沒 draft / busy=true → bootstrap 中央 placeholder
  bootstrap: null,

  // 2. draft exists, empty turns → welcome bubble + starter chips
  welcome: {
    draftId: "draft-welcome-001",
    pipelineId: "pl-001",
    sessionId: "sess-001",
    sessionStarted: true,
    complete: false,
    createdAt: NOW - 1000,
    updatedAt: NOW,
    turns: [],
    spec: null,
  },

  // 3. dialog mid-flow,partial spec(2/5) → checklist + progress + single quick reply
  dialogSingle: {
    draftId: "draft-dlg-002",
    pipelineId: "pl-001",
    sessionId: "sess-002",
    sessionStarted: true,
    complete: false,
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "建立功能需求", ts: NOW - 50_000 },
      {
        role: "ai",
        message: "好的，請描述這個功能要解決的核心問題。例如「使用者忘記密碼後沒辦法自助重設」。",
        options: ["著重在 UX 流程", "著重在 API 規格", "兩者都要"],
        optionsMode: "single",
        ts: NOW - 40_000,
      },
    ],
    spec: {
      title: "密碼自助重設流程",
      goal: "讓使用者忘記密碼時不需聯絡客服即可重設。",
      acceptance: [],
      prompt: "",
      mode: "iter",
    },
  },

  // 4. dialog,last AI 提 multi options → InlineMultiSelect inline render
  dialogMulti: {
    draftId: "draft-multi-003",
    pipelineId: "pl-001",
    sessionId: "sess-003",
    sessionStarted: true,
    complete: false,
    createdAt: NOW - 90_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "盤點可建立的需求單", ts: NOW - 80_000 },
      {
        role: "ai",
        message: "我幫你從現況看到三個值得獨立建立的方向，請選擇要本次處理的（可多選）：",
        options: [
          "通知中心未讀清單分組",
          "Topbar 推播 sub 狀態",
          "Settings 推播裝置撤銷確認",
          "iOS Safari 安裝引導",
        ],
        optionsMode: "multi",
        ts: NOW - 70_000,
      },
    ],
    spec: null,
  },

  // 5. waitingForAI=true(last turn 是 user)→ 「助理思考中」
  thinking: {
    draftId: "draft-thinking-004",
    pipelineId: "pl-001",
    sessionId: "sess-004",
    sessionStarted: true,
    complete: false,
    createdAt: NOW - 120_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "建立功能需求", ts: NOW - 110_000 },
      {
        role: "ai",
        message: "想處理哪個面向？",
        options: ["註冊", "登入", "權限"],
        optionsMode: "single",
        ts: NOW - 100_000,
      },
      { role: "user", message: "登入流程相關，特別是 OAuth callback 失敗時的 fallback", ts: NOW - 5_000 },
    ],
    spec: { title: "OAuth 失敗 fallback", goal: "", acceptance: [], prompt: "", mode: "iter" },
  },

  // 6. spec complete=true(5/5)but draft.complete=false → spec-ready-bar 顯示
  ready: {
    draftId: "draft-ready-005",
    pipelineId: "pl-001",
    sessionId: "sess-005",
    sessionStarted: true,
    complete: false,
    createdAt: NOW - 200_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "建立功能需求", ts: NOW - 180_000 },
      {
        role: "ai",
        message: "整理好了，看一下：",
        options: [],
        optionsMode: "single",
        ts: NOW - 160_000,
      },
    ],
    spec: {
      title: "OAuth callback 失敗 fallback",
      goal: "Google / GitHub OAuth callback 失敗時提供 email / password fallback 入口，不讓使用者卡在 error 頁。",
      acceptance: [
        "OAuth provider callback 回 5xx / timeout 時，error 頁顯示「使用 email 登入」次要按鈕",
        "點擊次要按鈕進入 password sign-in,session 沿用同一 csrf token",
        "後端 audit log 記錄 fallback 來源 provider + error code",
      ],
      prompt: "為登入畫面加入 OAuth fallback：當 provider callback 失敗時，error 頁顯示 email/password 次要登入入口，並把 fallback 路徑記入 audit log。",
      mode: "iter",
      iterLimit: 5,
      iterStopAtLimit: true,
    },
  },

  // 7. spec complete + draft.complete=true → review 自動跳出(無 splitInto)
  reviewSimple: {
    draftId: "draft-rev-simple-006",
    pipelineId: "pl-001",
    sessionId: "sess-006",
    sessionStarted: true,
    complete: true,
    createdAt: NOW - 220_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "建立功能需求", ts: NOW - 200_000 },
      { role: "ai", message: "spec 收斂完成。", options: [], optionsMode: "single", ts: NOW - 180_000 },
    ],
    spec: {
      title: "OAuth callback 失敗 fallback",
      goal: "Google / GitHub OAuth callback 失敗時提供 email/password fallback 入口。",
      acceptance: [
        "OAuth provider callback 回 5xx/timeout 時 error 頁顯示「使用 email 登入」按鈕",
        "點擊次要按鈕進入 password sign-in,session 沿用同一 csrf token",
      ],
      prompt: "為登入畫面加入 OAuth fallback：當 provider callback 失敗時，error 頁顯示 email/password 次要登入入口，並把 fallback 路徑記入 audit log。",
      mode: "iter",
      iterLimit: 5,
      iterStopAtLimit: true,
    },
  },

  // 8. review + splitInto(≥2)→ split-proposal 顯示
  reviewSplit: {
    draftId: "draft-rev-split-007",
    pipelineId: "pl-001",
    sessionId: "sess-007",
    sessionStarted: true,
    complete: true,
    createdAt: NOW - 240_000,
    updatedAt: NOW,
    turns: [
      { role: "user", message: "盤點可建立的需求單", ts: NOW - 220_000 },
      { role: "ai", message: "我看到三件相對獨立的工作。", options: [], optionsMode: "single", ts: NOW - 200_000 },
    ],
    spec: {
      title: "通知中心整體優化（單張版本）",
      goal: "改善 notif inbox 的未讀分組、推播 sub 狀態回報、Settings 撤銷流程。",
      acceptance: [
        "未讀分組支援按 pipeline 分群",
        "Topbar 推播 sub 狀態 chip 與 settings 同步",
        "撤銷裝置需二次確認",
      ],
      prompt: "整體優化通知中心：未讀分組、Topbar 推播狀態、Settings 裝置撤銷確認。",
      mode: "iter",
      iterLimit: 5,
      iterStopAtLimit: true,
    },
    splitInto: [
      {
        title: "通知中心未讀清單按 pipeline 分群",
        goal: "InboxColumn 的 unread tab 顯示時依 pipelineId 分群，每群顯示 pipeline 名與未讀數。",
        acceptance: ["分群 header 顯示 pipeline 名與未讀數", "點 header 可折疊整群"],
        prompt: "InboxColumn 的 unread tab 改成按 pipelineId 分群展示。",
        mode: "iter",
      },
      {
        title: "Topbar 推播 sub 狀態與 Settings 同步",
        goal: "Topbar 的推播狀態 chip 與 Settings 內 push toggle 即時同步、不需 refresh。",
        acceptance: ["Settings 改 push toggle 後 topbar chip 1 秒內更新"],
        prompt: "用 SettingsContext 訂閱 push 狀態，讓 topbar chip 即時跟 settings 同步。",
        mode: "step",
      },
      {
        title: "Settings 撤銷裝置二次確認",
        goal: "撤銷推播裝置需顯示 ConfirmDialog 二次確認，避免誤觸。",
        acceptance: ["撤銷按鈕點擊後彈出 confirm modal", "confirm modal 標題顯示裝置 platform + 末 4 碼 token"],
        prompt: "撤銷裝置加 ConfirmDialog 二次確認流程。",
        mode: "step",
      },
    ],
  },
};


// ── App + createRoot stripped; supplied by qadrawer-redesign.jsx ──
