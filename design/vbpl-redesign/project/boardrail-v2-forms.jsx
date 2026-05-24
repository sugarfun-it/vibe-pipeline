/* ============================================================================
   BoardRail V2 · forms — PickerSelect / TextField / CreateCard / ConfirmDialog
   ============================================================================ */

const { useState: useStateF, useMemo: useMemoF, useEffect: useEffectF, useRef: useRefF } = React;

/* ─── PickerSelectInline (verbatim) ─────────────────────────────────── */

function PickerSelectInline({ open, setOpen, value, onChange, options, icon, ariaLabel }) {
  const triggerRef = useRefF(null);
  const menuRef = useRefF(null);
  const current = options.find((o) => o.id === value);
  useEffectF(() => {
    if (!open) return;
    function onPointerDown(e) {
      const t = e.target;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpen]);
  return (
    <div className="picker vp-field">
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
        <div ref={menuRef} className="picker-menu fade-up" role="listbox" tabIndex={-1} aria-label={ariaLabel}>
          {options.map((o) => {
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
                {selected && <span className="picker-item-check"><CheckIconSm /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── TextField (verbatim) ──────────────────────────────────────────── */

function TextField({
  label, value, onChange, placeholder, spellCheck, autoComplete, maxLength,
  fieldClassName, inputClassName, error, ariaDescribedBy, id, inputRef,
}) {
  const describedId = error ? `${id}-desc` : undefined;
  const combinedDescribed = [describedId, ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={"form-field" + (fieldClassName ? ` ${fieldClassName}` : "")}>
      <label htmlFor={id} className="form-label"><span>{label}</span></label>
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
      {error && <div id={describedId} className="form-hint form-hint--error">{error}</div>}
    </div>
  );
}

/* ─── CreateCard (verbatim) ─────────────────────────────────────────── */

const FALLBACK_BRANCHES = ["main"];
const NAME_MAX_LENGTH = 60;

function CreateCard({ onCancel, onSubmit, existingNames = [], branches, defaultAutoMerge = false }) {
  const baseList = useMemoF(
    () => (branches && branches.length > 0 ? branches : FALLBACK_BRANCHES),
    [branches]
  );
  const defaultBase = baseList.includes("main") ? "main"
    : baseList.includes("master") ? "master"
    : baseList[0];

  const [name, setName] = useStateF("");
  const [baseBranch, setBaseBranch] = useStateF(defaultBase);
  const [baseOpen, setBaseOpen] = useStateF(false);
  const [autoMerge, setAutoMerge] = useStateF(defaultAutoMerge);
  const inputRef = useRefF(null);

  useEffectF(() => {
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

  useEffectF(() => {
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Esc cancels
  useEffectF(() => {
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit(e) {
    if (e) e.preventDefault();
    if (!valid) return;
    onSubmit({ name: trimmed, baseBranch, autoMerge });
  }

  return (
    <form className="create-card fade-up" onSubmit={submit}>
      <div className="create-card-head">
        <span className="rail-status-chip" data-state="planning" aria-hidden="true">
          <span className="rail-status-chip-dot" />
          <span>新 pipeline</span>
        </span>
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
          <div id={formatHintId} className="create-field-format-hint" hidden={hasError}>
            a-z、0-9、-、_，首字為小寫英文或數字，最多 {NAME_MAX_LENGTH} 字
          </div>
          <div
            id={counterId}
            className={"create-counter mono" + (counterAtLimit ? " is-limit" : counterNearLimit ? " is-near" : "")}
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
        <button type="button" className="btn create-cancel" onClick={onCancel} aria-keyshortcuts="Escape">
          <span>Esc</span>
          <span style={{ color: "var(--fg-faint)" }}>取消</span>
        </button>
        <button type="submit" className="btn btn-primary create-submit" disabled={!valid} aria-label="建立 pipeline">
          <span>建立</span>
          {valid && <span className="kbd-inline mono">↵</span>}
        </button>
      </div>
    </form>
  );
}

/* ─── ConfirmDialog (verbatim) ──────────────────────────────────────── */

function ConfirmDialog({ open, options, onClose }) {
  useEffectF(() => {
    if (!open || !options) return;
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onClose("cancel"); }
      else if (e.key === "Enter" && !options.danger) {
        e.preventDefault();
        onClose("confirm");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, options, onClose]);

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
          <div
            className={"confirm-desc" + (descriptionRich ? " confirm-desc--rich" : "")}
            style={{ whiteSpace: "pre-line" }}
          >
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

/* ─── Rail wrapper (V2 variant) ─────────────────────────────────────── */

function RailV2({
  pipelines, activeId, onSelect,
  creating, onStartCreate, createSlot,
  addLabel, draftPipelineIds, sectionMenuItems,
}) {
  const isEmpty = !creating && pipelines.length === 0;
  return (
    <aside className={"rail rail--v2chip" + (creating ? " is-creating" : "")} aria-label="Pipeline 列表">
      <div className="rail-section-header">
        <span className="rail-section-label mono" id="rail-pipelines-label">PIPELINES</span>
        {sectionMenuItems && sectionMenuItems.length > 0 && (
          <RailSectionMenu items={sectionMenuItems} />
        )}
      </div>
      <div className="rail-list">
        {creating ? createSlot : (
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
            <RailItemV2
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

Object.assign(window, { PickerSelectInline, TextField, CreateCard, ConfirmDialog, RailV2 });
