import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Logo } from "../ui/Logo";
import { Popover } from "../ui/Popover";
import { ArrowUpIcon, BranchIcon, CheckIconSm, ChevronIcon, CloseIcon, DotsHorizontalIcon, FileIcon, FolderIcon, HomeIcon, MoonIcon, PlayIcon, PlusIcon, SunIcon } from "../ui/icons";
import * as api from "../api/projects";
import { useActiveProjectHash } from "../hooks/useActiveProject";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { useUrlParam } from "../hooks/useUrlParam";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import type { Project } from "../../shared/types";
import "./topbar.css";

export function TopBar({
  runningCount = 0,
  maxParallel = 0,
  settingsSlot,
}: {
  runningCount?: number;
  maxParallel?: number;
  // shell 是版型容器,settings 屬於 features/ → 由外部(BoardScreen)注入,
  // TopBar 自己不認識 features/settings,維持 shell↛features 的 layering
  settingsSlot?: ReactNode;
} = {}) {
  const { hash, setHash } = useActiveProjectHash();
  const [recents, setRecents] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const projTriggerRef = useRef<HTMLButtonElement>(null);
  const browseCloseRef = useRef<HTMLButtonElement>(null);
  // Browser folder picker — remote(Tailscale)用,native picker 在 host 上跳 user 看不到,
  // 改成 client-side browse:抓 host 上目錄列表,UI 點擊導覽 + 選擇
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseData, setBrowseData] = useState<api.BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  async function loadBrowse(path?: string) {
    setBrowseLoading(true);
    setError(null);
    try {
      const data = await api.browseFolder(path);
      setBrowseData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseLoading(false);
    }
  }

  const [selectExisting, { pending: selectPending }] = useAsyncAction(async (p: Project) => {
    setError(null);
    try {
      const project = await api.openProject(p.path);
      setHash(project.hash);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  // 不 confirm — 只是移清單紀錄(不刪檔 / git / .vibe-pipeline/),重點下次可從「選擇其他資料夾…」加回來,無資料損失。confirm 純摩擦
  const [removeRecentEntry, { pending: removePending }] = useAsyncAction(async (p: Project) => {
    if (p.hash === hash) return; // active 不能刪(UI 上 X disabled,雙保險)
    setError(null);
    try {
      await api.removeRecent(p.hash);
      const list = await api.listRecent();
      setRecents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  const [openByPath, { pending: openByPathPending }] = useAsyncAction(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("路徑不能空");
      return;
    }
    setError(null);
    try {
      const project = await api.openProject(trimmed);
      const list = await api.listRecent();
      setRecents(list);
      setHash(project.hash);
      setBrowseOpen(false);
      setBrowseData(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  const busy = selectPending || removePending || openByPathPending;
  // theme 來源:URL ?theme= override → localStorage → light
  // toggle 寫 localStorage(via hook)並同步 <html> class —
  // index.html inline script 負責第一個 frame,這裡只負責 user 互動切換
  const [urlTheme] = useUrlParam("theme");
  const [storedTheme, setStoredTheme] = useLocalStorageState<string | null>(
    "vibe-pipeline:theme",
    null,
  );
  const isDark =
    urlTheme === "dark" || (urlTheme !== "light" && storedTheme === "dark");
  function toggleTheme() {
    const next = !isDark;
    setStoredTheme(next ? "dark" : "light");
    document.documentElement.classList.toggle("light", !next);
  }

  useEffect(() => {
    api
      .listRecent()
      .then(setRecents)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!overflowOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  // ⌘O / Ctrl+O 開瀏覽資料夾 modal(對應 menu 裡的 kbd hint)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 不放 deps 避免每 render 重綁聽器
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        if (busy) return;
        setError(null);
        setBrowseOpen(true);
        void loadBrowse();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Browse modal:Escape 關閉 + 開啟時 initial focus 落在 modal body 第一個可導覽 button
  // (上層 / 首頁 / 磁碟切換),沒有可用導覽時 fallback 到「取消」。比舊版直接落 「取消」
  // 更符合 "user 是為了瀏覽 / 選資料夾才開這個 modal" 的常見路徑(advisor topbar-009)
  // + Tab/Shift+Tab 焦點 trap 在 modal 內(無障礙 modal 標準行為)
  // + 關閉時 focus 還給 proj-trigger
  const browseDialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!browseOpen) return;
    function getFocusable(): HTMLElement[] {
      const root = browseDialogRef.current;
      if (!root) return [];
      const nodes = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        setBrowseOpen(false);
        setBrowseData(null);
        setError(null);
        return;
      }
      if (e.key === "Tab") {
        const focusables = getFocusable();
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (activeEl === first || !browseDialogRef.current?.contains(activeEl)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (activeEl === last || !browseDialogRef.current?.contains(activeEl)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      const root = browseDialogRef.current;
      const navBtn = root?.querySelector<HTMLButtonElement>(".browse-toolbar button:not([disabled])");
      if (navBtn) navBtn.focus();
      else browseCloseRef.current?.focus();
    }, 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [browseOpen, busy]);

  // browse data 載入完(toolbar 上層 / 首頁 / drive 才會 enabled)後,若 focus 還停在 fallback
  // 「取消」上,把 focus 推到第一個可用的導覽 button — 修 advisor r2 topbar-009 的 race:
  // 50ms timeout 觸發時可能 browseData 還沒到,nav 都 disabled,fallback 到取消後 user 卡死在
  // 末端 action。等資料到再校正一次。
  useEffect(() => {
    if (!browseOpen || !browseData) return;
    const root = browseDialogRef.current;
    if (!root) return;
    const navBtn = root.querySelector<HTMLButtonElement>(".browse-toolbar button:not([disabled])");
    if (!navBtn) return;
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl === browseCloseRef.current) {
      navBtn.focus();
    }
  }, [browseOpen, browseData]);

  // modal 關掉後把 focus 還給 proj-trigger(只在從 open → closed 轉換時)
  const wasBrowseOpen = useRef(false);
  useEffect(() => {
    if (wasBrowseOpen.current && !browseOpen) {
      projTriggerRef.current?.focus();
    }
    wasBrowseOpen.current = browseOpen;
  }, [browseOpen]);

  const active = recents.find((p) => p.hash === hash) ?? null;


  return (
    <div className="topbar">
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
            className="proj-menu fade-up"
            id="proj-menu-popover"
            autoFocusFirstItem={false}
            manageRovingFocus={false}
          >
              <div className="proj-menu-label mono">最近專案</div>
              {recents.length === 0 && (
                <div className="proj-menu-label mono proj-menu-label--empty">
                  (還沒開過任何專案)
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
                      <span className="proj-menu-item-meta mono">
                        {p.hasInit ? "已初始化" : "未初始化"}
                      </span>
                      {isActive && (
                        <span className="proj-menu-check">
                          <CheckIconSm />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="proj-menu-remove"
                      onClick={() => removeRecentEntry(p)}
                      disabled={busy || isActive}
                      title={isActive ? "目前使用中的專案不能從清單移除" : "從最近專案清單移除（不刪檔）"}
                      aria-label={isActive ? "目前使用中，不能移除" : `從最近專案移除 ${p.name}`}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
              <div className="proj-menu-divider" />
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
            <button type="button"
              className="chip topbar-reveal-folder"
              title="在系統檔案總管中開啟此專案資料夾"
              aria-label="在系統檔案總管中開啟此專案資料夾"
              onClick={() => api.reveal(active.hash).catch(() => {})}
            >
              <FolderIcon />
              <span>在檔案總管開啟</span>
            </button>
          </div>
        )}
      </div>

      <span className="topbar-spacer" />

      <div className="topbar-right">
        <div className={"topbar-overflow" + (overflowOpen ? " is-open" : "")} ref={overflowRef}>
          <button
            type="button"
            className={"icon-btn topbar-overflow-toggle" + (overflowOpen ? " is-open" : "")}
            onClick={() => setOverflowOpen((o) => !o)}
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="true"
            aria-expanded={overflowOpen}
            aria-controls="topbar-overflow-menu-popover"
          >
            <DotsHorizontalIcon />
          </button>
          {/* role="group" + aria-label 表達「相關控制群」語義,避免 role="menu" 的嚴格
              menuitem 鍵盤模型(menu 內混了 chip 狀態 + theme/settings 動作,不適合 menubar
              keyboard contract;advisor r2 topbar-002 建議改 popover/group pattern) */}
          <div
            id="topbar-overflow-menu-popover"
            role="group"
            aria-label="更多操作"
            className={"topbar-overflow-menu" + (overflowOpen ? " is-open" : "")}
          >
            {active && (
              <div className="topbar-overflow-mobile-items">
                {active.hasGit && active.currentBranch && (
                  <span
                    className="chip mono topbar-overflow-chip"
                    title={`目前分支: ${active.currentBranch}`}
                  >
                    <span className="topbar-branch-icon"><BranchIcon /></span>{" "}
                    {active.currentBranch}
                  </span>
                )}
                <button
                  type="button"
                  className="topbar-overflow-item"
                  title="在系統檔案總管中開啟此專案資料夾"
                  onClick={() => {
                    setOverflowOpen(false);
                    api.reveal(active.hash).catch(() => {});
                  }}
                >
                  <FolderIcon />
                  <span>在檔案總管開啟</span>
                </button>
              </div>
            )}
            {hash && maxParallel > 0 && (
              <ParallelChip running={runningCount} max={maxParallel} />
            )}
            <button type="button"
              className="icon-btn topbar-theme-toggle"
              onClick={toggleTheme}
              title={isDark ? "切到亮色" : "切到暗色"}
              aria-label={isDark ? "切到亮色主題" : "切到暗色主題"}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
            {settingsSlot}
          </div>
        </div>
      </div>
      {browseOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="browse-modal-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setBrowseOpen(false);
              setBrowseData(null);
              setError(null);
            }
          }}
        >
          <div className="modal-card browse-modal-card" ref={browseDialogRef}>
            <div className="browse-modal-head">
              <div id="browse-modal-title" className="modal-title">選擇專案資料夾</div>
              <button
                type="button"
                className="icon-btn browse-modal-close"
                onClick={() => {
                  if (busy) return;
                  setBrowseOpen(false);
                  setBrowseData(null);
                  setError(null);
                }}
                disabled={busy}
                title="關閉"
                aria-label="關閉「選擇專案資料夾」對話框"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="modal-body">
              <div className="browse-path-row">
                <span className="browse-path-label" id="browse-path-label">目前位置</span>
                <div
                  className="mono browse-current-path"
                  aria-labelledby="browse-path-label"
                  aria-live="polite"
                  title={browseData?.path ?? "載入中"}
                >
                  {browseData?.path ?? "(載入中…)"}
                </div>
              </div>
              <div className="browse-toolbar" role="toolbar" aria-label="資料夾導覽">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.parent ?? undefined)}
                  disabled={!browseData?.parent || browseLoading}
                  title="回到上一層資料夾"
                  aria-label="回到上一層資料夾"
                >
                  <ArrowUpIcon /> 上層
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.home)}
                  disabled={browseLoading || !browseData?.home}
                  title="跳回使用者家目錄"
                  aria-label="跳回使用者家目錄"
                >
                  <HomeIcon /> 首頁
                </button>
                {(browseData?.drives.length ?? 0) > 0 && (
                  <span className="browse-drives-group">
                    <span className="browse-drives-label">磁碟:</span>
                    {browseData!.drives.map((d) => {
                      const active = browseData?.path.toUpperCase().startsWith(d.toUpperCase());
                      return (
                        <button
                          key={d}
                          type="button"
                          className={"btn browse-drive-btn" + (active ? " is-active" : "")}
                          onClick={() => void loadBrowse(d)}
                          disabled={browseLoading}
                          title={`切到磁碟 ${d}`}
                          aria-label={`切到磁碟 ${d}`}
                          aria-pressed={active ? true : false}
                        >
                          {d.replace("\\", "")}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
              <ul className="browse-list" role="list" aria-label="資料夾內容">
                {browseLoading ? (
                  <li className="browse-list-placeholder">載入中…</li>
                ) : !browseData ? (
                  <li className="browse-list-placeholder">—</li>
                ) : browseData.entries.length === 0 ? (
                  <li className="browse-list-placeholder">(空資料夾)</li>
                ) : (
                  browseData.entries.map((e) => (
                    <li key={e.name} role="listitem">
                      <button
                        type="button"
                        onClick={() => {
                          if (!e.isDir) return;
                          const next = browseData.path + (browseData.path.endsWith(browseData.sep) ? "" : browseData.sep) + e.name;
                          void loadBrowse(next);
                        }}
                        disabled={!e.isDir || browseLoading}
                        className="browse-entry"
                        aria-label={e.isDir ? `開啟資料夾 ${e.name}` : `${e.name}(檔案,不可選)`}
                      >
                        <span aria-hidden>{e.isDir ? <FolderIcon /> : <FileIcon />}</span>
                        <span className="browse-entry-name">{e.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {error && (
                <div className="browse-error" role="alert">{error}</div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                ref={browseCloseRef}
                className="btn"
                onClick={() => {
                  if (busy) return;
                  setBrowseOpen(false);
                  setBrowseData(null);
                  setError(null);
                }}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => browseData && void openByPath(browseData.path)}
                disabled={busy || !browseData}
                title={browseData ? `將「${browseData.path}」設為目前專案` : undefined}
              >
                {busy ? "開啟中…" : "選擇目前資料夾"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// N/M chip:過載(N>M,max_parallel 改小但已起的不 kill)時加括號標記
function ParallelChip({ running, max }: { running: number; max: number }) {
  const overload = running > max;
  const color = overload
    ? "var(--failed)"
    : running >= max && running > 0
    ? "var(--queued)"
    : running > 0
    ? "var(--running)"
    : "var(--fg-mute)";
  return (
    <span
      className="chip mono parallel-chip"
      title={
        overload
          ? `正在執行 ${running} 條，已超過上限 ${max}（改小不會中止既有的）`
          : `同時執行 ${running} / ${max} 條`
      }
      aria-label={
        overload
          ? `正在執行 ${running} 條，已超過上限 ${max}`
          : `同時執行 ${running} / ${max} 條`
      }
      style={{ color }}
    >
      <span className="topbar-branch-icon"><PlayIcon /></span>
      {running}/{max}
      {overload && <span className="parallel-chip-overload">!</span>}
    </span>
  );
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // 用 userAgentData (新版瀏覽器) 或 fallback 到 platform/userAgent
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}
