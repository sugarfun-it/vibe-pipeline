import type { RefObject } from "react";
import { Popover } from "../../ui/Popover";
import { Logo } from "../../ui/Logo";
import { BranchIcon, CheckIconSm, ChevronIcon, CloseIcon, FolderIcon, PlusIcon } from "../../ui/icons";
import * as api from "../../api";
import type { Project } from "../../../shared/types";
import { isLocalHost } from "../../lib/isLocalHost";
import { isMac } from "./utils";

type CrumbsProps = {
  active: Project | null;
  busy: boolean;
  error: string | null;
  hash: string | null;
  open: boolean;
  projTriggerRef: RefObject<HTMLButtonElement>;
  recents: Project[];
  loadBrowse: (path?: string) => Promise<void>;
  removeRecentEntry: (p: Project) => void;
  selectExisting: (p: Project) => void;
  setBrowseOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
};

export function Crumbs({
  active,
  busy,
  error,
  hash,
  open,
  projTriggerRef,
  recents,
  loadBrowse,
  removeRecentEntry,
  selectExisting,
  setBrowseOpen,
  setError,
  setOpen,
}: CrumbsProps) {
  return (
      <div className="topbar-left">
        <div className="topbar-brand">
          <Logo size={18} />
          <span>vibe-pipeline</span>
        </div>
        <span className="topbar-sep" />

        <div className="proj-switcher">
          <button type="button"
            ref={projTriggerRef}
            className={"proj-trigger" + (open ? " is-open" : "")}
            onClick={() => setOpen((o) => !o)}
            title="切換專案"
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls="proj-menu-popover"
            aria-label={active ? `切換專案（目前：${active.name}）` : "選擇專案"}
          >
            <FolderIcon />
            <span className="proj-trigger-name">{active?.name ?? "選擇專案"}</span>
            <span className="proj-trigger-path mono">{active?.path ?? "(尚未選擇)"}</span>
            <ChevronIcon />
          </button>
          <Popover
            anchorRef={projTriggerRef}
            open={open}
            onClose={() => setOpen(false)}
            placement="bottom-start"
            offset={6}
            role="dialog"
            ariaLabel="切換專案"
            className="menu-surface proj-menu fade-up"
            id="proj-menu-popover"
            autoFocusFirstItem={false}
            manageRovingFocus={false}
          >
              {recents.length > 0 && (
                <div className="proj-menu-label">最近專案</div>
              )}
              {recents.length === 0 && (
                <div className="proj-menu-empty" role="status">
                  尚未開過任何專案
                </div>
              )}
              {recents.map((p) => {
                const isActive = p.hash === hash;
                return (
                  <div key={p.hash} className="proj-menu-row">
                    <button type="button"
                      className={"proj-menu-item" + (isActive ? " is-active" : "")}
                      onClick={() => selectExisting(p)}
                      disabled={busy}
                    >
                      <FolderIcon />
                      <div className="proj-menu-item-text">
                        <div className="proj-menu-item-name">{p.name}</div>
                        <div className="proj-menu-item-path mono">{p.path}</div>
                      </div>
                      <span className="proj-menu-item-meta">
                        {p.hasInit ? "已初始化" : "未初始化"}
                      </span>
                      {isActive && (
                        <span className="proj-menu-check">
                          <CheckIconSm />
                        </span>
                      )}
                    </button>
                    {/* active row 不 render remove button — ✓ 與 X 互斥使用同一個右側 slot,
                        避免兩個 absolute 元素疊在同位置造成槽位語意 / 回歸風險(advisor topbar-r1) */}
                    {!isActive && (
                      <button
                        type="button"
                        className="proj-menu-remove"
                        onClick={() => removeRecentEntry(p)}
                        disabled={busy}
                        title="從最近專案清單移除（不刪檔）"
                        aria-label={`從最近專案移除 ${p.name}`}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                );
              })}
              {recents.length > 0 && <div className="proj-menu-divider" />}
              <button
                type="button"
                className="proj-menu-item proj-menu-item-action"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setBrowseOpen(true);
                  void loadBrowse();
                }}
                disabled={busy}
                title="瀏覽器內導覽 host 上目錄(local + Tailscale 遠端都用同一套)"
              >
                <PlusIcon />
                <span>選擇專案資料夾…</span>
                <span className="kbd mono proj-menu-shortcut">
                  {isMac() ? "⌘O" : "Ctrl+O"}
                </span>
              </button>
              {error && (
                <div className="proj-menu-label mono proj-menu-error">
                  {error}
                </div>
              )}
          </Popover>
        </div>

        {active && (
          <div className="topbar-active-meta">
            {active.hasGit && active.currentBranch && (
              <span
                className="chip mono topbar-current-branch"
                title={`目前分支: ${active.currentBranch}`}
              >
                <span className="topbar-branch-icon"><BranchIcon /></span>{" "}
                {active.currentBranch}
              </span>
            )}
            {isLocalHost() && (
              <button type="button"
                className="chip topbar-reveal-folder"
                title="在系統檔案總管中開啟此專案資料夾"
                aria-label="在系統檔案總管中開啟此專案資料夾"
                onClick={() => api.reveal(active.hash).catch(() => {})}
              >
                <FolderIcon />
                <span>在檔案總管開啟</span>
              </button>
            )}
          </div>
        )}
      </div>
  );
}
