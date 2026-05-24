import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckIconSm } from "./icons";
import { Popover } from "./Popover";
// phase4-2026-05-23-008 — pull in shared form-hint / form-hint--error styles
import "./forms/forms.css";

export type PickerOption = {
  id: string;
  label: string;
  hint?: string;
  mono?: boolean;
  disabled?: boolean;
};

export type PickerSelectProps = {
  open: boolean;
  setOpen: (v: boolean | ((o: boolean) => boolean)) => void;
  value: string;
  onChange: (id: string) => void;
  options: PickerOption[];
  icon?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  id?: string;
  // phase4-2026-05-23-008 — field-level hint / error rendered below trigger
  // (mirrors NumberField API: error wins over hint, aria-describedby wires
  // whichever is shown). Caller decides label markup; this prop is for the
  // helper line under the control.
  fieldHint?: ReactNode;
  fieldError?: ReactNode;
};

export function PickerSelect({
  open,
  setOpen,
  value,
  onChange,
  options,
  icon,
  disabled = false,
  readOnly = false,
  ariaLabel,
  placeholder,
  id: idProp,
  fieldHint,
  fieldError,
}: PickerSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reactId = useId();
  const baseId = idProp || `vp-picker-${reactId.replace(/[^a-z0-9]/gi, "")}`;
  const listboxId = `${baseId}-listbox`;

  const enabledOptions = useMemo(() => options.filter((o) => !o.disabled), [options]);
  const valueIndex = useMemo(() => options.findIndex((o) => o.id === value), [options, value]);
  const [activeIndex, setActiveIndex] = useState<number>(valueIndex >= 0 ? valueIndex : 0);
  const typeBufferRef = useRef<{ text: string; ts: number }>({ text: "", ts: 0 });

  const inert = disabled || readOnly;

  useEffect(() => {
    if (open) {
      setActiveIndex(valueIndex >= 0 ? valueIndex : findFirstEnabled(options));
    }
  }, [open, valueIndex, options]);

  useEffect(() => {
    if (!open) return;
    // listbox 內 focus 應留在 listbox container(走 aria-activedescendant),
    // 不靠 trigger 的 keydown — 開啟時把焦點推到 menu 容器。
    const t = window.setTimeout(() => menuRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[activeIndex];
    if (el && menuRef.current) {
      const menu = menuRef.current;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
    }
  }, [activeIndex, open]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      if (!options.length) return;
      let next = activeIndex;
      for (let i = 0; i < options.length; i++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) {
          setActiveIndex(next);
          return;
        }
      }
    },
    [activeIndex, options],
  );

  const commit = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      onChange(opt.id);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [options, onChange, setOpen],
  );

  const handleTypeahead = useCallback(
    (ch: string) => {
      if (!options.length) return;
      const now = Date.now();
      const buf = typeBufferRef.current;
      const text = (now - buf.ts > 600 ? "" : buf.text) + ch.toLowerCase();
      typeBufferRef.current = { text, ts: now };
      const startFrom = open ? activeIndex : valueIndex >= 0 ? valueIndex : -1;
      for (let step = 1; step <= options.length; step++) {
        const idx = (startFrom + step + options.length) % options.length;
        const opt = options[idx];
        if (opt.disabled) continue;
        if (opt.label.toLowerCase().startsWith(text)) {
          if (open) {
            setActiveIndex(idx);
          } else {
            onChange(opt.id);
          }
          return;
        }
      }
    },
    [options, open, activeIndex, valueIndex, onChange],
  );

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (inert) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (e.key === "ArrowDown") setActiveIndex(findFirstEnabled(options, valueIndex));
      else if (e.key === "ArrowUp") setActiveIndex(findLastEnabled(options, valueIndex));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      const idx = findFirstEnabled(options);
      if (idx >= 0) onChange(options[idx].id);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const idx = findLastEnabled(options);
      if (idx >= 0) onChange(options[idx].id);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      handleTypeahead(e.key);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      const idx = findFirstEnabled(options);
      if (idx >= 0) setActiveIndex(idx);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const idx = findLastEnabled(options);
      if (idx >= 0) setActiveIndex(idx);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(activeIndex);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      handleTypeahead(e.key);
    }
  };

  const current = options.find((o) => o.id === value);
  const activeId = open && options[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined;
  const labelText = current?.label ?? placeholder ?? "";
  // phase4-2026-05-23-008 — describedby wires field-level hint / error
  const describedId = fieldError || fieldHint ? `${baseId}-desc` : undefined;
  const describedText = fieldError ?? fieldHint;

  return (
    <div className={"picker vp-field" + (inert ? " is-inert" : "")}>
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        className={"picker-trigger vp-control" + (open ? " is-open" : "") + (inert ? " is-disabled" : "")}
        onClick={() => {
          if (inert) return;
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-disabled={inert || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-readonly={readOnly || undefined}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={describedId}
      >
        {icon}
        <span className={current?.mono ? "mono" : ""}>{labelText}</span>
        {current?.hint && <span className="picker-hint mono">({current.hint})</span>}
        <span style={{ flex: 1 }} />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open && !inert}
        onClose={() => setOpen(false)}
        placement="bottom-start"
        matchAnchorWidth
        autoFocusFirstItem={false}
        manageRovingFocus={false}
      >
        <div
          ref={menuRef}
          id={listboxId}
          className="picker-menu fade-up"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={baseId}
          aria-activedescendant={activeId}
          onKeyDown={onListKeyDown}
        >
          {options.map((o, i) => {
            const selected = o.id === value;
            const active = i === activeIndex;
            return (
              <button
                key={o.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                id={`${baseId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                tabIndex={-1}
                className={
                  "picker-item" +
                  (selected ? " is-active" : "") +
                  (active ? " is-focused" : "") +
                  (o.disabled ? " is-disabled" : "")
                }
                onMouseEnter={() => {
                  if (!o.disabled) setActiveIndex(i);
                }}
                onClick={() => commit(i)}
                disabled={o.disabled}
              >
                {icon && <span className="picker-item-icon">{icon}</span>}
                <span className={o.mono ? "mono" : ""}>{o.label}</span>
                {o.hint && <span className="picker-item-hint mono">{o.hint}</span>}
                {selected && (
                  <span className="picker-item-check">
                    <CheckIconSm />
                  </span>
                )}
              </button>
            );
          })}
          {!enabledOptions.length && (
            <div className="picker-empty" role="presentation">
              —
            </div>
          )}
        </div>
      </Popover>
      {describedText !== undefined && describedText !== null && describedText !== "" && (
        <div id={describedId} className={"form-hint" + (fieldError ? " form-hint--error" : "")}>
          {describedText}
        </div>
      )}
    </div>
  );
}

function findFirstEnabled(options: PickerOption[], from = -1): number {
  for (let i = from + 1; i < options.length; i++) if (!options[i].disabled) return i;
  for (let i = 0; i <= from; i++) if (!options[i].disabled) return i;
  return -1;
}

function findLastEnabled(options: PickerOption[], from = options.length): number {
  for (let i = from - 1; i >= 0; i--) if (!options[i].disabled) return i;
  for (let i = options.length - 1; i >= from; i--) if (!options[i].disabled) return i;
  return -1;
}
