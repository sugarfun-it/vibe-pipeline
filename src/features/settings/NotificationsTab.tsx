import { useEffect, useId, useState } from "react";
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
  { key: "auto_merge_conflict", label: "衝突交由 AI 處理" },
];

type PushState =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "default" }
  | { kind: "granted" };

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

  const state: PushState =
    supported === null
      ? { kind: "checking" }
      : supported === false
        ? { kind: "unsupported" }
        : permission === "denied"
          ? { kind: "denied" }
          : permission === "granted" && !!token
            ? { kind: "granted" }
            : { kind: "default" };

  const enabled = state.kind === "granted";
  const disabled = state.kind !== "default" && state.kind !== "granted" || loading;
  const isBusy = loading || state.kind === "checking";

  const stateId = useId();
  const stateBlockId = `${stateId}-state`;

  return (
    <div className="push-section" aria-busy={isBusy || undefined}>
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
            role="switch"
            checked={enabled}
            disabled={disabled}
            aria-checked={enabled}
            aria-describedby={stateBlockId}
            onChange={(e) => {
              if (e.target.checked) void enable();
              else void disable();
            }}
          />
          <span className="toggle-pill-track" aria-hidden>
            <span className="toggle-pill-thumb" />
          </span>
          {enabled
            ? "推播通知已啟用"
            : loading
              ? "處理中…"
              : "啟用推播通知"}
        </label>
      </div>

      <PushStateBlock state={state} loading={loading} id={stateBlockId} />

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
                  role="switch"
                  aria-checked={checked}
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

function PushStateBlock({
  state,
  loading,
  id,
}: {
  state: PushState;
  loading: boolean;
  id: string;
}) {
  if (loading) {
    return (
      <div
        id={id}
        className="push-state push-state--info"
        role="status"
        aria-live="polite"
      >
        <div className="push-state-title">處理中…</div>
        <div className="push-state-sub">
          正在更新此裝置的推播設定，請稍候。
        </div>
      </div>
    );
  }
  switch (state.kind) {
    case "checking":
      return (
        <div
          id={id}
          className="push-state push-state--info"
          role="status"
          aria-live="polite"
        >
          <div className="push-state-title">檢查推播支援中…</div>
          <div className="push-state-sub">
            正在確認此瀏覽器是否支援 Web Push。
          </div>
        </div>
      );
    case "unsupported":
      return (
        <div
          id={id}
          className="push-state push-state--error"
          role="status"
          aria-live="polite"
        >
          <div className="push-state-head">
            <span className="push-state-badge">不支援</span>
            <div className="push-state-title">此瀏覽器不支援 Web Push</div>
          </div>
          <div className="push-state-sub">
            可改用桌面 Chrome / Edge / Firefox，或將本站安裝為 App 後再嘗試啟用。
          </div>
        </div>
      );
    case "denied":
      return (
        <div
          id={id}
          className="push-state push-state--error"
          role="status"
          aria-live="polite"
        >
          <div className="push-state-head">
            <span className="push-state-badge">已封鎖</span>
            <div className="push-state-title">已被瀏覽器封鎖</div>
          </div>
          <div className="push-state-sub">
            請先在瀏覽器解除封鎖，再回此頁啟用推播：
          </div>
          <ul className="push-state-steps">
            <li>
              <strong>Chrome / Edge</strong>：點網址列左側的鎖頭或調整圖示 → 網站設定 → 通知 → 改為「允許」。
            </li>
            <li>
              <strong>Safari</strong>：「Safari → 設定 → 網站 → 通知」找到本站並改為「允許」。
            </li>
            <li>解除後重新整理此頁，再回到此設定啟用。</li>
          </ul>
        </div>
      );
    case "default":
      return (
        <div
          id={id}
          className="push-state push-state--neutral"
          role="status"
          aria-live="polite"
        >
          <div className="push-state-title">尚未啟用</div>
          <div className="push-state-sub">
            開啟後可選擇接收哪些事件。瀏覽器會先詢問通知權限。
          </div>
        </div>
      );
    case "granted":
      return (
        <div
          id={id}
          className="push-state push-state--ok"
          role="status"
          aria-live="polite"
        >
          <div className="push-state-head">
            <span className="push-state-badge push-state-badge--ok">已啟用</span>
            <div className="push-state-title">已啟用此裝置的推播</div>
          </div>
          <div className="push-state-sub">
            下方可選擇要接收哪些事件，變更會自動儲存。
          </div>
        </div>
      );
  }
}

function InstallAppSection() {
  const { toast } = useToast();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  const [onClick, { pending: busy }] = useAsyncAction(async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") {
      toast("此瀏覽器無法觸發安裝，請改用瀏覽器選單的「安裝 App」", { variant: "danger" });
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
        <div className="settings-section-title">推播通知</div>
        <PushNotificationsSection
          userCfg={userCfg}
          pushSaving={pushSaving}
          onTogglePushEvent={onTogglePushEvent}
        />
      </div>
      <div className="task-group task-group--primary">
        <InstallAppSection />
      </div>
    </div>
  );
}
