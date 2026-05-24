/* ============================================================================
   BoardRail — verbatim JSX bundle for claude.ai/design reverse handoff.

   DOM / className / text content mirror the source verbatim:
     src/features/pipeline/BoardRail.tsx
     src/shell/Rail.tsx                 (Rail / RailItem / RailSectionMenu)
     src/features/pipelineCreate/CreateCard.tsx
     src/ui/ConfirmDialog.tsx
     src/ui/Popover.tsx / Overlay.tsx   (overlay primitives)
     src/ui/PickerSelect.tsx            (base picker DOM unwound into .picker)
     src/ui/forms/TextField.tsx         (.form-field / .form-label / .form-input)
     src/ui/icons.tsx                   (inline SVG verbatim)
     shared/types.ts                    (Pipeline / Ticket state unions)

   This file is the SSOT — Prototype - BoardRail.html inlines the same JSX
   inside <script type="text/babel">.
   ============================================================================ */

const { useState, useMemo, useEffect, useRef, useCallback } = React;

/* ─── Icons (verbatim from src/ui/icons.tsx) ──────────────────────────── */

const PlusIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const CloseIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const DotsHorizontalIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
const TrashIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const BranchIcon = (p) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);
const CheckIconSm = (p) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4 12.5 9.5 18 20 6" />
  </svg>
);
const WarnIcon = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17.5" r="0.8" fill="currentColor" />
  </svg>
);

/* ─── data tables (src/data/pipelines.ts STATE_COLOR) ─────────────────── */

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

/* ─── helpers from src/shell/Rail.tsx (verbatim) ──────────────────────── */

const PIPELINE_STATE_TEXT = {
  planning: "規劃中",
  running: "執行中",
  paused: "暫停",
  ready: "可合併",
  merged: "已合併",
  failed: "失敗",
};

function lastActivityAt(p) {
  let max = 0;
  for (const t of p.tickets) {
    if (typeof t.endedAt === "number") max = Math.max(max, t.endedAt);
    if (typeof t.startedAt === "number") max = Math.max(max, t.startedAt);
    if (t.iter && t.iter.rounds) {
      for (const r of t.iter.rounds) {
        if (typeof r.endedAt === "number") max = Math.max(max, r.endedAt);
        if (typeof r.startedAt === "number") max = Math.max(max, r.startedAt);
      }
    }
    if (t.commits) {
      for (const c of t.commits) {
        if (c && typeof c.ts === "number") max = Math.max(max, c.ts);
      }
    }
  }
  return max > 0 ? max : null;
}

function fmtAgo(ms) {
  if (!ms) return null;
  const since = Math.floor((Date.now() - ms) / 1000);
  if (since < 60) return "剛剛";
  if (since < 3600) return `${Math.floor(since / 60)}分鐘前`;
  if (since < 86400) return `${Math.floor(since / 3600)}小時前`;
  return `${Math.floor(since / 86400)}天前`;
}

function railSecondary(p) {
  const base = p.baseBranch || "main";
  const branchSuffix = (p.branch || "").replace(/^pipeline\//, "");
  const ago = fmtAgo(lastActivityAt(p));
  const agoSuffix = ago ? ` · ${ago}` : "";

  if (p.state === "running") {
    const t = p.tickets.find((x) => x.status === "running");
    if (t) {
      const title = t.title.length > 18 ? t.title.slice(0, 17) + "…" : t.title;
      return `▶ #${t.n} ${title}${agoSuffix}`;
    }
    return `執行中${agoSuffix}`;
  }
  if (p.state === "merged") return `已併入 ${base}${agoSuffix}`;
  if (p.state === "ready") return `可合併入 ${base}${agoSuffix}`;
  if (p.state === "failed") return `失敗${agoSuffix}`;
  if (p.state === "paused") {
    const last = [...p.tickets].reverse().find(
      (x) => x.status === "paused" || x.status === "running"
    );
    if (last) return `⏸ #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  const planningAgo = ago ? `更新於 ${ago}` : (p.createdAt ? `建立於 ${fmtAgo(p.createdAt) || "剛剛"}` : "");
  if (branchSuffix !== p.name) {
    return planningAgo ? `⎇ ${branchSuffix} · ${planningAgo}` : `⎇ ${branchSuffix}`;
  }
  return planningAgo ? `尚未執行 · ${planningAgo}` : "尚未執行";
}

function railSecondaryAccessible(p) {
  const base = p.baseBranch || "main";
  const branchSuffix = (p.branch || "").replace(/^pipeline\//, "");
  const ago = fmtAgo(lastActivityAt(p));
  const agoSuffix = ago ? ` · ${ago}` : "";

  if (p.state === "running") {
    const t = p.tickets.find((x) => x.status === "running");
    if (t) {
      const title = t.title.length > 18 ? t.title.slice(0, 17) + "…" : t.title;
      return `執行中 ticket #${t.n} ${title}${agoSuffix}`;
    }
    return `執行中${agoSuffix}`;
  }
  if (p.state === "merged") return `已併入 ${base}${agoSuffix}`;
  if (p.state === "ready") return `可合併入 ${base}${agoSuffix}`;
  if (p.state === "failed") return `失敗${agoSuffix}`;
  if (p.state === "paused") {
    const last = [...p.tickets].reverse().find(
      (x) => x.status === "paused" || x.status === "running"
    );
    if (last) return `暫停於 ticket #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  const planningAgo = ago ? `更新於 ${ago}` : "";
  if (branchSuffix !== p.name) {
    return planningAgo ? `branch ${branchSuffix} · ${planningAgo}` : `branch ${branchSuffix}`;
  }
  return planningAgo ? `尚未執行 · ${planningAgo}` : "尚未執行";
}

function railMiniLabel(p) {
  const total = p.tickets.length;
  if (total === 0) return "尚無 ticket";
  const counts = {};
  for (const t of p.tickets) {
    const k =
      t.status === "failed" ||
      t.status === "failed_iter_limit" ||
      t.status === "failed_transient"
        ? "failed"
        : t.status;
    counts[k] = (counts[k] || 0) + 1;
  }
  const label = { done: "已完成", running: "執行中", paused: "暫停", ready: "準備", failed: "失敗" };
  const parts = [];
  for (const k of ["done", "running", "paused", "ready", "failed"]) {
    if (counts[k]) parts.push(`${counts[k]} ${label[k]}`);
  }
  const known = parts.length ? parts.join("、") : "";
  const planned = total - (counts.done || 0) - (counts.running || 0) - (counts.paused || 0) - (counts.ready || 0) - (counts.failed || 0);
  const tail = planned > 0 ? (known ? `、${planned} 待執行` : `${planned} 待執行`) : "";
  return `共 ${total} ticket${known || tail ? "(" + known + tail + ")" : ""}`;
}

/* ─── RailItem (verbatim DOM) ─────────────────────────────────────────── */

function RailItem({ p, active, onClick, muted, hasDraft }) {
  const done = p.tickets.filter((t) => t.status === "done").length;
  const total = p.tickets.length;
  const stateText = PIPELINE_STATE_TEXT[p.state] || p.state;
  const secondary = railSecondary(p);
  const fullSecondary = railSecondaryAccessible(p);
  const miniLabel = railMiniLabel(p);
  const ariaLabel =
    `${p.name} · ${stateText} · ${done} / ${total} ticket 完成` +
    (hasDraft ? " · QA 進行中" : "") +
    (fullSecondary ? ` · ${fullSecondary}` : "") +
    (miniLabel ? ` · ${miniLabel}` : "");
  return (
    <button
      type="button"
      className={"rail-item" + (active ? " is-active" : "") + (muted ? " is-muted" : "")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      aria-disabled={muted ? true : undefined}
      tabIndex={muted ? -1 : undefined}
    >
      <div className="rail-item-row">
        <span className="rail-state-dot" aria-hidden="true" style={{ background: STATE_COLOR[p.state] }} />
        <span className="rail-item-name" title={p.name}>{p.name}</span>
        {hasDraft && (
          <span className="mono rail-qa-badge" aria-hidden="true" title="進行中 QA">QA</span>
        )}
        <span
          className="rail-item-count mono"
          aria-hidden="true"
          title={`${done} / ${total} ticket 已完成`}
        >
          {done}/{total}
        </span>
      </div>
      <div className="rail-mini" aria-hidden="true">
        {p.tickets.map((t) => {
          const fill =
            t.status === "done" ? "var(--done)"
            : t.status === "running" ? "var(--running)"
            : t.status === "paused" ? "var(--paused)"
            : t.status === "failed" || t.status === "failed_iter_limit" || t.status === "failed_transient" ? "var(--failed)"
            : t.status === "ready" ? "var(--running-soft)"
            : "var(--line-2)";
          return <span key={t.id} className={"rail-mini-cell" + (t.status === "running" ? " is-running" : "")} style={{ background: fill }} />;
        })}
      </div>
      <div className="rail-item-meta" aria-hidden="true" title={fullSecondary || secondary}>
        <span className="mono">{secondary}</span>
      </div>
    </button>
  );
}

/* ─── RailSectionMenu (PopoverPlacement bottom-end; simplified anchoring
       — Popover.tsx full math reproduced is overkill for prototype, we use
       absolute-positioned menu inside .rail-section-overflow container,
       which the source CSS already supports via `position: relative`.) */

function RailSectionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      const t = e.target;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={"rail-section-overflow" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="rail-section-overflow-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DotsHorizontalIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Rail section 操作"
          className="focus-overflow-menu rail-section-overflow-menu"
          style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, left: "auto" }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={"focus-overflow-item" + (it.danger ? " is-danger" : "")}
              disabled={!!it.disabledReason}
              title={it.disabledReason || undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (it.disabledReason) return;
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="focus-overflow-item-icon">{it.icon || <TrashIcon />}</span>
              <span className="focus-overflow-item-label">{it.label}</span>
              {it.disabledReason && (
                <span className="mono focus-overflow-item-hint">{it.disabledReason}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── PickerSelect-equivalent (CreateCard's base-branch picker).
       Source uses ui/PickerSelect.tsx → Popover portal. Inlined here as
       the standard `.picker` container with absolute-positioned `.picker-menu`,
       which the source CSS supports (see createPipeline.css `.picker-menu`
       `position: absolute; top: calc(100% + 4px);`). ARIA + class names
       preserved 1:1 with the atom. */

function PickerSelectInline({ open, setOpen, value, onChange, options, icon, ariaLabel }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      const t = e.target;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpen]);

  return (
    <div className={"picker vp-field"}>
      <button
        ref={triggerRef}
        type="button"
        className={"picker-trigger vp-control" + (open ? " is-open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {icon}
        <span className={current && current.mono ? "mono" : ""}>{current ? current.label : ""}</span>
        <span style={{ flex: 1 }} />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="picker-menu fade-up"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
        >
          {options.map((o, i) => {
            const selected = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={"picker-item" + (selected ? " is-active" : "")}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                {icon && <span className="picker-item-icon">{icon}</span>}
                <span className={o.mono ? "mono" : ""}>{o.label}</span>
                {selected && (
                  <span className="picker-item-check"><CheckIconSm /></span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── TextField (verbatim DOM from src/ui/forms/TextField.tsx) ────────── */

function TextField({
  label, value, onChange, placeholder, spellCheck, autoComplete, maxLength,
  fieldClassName, inputClassName, error, ariaDescribedBy, id, inputRef,
}) {
  const describedId = error ? `${id}-desc` : undefined;
  const combinedDescribed =
    [describedId, ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={"form-field" + (fieldClassName ? ` ${fieldClassName}` : "")}>
      <label htmlFor={id} className="form-label">
        <span>{label}</span>
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={"form-input" + (inputClassName ? ` ${inputClassName}` : "")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={spellCheck}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={combinedDescribed}
      />
      {error && (
        <div id={describedId} className="form-hint form-hint--error">{error}</div>
      )}
    </div>
  );
}

/* ─── CreateCard (verbatim from src/features/pipelineCreate/CreateCard.tsx) ─── */

const FALLBACK_BRANCHES = ["main"];
const NAME_MAX_LENGTH = 60;

function CreateCard({ onCancel, onSubmit, existingNames = [], branches, defaultAutoMerge = false }) {
  const baseList = useMemo(
    () => (branches && branches.length > 0 ? branches : FALLBACK_BRANCHES),
    [branches]
  );
  const defaultBase = baseList.includes("main")
    ? "main"
    : baseList.includes("master")
    ? "master"
    : baseList[0];
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBase);
  const [baseOpen, setBaseOpen] = useState(false);
  const [autoMerge, setAutoMerge] = useState(defaultAutoMerge);
  const inputRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!baseList.includes(baseBranch)) setBaseBranch(defaultBase);
  }, [baseList, defaultBase, baseBranch]);

  const uid = "demo";
  const inputId = "create-pipeline-name-" + uid;
  const counterId = "create-pipeline-name-counter-" + uid;
  const formatHintId = "create-pipeline-name-format-" + uid;
  const autoMergeDescId = "create-pipeline-automerge-desc-" + uid;
  const baseLabelId = "create-pipeline-base-label-" + uid;

  const trimmed = name.trim();
  const taken = existingNames.includes(trimmed);
  const formatOk = /^[a-z0-9][a-z0-9-_]*$/.test(trimmed);
  const valid = trimmed.length > 0 && !taken && formatOk;
  const showFormatHint = trimmed.length > 0 && !formatOk;
  const hasError = taken || showFormatHint;
  const counterNearLimit = name.length >= NAME_MAX_LENGTH - 10;
  const counterAtLimit = name.length >= NAME_MAX_LENGTH;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  function submit(e) {
    if (e) e.preventDefault();
    if (!valid) return;
    onSubmit({ name: trimmed, baseBranch, autoMerge });
  }

  return (
    <form className="create-card fade-up" onSubmit={submit} ref={cardRef}>
      <div className="create-card-head">
        <span className="rail-state-dot" style={{ background: "var(--draft)" }} />
        <span className="create-card-eyebrow mono" style={{ textTransform: "none" }}>新 pipeline</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="create-x" onClick={onCancel} title="取消 (Esc)" aria-label="取消">
          <CloseIcon />
        </button>
      </div>

      <div className="create-field create-field-name">
        <TextField
          inputRef={inputRef}
          id={inputId}
          label="名稱"
          value={name}
          onChange={setName}
          placeholder="my-feature"
          spellCheck={false}
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          fieldClassName={"create-field-form" + (hasError ? " is-error" : "")}
          inputClassName="mono create-field-form-input"
          ariaDescribedBy={[
            !hasError ? formatHintId : null,
            counterNearLimit ? counterId : null,
          ].filter(Boolean).join(" ") || undefined}
          error={
            hasError
              ? taken
                ? "名稱已存在，請換一個。"
                : showFormatHint
                ? "只能使用小寫英文、數字、-、_，且需以小寫英文或數字開頭。"
                : undefined
              : undefined
          }
        />
        <div className="create-field-meta">
          <div
            id={formatHintId}
            className="create-field-format-hint"
            hidden={hasError}
          >
            a-z、0-9、-、_，首字為小寫英文或數字，最多 {NAME_MAX_LENGTH} 字
          </div>
          <div
            id={counterId}
            className={
              "create-counter mono" +
              (counterAtLimit ? " is-limit" : counterNearLimit ? " is-near" : "")
            }
            aria-live="polite"
            aria-label={`名稱長度 ${name.length}／${NAME_MAX_LENGTH}`}
            hidden={!counterNearLimit}
          >
            {name.length}/{NAME_MAX_LENGTH}
          </div>
        </div>
      </div>

      <div className="create-field">
        <div id={baseLabelId} className="create-field-label">基底分支</div>
        <PickerSelectInline
          open={baseOpen}
          setOpen={setBaseOpen}
          value={baseBranch}
          onChange={setBaseBranch}
          icon={<span className="mono" style={{ color: "var(--fg-mute)", display: "inline-flex" }}><BranchIcon /></span>}
          options={baseList.map((b) => ({ id: b, label: b, mono: true }))}
          ariaLabel="基底分支"
        />
      </div>

      <div className="create-field create-field-automerge">
        <label className={"toggle-pill mono" + (autoMerge ? " is-on" : "")}>
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => setAutoMerge(e.target.checked)}
            aria-describedby={autoMergeDescId}
          />
          <span className="toggle-pill-track" aria-hidden>
            <span className="toggle-pill-thumb" />
          </span>
          自動合併
        </label>
        <div id={autoMergeDescId} className="create-field-desc">
          所有 ticket 完成後，自動建立合併 ticket。
        </div>
      </div>

      <div className="create-actions">
        <button
          type="button"
          className="btn create-cancel"
          onClick={onCancel}
          aria-keyshortcuts="Escape"
        >
          <span>Esc</span>
          <span style={{ color: "var(--fg-faint)" }}>取消</span>
        </button>
        <button
          type="submit"
          className="btn btn-primary create-submit"
          disabled={!valid}
          aria-label="建立 pipeline"
        >
          <span>建立</span>
          {valid && <span className="kbd-inline mono">↵</span>}
        </button>
      </div>
    </form>
  );
}

/* ─── ConfirmDialog (verbatim from src/ui/ConfirmDialog.tsx) ─────────── */

function ConfirmDialog({ open, options, onClose }) {
  if (!open || !options) return null;
  const { title, description, descriptionRich, confirmLabel, cancelLabel, danger, warning } = options;
  return (
    <div
      className="drawer-stage drawer-stage--modal confirm-stage"
      role={danger ? "alertdialog" : "dialog"}
      aria-modal="true"
    >
      <div
        className="drawer-scrim confirm-scrim"
        onClick={() => { if (!danger) onClose("cancel"); }}
        aria-hidden="true"
      />
      <div
        className="drawer drawer--modal confirm-card fade-up"
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="confirm-title">{title}</div>
        {warning && (
          <div className="confirm-warning">
            <span className="confirm-warning-icon" aria-hidden><WarnIcon /></span>
            <span className="confirm-warning-text">{warning}</span>
          </div>
        )}
        {(descriptionRich || description) && (
          <div className={"confirm-desc" + (descriptionRich ? " confirm-desc--rich" : "")}>
            {descriptionRich || description}
          </div>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className={"btn confirm-cancel" + (danger ? " confirm-cancel--autofocused" : "")}
            onClick={() => onClose("cancel")}
            autoFocus={!!danger}
          >
            {cancelLabel || "取消"}
          </button>
          <button
            type="button"
            className={"btn " + (danger ? "btn-danger" : "btn-primary")}
            onClick={() => onClose("confirm")}
            autoFocus={!danger}
            aria-keyshortcuts={!danger ? "Enter" : undefined}
          >
            {confirmLabel || "確認"}
            {!danger && (
              <>
                <span className="kbd-inline mono" aria-hidden="true">↵</span>
                <span className="sr-only">(按 Enter 鍵確認)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Rail (verbatim from src/shell/Rail.tsx) ────────────────────────── */

function Rail({
  pipelines, activeId, onSelect,
  creating = false, onStartCreate, createSlot,
  addLabel = "新增 pipeline",
  draftPipelineIds, sectionMenuItems,
}) {
  const isEmpty = !creating && pipelines.length === 0;
  return (
    <aside className={"rail" + (creating ? " is-creating" : "")} aria-label="Pipeline 列表">
      <div className="rail-section-header">
        <span className="rail-section-label mono" id="rail-pipelines-label">PIPELINES</span>
        {sectionMenuItems && sectionMenuItems.length > 0 && (
          <RailSectionMenu items={sectionMenuItems} />
        )}
      </div>
      <div className="rail-list">
        {creating ? (
          createSlot
        ) : (
          <button type="button" className="rail-add" onClick={onStartCreate}>
            <PlusIcon /> <span>{addLabel}</span>
          </button>
        )}

        {isEmpty && (
          <p className="rail-empty-hint" role="note">
            還沒有 pipeline。點上方<span className="mono">「+ {addLabel}」</span>建立第一條。
          </p>
        )}

        <div
          role="group"
          aria-labelledby="rail-pipelines-label"
          className="rail-list-items"
          style={{ display: "contents" }}
        >
          {pipelines.map((p) => (
            <RailItem
              key={p.id}
              p={p}
              active={p.id === activeId}
              onClick={() => onSelect(p.id)}
              muted={creating}
              hasDraft={(draftPipelineIds && draftPipelineIds.has(p.id)) || false}
            />
          ))}
        </div>
      </div>
      <div className="rail-spacer" />
    </aside>
  );
}

/* ─── BoardRail (verbatim from src/features/pipeline/BoardRail.tsx) ──── */

function BoardRail({
  project, pipelines, activeId, onSelect,
  creating, setCreating, isUninit, onStartInit,
  draftPipelineIds, branches, defaultAutoMerge, onCreate,
  // demo-only inject: confirmDialog mock
  openConfirm,
  notifyInfo, notifyError,
}) {
  const existingNames = useMemo(() => pipelines.map((p) => p.name), [pipelines]);

  async function handleCleanupAllMergedWorktrees() {
    if (!project) return;
    const mergedPipelines = pipelines.filter((p) => p.state === "merged");
    const n = mergedPipelines.length;
    if (n === 0) {
      notifyInfo("目前沒有已合併的 pipeline,無需清除");
      return;
    }
    const okay = await openConfirm({
      title: `清除所有已合併的 worktree?`,
      description:
        `將清除目前 project 內所有 state=merged 的 pipeline worktree(共 ${n} 個):\n` +
        mergedPipelines.map((p) => `  · ${p.name}`).join("\n") +
        "\n\n只清磁碟,pipeline 紀錄 / branch 不動。",
      confirmLabel: `清除 ${n} 個`,
    });
    if (!okay) return;
    // demo: mock API success
    notifyInfo(`✓ 清除 ${n} 個 worktree(mock)`);
  }

  const mergedCount = pipelines.filter((p) => p.state === "merged").length;
  const sectionMenuItems = [
    {
      key: "cleanup-all-merged-worktrees",
      label: "清理已合併 worktree",
      icon: <TrashIcon />,
      danger: true,
      disabledReason: mergedCount === 0 ? "目前無已合併" : undefined,
      onClick: () => { handleCleanupAllMergedWorktrees(); },
    },
  ];

  return (
    <Rail
      pipelines={pipelines}
      activeId={activeId}
      onSelect={onSelect}
      creating={creating}
      onStartCreate={isUninit ? onStartInit : () => setCreating(true)}
      addLabel={isUninit ? "開始初始化" : "新 pipeline"}
      draftPipelineIds={draftPipelineIds}
      sectionMenuItems={sectionMenuItems}
      createSlot={
        <CreateCard
          onCancel={() => setCreating(false)}
          onSubmit={onCreate}
          existingNames={existingNames}
          branches={branches}
          defaultAutoMerge={defaultAutoMerge}
        />
      }
    />
  );
}

/* ─── Fixture pipelines covering ALL state branches ─────────────────── */

const NOW = Date.now();
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

function mkTicket(n, status, title, extra = {}) {
  return {
    id: `t-${n}-${status}`,
    n,
    title,
    mode: "iter",
    status,
    ...extra,
  };
}

const FIXTURE_PIPELINES = {
  // 1) Full mixed dataset — every pipeline.state + every ticket.status appears
  mixed: [
    {
      id: "p-planning",
      name: "draft-feature",
      branch: "pipeline/draft-feature",
      baseBranch: "main",
      state: "planning",
      createdAt: NOW - 5 * MIN,
      tickets: [
        mkTicket(1, "draft", "規劃登入流程"),
        mkTicket(2, "ready", "建 OAuth callback"),
        mkTicket(3, "draft", "寫 e2e 測試"),
      ],
    },
    {
      id: "p-running",
      name: "checkout-redesign",
      branch: "pipeline/checkout-redesign",
      baseBranch: "main",
      state: "running",
      createdAt: NOW - 4 * HOUR,
      tickets: [
        mkTicket(1, "done", "拉 spec",        { startedAt: NOW - 4 * HOUR, endedAt: NOW - 3 * HOUR }),
        mkTicket(2, "done", "切版",            { startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR }),
        mkTicket(3, "running", "綁付款 webhook", { startedAt: NOW - 8 * MIN }),
        mkTicket(4, "ready", "整合 e2e"),
      ],
    },
    {
      id: "p-paused",
      name: "stripe-migration",
      branch: "pipeline/stripe-migration",
      baseBranch: "main",
      state: "paused",
      createdAt: NOW - 2 * 24 * HOUR,
      tickets: [
        mkTicket(1, "done", "API 抽象層", { endedAt: NOW - 6 * HOUR }),
        mkTicket(2, "paused", "改 charge flow", { startedAt: NOW - 90 * MIN }),
        mkTicket(3, "ready", "改 refund flow"),
      ],
    },
    {
      id: "p-ready",
      name: "perf-pass",
      branch: "pipeline/perf-pass",
      baseBranch: "main",
      state: "ready",
      createdAt: NOW - 18 * HOUR,
      tickets: [
        mkTicket(1, "done", "profile 主 list 渲染", { endedAt: NOW - 12 * HOUR }),
        mkTicket(2, "done", "lazy load images",   { endedAt: NOW - 6 * HOUR }),
        mkTicket(3, "done", "trim bundle",         { endedAt: NOW - 30 * MIN }),
      ],
    },
    {
      id: "p-failed",
      name: "broken-build",
      branch: "pipeline/broken-build",
      baseBranch: "main",
      state: "failed",
      createdAt: NOW - 25 * HOUR,
      tickets: [
        mkTicket(1, "done", "改 webpack",       { endedAt: NOW - 24 * HOUR }),
        mkTicket(2, "failed", "升 ts 5",         { endedAt: NOW - 20 * HOUR }),
        mkTicket(3, "failed_iter_limit", "修 typecheck", { endedAt: NOW - 18 * HOUR }),
        mkTicket(4, "failed_transient", "重跑 ci", { endedAt: NOW - 17 * HOUR }),
      ],
    },
    {
      id: "p-merged",
      name: "intl-zh-tw",
      branch: "pipeline/intl-zh-tw",
      baseBranch: "main",
      state: "merged",
      createdAt: NOW - 3 * 24 * HOUR,
      mergedAt: NOW - 6 * HOUR,
      tickets: [
        mkTicket(1, "done", "抽 zh-TW 字典", { endedAt: NOW - 2 * 24 * HOUR }),
        mkTicket(2, "done", "替 prompt 加 hint", { endedAt: NOW - 18 * HOUR }),
      ],
    },
    {
      id: "p-merged-2",
      name: "dark-mode-tokens",
      branch: "pipeline/dark-mode-tokens",
      baseBranch: "main",
      state: "merged",
      createdAt: NOW - 5 * 24 * HOUR,
      mergedAt: NOW - 25 * HOUR,
      tickets: [
        mkTicket(1, "done", "重抽 token", { endedAt: NOW - 4 * 24 * HOUR }),
      ],
    },
  ],
  // 2) empty — exercises rail-empty-hint
  empty: [],
  // 3) single — minimal happy path
  single: [
    {
      id: "p-only",
      name: "tidy-readme",
      branch: "pipeline/tidy-readme",
      baseBranch: "main",
      state: "planning",
      createdAt: NOW - 2 * MIN,
      tickets: [
        mkTicket(1, "ready", "改 README 目錄"),
      ],
    },
  ],
  // 4) all-merged — every row is merged → cleanup menu enabled, "清除 N 個"
  "all-merged": Array.from({ length: 4 }).map((_, i) => ({
    id: `p-am-${i}`,
    name: `merged-feature-${i + 1}`,
    branch: `pipeline/merged-feature-${i + 1}`,
    baseBranch: "main",
    state: "merged",
    createdAt: NOW - (10 + i) * HOUR,
    mergedAt: NOW - (3 + i) * HOUR,
    tickets: [mkTicket(1, "done", `合併 #${i + 1}`, { endedAt: NOW - (3 + i) * HOUR })],
  })),
  // 5) failed-only — exercises failed dot + reason text without merged
  "failed-only": [
    {
      id: "p-fo",
      name: "ci-pipeline",
      branch: "pipeline/ci-pipeline",
      baseBranch: "main",
      state: "failed",
      createdAt: NOW - 30 * HOUR,
      tickets: [
        mkTicket(1, "done", "升 bun"),
        mkTicket(2, "failed", "跑單元測試"),
      ],
    },
  ],
};

/* ─── Demo App ────────────────────────────────────────────────────────── */

function DemoApp() {
  // theme
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // data set
  const [dataKey, setDataKey] = useState("mixed");
  const pipelines = FIXTURE_PIPELINES[dataKey];

  // BoardRail props (state branches)
  const [activeId, setActiveId] = useState((pipelines[0] && pipelines[0].id) || "");
  useEffect(() => { setActiveId((FIXTURE_PIPELINES[dataKey][0] && FIXTURE_PIPELINES[dataKey][0].id) || ""); }, [dataKey]);

  const [creating, setCreating] = useState(false);
  const [isUninit, setIsUninit] = useState(false);
  const [hasDraftFirst, setHasDraftFirst] = useState(true);
  const draftPipelineIds = useMemo(() => {
    const s = new Set();
    if (hasDraftFirst && pipelines[0]) s.add(pipelines[0].id);
    return s;
  }, [pipelines, hasDraftFirst]);

  const [defaultAutoMerge, setDefaultAutoMerge] = useState(false);

  // toasts (notify*)
  const [toasts, setToasts] = useState([]);
  function pushToast(kind, msg) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }

  // ConfirmDialog state — promise-based like source
  const [confirmState, setConfirmState] = useState(null);
  function openConfirm(opts) {
    return new Promise((resolve) => {
      setConfirmState({ opts, resolve });
    });
  }
  function closeConfirm(result) {
    if (!confirmState) return;
    confirmState.resolve(result === "confirm");
    setConfirmState(null);
  }

  function onCreate({ name }) {
    pushToast("info", `(mock) 建立 pipeline:${name}`);
    setCreating(false);
  }

  const project = { hash: "demo0001", name: "demo-project", path: "/demo", hasInit: true, hasGit: true, lastOpenedAt: NOW };

  return (
    <>
      <div className="preview-shell">
        <div className="preview-rail-host">
          <BoardRail
            project={project}
            pipelines={pipelines}
            activeId={activeId}
            onSelect={setActiveId}
            creating={creating}
            setCreating={setCreating}
            isUninit={isUninit}
            onStartInit={() => pushToast("info", "(mock) 開始初始化專案")}
            draftPipelineIds={draftPipelineIds}
            branches={["main", "master", "develop", "release/2026.05"]}
            defaultAutoMerge={defaultAutoMerge}
            onCreate={onCreate}
            openConfirm={openConfirm}
            notifyInfo={(m) => pushToast("info", m)}
            notifyError={(m) => pushToast("error", m)}
          />
        </div>
        <div className="preview-stage-fill">
          focus column placeholder · BoardRail preview
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        options={confirmState ? confirmState.opts : null}
        onClose={closeConfirm}
      />

      {/* lightweight toast surface (preview only) */}
      <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 6, zIndex: 9000 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            background: t.kind === "error" ? "var(--failed-soft)" : "var(--panel-2)",
            color: t.kind === "error" ? "var(--failed)" : "var(--fg)",
            border: "1px solid " + (t.kind === "error" ? "var(--danger-border)" : "var(--line-2)"),
            padding: "6px 12px", borderRadius: 6, fontSize: 12,
            boxShadow: "var(--shadow-md)",
          }}>{t.msg}</div>
        ))}
      </div>

      <DemoPanel
        theme={theme} setTheme={setTheme}
        dataKey={dataKey} setDataKey={setDataKey}
        activeId={activeId} setActiveId={setActiveId} pipelines={pipelines}
        creating={creating} setCreating={setCreating}
        isUninit={isUninit} setIsUninit={setIsUninit}
        hasDraftFirst={hasDraftFirst} setHasDraftFirst={setHasDraftFirst}
        defaultAutoMerge={defaultAutoMerge} setDefaultAutoMerge={setDefaultAutoMerge}
      />
    </>
  );
}

function DemoPanel(props) {
  const {
    theme, setTheme,
    dataKey, setDataKey,
    activeId, setActiveId, pipelines,
    creating, setCreating,
    isUninit, setIsUninit,
    hasDraftFirst, setHasDraftFirst,
    defaultAutoMerge, setDefaultAutoMerge,
  } = props;
  return (
    <aside className="demo-panel" aria-label="Demo controls">
      <h2>BoardRail · demo controls</h2>

      <div className="demo-row">
        <label htmlFor="d-theme">theme</label>
        <select id="d-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="dark">dark</option>
          <option value="light">light</option>
        </select>
      </div>

      <div className="demo-divider" />

      <div className="demo-row">
        <label htmlFor="d-data">pipelines fixture</label>
        <select id="d-data" value={dataKey} onChange={(e) => setDataKey(e.target.value)}>
          <option value="mixed">mixed — 7 rows, every state</option>
          <option value="single">single — 1 planning row</option>
          <option value="empty">empty — exercises rail-empty-hint</option>
          <option value="all-merged">all-merged — 4 merged rows (cleanup enabled)</option>
          <option value="failed-only">failed-only — single failed row</option>
        </select>
      </div>

      <div className="demo-row">
        <label htmlFor="d-active">activeId</label>
        <select id="d-active" value={activeId} onChange={(e) => setActiveId(e.target.value)}>
          {pipelines.length === 0 && <option value="">(no pipelines)</option>}
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.state}</option>
          ))}
        </select>
      </div>

      <div className="demo-divider" />

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-creating">creating(CreateCard 顯示)</label>
        <input id="d-creating" type="checkbox" checked={creating} onChange={(e) => setCreating(e.target.checked)} />
      </div>

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-uninit">isUninit(addLabel = 開始初始化)</label>
        <input id="d-uninit" type="checkbox" checked={isUninit} onChange={(e) => setIsUninit(e.target.checked)} />
      </div>

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-qa">draft on first row(QA badge)</label>
        <input id="d-qa" type="checkbox" checked={hasDraftFirst} onChange={(e) => setHasDraftFirst(e.target.checked)} />
      </div>

      <div className="demo-divider" />

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-am">CreateCard defaultAutoMerge</label>
        <input id="d-am" type="checkbox" checked={defaultAutoMerge} onChange={(e) => setDefaultAutoMerge(e.target.checked)} />
      </div>

      <div className="demo-divider" />

      <p style={{ fontSize: 11, color: "var(--fg-mute)", lineHeight: 1.5, margin: 0 }}>
        切換 fixture → mixed 看完整 7 種 pipeline.state(planning / running / paused / ready / failed / merged × 2);
        all-merged → 點 ⋯ → 清理已合併 worktree(會跳 ConfirmDialog,desc 列名)；
        empty → 看 rail-empty-hint；single → 看 rail-mini 只一格。
        CreateCard 開啟後試名稱 <span className="mono">Bad-Name</span>(format error)、
        <span className="mono">draft-feature</span>(taken,在 mixed 下)、
        <span className="mono">a</span> 然後打滿 60 字看 counter is-near / is-limit。
      </p>
    </aside>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<DemoApp />);
