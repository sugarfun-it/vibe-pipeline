import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setupInit, setupVerify, type SetupInitResp } from "../../api/auth";
import { TextField } from "../../ui/forms/TextField";
import { useToast } from "../../ui/Toast";
import "../../styles/auth-screen.css";
import "./auth.css";

export function SetupScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "ready" | "init-error">("loading");
  const [data, setData] = useState<SetupInitResp | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const retryBtnRef = useRef<HTMLButtonElement | null>(null);

  async function runInit() {
    setRetryBusy(true);
    setState("loading");
    setError(null);
    try {
      const resp = await setupInit();
      setData(resp);
      setState("ready");
    } catch {
      setState("init-error");
    } finally {
      setRetryBusy(false);
    }
  }

  useEffect(() => {
    void runInit();
  }, []);

  useEffect(() => {
    if (state === "ready" && error) {
      inputRef.current?.focus();
    }
  }, [error, state]);

  useEffect(() => {
    if (state === "init-error") {
      retryBtnRef.current?.focus();
    }
  }, [state]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || code.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setupVerify(data.setup_token, code);
      navigate("/");
    } catch {
      setError("驗證碼錯誤，請輸入最新的 6 位數字。");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    if (!data?.otpauth_url) return;
    try {
      await navigator.clipboard.writeText(data.otpauth_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("複製失敗，請手動選取後複製。", { variant: "danger" });
    }
  }

  const remaining = 6 - code.length;
  const showCounter = code.length > 0 && code.length < 6;

  if (state === "loading") {
    return (
      <div className="auth-screen setup-screen">
        <div
          className="auth-card setup-card setup-card--loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <p className="setup-brand" aria-hidden="true">vibe-pipeline</p>
          <span className="auth-spinner setup-spinner" aria-hidden="true" />
          <p className="setup-loading-title">正在準備 QR Code…</p>
          <p className="setup-loading-sub">第一次設定雙重驗證需要幾秒鐘。</p>
        </div>
      </div>
    );
  }

  if (state === "init-error") {
    return (
      <div className="auth-screen setup-screen">
        <div className="auth-card setup-card setup-card--error">
          <p className="setup-brand" aria-hidden="true">vibe-pipeline</p>
          <div className="setup-error-block" role="alert" aria-live="assertive">
            <span className="setup-error-icon" aria-hidden="true">!</span>
            <div className="setup-error-text">
              <p className="setup-error-title">無法準備 QR Code</p>
              <p className="setup-error-detail">
                可能是網路問題或後端尚未就緒，請稍後再試一次。
              </p>
            </div>
          </div>
          <button
            ref={retryBtnRef}
            className={
              "btn btn-primary setup-retry-btn" +
              (retryBusy ? " setup-retry-btn--loading" : "")
            }
            onClick={() => void runInit()}
            disabled={retryBusy}
            aria-busy={retryBusy || undefined}
          >
            {retryBusy ? (
              <>
                <span className="setup-spinner-inline" aria-hidden="true" />
                <span>重新準備中…</span>
              </>
            ) : (
              <span>重試準備 QR Code</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen setup-screen">
      <div className="auth-card setup-card">
        <header className="setup-header">
          <p className="setup-brand" aria-hidden="true">vibe-pipeline</p>
          <h1 className="auth-title setup-title">設定雙重驗證</h1>
          <p className="setup-subtitle">
            這是本機帳號的首次設定，請依下列步驟完成。
          </p>
        </header>
        <ol className="setup-steps">
          <li>
            <span className="setup-step-num" aria-hidden="true">1</span>
            <span className="setup-step-text">
              打開驗證器應用程式（Google Authenticator、1Password、Authy 等）。
            </span>
          </li>
          <li>
            <span className="setup-step-num" aria-hidden="true">2</span>
            <span className="setup-step-text">掃描下方 QR Code 加入新帳號。</span>
          </li>
          <li>
            <span className="setup-step-num" aria-hidden="true">3</span>
            <span className="setup-step-text">輸入應用程式產生的 6 位數驗證碼。</span>
          </li>
        </ol>
        {data && (
          <div className="auth-qr setup-qr" role="img" aria-label="雙重驗證 QR Code">
            <div
              className="setup-qr-svg"
              dangerouslySetInnerHTML={{ __html: data.qr_svg }}
            />
          </div>
        )}
        {data?.otpauth_url && (
          <div className="setup-manual">
            <button
              type="button"
              className="setup-manual-toggle"
              onClick={() => setSecretVisible((v) => !v)}
              aria-expanded={secretVisible}
              aria-controls="setup-manual-uri"
            >
              {secretVisible ? "隱藏手動設定連結" : "無法掃描？顯示手動設定連結"}
            </button>
            {secretVisible && (
              <div className="setup-manual-row" id="setup-manual-uri">
                <p className="setup-manual-hint">
                  將下列連結貼到驗證器應用程式中，或匯入為新的 TOTP 帳號。
                </p>
                <div className="setup-manual-controls">
                  <code className="setup-manual-code" aria-label="otpauth URL">
                    {data.otpauth_url}
                  </code>
                  <button
                    type="button"
                    className={
                      "btn setup-manual-copy" + (copied ? " is-copied" : "")
                    }
                    onClick={() => void copySecret()}
                  >
                    {copied ? "已複製" : "複製"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <form onSubmit={onSubmit} className="auth-form setup-form" noValidate>
          <div className="setup-field">
            <TextField
              ref={inputRef}
              label="驗證碼"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
              disabled={submitting}
              inputClassName="form-input--code setup-code-input"
              fieldClassName="setup-field-inner"
              error={error ?? undefined}
              ariaDescribedBy="setup-input-hint"
            />
            <p
              id="setup-input-hint"
              className={
                "setup-input-hint" + (showCounter ? " setup-input-hint--counter" : "")
              }
            >
              {showCounter ? `還差 ${remaining} 位` : "請輸入驗證器應用程式上的 6 位數字。"}
            </p>
          </div>
          <button
            type="submit"
            className={
              "btn btn-primary setup-submit" +
              (submitting ? " setup-submit--loading" : "")
            }
            disabled={code.length !== 6 || submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? (
              <>
                <span className="setup-spinner-inline" aria-hidden="true" />
                <span>驗證中…</span>
              </>
            ) : (
              <span>完成設定</span>
            )}
          </button>
          <span role="status" aria-live="polite" className="setup-sr-status">
            {submitting ? "正在驗證驗證碼，請稍候。" : ""}
          </span>
        </form>
      </div>
    </div>
  );
}
