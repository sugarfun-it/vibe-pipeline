import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../shell/AppShell";
import { Rail } from "../../../shell/Rail";
import { TopBar } from "../../../shell/TopBar";
import { EmptyProject } from "../banner/EmptyProject";
import { useQA } from "../../qa/useQA";
import { SettingsButton } from "../misc/SettingsButton";
import { BoardRail } from "./BoardRail";
import { BoardMain } from "./BoardMain";
import { BoardOverlays } from "./BoardOverlays";
import { useInbox } from "../misc/useInbox";
import { ActiveProjectProvider, type ActiveProjectContextValue } from "../../../contexts/ActiveProjectContext";
import { useActiveProjectHash } from "../../../hooks/useActiveProject";
import { useApi } from "../../../hooks/useApi";
import { useTimeout } from "../../../hooks/useTimeout";
import { useUrlParam } from "../../../hooks/useUrlParam";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import * as api from "../../../api";
import type { Pipeline, Ticket } from "../../../../shared/types";
import type { Project } from "../../../../shared/types";
import { InboxColumn } from "../../notifications/InboxColumn";
import "./boardScreen.css";

export function BoardScreen({
  density = "medium",
  startCreating = false,
}: {
  density?: "compact" | "medium";
  startCreating?: boolean;
}) {
  const { hash } = useActiveProjectHash();
  const [project, setProject] = useLocalStorageState<Project | null>(
    `vp-cache:project:${hash ?? "__none__"}`,
    null,
    {
      serialize: (v) => JSON.stringify(v),
      deserialize: (s) => JSON.parse(s) as Project | null,
    },
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeIdRaw, setActiveIdParam] = useUrlParam("pipeline", { push: true });
  const activeId = activeIdRaw ?? "";
  const setActiveId = useCallback(
    (next: string | ((prev: string) => string)) => {
      const resolved = typeof next === "function" ? next(activeId) : next;
      if (resolved === activeId) return;
      setActiveIdParam(resolved || null);
    },
    [activeId, setActiveIdParam],
  );
  const [activeTab, setActiveTab] = useState<"rail" | "focus">("focus");
  const [hashGraceExpired, setHashGraceExpired] = useState(false);
  useTimeout(() => setHashGraceExpired(true), 200);
  const [creating, setCreating] = useState(startCreating);
  const [tick, setTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const qa = useQA(hash);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [splittingTicketId, setSplittingTicketId] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [maxParallel, setMaxParallel] = useState<number>(0);
  const [defaultAutoMerge, setDefaultAutoMerge] = useState<boolean>(false);

  const {
    inboxState,
    setInboxState,
    filter,
    setFilter,
    items,
    highlightId,
    unreadCount,
    markRead,
    dismissNotif,
    markAllRead,
    dismissAllNotifs,
    focusInboxItem,
  } = useInbox(hash);

  // notify* — 統一寫 setActionError(toast)。透過 Context 暴露給深層子組件,不再 props drill。
  const notifyError = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  const notifyWarn = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  const notifyInfo = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);

  function focusNotif(id: string, pipelineId?: string) {
    if (pipelineId) {
      setActiveId(pipelineId);
      setActiveTab("focus");
    }
    focusInboxItem(id);
  }

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCreating(startCreating);
  }, [startCreating]);

  useEffect(() => {
    if (!creating) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCreating(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [creating]);

  useTimeout(() => setActionError(null), actionError ? 6000 : null, [actionError]);

  useEffect(() => {
    const base = "vibe-pipeline";
    if (!project) {
      document.title = base;
      return;
    }
    const projectName = project.name;
    const running = pipelines.find((p) => p.state === "running");
    const blockingNotifs = items.filter((i) => i.sev === "block" && i.unread).length;
    let prefix = "";
    if (blockingNotifs > 0) prefix = `[!${blockingNotifs}] `;
    else if (running) prefix = `[▶] `;
    else if (unreadCount > 0) prefix = `(${unreadCount}) `;
    const main = running ? `${running.name} 跑中` : projectName;
    document.title = `${prefix}${main} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [project, pipelines, items, unreadCount]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hash is the intentional trigger
  const prevHashRef = useRef<string | null>(null);
  useEffect(() => {
    setPopupDismissed(false);
    setActionError(null);
    if (prevHashRef.current !== null && prevHashRef.current !== hash) {
      setActiveId("");
      setPipelines([]);
    }
    prevHashRef.current = hash ?? null;
  }, [hash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a force-refetch trigger
  useEffect(() => {
    if (!hash) {
      setProject(null);
      setPipelines([]);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    api
      .status(hash)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, reloadKey]);

  useEffect(() => {
    if (!creating || !project?.hasGit) {
      return;
    }
    api
      .listBranches(project.hash)
      .then((bs) => setBranches(bs))
      .catch(() => setBranches([]));
  }, [creating, project?.hash, project?.hasGit]);

  const configResult = useApi(
    async () => (project?.hasInit ? await api.getConfig(project.hash) : null),
    { deps: [project?.hash, project?.hasInit, reloadKey] }
  );
  useEffect(() => {
    if (!project?.hasInit) {
      setMaxParallel(0);
      return;
    }
    if (configResult.data) {
      setMaxParallel(configResult.data.defaults.max_parallel);
      setDefaultAutoMerge(!!configResult.data.defaults.auto_merge);
    }
  }, [project, configResult.data]);

  const pipelinesResult = useApi<{ projectHash: string; pipelines: Pipeline[] } | null>(
    async () => {
      if (!project?.hasInit) return null;
      const projectHash = project.hash;
      const arr = await api.listPipelines(projectHash);
      const tsOf = (p: Pipeline): number => {
        if (typeof p.createdAt === "number") return p.createdAt;
        const tsHex = (p.id ?? "").split("-")[0];
        return tsHex && /^[0-9a-f]+$/i.test(tsHex) ? parseInt(tsHex, 16) : 0;
      };
      const sorted = [...((arr as Pipeline[]) ?? [])].sort((a, b) => tsOf(b) - tsOf(a));
      return { projectHash, pipelines: sorted };
    },
    {
      intervalMs: 5000,
      gate: !!project?.hasInit,
      deps: [project?.hash, project?.hasInit, reloadKey],
      cacheKey: hash ? `pipelines:${hash}` : undefined,
    }
  );
  useEffect(() => {
    if (!project?.hasInit || project.hash !== hash) {
      setPipelines([]);
      return;
    }
    const result = pipelinesResult.data;
    if (result?.projectHash === project.hash) {
      const sorted = result.pipelines;
      setPipelines(sorted);
      if (sorted.length > 0) setActiveId((id) => id || sorted[0].id);
    }
  }, [hash, project, pipelinesResult.data]);

  const active = useMemo(() => {
    if (project?.hash !== hash) return undefined;
    return pipelines.find((p) => p.id === activeId) || pipelines[0];
  }, [activeId, hash, pipelines, project?.hash]);

  const handleCreate = useCallback(
    async ({
      name,
      baseBranch,
      autoMerge,
    }: {
      name: string;
      baseBranch: string;
      autoMerge: boolean;
    }) => {
      if (!project) return;
      const body = {
        name,
        branch: "pipeline/" + name,
        baseBranch,
        state: "planning" as const,
        tickets: [],
        autoMerge,
      };
      try {
        const created = (await api.createPipeline(project.hash, body)) as Pipeline;
        setPipelines((arr) => [created, ...arr]);
        setActiveId(created.id);
        setActiveTab("focus");
        setCreating(false);
        notifyInfo(`✓ pipeline "${name}" 已建立`, { pipelineId: created.id });
      } catch (e) {
        notifyError(`建立 pipeline 失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [project, setActiveId, notifyInfo, notifyError],
  );

  const runningCount = pipelines.filter((p) => p.state === "running").length;
  const queuedIds = useMemo(
    () =>
      pipelines
        .filter((p) => p.state === "queued")
        .map((p) => p.id)
        .sort(),
    [pipelines],
  );
  function queuePositionOf(pid: string): number {
    const i = queuedIds.indexOf(pid);
    return i < 0 ? 0 : i + 1;
  }

  const handleConfigSaved = useCallback(
    (cfg: { defaults: { max_parallel: number; auto_merge?: boolean } }) => {
      setMaxParallel(cfg.defaults.max_parallel);
      setDefaultAutoMerge(!!cfg.defaults.auto_merge);
    },
    [],
  );
  const handleStartInit = useCallback(() => setPopupDismissed(false), []);
  const handleSelectPipeline = useCallback((id: string) => {
    setActiveId(id);
    setActiveTab("focus");
  }, [setActiveId]);
  const handleTicketClick = useCallback((t: Ticket) => setOpenTicket(t), []);
  const draftPipelineIds = useMemo(
    () => new Set(qa.drafts.map((d) => d.pipelineId)),
    [qa.drafts],
  );

  const topBar = (
    <TopBar
      runningCount={runningCount}
      maxParallel={maxParallel}
      settingsSlot={
        <SettingsButton hash={hash} onConfigSaved={handleConfigSaved} />
      }
    />
  );
  const inboxAside = (
    <InboxColumn
      state={inboxState}
      setState={setInboxState}
      items={items}
      filter={filter}
      setFilter={setFilter}
      unreadCount={unreadCount}
      highlightId={highlightId}
      onMarkRead={markRead}
      onDismiss={dismissNotif}
      onMarkAllRead={markAllRead}
      onDismissAll={dismissAllNotifs}
      onItemClick={focusNotif}
    />
  );
  const shellRootClass =
    "notif-root is-inbox-" + inboxState + " is-mobile-board is-mobile-tab-" + activeTab;
  const mobileTabBar = (
    <div className="board-mobile-tabs" role="tablist" aria-label="Board panels">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "rail"}
        className={"board-mobile-tab" + (activeTab === "rail" ? " is-active" : "")}
        onClick={() => setActiveTab("rail")}
      >
        Pipeline
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "focus"}
        className={"board-mobile-tab" + (activeTab === "focus" ? " is-active" : "")}
        onClick={() => setActiveTab("focus")}
      >
        Ticket
      </button>
    </div>
  );
  const ctxValue: ActiveProjectContextValue = useMemo(
    () => ({
      hash,
      project,
      setProject,
      reloadKey,
      bumpReload,
      notifyError,
      notifyWarn,
      notifyInfo,
    }),
    [hash, project, setProject, reloadKey, bumpReload, notifyError, notifyWarn, notifyInfo],
  );

  if (!hash) {
    return (
      <ActiveProjectProvider value={ctxValue}>
        <AppShell
          density={density}
          rootClassName={shellRootClass}
          topBar={topBar}
          rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />}
          main={hashGraceExpired
            ? <EmptyProject />
            : <EmptyProject message="載入中…" hint="" pointToTopBar={false} />}
          aside={inboxAside}
          mobileTabBar={mobileTabBar}
        />
      </ActiveProjectProvider>
    );
  }

  if (loadError) {
    return (
      <ActiveProjectProvider value={ctxValue}>
        <AppShell
          density={density}
          rootClassName={shellRootClass}
          topBar={topBar}
          rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />}
          main={<EmptyProject message="找不到這個專案" hint={loadError} />}
          aside={inboxAside}
          mobileTabBar={mobileTabBar}
        />
      </ActiveProjectProvider>
    );
  }

  if (!project) {
    return (
      <ActiveProjectProvider value={ctxValue}>
        <AppShell
          density={density}
          rootClassName={shellRootClass}
          topBar={topBar}
          rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />}
          main={<EmptyProject message="載入中…" hint="" pointToTopBar={false} />}
          aside={inboxAside}
          mobileTabBar={mobileTabBar}
        />
      </ActiveProjectProvider>
    );
  }

  const isUninit = !project.hasInit;

  return (
    <ActiveProjectProvider value={ctxValue}>
      <AppShell
        density={density}
        rootClassName={shellRootClass}
        topBar={topBar}
        rail={
          <BoardRail
            project={project}
            pipelines={pipelines}
            activeId={activeId}
            onSelect={handleSelectPipeline}
            creating={creating}
            setCreating={setCreating}
            isUninit={isUninit}
            onStartInit={handleStartInit}
            draftPipelineIds={draftPipelineIds}
            branches={branches}
            defaultAutoMerge={defaultAutoMerge}
            onCreate={handleCreate}
          />
        }
        main={
          <BoardMain
            project={project}
            pipelines={pipelines}
            setPipelines={setPipelines}
            active={active}
            activeId={activeId}
            setActiveId={setActiveId}
            creating={creating}
            tick={tick}
            queuePosition={queuePositionOf(active?.id ?? "")}
            splittingTicketId={splittingTicketId}
            qaOpen={qa.open}
            qaDraftFor={qa.draftFor}
            onTicketClick={handleTicketClick}
          />
        }
        overlay={
          <BoardOverlays
            project={project}
            pipelines={pipelines}
            setPipelines={setPipelines}
            active={active}
            qa={qa}
            openTicket={openTicket}
            setOpenTicket={setOpenTicket}
            splittingTicketId={splittingTicketId}
            setSplittingTicketId={setSplittingTicketId}
            popupDismissed={popupDismissed}
            setPopupDismissed={setPopupDismissed}
            actionError={actionError}
            setActionError={setActionError}
          />
        }
        aside={inboxAside}
        mobileTabBar={mobileTabBar}
      />
    </ActiveProjectProvider>
  );
}
