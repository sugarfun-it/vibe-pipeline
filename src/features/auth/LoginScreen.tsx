import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../../api/auth";
import { TextField } from "../../ui/forms/TextField";
import "../../styles/auth-screen.css";

export function LoginScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(code);
      navigate(returnTo);
    } catch {
      setError("驗證碼錯誤");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">輸入驗證碼</h1>
        <form onSubmit={onSubmit} className="auth-form">
          <TextField
            label="驗證碼"
            labelHidden
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="6 碼驗證碼"
            autoFocus
            inputClassName="form-input--code"
            error={error ?? undefined}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={code.length !== 6 || submitting}
            style={{ justifyContent: "center" }}
          >
            {submitting ? "驗證中…" : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
