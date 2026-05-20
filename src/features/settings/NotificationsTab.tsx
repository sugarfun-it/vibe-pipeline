import { useEffect, useState } from "react";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import {
  getPermission,
  getStoredToken,
  isFcmSupported,
  requestAndRegisterToken,
  unregisterToken as unregisterFcm,
} from "../../lib/fcm";
import type { PushEventKey, UserConfig } from "../../../shared/types";
import "./SettingsPopover.css";

const PUSH_EVENT_LABELS: Array<{ key: PushEventKey; label: string }> = [
  { key: "ticket_done", label: "Ticket 完成" },
  { key: "ticket_failed", label: "Ticket 失敗" },
  { key: "pipeline_paused", label: "Pipeline 暫停需回應" },
  { key: "pipeline_ready", label: "Pipeline 跑完" },
  { key: "auto_merge_conflict", label: "AI 接手解衝突" },
];

function PushNotificationsSection({
  userCfg,
  pushSaving,
  onTogglePushEvent,
  onActionError,
}: {
  userCfg: UserConfig | null;
  pushSaving: Partial<Record<PushEventKey, boolean>>;
  onTogglePushEvent: (key: PushEventKey, enabled: boolean) => void;
  onActionError?: (message: string) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(getPermission());
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isFcmSupported().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshPermission() {
    setPermission(getPermission());
    setToken(getStoredToken());
  }

  async function enable() {
    setLoading(true);
    setLastError(null);
    try {
      await requestAndRegisterToken();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "啟用通知失敗";
      setLastError(message);
      onActionError?.(message);
      refreshPermission();
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    setLoading(true);
    setLastError(null);
    try {
      await unregisterFcm();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "停用通知失敗";
      setLastError(message);
      onActionError?.(message);
    } finally {
      setLoading(false);
    }
  }

  const enabled = permission === "granted" && !!token;
  const disabled = supported === false || permission === "denied" || loading || supported === null;
  const hint = supported === false
    ? "此瀏覽器不支援 Web Push。"
    : permission === "denied"
      ? "已被瀏覽器封鎖,請至網址列設定重新允許後再回此頁啟用。"
      : loading
        ? "處理中…"
        : null;

  return (
    <div>
      <div className="push-toggle-row">
        <label
          className={"toggle-pill mono" + (enabled ? " is-on" : "")}
          style={{ opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.checked) void enable();
              else void disable();
            }}
          />
          <span className="toggle-pill-track" aria-hidden>
            <span className="toggle-pill-thumb" />
          </span>
          {enabled ? "推播通知" : "啟用推播通知"}
        </label>
        {hint && <span className="push-hint" style={{ margin: 0 }}>{hint}</span>}
      </div>
      {enabled && (
        <div className="settings-popover-task-grid" aria-label="推播事件" style={{ marginTop: 14, marginLeft: 12, paddingLeft: 12, borderLeft: "2px solid var(--line)", width: "fit-content", alignItems: "stretch" }}>
          {PUSH_EVENT_LABELS.map((item) => {
            const checked = userCfg?.pushEvents[item.key] ?? true;
            return (
              <label
                key={item.key}
                className={"toggle-pill mono" + (checked ? " is-on" : "")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!userCfg || !!pushSaving[item.key]}
                  onChange={(e) => onTogglePushEvent(item.key, e.target.checked)}
                />
                <span className="toggle-pill-track" aria-hidden>
                  <span className="toggle-pill-thumb" />
                </span>
                {item.label}
              </label>
            );
          })}
        </div>
      )}

      {lastError && (
        <div className="mono push-error">
          {lastError}
        </div>
      )}
    </div>
  );
}

function InstallAppSection({ onActionError }: { onActionError?: (message: string) => void }) {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "unavailable") {
        onActionError?.("此瀏覽器無法觸發安裝,請改用瀏覽器選單的「安裝 App」");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-section-title">安裝為 App</div>
      {canInstall && !installed && (
        <div className="push-action-row">
          <button type="button" className="btn" disabled={busy} onClick={() => void onClick()}>
            {busy ? "處理中…" : "安裝 App"}
          </button>
        </div>
      )}
      <div className="push-hint" style={{ margin: 0 }}>
        {installed
          ? "已安裝,直接從 App 圖示開啟即可。"
          : canInstall
            ? "安裝後可全螢幕、推播更穩。"
            : "沒安裝鈕?可能已裝、或瀏覽器不支援。Chrome / Edge 用網址列「⊕」;iOS Safari 走「分享 → 加入主畫面」。"}
      </div>
    </>
  );
}

export function NotificationsTab({
  userCfg,
  pushSaving,
  onTogglePushEvent,
  onActionError,
}: {
  userCfg: UserConfig | null;
  pushSaving: Partial<Record<PushEventKey, boolean>>;
  onTogglePushEvent: (key: PushEventKey, enabled: boolean) => void;
  onActionError?: (message: string) => void;
}) {
  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <InstallAppSection onActionError={onActionError} />
      </div>
      <div className="task-group task-group--primary">
        <div className="settings-section-title">推播通知</div>
        <PushNotificationsSection
          userCfg={userCfg}
          pushSaving={pushSaving}
          onTogglePushEvent={onTogglePushEvent}
          onActionError={onActionError}
        />
      </div>
    </div>
  );
}
