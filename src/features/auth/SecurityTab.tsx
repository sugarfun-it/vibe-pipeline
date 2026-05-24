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

// Derive a short human-readable device label from a UA string.
// Falls back to the UA itself when no pattern matches.
function describeUa(ua: string): string {
  if (!ua) return "未知裝置";
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  let os = "其他系統";
  if (/iPhone|iPad|iPod|iOS/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "瀏覽器";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  const form = isMobile ? "手機" : "桌機";
  return `${os} · ${browser} · ${form}`;
}

export function SecurityTab({
  status,
}: {
  status: AuthStatus;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessionsError(null);
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
          const detail = e instanceof Error ? e.message : String(e);
          if (typeof console !== "undefined") console.error("[SecurityTab] sessions fetch failed:", detail);
          // Distinguish 「讀取失敗」 from 「真的沒有任何 session」 — keep
          // sessions=[] for empty branch only; surface a persistent error
          // chip + retry control for the failure branch (R3 sec-loading-r3-001).
          setSessions([]);
          setSessionsError("無法讀取登入工作階段，請稍後重試。");
          toast("讀取登入工作階段失敗，請稍後重試。", { variant: "danger" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick, toast]);

  async function revoke(s: SessionInfo) {
    const ok = await confirm({
      title: "撤銷此登入工作階段",
      warning: "目前無法判斷此是否為您正在使用的裝置；若撤銷的是當前裝置，您將需要重新登入。",
      description: `將撤銷 ${s.ip}（${describeUa(s.ua)}）的登入工作階段。`,
      confirmLabel: "撤銷",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await authedFetch(`/api/auth/sessions/${s.cookieHash}`, { method: "DELETE" });
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
      title: "重置驗證器設定",
      warning: "重置後，所有裝置將立即登出，需重新掃描 QR Code 才能存取。請確保您能再次完成新裝置設定。",
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
    <div className="security-tab">
      <div className="auth-bound-header">
        <span className="auth-bound-check" aria-hidden="true">✓</span>
        <span className="auth-bound-label">已綁定</span>
        <span className="auth-bound-sep" aria-hidden="true">·</span>
        <span className="auth-bound-ts">
          {formatBoundAt(status.boundAt)}
        </span>
      </div>

      <div className="security-section-head">
        <div className="auth-section-label">
          活躍登入工作階段
          {sessions !== null && sessions.length > 0 && (
            <span className="security-session-count" aria-label={`共 ${sessions.length} 個`}>
              · {sessions.length}
            </span>
          )}
        </div>
      </div>

      {sessions === null ? (
        <div role="status" aria-live="polite" aria-busy="true">
          <ul className="security-loading" aria-label="讀取登入工作階段中">
            {[0, 1, 2].map((i) => (
              <li key={i} className="security-loading-row">
                <div className="security-loading-info">
                  <div className="security-loading-bar security-loading-bar--w1" aria-hidden="true" />
                  <div className="security-loading-bar security-loading-bar--w2" aria-hidden="true" />
                  <div className="security-loading-bar security-loading-bar--w3" aria-hidden="true" />
                </div>
                <div className="security-loading-revoke" aria-hidden="true" />
              </li>
            ))}
          </ul>
          <p className="security-loading-status">
            <span className="security-loading-status-dot" aria-hidden="true" />
            <span>讀取登入工作階段中…</span>
          </p>
        </div>
      ) : sessionsError ? (
        <div className="security-list-error" role="alert">
          <span className="security-list-error-text">{sessionsError}</span>
          <button
            type="button"
            className="btn security-list-error-retry"
            onClick={() => {
              // Reset the list to a loading state before re-fetching so the
              // UI announces 「讀取中」 again instead of briefly looking like
              // an empty list. The effect dep on `tick` re-runs the fetch.
              setSessions(null);
              setSessionsError(null);
              setTick((n) => n + 1);
            }}
          >
            重試
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="auth-hint">尚無活躍登入工作階段。</div>
      ) : (
        <ul className="security-session-list" aria-label="活躍登入工作階段">
          {sessions.map((s) => {
            const uaLabel = describeUa(s.ua);
            return (
              <li key={s.cookieHash} className="security-session-row">
                <div className="security-session-info">
                  <div className="security-session-line-1">
                    <span className="security-session-ua-label">{uaLabel}</span>
                  </div>
                  <div
                    className="mono security-session-ua"
                    title={s.ua}
                  >
                    {s.ua}
                  </div>
                  <div className="security-session-meta">
                    <span className="mono security-session-ip">{s.ip}</span>
                    <span className="security-session-meta-sep" aria-hidden="true">·</span>
                    <span className="security-session-last">
                      最後活動 {formatRelativeTime(s.lastActiveAt)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn security-revoke-btn"
                  onClick={() => void revoke(s)}
                  aria-label={`撤銷 ${s.ip}（${uaLabel}）的登入工作階段`}
                >
                  撤銷
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {sessions !== null && sessions.length > 0 && (
        <p className="security-list-foot">
          目前無法標示當前裝置。撤銷當前使用中的工作階段後，該裝置需重新登入。
        </p>
      )}

      <div
        className="security-actions"
        aria-busy={sessions === null || undefined}
      >
        <button
          type="button"
          className="btn"
          onClick={() => setAddDeviceOpen(true)}
          disabled={sessions === null}
          aria-disabled={sessions === null || undefined}
          title={sessions === null ? "等待登入工作階段讀取完成…" : undefined}
        >
          新增裝置
        </button>
        <button
          type="button"
          className="btn btn-danger security-reset-btn"
          onClick={() => void reset()}
          disabled={sessions === null}
          aria-disabled={sessions === null || undefined}
          title={sessions === null ? "等待登入工作階段讀取完成…" : undefined}
        >
          重置驗證器
          <span className="security-reset-sub">（重置 TOTP）</span>
        </button>
      </div>

      {addDeviceOpen && <AddDeviceDialog onClose={() => setAddDeviceOpen(false)} />}
    </div>
  );
}
