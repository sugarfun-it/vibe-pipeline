import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../../api/auth";
import { TextField } from "../../ui/forms/TextField";
import "../../styles/auth-screen.css";
import "./auth.css";

export function LoginScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(code);
      navigate(returnTo);
    } catch {
      setError("驗證碼錯誤或已逾時，請輸入最新 6 位數驗證碼。");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (error) {
      inputRef.current?.focus();
    }
  }, [error]);

  const remaining = 6 - code.length;
  const showCounter = code.length > 0 && code.length < 6;

  return (
    <div className="auth-screen login-screen">
      <div className="auth-card login-card">
        <header className="login-header">
          <h1 className="auth-title login-title">輸入驗證碼</h1>
          <p className="login-subtitle">
            請輸入裝置設定時產生的 6 位數驗證碼以登入 vibe-pipeline。
          </p>
        </header>
        <form
          onSubmit={onSubmit}
          className="auth-form login-form"
          noValidate
        >
          <div className="login-field">
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
              inputClassName="form-input--code login-code-input"
              fieldClassName="login-field-inner"
              error={error ?? undefined}
              ariaDescribedBy="login-input-hint"
            />
            <p
              id="login-input-hint"
              className={
                "login-input-hint" + (showCounter ? " login-input-hint--counter" : "")
              }
            >
              {showCounter ? `還差 ${remaining} 位` : "限 6 位數字，輸入完成後可送出。"}
            </p>
          </div>
          <button
            type="submit"
            className={
              "btn btn-primary login-submit" + (submitting ? " login-submit--loading" : "")
            }
            disabled={code.length !== 6 || submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? (
              <>
                <span className="login-submit-spinner" aria-hidden="true" />
                <span>驗證中…</span>
              </>
            ) : (
              <span>登入</span>
            )}
          </button>
          <span role="status" aria-live="polite" className="login-sr-status">
            {submitting ? "正在驗證您的驗證碼，請稍候。" : ""}
          </span>
          <span role="alert" aria-live="assertive" className="login-sr-status">
            {!submitting && error ? error : ""}
          </span>
        </form>
      </div>
    </div>
  );
}
