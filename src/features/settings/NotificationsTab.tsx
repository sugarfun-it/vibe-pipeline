import { useEffect, useState } from "react";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import {
  getPermission,
  getStoredToken,
  isFcmSupported,
  requestAndRegisterToken,
  unregisterToken as unregisterFcm,
} from "../../lib/fcm";
import type { PushEventKey, UserConfig } from "../../../shared/types";
import { useToast } from "../../ui/Toast";
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
}: {
  userCfg: UserConfig | null;
  pushSaving: Partial<Record<PushEventKey, boolean>>;
  onTogglePushEvent: (key: PushEventKey, enabled: boolean) => void;
}) {
  const { toast } = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(getPermission());
  const [token, setToken] = useState<string | null>(getStoredToken());

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

  const [enable, { pending: enabling }] = useAsyncAction(async () => {
    try {
      await requestAndRegisterToken();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "啟用通知失敗";
      toast(message, { variant: "danger" });
      refreshPermission();
      throw e;
    }
  });

  const [disable, { pending: disabling }] = useAsyncAction(async () => {
    try {
      await unregisterFcm();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "停用通知失敗";
      toast(message, { variant: "danger" });
      throw e;
    }
  });

  const loading = enabling || disabling;

  const enabled = permission === "granted" && !!token;
  const disabled = supported === false || permission === "denied" || loading || supported === null;
  const hint = supported === false
    ? "此瀏覽器不支援 Web Push。"
    : permission === "denied"
      ? "已被瀏覽器封鎖，請至網址列設定重新允許後再回此頁啟用。"
      : loading
        ? "處理中…"
        : null;
  const blockedBadge = supported === false
    ? "不支援"
    : permission === "denied"
      ? "已封鎖"
      : null;

  const hintId = "push-toggle-hint";
  return (
    <div>
      <div className="push-toggle-row">
        <label
          className={
            "toggle-pill mono" +
            (enabled ? " is-on" : "") +
            (disabled ? " is-disabled" : "")
          }
          aria-disabled={disabled || undefined}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            aria-describedby={hint ? hintId : undefined}
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
        {blockedBadge && (
          <span className="push-blocked-badge" aria-hidden>
            {blockedBadge}
          </span>
        )}
        {hint && (
          <span id={hintId} className="push-hint push-hint--inline">
            {hint}
          </span>
        )}
      </div>
      {enabled && (
        <div className="settings-popover-task-grid push-events-grid" aria-label="推播事件">
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

    </div>
  );
}

function InstallAppSection() {
  const { toast } = useToast();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  const [onClick, { pending: busy }] = useAsyncAction(async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") {
      toast("此瀏覽器無法觸發安裝,請改用瀏覽器選單的「安裝 App」", { variant: "danger" });
    }
  });

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
      <div className="push-hint push-hint--inline">
        {installed ? (
          "已安裝，直接從 App 圖示開啟即可。"
        ) : canInstall ? (
          "安裝後可全螢幕、推播更穩。"
        ) : (
          <>
            此瀏覽器未提供安裝按鈕。可能已安裝過，或需從瀏覽器手動安裝：
            <ul className="push-hint-list">
              <li>Chrome / Edge：點網址列右側的安裝圖示（⊕）。</li>
              <li>iOS Safari：點下方「分享」→「加入主畫面」。</li>
            </ul>
          </>
        )}
      </div>
    </>
  );
}

export function NotificationsTab({
  userCfg,
  pushSaving,
  onTogglePushEvent,
}: {
  userCfg: UserConfig | null;
  pushSaving: Partial<Record<PushEventKey, boolean>>;
  onTogglePushEvent: (key: PushEventKey, enabled: boolean) => void;
}) {
  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <InstallAppSection />
      </div>
      <div className="task-group task-group--primary">
        <div className="settings-section-title">推播通知</div>
        <PushNotificationsSection
          userCfg={userCfg}
          pushSaving={pushSaving}
          onTogglePushEvent={onTogglePushEvent}
        />
      </div>
    </div>
  );
}
