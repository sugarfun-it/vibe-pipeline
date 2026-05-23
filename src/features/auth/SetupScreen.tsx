import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setupInit, setupVerify, type SetupInitResp } from "../../api/auth";
import { TextField } from "../../ui/forms/TextField";
import "../../styles/auth.css";

export function SetupScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ready" | "init-error">("loading");
  const [data, setData] = useState<SetupInitResp | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runInit() {
    setState("loading");
    setError(null);
    try {
      const resp = await setupInit();
      setData(resp);
      setState("ready");
    } catch {
      setState("init-error");
    }
  }

  useEffect(() => {
    void runInit();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || code.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setupVerify(data.setup_token, code);
      navigate("/");
    } catch {
      setError("驗證碼錯誤,請重試");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (state === "init-error") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-error">初始化失敗</p>
          <button className="btn btn-primary" onClick={() => void runInit()}>
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">設定雙重驗證</h1>
        <p className="auth-hint">請用 Authenticator App 掃描 QR Code</p>
        {data && (
          <div className="auth-qr" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
        )}
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
            {submitting ? "驗證中…" : "完成設定"}
          </button>
        </form>
      </div>
    </div>
  );
}
