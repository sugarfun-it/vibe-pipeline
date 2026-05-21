import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { Logo } from "../ui/Logo";
import { CheckIconSm, ChevronIcon, CloseIcon, FolderIcon, MoonIcon, PlusIcon, SunIcon } from "../ui/icons";
import * as api from "../api/projects";
import { useConfirm } from "../ui/ConfirmDialog";
import { useActiveProjectHash } from "../hooks/useActiveProject";
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
  const confirm = useConfirm();
  const [recents, setRecents] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
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
  // theme 來源:URL ?theme= override → localStorage → light
  // toggle 寫 localStorage 並同步 <html> class(useTheme hook 也會跑,雙保險;localStorage 觸發不了 React 重 render,所以這裡也手動 setIsDark)
  const [searchParams] = useSearchParams();
  const urlTheme = searchParams.get("theme");
  const [isDark, setIsDark] = useState(() => {
    if (urlTheme === "dark") return true;
    if (urlTheme === "light") return false;
    try {
      return localStorage.getItem("vibe-pipeline:theme") === "dark";
    } catch {
      return false;
    }
  });
  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    try {
      localStorage.setItem("vibe-pipeline:theme", next ? "dark" : "light");
    } catch {}
    document.documentElement.classList.toggle("light", !next);
  }

  useEffect(() => {
    api
      .listRecent()
      .then(setRecents)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const active = recents.find((p) => p.hash === hash) ?? null;

  async function selectExisting(p: Project) {
    setBusy(true);
    setError(null);
    try {
      const project = await api.openProject(p.path);
      setHash(project.hash);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeRecentEntry(p: Project) {
    if (p.hash === hash) return; // active 不能刪(UI 上 X disabled,雙保險)
    const ok = await confirm({
      title: `從最近專案移除「${p.name}」?`,
      description: `路徑:${p.path}\n\n只移除清單紀錄,不刪除任何專案檔案 / git / .vibe-pipeline/ 內容。下次可重新從「選擇其他資料夾…」加回來。`,
      confirmLabel: "移除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeRecent(p.hash);
      const list = await api.listRecent();
      setRecents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openByPath(path: string) {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("路徑不能空");
      return;
    }
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <Logo size={18} />
          <span>vibe-pipeline</span>
        </div>
        <span className="topbar-sep" />

        <div className="proj-switcher" ref={wrapRef}>
          <button type="button"
            className={"proj-trigger" + (open ? " is-open" : "")}
            onClick={() => setOpen((o) => !o)}
            title="切換專案"
          >
            <FolderIcon />
            <span className="proj-trigger-name">{active?.name ?? "選擇專案"}</span>
            <span className="proj-trigger-path mono">{active?.path ?? "(尚未選擇)"}</span>
            <ChevronIcon />
          </button>
          {open && (
            <div className="proj-menu fade-up" role="menu">
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
                      title={isActive ? "目前使用中的專案不能從清單移除" : "從最近專案清單移除(不刪檔)"}
                      aria-label={isActive ? "目前使用中,不能移除" : `從最近專案移除 ${p.name}`}
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
                <span>選擇其他資料夾…</span>
                <span className="kbd mono proj-menu-shortcut">
                  {isMac() ? "⌘O" : "Ctrl+O"}
                </span>
              </button>
              {error && (
                <div className="proj-menu-label mono proj-menu-error">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {active && (
          <div className="topbar-active-meta">
            {active.hasGit && active.currentBranch && (
              <span
                className="chip mono topbar-current-branch"
                title={`當前 branch: ${active.currentBranch}`}
              >
                <span className="topbar-branch-icon">⎇</span>{" "}
                {active.currentBranch}
              </span>
            )}
            <button type="button"
              className="chip topbar-reveal-folder"
              title="在檔案總管中開啟"
              onClick={() => api.reveal(active.hash).catch(() => {})}
            >
              <FolderIcon />
              <span>開啟專案資料夾</span>
            </button>
          </div>
        )}
      </div>

      <span className="topbar-spacer" />

      <div className="topbar-right">
        <div className="topbar-overflow" ref={overflowRef}>
          <button
            type="button"
            className={"icon-btn topbar-overflow-toggle" + (overflowOpen ? " is-open" : "")}
            onClick={() => setOverflowOpen((o) => !o)}
            title="更多操作"
            aria-label="更多操作"
            aria-expanded={overflowOpen}
          >
            ⋯
          </button>
          <div className={"topbar-overflow-menu" + (overflowOpen ? " is-open" : "")}>
            {active && (
              <div className="topbar-overflow-mobile-items">
                {active.hasGit && active.currentBranch && (
                  <span
                    className="chip mono topbar-overflow-chip"
                    title={`當前 branch: ${active.currentBranch}`}
                  >
                    <span className="topbar-branch-icon">⎇</span>{" "}
                    {active.currentBranch}
                  </span>
                )}
                <button
                  type="button"
                  className="topbar-overflow-item"
                  title="在檔案總管中開啟"
                  onClick={() => {
                    setOverflowOpen(false);
                    api.reveal(active.hash).catch(() => {});
                  }}
                >
                  <FolderIcon />
                  <span>開啟專案資料夾</span>
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
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setBrowseOpen(false);
              setBrowseData(null);
              setError(null);
            }
          }}
        >
          <div className="modal-card browse-modal-card">
            <div className="modal-title">瀏覽資料夾</div>
            <div className="modal-body">
              <div className="mono browse-current-path" title="當前路徑">
                {browseData?.path ?? "(loading…)"}
              </div>
              <div className="browse-toolbar">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.parent ?? undefined)}
                  disabled={!browseData?.parent || browseLoading}
                  title="上一層"
                >
                  ↑ 上層
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.home)}
                  disabled={browseLoading || !browseData?.home}
                  title="跳回 home"
                >
                  🏠 home
                </button>
                {(browseData?.drives.length ?? 0) > 0 && (
                  <>
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
                          title={`切到 ${d}`}
                        >
                          {d.replace("\\", "")}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
              <div className="browse-list">
                {browseLoading ? (
                  <div className="browse-list-placeholder">載入中…</div>
                ) : !browseData ? (
                  <div className="browse-list-placeholder">—</div>
                ) : browseData.entries.length === 0 ? (
                  <div className="browse-list-placeholder">(空資料夾)</div>
                ) : (
                  browseData.entries.map((e) => (
                    <button
                      type="button"
                      key={e.name}
                      onClick={() => {
                        if (!e.isDir) return;
                        const next = browseData.path + (browseData.path.endsWith(browseData.sep) ? "" : browseData.sep) + e.name;
                        void loadBrowse(next);
                      }}
                      disabled={!e.isDir || browseLoading}
                      className="browse-entry"
                    >
                      <span aria-hidden>{e.isDir ? "📁" : "📄"}</span>
                      <span className="browse-entry-name">{e.name}</span>
                    </button>
                  ))
                )}
              </div>
              {error && (
                <div className="browse-error">{error}</div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
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
              >
                {busy ? "開啟中…" : "選擇此資料夾"}
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
          ? `running ${running} 條已超過 max_parallel ${max}(改小不會 kill 既有的)`
          : `同時跑 ${running} / ${max} 條`
      }
      style={{ color }}
    >
      <span className="topbar-branch-icon">▶</span>
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
