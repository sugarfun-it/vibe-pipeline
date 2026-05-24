import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PickerSelect } from "../../ui/PickerSelect";
import { BranchIcon, CloseIcon } from "../../ui/icons";
import { TextField } from "../../ui/forms/TextField";
import "../pipeline/createPipeline.css";

const FALLBACK_BRANCHES = ["main"];
const NAME_MAX_LENGTH = 60;

export function CreateCard({
  onCancel,
  onSubmit,
  existingNames = [],
  branches,
  defaultAutoMerge = false,
}: {
  onCancel: () => void;
  onSubmit: (data: { name: string; baseBranch: string; autoMerge: boolean }) => void;
  existingNames?: string[];
  branches?: string[];
  defaultAutoMerge?: boolean;
}) {
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
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const baseOpenRef = useRef(baseOpen);
  baseOpenRef.current = baseOpen;

  const uid = useId();
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
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const card = cardRef.current;
      const target = e.target as Node | null;
      const insideCard = !!(card && target && card.contains(target));
      if (!insideCard) return;
      if (baseOpenRef.current) {
        setBaseOpen(false);
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
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
          ref={inputRef}
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
                ? "首字需英數；可用 a-z、0-9、-、_。"
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
            a-z、0-9、-、_，首字英數
          </div>
          <div
            id={counterId}
            className={
              "create-counter mono" +
              (counterAtLimit ? " is-limit" : counterNearLimit ? " is-near" : "")
            }
            aria-live="polite"
            hidden={!counterNearLimit}
          >
            {name.length}/{NAME_MAX_LENGTH}
          </div>
        </div>
      </div>

      <div className="create-field">
        <div id={baseLabelId} className="create-field-label">基底分支</div>
        <PickerSelect
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
          <span className="kbd-inline mono">↵</span>
        </button>
      </div>
    </form>
  );
}

export function CreatePlaceholder() {
  return (
    <main className="focus focus-create-empty">
      <div className="create-empty fade-up">
        <div className="create-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7 L9 12 L4 17" />
            <path d="M10 7 L15 12 L10 17" opacity="0.55" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" />
          </svg>
        </div>
        <div className="create-empty-title">新 pipeline 還沒建立</div>
        <div className="create-empty-desc">
          填好左側資訊後按 <span className="kbd mono">↵</span>，自動切過去開第一張 ticket。
        </div>
      </div>
    </main>
  );
}
