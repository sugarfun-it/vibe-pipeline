import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { WarnIcon } from "./icons";
import { Overlay } from "./Overlay";
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
  const titleId = useId();
  const descId = useId();
  const warnId = useId();

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<ConfirmResult>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  // Enter = confirm(非 danger);Enter 在 textarea 略過。
  // ESC / Tab trap / scrim 由 Overlay 處理(scrim 在 danger 模式下 onRequestClose 內擋掉)。
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      if (e.key !== "Enter" || state.danger) return;
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "TEXTAREA") return;
      e.preventDefault();
      state.resolve("confirm");
      setState(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
        <Overlay
          role="alertdialog"
          // danger 模式下 scrim click / ESC 不誤關(避免誤觸毀資料);非 danger 直接 cancel。
          onRequestClose={() => { if (!state.danger) close("cancel"); }}
          labelledBy={titleId}
          describedBy={describedBy}
          // autoFocus 在 button 上接管初始 focus,不需 Overlay 自動 focus root。
          initialFocus="auto"
          stageClassName="drawer-stage--modal confirm-stage"
          scrimClassName="confirm-scrim"
          surfaceClassName="drawer--modal confirm-card fade-up"
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
        </Overlay>
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
