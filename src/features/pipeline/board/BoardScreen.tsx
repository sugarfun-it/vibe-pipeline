import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import * as api from "../../../api";
import type { Project } from "../../../../shared/types";
import { InboxColumn } from "../../notifications/InboxColumn";
import { useActivePipeline } from "./useActivePipeline";
import { useBoardNotify } from "./useBoardNotify";
import { useBoardTabs } from "./useBoardTabs";
import { usePipelinesState } from "./usePipelinesState";
import { useProjectMeta } from "./useProjectMeta";
import { useTicketDrawer } from "./useTicketDrawer";
import "./boardScreen.css";

export function BoardScreen({ density = "medium", startCreating = false }: {
  density?: "compact" | "medium";
  startCreating?: boolean;
}) {
  const { hash } = useActiveProjectHash();
  const [project, setProject] = useLocalStorageState<Project | null>(`vp-cache:project:${hash ?? "__none__"}`, null, {
    serialize: (v) => JSON.stringify(v),
    deserialize: (s) => JSON.parse(s) as Project | null,
  });
  const { activeId, setActiveId, hashGraceExpired } = useActivePipeline();
  const { activeTab, setActiveTab, switchToRail, switchToFocus, handleSelectPipeline } = useBoardTabs(setActiveId);
  const [creating, setCreating] = useState(startCreating);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const pipelineState = usePipelinesState({ hash, project, setProject, setActiveId, setPopupDismissed });
  const { loadError, actionError, setActionError, pipelines, setPipelines, tick, reloadKey, bumpReload } = pipelineState;
  const notify = useBoardNotify(setActionError);
  const qa = useQA(hash);
  const ticketDrawer = useTicketDrawer();
  const projectMeta = useProjectMeta({ creating, project, reloadKey });
  const inbox = useInbox(hash);

  function focusNotif(id: string, pipelineId?: string) {
    if (pipelineId) {
      setActiveId(pipelineId);
      setActiveTab("focus");
    }
    inbox.focusInboxItem(id);
  }

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

  useEffect(() => {
    const base = "vibe-pipeline";
    if (!project) {
      document.title = base;
      return;
    }
    const projectName = project.name;
    const running = pipelines.find((p) => p.state === "running");
    const blockingNotifs = inbox.items.filter((i) => i.sev === "block" && i.unread).length;
    let prefix = "";
    if (blockingNotifs > 0) prefix = `[!${blockingNotifs}] `;
    else if (running) prefix = `[▶] `;
    else if (inbox.unreadCount > 0) prefix = `(${inbox.unreadCount}) `;
    const main = running ? `${running.name} 跑中` : projectName;
    document.title = `${prefix}${main} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [project, pipelines, inbox.items, inbox.unreadCount]);

  const active = useMemo(() => {
    if (project?.hash !== hash) return undefined;
    return pipelines.find((p) => p.id === activeId) || pipelines[0];
  }, [activeId, hash, pipelines, project?.hash]);
  const handleCreate = useCallback(async ({ name, baseBranch, autoMerge }: {
    name: string;
    baseBranch: string;
    autoMerge: boolean;
  }) => {
    if (!project) return;
    const body = { name, branch: "pipeline/" + name, baseBranch, state: "planning" as const, tickets: [], autoMerge };
    try {
      const created = await api.createPipeline(project.hash, body);
      setPipelines((arr) => [created, ...arr]);
      setActiveId(created.id);
      setActiveTab("focus");
      setCreating(false);
      notify.info(`✓ pipeline "${name}" 已建立`, { pipelineId: created.id });
    } catch (e) {
      notify.error(`建立 pipeline 失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [project, setActiveId, notify.info, notify.error]);

  const runningCount = pipelines.filter((p) => p.state === "running").length;
  const queuedIds = useMemo(() => pipelines.filter((p) => p.state === "queued").map((p) => p.id).sort(), [pipelines]);
  function queuePositionOf(pid: string): number {
    const i = queuedIds.indexOf(pid);
    return i < 0 ? 0 : i + 1;
  }

  const handleStartInit = useCallback(() => setPopupDismissed(false), []);
  const draftPipelineIds = useMemo(() => new Set(qa.drafts.map((d) => d.pipelineId)), [qa.drafts]);
  const topBar = (
    <TopBar
      runningCount={runningCount}
      maxParallel={projectMeta.maxParallel}
      settingsSlot={<SettingsButton hash={hash} onConfigSaved={projectMeta.handleConfigSaved} />}
    />
  );
  const inboxAside = (
    <InboxColumn
      state={inbox.inboxState}
      setState={inbox.setInboxState}
      items={inbox.items}
      filter={inbox.filter}
      setFilter={inbox.setFilter}
      unreadCount={inbox.unreadCount}
      highlightId={inbox.highlightId}
      onMarkRead={inbox.markRead}
      onDismiss={inbox.dismissNotif}
      onMarkAllRead={inbox.markAllRead}
      onDismissAll={inbox.dismissAllNotifs}
      onItemClick={focusNotif}
    />
  );
  const shellRootClass = "notif-root is-inbox-" + inbox.inboxState + " is-mobile-board is-mobile-tab-" + activeTab;
  const mobileTabBar = (
    <div className="board-mobile-tabs" role="tablist" aria-label="Board panels">
      <button type="button" role="tab" aria-selected={activeTab === "rail"} className={"board-mobile-tab" + (activeTab === "rail" ? " is-active" : "")} onClick={switchToRail}>Pipeline</button>
      <button type="button" role="tab" aria-selected={activeTab === "focus"} className={"board-mobile-tab" + (activeTab === "focus" ? " is-active" : "")} onClick={switchToFocus}>Ticket</button>
    </div>
  );
  const ctxValue: ActiveProjectContextValue = useMemo(() => ({
    hash,
    project,
    setProject,
    reloadKey,
    bumpReload,
    notifyError: notify.error,
    notifyWarn: notify.warn,
    notifyInfo: notify.info,
  }), [hash, project, setProject, reloadKey, bumpReload, notify.error, notify.warn, notify.info]);

  if (!hash || loadError || !project) {
    const main = !hash
      ? hashGraceExpired ? <EmptyProject /> : <EmptyProject message="載入中…" hint="" pointToTopBar={false} />
      : loadError ? <EmptyProject message="找不到這個專案" hint={loadError} /> : <EmptyProject message="載入中…" hint="" pointToTopBar={false} />;
    return (
      <ActiveProjectProvider value={ctxValue}>
        <AppShell density={density} rootClassName={shellRootClass} topBar={topBar} rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />} main={main} aside={inboxAside} mobileTabBar={mobileTabBar} />
      </ActiveProjectProvider>
    );
  }

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
            isUninit={!project.hasInit}
            onStartInit={handleStartInit}
            draftPipelineIds={draftPipelineIds}
            branches={projectMeta.branches}
            defaultAutoMerge={projectMeta.defaultAutoMerge}
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
            splittingTicketId={ticketDrawer.splittingTicketId}
            qaOpen={qa.open}
            qaDraftFor={qa.draftFor}
            onTicketClick={ticketDrawer.handleTicketClick}
          />
        }
        overlay={
          <BoardOverlays
            project={project}
            pipelines={pipelines}
            setPipelines={setPipelines}
            active={active}
            qa={qa}
            openTicket={ticketDrawer.openTicket}
            setOpenTicket={ticketDrawer.setOpenTicket}
            splittingTicketId={ticketDrawer.splittingTicketId}
            setSplittingTicketId={ticketDrawer.setSplittingTicketId}
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
