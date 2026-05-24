import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setupInit, type SetupInitResp } from "../../api/auth";
import { useToast } from "../../ui/Toast";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import "./auth.css";

export function AddDeviceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<SetupInitResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [loadQr, { pending: loading }] = useAsyncAction(async () => {
    setError(null);
    try {
      const resp = await setupInit();
      setData(resp);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const userMsg = "目前無法產生 QR Code，請稍後再試。";
      setError(userMsg);
      toast(userMsg, { variant: "danger" });
      if (typeof console !== "undefined") console.error("[AddDeviceDialog] setupInit failed:", detail);
      throw e;
    }
  });

  useEffect(() => {
    void loadQr();
  }, [loadQr]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const el = dialogRef.current;
      if (!el) return;
      const focusable = el.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? el).focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

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

  const copySecret = useCallback(async () => {
    const text = data?.otpauth_url;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("已複製設定連結", { variant: "success" });
    } catch (e) {
      toast(`複製失敗:${e instanceof Error ? e.message : String(e)}`, { variant: "danger" });
    }
  }, [data?.otpauth_url, toast]);

  const ready = !!data?.qr_svg && !loading && !error;
  const primaryLabel = ready ? "完成" : "關閉";

  const content = (
    <div
      className="auth-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-device-dialog-title"
        aria-describedby="add-device-dialog-desc"
        className="auth-dialog-box"
        tabIndex={-1}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, marginTop: -6 }}>
          <div id="add-device-dialog-title" className="auth-dialog-title" style={{ marginBottom: 0 }}>
            擴增裝置
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            title="關閉"
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              padding: 0,
              margin: -8,
              cursor: "pointer",
              color: "var(--fg-mute)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              width: 40,
              height: 40,
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div id="add-device-dialog-desc" className="auth-dialog-desc">
          在新裝置的驗證器 App 掃描此 QR Code，即可加入同一組登入驗證。請只在自己信任的裝置上操作。
        </div>

        {loading && (
          <div className="auth-dialog-loading" role="status" aria-live="polite">
            載入中…
          </div>
        )}

        {!loading && error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, marginBottom: 12 }}>
            <div className="auth-dialog-error" role="alert" style={{ marginBottom: 0 }}>
              {error}
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void loadQr()}
              style={{ alignSelf: "flex-start" }}
            >
              重試
            </button>
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
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => setSecretVisible((v) => !v)}
                  aria-expanded={secretVisible}
                  aria-controls="add-device-manual-uri"
                  style={{
                    appearance: "none",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--fg-mute)",
                    fontSize: 11,
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                  }}
                >
                  {secretVisible ? "隱藏手動設定連結" : "無法掃描？顯示手動設定連結"}
                </button>
                {secretVisible && (
                  <div
                    id="add-device-manual-uri"
                    style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}
                  >
                    <code
                      className="mono"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 10.5,
                        background: "var(--bg)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        padding: "4px 6px",
                        overflowX: "auto",
                        whiteSpace: "nowrap",
                        color: "var(--fg-mute)",
                      }}
                    >
                      {data.otpauth_url}
                    </code>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void copySecret()}
                      style={{ fontSize: 11, padding: "3px 8px", flexShrink: 0 }}
                    >
                      複製
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="auth-dialog-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
