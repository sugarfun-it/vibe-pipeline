import { useEffect, useRef, useState } from "react";
import * as api from "../../api/projects";
import { AITab } from "./AITab";
import { NotificationsTab } from "./NotificationsTab";
import { ProjectTab } from "./ProjectTab";
import { SecurityTab } from "./SecurityTab";
import { UpdateTab } from "./UpdateTab";
import { useAuthStatus } from "../auth/useAuthStatus";
import { useUserConfig } from "./useUserConfig";
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
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status: authStatus } = useAuthStatus();
  type TabKey = "project" | "ai" | "notifications" | "update" | "security";
  const [activeTab, setActiveTab] = useState<TabKey>("project");

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

  if (!open) return null;

  const tabs: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: "project", label: "Project" },
    { key: "ai", label: "AI 任務" },
    { key: "notifications", label: "PWA" },
    { key: "update", label: "更新" },
    ...(authStatus?.bound === true ? ([{ key: "security", label: "安全" }] as const) : []),
  ];

  return (
    <div ref={wrapRef} className="settings-popover" role="dialog" aria-label="設定">
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

      <div className="settings-popover-tabs">
        {tabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
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
          >
            已儲存 ✓
          </span>
        )}
      </div>

      <div hidden={activeTab !== "project"}>
        <ProjectTab
          hash={hash}
          onSaved={onSaved}
          onSavedNotify={showSaved}
          onActionError={onActionError}
          onLoadError={setProjectError}
        />
      </div>

      {activeTab === "ai" && (
        <AITab
          userCfg={userCfg}
          userCfgError={userCfgError}
          projectError={projectError}
          onTaskChange={updateTask}
        />
      )}

      {activeTab === "notifications" && (
        <NotificationsTab
          userCfg={userCfg}
          pushSaving={pushSaving}
          onTogglePushEvent={updatePushEvent}
          onActionError={onActionError}
        />
      )}

      {activeTab === "update" && (
        <div className="settings-tab-content">
          <UpdateTab onActionError={onActionError} />
        </div>
      )}

      {activeTab === "security" && authStatus?.bound === true && (
        <SecurityTab status={authStatus} onActionError={onActionError} />
      )}
    </div>
  );
}
