import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../../api/auth";
import "../../styles/auth.css";

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
          <input
            className="auth-code-input"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6 碼驗證碼"
            autoFocus
          />
          {error && <p className="auth-error">{error}</p>}
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
