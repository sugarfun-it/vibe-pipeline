import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { WarnIcon } from "./icons";
import "../styles/drawer.css";
import "./confirmDialog.css";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  tertiaryLabel?: string;
  warning?: string;
};

export type ConfirmResult = "confirm" | "tertiary" | "cancel";

type State = ConfirmOptions & { resolve: (r: ConfirmResult) => void };

const Ctx = createContext<((opts: ConfirmOptions) => Promise<ConfirmResult>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const warnId = useId();

  const confirm = useCallback((opts: ConfirmOptions) => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return new Promise<ConfirmResult>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    function getFocusables(): HTMLElement[] {
      const root = cardRef.current;
      if (!root) return [];
      const nodes = root.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      );
      return Array.from(nodes).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
    }
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      if (e.key === "Escape") {
        e.preventDefault();
        state.resolve("cancel");
        setState(null);
        return;
      }
      if (e.key === "Enter" && !state.danger) {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === "TEXTAREA") return;
        e.preventDefault();
        state.resolve("confirm");
        setState(null);
        return;
      }
      if (e.key === "Tab") {
        const focusables = getFocusables();
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !cardRef.current?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !cardRef.current?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state]);

  useEffect(() => {
    if (state) return;
    const prev = previouslyFocusedRef.current;
    if (prev && prev.isConnected && typeof prev.focus === "function") {
      prev.focus();
    }
    previouslyFocusedRef.current = null;
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const body = document.body;
    const prev = body.getAttribute("data-overlay-open");
    body.setAttribute("data-overlay-open", "confirm");
    return () => {
      if (prev == null) body.removeAttribute("data-overlay-open");
      else body.setAttribute("data-overlay-open", prev);
    };
  }, [state]);

  function close(r: ConfirmResult) {
    if (!state) return;
    state.resolve(r);
    setState(null);
  }

  const describedBy = state
    ? [state.warning ? warnId : null, state.description ? descId : null].filter(Boolean).join(" ") || undefined
    : undefined;

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="drawer-stage drawer-stage--modal confirm-stage">
          <div
            className="drawer-scrim confirm-scrim"
            onClick={() => { if (!state.danger) close("cancel"); }}
            aria-hidden="true"
          />
          <div
            ref={cardRef}
            className="drawer drawer--modal confirm-card fade-up"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={describedBy}
          >
            <div id={titleId} className="confirm-title">{state.title}</div>
            {state.warning && (
              <div id={warnId} className="confirm-warning">
                <span className="confirm-warning-icon" aria-hidden><WarnIcon /></span>
                <span className="confirm-warning-text">{state.warning}</span>
              </div>
            )}
            {state.description && (
              <div id={descId} className="confirm-desc">{state.description}</div>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="btn confirm-cancel"
                onClick={() => close("cancel")}
                // biome-ignore lint/a11y/noAutofocus: 為了在 danger confirm 上預設 focus 取消按鈕,降低誤觸風險
                autoFocus={state.danger}
              >
                {state.cancelLabel ?? "取消"}
              </button>
              {state.tertiaryLabel && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => close("tertiary")}
                >
                  {state.tertiaryLabel}
                </button>
              )}
              <button
                type="button"
                className={"btn " + (state.danger ? "btn-danger" : "btn-primary")}
                onClick={() => close("confirm")}
                // biome-ignore lint/a11y/noAutofocus: 非 danger 預期立刻可以 Enter 確認,符合 UX 慣例
                autoFocus={!state.danger}
              >
                {state.confirmLabel ?? "確認"}
                {!state.danger && <span className="kbd-inline mono" aria-hidden="true">↵</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// 預設回 boolean(confirm=true / cancel=false),沒設 tertiaryLabel 時舊呼叫端不用改。
// 設了 tertiaryLabel 想拿三態結果 → 改用 useTriConfirm()。
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useConfirm 要在 ConfirmProvider 內用");
  return useCallback(async (opts) => {
    const r = await fn(opts);
    return r === "confirm";
  }, [fn]);
}

export function useTriConfirm(): (opts: ConfirmOptions) => Promise<ConfirmResult> {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useTriConfirm 要在 ConfirmProvider 內用");
  return fn;
}
