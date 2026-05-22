import { useEffect, useId, useRef, useState } from "react";
import * as api from "../../api/projects";
import { AITab } from "./AITab";
import { NotificationsTab } from "./NotificationsTab";
import { ProjectTab } from "./ProjectTab";
import { SecurityTab } from "../auth/SecurityTab";
import { UpdateTab } from "./UpdateTab";
import { useAuthStatus } from "../auth/useAuthStatus";
import { useUserConfig } from "./useUserConfig";
import { CheckIconSm } from "../../ui/icons";
import "./SettingsPopover.css";

const SAVED_VISIBLE_MS = 3000;

export function SettingsPopover({
  hash,
  open,
  onClose,
  onSaved,
  onActionError,
  anchorRef,
}: {
  hash: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (cfg: api.ProjectConfig) => void;
  onActionError?: (message: string) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedFading, setSavedFading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status: authStatus } = useAuthStatus();
  type TabKey = "project" | "ai" | "notifications" | "update" | "security";
  const [activeTab, setActiveTab] = useState<TabKey>("project");
  const baseId = useId();
  const tabId = (k: TabKey) => `${baseId}-tab-${k}`;
  const panelId = (k: TabKey) => `${baseId}-panel-${k}`;

  function isAbortError(e: unknown): boolean {
    return e instanceof Error && e.name === "AbortError";
  }

  function toastSaveError(e: unknown) {
    if (isAbortError(e)) return;
    const message = e instanceof Error && e.message ? e.message : "儲存失敗，請重試";
    onActionError?.(message);
  }

  function showSaved() {
    setSavedVisible(true);
    setSavedFading(false);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedFading(true), SAVED_VISIBLE_MS);
  }

  function onSavedTransitionEnd(e: React.TransitionEvent<HTMLSpanElement>) {
    if (e.propertyName !== "opacity" || !savedFading) return;
    setSavedVisible(false);
    setSavedFading(false);
  }

  const { userCfg, userCfgError, pushSaving, updateTask, updatePushEvent } = useUserConfig({
    open,
    onSaved: showSaved,
    onSaveError: toastSaveError,
  });

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  // 開啟時把焦點移到目前 tab(SR / 鍵盤入口);關閉時還焦點給觸發按鈕。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const t = window.setTimeout(() => {
        const el = tablistRef.current?.querySelector<HTMLButtonElement>(
          ".settings-popover-tab.is-active",
        );
        el?.focus();
      }, 30);
      wasOpenRef.current = true;
      return () => window.clearTimeout(t);
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      anchorRef.current?.focus?.();
    }
  }, [open, anchorRef]);

  if (!open) return null;

  const tabs: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: "project", label: "專案" },
    { key: "ai", label: "AI 任務" },
    { key: "notifications", label: "通知" },
    { key: "update", label: "更新" },
    ...(authStatus?.bound === true ? ([{ key: "security", label: "安全" }] as const) : []),
  ];

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const len = tabs.length;
    let next = idx;
    if (e.key === "ArrowLeft") next = (idx - 1 + len) % len;
    else if (e.key === "ArrowRight") next = (idx + 1) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    const nextKey = tabs[next].key;
    setActiveTab(nextKey);
    window.setTimeout(() => {
      tablistRef.current?.querySelector<HTMLButtonElement>(
        `[data-tab-key="${nextKey}"]`,
      )?.focus();
    }, 0);
  }

  return (
    <div ref={wrapRef} className="settings-popover" role="dialog" aria-modal="false" aria-label="設定">
      <button
        type="button"
        className="settings-popover-close"
        onClick={onClose}
        aria-label="關閉設定"
        title="關閉"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      <div
        ref={tablistRef}
        className="settings-popover-tabs"
        role="tablist"
        aria-label="設定分頁"
      >
        {tabs.map((t, idx) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={tabId(t.key)}
              aria-selected={isActive}
              aria-controls={panelId(t.key)}
              tabIndex={isActive ? 0 : -1}
              data-tab-key={t.key}
              onClick={() => setActiveTab(t.key)}
              onKeyDown={(e) => onTabKey(e, idx)}
              className={"settings-popover-tab" + (isActive ? " is-active" : "")}
            >
              {t.label}
            </button>
          );
        })}
        <span className="settings-popover-tabs-spacer" />
        {savedVisible && (
          <span
            className={"chip settings-popover-saved" + (savedFading ? " is-fading" : "")}
            onTransitionEnd={onSavedTransitionEnd}
            role="status"
            aria-live="polite"
          >
            已儲存 <CheckIconSm aria-hidden />
          </span>
        )}
      </div>

      <div
        role="tabpanel"
        id={panelId("project")}
        aria-labelledby={tabId("project")}
        hidden={activeTab !== "project"}
      >
        <ProjectTab
          hash={hash}
          onSaved={onSaved}
          onSavedNotify={showSaved}
          onActionError={onActionError}
          onLoadError={setProjectError}
        />
      </div>

      {activeTab === "ai" && (
        <div role="tabpanel" id={panelId("ai")} aria-labelledby={tabId("ai")}>
          <AITab
            userCfg={userCfg}
            userCfgError={userCfgError}
            projectError={projectError}
            onTaskChange={updateTask}
          />
        </div>
      )}

      {activeTab === "notifications" && (
        <div role="tabpanel" id={panelId("notifications")} aria-labelledby={tabId("notifications")}>
          <NotificationsTab
            userCfg={userCfg}
            pushSaving={pushSaving}
            onTogglePushEvent={updatePushEvent}
            onActionError={onActionError}
          />
        </div>
      )}

      {activeTab === "update" && (
        <div role="tabpanel" id={panelId("update")} aria-labelledby={tabId("update")} className="settings-tab-content">
          <UpdateTab onActionError={onActionError} />
        </div>
      )}

      {activeTab === "security" && authStatus?.bound === true && (
        <div role="tabpanel" id={panelId("security")} aria-labelledby={tabId("security")}>
          <SecurityTab status={authStatus} onActionError={onActionError} />
        </div>
      )}
    </div>
  );
}
