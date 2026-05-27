import { useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../../api";
import { useActiveProjectHash } from "../../hooks/useActiveProject";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useLocalStorageState } from "../../hooks/useLocalStorageState";
import { useUrlParam } from "../../hooks/useUrlParam";
import type { Project } from "../../../shared/types";
import { Crumbs } from "./Crumbs";
import { Actions } from "./Actions";
import { FolderBrowseModal } from "./Overflow";
import "../topbar.css";

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
  const [error, setError] = useState<string | null>(null);
  const projTriggerRef = useRef<HTMLButtonElement>(null);
  const browseCloseRef = useRef<HTMLButtonElement>(null);
  // Browser folder picker — remote(Tailscale)用,native picker 在 host 上跳 user 看不到,
  // 改成 client-side browse:抓 host 上目錄列表,UI 點擊導覽 + 選擇
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseData, setBrowseData] = useState<api.BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  // 失敗時保留試過的 path,讓「重試」可以重打同一個 path,而非變成 dead-end(advisor 2026-05-24 r1)
  const [lastTriedPath, setLastTriedPath] = useState<string | undefined>();

  async function loadBrowse(path?: string) {
    setBrowseLoading(true);
    setLastTriedPath(path);
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
    }
  });

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
    setError(null);
    try {
      const project = await api.openProject(path);
      setHash(project.hash);
      setBrowseOpen(false);
      setBrowseData(null);
      const next = await api.listRecent();
      setRecents(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  const busy = selectPending || removePending || openByPathPending;
  // theme 來源:URL ?theme= override → localStorage → light
  // toggle 寫 localStorage(via hook)並同步 <html> class —
  // index.html inline script 負責第一個 frame,這裡只負責 user 互動切換
  const [urlTheme] = useUrlParam("theme");
  const [storedTheme, setStoredTheme] = useLocalStorageState<string | null>("vibe-pipeline:theme", null);
  const isDark = urlTheme === "dark" || (urlTheme !== "light" && storedTheme === "dark");
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
      <Crumbs
        active={active}
        busy={busy}
        error={error}
        hash={hash}
        open={open}
        projTriggerRef={projTriggerRef}
        recents={recents}
        loadBrowse={loadBrowse}
        removeRecentEntry={removeRecentEntry}
        selectExisting={selectExisting}
        setBrowseOpen={setBrowseOpen}
        setError={setError}
        setOpen={setOpen}
      />
      <span className="topbar-spacer" />
      <Actions hash={hash} isDark={isDark} maxParallel={maxParallel} runningCount={runningCount} settingsSlot={settingsSlot} toggleTheme={toggleTheme} />
      {browseOpen && (
        <FolderBrowseModal
          browseCloseRef={browseCloseRef}
          browseData={browseData}
          browseDialogRef={browseDialogRef}
          browseLoading={browseLoading}
          busy={busy}
          error={error}
          lastTriedPath={lastTriedPath}
          loadBrowse={loadBrowse}
          openByPath={openByPath}
          setBrowseData={setBrowseData}
          setBrowseOpen={setBrowseOpen}
          setError={setError}
        />
      )}
    </div>
  );
}
