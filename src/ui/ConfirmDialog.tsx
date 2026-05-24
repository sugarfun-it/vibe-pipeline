import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { WarnIcon } from "./icons";
import { Overlay } from "./Overlay";
import "../styles/drawer.css";
import "./confirmDialog.css";

export type ConfirmOptions = {
  title: string;
  description?: string;
  // phase4-2026-05-23-012 — rich description slot for destructive flows that
  // need a structured body (semantic list / mono detail / bullets). Caller
  // owns the markup; ConfirmDialog still wires aria-describedby.
  descriptionRich?: React.ReactNode;
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
  // ESC = cancel(包含 danger:破壞性確認禁掉 scrim 誤觸,但 ESC 是無歧義的取消信號,
  // a11y 不能擋,否則變 keyboard trap。Overlay 的 onRequestClose 會替 scrim 擋,
  // ESC 走我們這條優先處理)。Tab trap 仍由 Overlay 接手。
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      const target = e.target as HTMLElement | null;
      if (e.key === "Escape") {
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        e.preventDefault();
        e.stopPropagation();
        state.resolve("cancel");
        setState(null);
        return;
      }
      if (e.key !== "Enter" || state.danger) return;
      if (target && target.tagName === "TEXTAREA") return;
      e.preventDefault();
      state.resolve("confirm");
      setState(null);
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [state]);

  function close(r: ConfirmResult) {
    if (!state) return;
    state.resolve(r);
    setState(null);
  }

  const describedBy = state
    ? [
        state.warning ? warnId : null,
        state.description || state.descriptionRich ? descId : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined
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
          {(state.descriptionRich || state.description) && (
            <div
              id={descId}
              className={
                "confirm-desc" + (state.descriptionRich ? " confirm-desc--rich" : "")
              }
            >
              {state.descriptionRich ?? state.description}
            </div>
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
              // iter-uiux-2026-05-24 confirm-dialog.standard r1 std-04 —
              // 視覺 ↵ chip aria-hidden,鍵盤 / 螢幕閱讀器使用者要可讀的提示:
              // 非 danger 時補 aria-keyshortcuts + sr-only "按 Enter 鍵確認" hint。
              aria-keyshortcuts={!state.danger ? "Enter" : undefined}
            >
              {state.confirmLabel ?? "確認"}
              {!state.danger && (
                <>
                  <span className="kbd-inline mono" aria-hidden="true">↵</span>
                  <span className="sr-only">(按 Enter 鍵確認)</span>
                </>
              )}
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
