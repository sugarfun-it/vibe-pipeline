import { useEffect, useId, useRef, useState } from "react";
import * as api from "../../api";
import { Popover } from "../../ui/Popover";
import { AITab } from "./AITab";
import { NotificationsTab } from "./NotificationsTab";
import { ProjectTab } from "./ProjectTab";
import { UpdateTab } from "./UpdateTab";
import { useUserConfig } from "./useUserConfig";
import { CheckIconSm, CloseIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import "../../styles/drawer.css";
import "./SettingsPopover.css";

const SAVED_VISIBLE_MS = 3000;

export function SettingsPopover({
  hash,
  open,
  onClose,
  onSaved,
  anchorRef,
}: {
  hash: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (cfg: api.ProjectConfig) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const { toast } = useToast();
  const [savedVisible, setSavedVisible] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [savedFading, setSavedFading] = useState(false);
  const tablistRef = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  type TabKey = "project" | "ai" | "notifications" | "update";
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
    toast(message, { variant: "danger" });
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

  const { userCfg, pushSaving, updateTask, updatePushEvent } = useUserConfig({
    open,
    onSaved: showSaved,
    onSaveError: toastSaveError,
  });

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // 開啟時把焦點移到目前 tab(SR / 鍵盤入口);關閉走 Popover restoreFocus。
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const el = tablistRef.current?.querySelector<HTMLButtonElement>(
        ".settings-popover-tab.is-active",
      );
      el?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const tabs: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: "project", label: "專案" },
    { key: "ai", label: "AI 任務" },
    { key: "notifications", label: "通知" },
    { key: "update", label: "更新" },
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

  // Tab 面板渲染走 switch + never default:加第 5 個 tab 卻忘了補 case 會編譯即 fail。
  // project 面板一律掛載(用 hidden 切顯隱)以保留 ProjectTab 的載入 / autosave / draft 狀態,
  // 故 project case 回傳 null,實際面板在 switch 外另行掛載。
  function renderActivePanel() {
    switch (activeTab) {
      case "project":
        return null;
      case "ai":
        return (
          <div role="tabpanel" id={panelId("ai")} aria-labelledby={tabId("ai")}>
            <AITab userCfg={userCfg} onTaskChange={updateTask} />
          </div>
        );
      case "notifications":
        return (
          <div role="tabpanel" id={panelId("notifications")} aria-labelledby={tabId("notifications")}>
            <NotificationsTab
              userCfg={userCfg}
              pushSaving={pushSaving}
              onTogglePushEvent={updatePushEvent}
            />
          </div>
        );
      case "update":
        return (
          <div
            role="tabpanel"
            id={panelId("update")}
            aria-labelledby={tabId("update")}
            className="settings-tab-content"
          >
            <UpdateTab />
          </div>
        );
      default: {
        const _exhaustive: never = activeTab;
        return _exhaustive;
      }
    }
  }

  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      placement="bottom-end"
      offset={6}
      role="dialog"
      ariaLabel="設定"
      className="settings-popover"
      autoFocusFirstItem={false}
      manageRovingFocus={false}
    >
      <div className="settings-popover-header">
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
        </div>
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
        <button
          type="button"
          className="drawer-close settings-popover-close"
          onClick={onClose}
          aria-label="關閉設定"
          title="關閉"
        >
          <CloseIcon width="16" height="16" aria-hidden="true" focusable="false" />
        </button>
      </div>

      <div
        role="tabpanel"
        id={panelId("project")}
        aria-labelledby={tabId("project")}
        hidden={activeTab !== "project"}
      >
        {activeTab === "project" && projectLoadError && (
          <div className="settings-tab-content">
            <span className="settings-subhint settings-subhint--error" role="alert">
              載入專案設定失敗：{projectLoadError}
            </span>
          </div>
        )}
        <ProjectTab
          hash={hash}
          onSaved={onSaved}
          onSavedNotify={showSaved}
          onLoadError={(message) => {
            setProjectLoadError(message);
            if (message) toast(`載入專案設定失敗：${message}`, { variant: "danger" });
          }}
        />
      </div>

      {renderActivePanel()}
    </Popover>
  );
}
