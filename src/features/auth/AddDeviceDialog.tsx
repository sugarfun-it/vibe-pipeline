import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setupInit, type SetupInitResp } from "../../api/auth";
import { useToast } from "../../ui/Toast";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { CloseIcon, SpinnerIcon, WarnIcon } from "../../ui/icons";
import "./auth.css";

export function AddDeviceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<SetupInitResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const footerBtnRef = useRef<HTMLButtonElement>(null);
  const retryBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [loadQr, { pending: loading }] = useAsyncAction(async () => {
    setError(null);
    try {
      const resp = await setupInit();
      setData(resp);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const userMsg = "目前無法產生新增裝置 QR Code。請檢查連線後重試；若仍失敗，請稍後再開啟安全設定。";
      setError(userMsg);
      if (typeof console !== "undefined") console.error("[AddDeviceDialog] setupInit failed:", detail);
      throw e;
    }
  });

  useEffect(() => {
    void loadQr();
  }, [loadQr]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // Direct initial focus once when the dialog mounts. We deliberately do NOT
  // re-focus on async state transitions (loading → ready, ready → error etc.)
  // because that would yank focus away from a user who already tabbed to a
  // different control. If the user opens the dialog and immediately moves
  // away, their position is respected (R3 ADD-LOAD-R3-001 / sec-add-ready-r3-001).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (footerBtnRef.current) {
        footerBtnRef.current.focus();
        return;
      }
      dialogRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When error appears for the first time and focus is still on the footer
  // close button (i.e. the user has not moved focus elsewhere), pull focus
  // forward to the retry button so the recovery path is one step away.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const wasErr = lastErrorRef.current;
    lastErrorRef.current = error;
    if (!error || wasErr === error) return;
    const t = window.setTimeout(() => {
      const active = document.activeElement;
      if (retryBtnRef.current && (active === footerBtnRef.current || active === dialogRef.current || active === document.body)) {
        retryBtnRef.current.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Body scroll lock while dialog is mounted (mobile settings popover is a
  // full-screen scrollable surface — without lock, background can scroll under
  // the dialog).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // SettingsPopover (host) installs a document-level pointerdown CAPTURE
  // listener to close itself on outside-clicks. Per the DOM event flow
  // (capture order: window → document → ancestors → target), a listener on
  // `window` in the capture phase runs BEFORE any listener on `document` in
  // the same phase, regardless of registration order. So even though the
  // popover registered its document listener first, our window-level capture
  // listener fires earlier and can stopPropagation before the popover sees
  // the event. (R3/R4 SEC-LIST-R3-001 / SEC-LIST-R2-002 / R4-001/002 carryover.)
  useEffect(() => {
    function onWinPointerDown(e: PointerEvent) {
      const overlay = dialogRef.current?.parentElement;
      if (overlay && e.target instanceof Node && overlay.contains(e.target)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }
    window.addEventListener("pointerdown", onWinPointerDown, true);
    return () => window.removeEventListener("pointerdown", onWinPointerDown, true);
  }, []);

  const copySecret = useCallback(async () => {
    const text = data?.otpauth_url;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFlash(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedFlash(false), 1800);
    } catch (e) {
      if (typeof console !== "undefined") console.error("[AddDeviceDialog] copy failed:", e);
      toast("複製失敗，請手動選取連結並按 Ctrl/Cmd+C 或長按複製。", { variant: "danger" });
    }
  }, [data?.otpauth_url, toast]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const ready = !!data?.qr_svg && !loading && !error;
  // Always "關閉" — the dialog cannot verify that the new device actually
  // scanned + enrolled; using "完成" would imply confirmation that did not
  // happen. Keep "關閉" so the action label matches what the button does.
  const primaryLabel = "關閉";

  const descId = "add-device-dialog-desc";
  const errId = "add-device-dialog-err";
  const describedBy = error ? `${descId} ${errId}` : descId;

  // Pointerdown stopPropagation: SettingsPopover (host) uses a document-level
  // pointerdown capture listener to close itself when clicking outside its own
  // container. Because this dialog renders via createPortal at document.body,
  // any click inside the dialog would otherwise close the popover (and unmount
  // this dialog with it). Block pointer events from bubbling out of the
  // overlay so the host popover cannot mistake them for outside clicks.
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

  const content = (
    <div
      className="auth-dialog-overlay"
      onPointerDown={stopPointer}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-device-dialog-title"
        aria-describedby={describedBy}
        className="auth-dialog-box"
        tabIndex={-1}
      >
        <div className="auth-dialog-header">
          <div id="add-device-dialog-title" className="auth-dialog-title">
            新增裝置
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            title="關閉"
            className="auth-dialog-close"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div id={descId} className="auth-dialog-desc">
          使用新裝置的驗證器應用程式掃描 QR Code。請只在自己信任的裝置上操作。
        </div>

        {loading && (
          <div className="auth-dialog-loading-block" role="status" aria-live="polite">
            <span className="auth-dialog-loading-spinner" aria-hidden="true">
              <SpinnerIcon width={28} height={28} />
            </span>
            <span className="auth-dialog-loading-title">正在產生新增裝置 QR Code…</span>
            <span className="auth-dialog-loading-sub">通常只需要幾秒鐘。如果遲遲沒有出現，請按右下角「關閉」並重新開啟。</span>
          </div>
        )}

        {!loading && error && (
          <div className="auth-dialog-error-panel" role="alert">
            <div className="auth-dialog-error-header">
              <span className="auth-dialog-error-icon" aria-hidden="true">
                <WarnIcon width={16} height={16} />
              </span>
              <div id={errId} className="auth-dialog-error-text">
                {error}
              </div>
            </div>
            <div className="auth-dialog-error-actions">
              <button
                ref={retryBtnRef}
                type="button"
                className="btn btn-primary"
                onClick={() => void loadQr()}
              >
                重試
              </button>
              <button
                type="button"
                className="btn auth-dialog-error-close"
                onClick={onClose}
              >
                關閉
              </button>
            </div>
          </div>
        )}

        {ready && data && (
          <>
            <div
              className="auth-qr-wrapper"
              aria-label="新增裝置用 QR Code"
              role="img"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: backend 產生的 QR SVG 內容
              dangerouslySetInnerHTML={{ __html: data.qr_svg }}
            />
            {data.otpauth_url && (
              <div className="auth-dialog-manual">
                <button
                  type="button"
                  onClick={() => setSecretVisible((v) => !v)}
                  aria-expanded={secretVisible}
                  aria-controls="add-device-manual-uri"
                  className="auth-dialog-manual-toggle"
                >
                  {secretVisible ? "隱藏手動設定連結" : "無法掃描？顯示手動設定連結"}
                </button>
                {secretVisible && (
                  <div id="add-device-manual-uri" className="auth-dialog-manual-row">
                    <div className="auth-dialog-manual-hint">
                      此連結含 TOTP 金鑰，請只在自己的驗證器應用程式內貼上，避免在公開頻道分享或截圖。
                    </div>
                    <div className="auth-dialog-manual-controls">
                      <code
                        id="add-device-manual-uri-code"
                        className="mono auth-dialog-manual-code"
                        role="textbox"
                        tabIndex={0}
                        aria-readonly="true"
                        aria-label="新增裝置 TOTP 設定連結"
                        onFocus={(e) => {
                          const sel = window.getSelection();
                          if (!sel) return;
                          const range = document.createRange();
                          range.selectNodeContents(e.currentTarget);
                          sel.removeAllRanges();
                          sel.addRange(range);
                        }}
                      >
                        {data.otpauth_url}
                      </code>
                      <button
                        type="button"
                        className={"btn auth-dialog-manual-copy" + (copiedFlash ? " is-copied" : "")}
                        onClick={() => void copySecret()}
                        aria-label="複製設定連結"
                      >
                        {copiedFlash ? "已複製 ✓" : "複製"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* In error state the footer is omitted entirely — the error panel
            carries both 重試 (primary) + 關閉 (secondary) so the dialog has a
            single action row instead of two disconnected zones. */}
        {!error && (
          <div className="auth-dialog-footer">
            <button
              ref={footerBtnRef}
              type="button"
              className="btn"
              onClick={onClose}
            >
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
