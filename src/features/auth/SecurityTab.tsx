import { useEffect, useState } from "react";
import { authedFetch } from "./authApi";
import { useConfirm } from "../../ui/ConfirmDialog";
import { useToast } from "../../ui/Toast";
import { AddDeviceDialog } from "./AddDeviceDialog";
import type { AuthStatus, SessionInfo } from "./types";
import "./auth.css";

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

function formatBoundAt(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "剛剛";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 個月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function SecurityTab({
  status,
}: {
  status: AuthStatus;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authedFetch("/api/auth/sessions")
      .then(async (res) => {
        const body = (await res.json()) as Envelope<{ sessions: SessionInfo[] } | SessionInfo[]>;
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          throw new Error(body.error?.message ?? `sessions ${res.status}`);
        }
        const data = body.data;
        const list = Array.isArray(data) ? data : data?.sessions ?? [];
        setSessions(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          toast(`讀取 sessions 失敗:${e instanceof Error ? e.message : String(e)}`, { variant: "danger" });
          setSessions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick, toast]);

  async function revoke(cookieHash: string) {
    try {
      const res = await authedFetch(`/api/auth/sessions/${cookieHash}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error(`revoke ${res.status}`);
      }
      setTick((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "撤銷失敗", { variant: "danger" });
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "重置 TOTP",
      warning: "重置後所有裝置將立即登出，需重新掃描 QR Code 才能存取。",
      description: "確定要繼續嗎？",
      confirmLabel: "重置",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await authedFetch("/api/auth/reset", { method: "POST" });
      if (!res.ok && res.status !== 204) {
        throw new Error(`reset ${res.status}`);
      }
      window.location.href = "/setup";
    } catch (e) {
      toast(e instanceof Error ? e.message : "重置失敗", { variant: "danger" });
    }
  }

  return (
    <div>
      <div className="auth-bound-header">
        <span className="auth-bound-check">✓</span>
        <span style={{ color: "var(--fg)" }}>已綁定</span>
        <span className="mono auth-bound-ts">
          {formatBoundAt(status.boundAt)}
        </span>
      </div>

      <div className="auth-section-label">
        活躍 Sessions
      </div>
      {sessions === null ? (
        <div className="auth-hint">載入中…</div>
      ) : sessions.length === 0 ? (
        <div className="auth-hint">無活躍 session。</div>
      ) : (
        <div className="auth-session-list">
          {sessions.map((s) => (
            <div key={s.cookieHash} className="auth-session-row">
              <div className="auth-session-info">
                <div className="mono auth-session-ip">
                  {s.ip}
                </div>
                <div
                  className="mono auth-session-ua"
                  title={s.ua}
                >
                  {truncate(s.ua, 56)}
                </div>
                <div className="auth-session-last-active">
                  最後活動 {formatRelativeTime(s.lastActiveAt)}
                </div>
              </div>
              <button
                type="button"
                className="btn auth-revoke-btn"
                onClick={() => void revoke(s.cookieHash)}
              >
                撤銷
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="auth-actions">
        <button type="button" className="btn" onClick={() => setAddDeviceOpen(true)}>
          擴增裝置
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void reset()}
        >
          重置 TOTP
        </button>
      </div>

      {addDeviceOpen && <AddDeviceDialog onClose={() => setAddDeviceOpen(false)} />}
    </div>
  );
}
