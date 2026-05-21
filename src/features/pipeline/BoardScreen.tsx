import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { Rail } from "../../shell/Rail";
import type { RailMenuItem } from "../../shell/Rail";
import { useConfirm } from "../../ui/ConfirmDialog";
import { TrashIcon } from "../../ui/icons";
import { TopBar } from "../../shell/TopBar";
import { FocusColumn } from "./FocusColumn";
import { TicketDrawer } from "./TicketDrawer";
import { CreateCard, CreatePlaceholder } from "../pipelineCreate/CreateCard";
import { EmptyProject } from "./EmptyProject";
import { InitPopup } from "../init/InitPopup";
import { InboxColumn } from "../notifications/InboxColumn";
import { QADrawer } from "../qa/QADrawer";
import { useQA } from "../qa/useQA";
import { SettingsPopover } from "../settings/SettingsPopover";
import { GearIcon } from "../../ui/icons";
import type { NotifItem } from "../../types/notif";
import { useActiveProjectHash } from "../../hooks/useActiveProject";
import { useApi } from "../../hooks/useApi";
import * as api from "../../api/projects";
import * as qaApi from "../../api/qa";
import type { Pipeline, Ticket } from "../../types/pipeline";
import type { Project } from "../../../shared/types";
import type { InboxFilter, InboxState } from "../../types/notif";

export function BoardScreen({
  density = "medium",
  startCreating = false,
}: {
  density?: "compact" | "medium";
  startCreating?: boolean;
}) {
  const { hash } = useActiveProjectHash();
  // PWA reload 體感 — mount 時從 localStorage hydrate 上次 project snapshot,避免 !project 全屏「載入中…」一閃
  const [project, setProject] = useState<Project | null>(() => {
    if (!hash) return null;
    try {
      const raw = localStorage.getItem(`vp-cache:project:${hash}`);
      return raw ? (JSON.parse(raw) as Project) : null;
    } catch {
      return null;
    }
  });
  // 切兩種 error:
  // - loadError = 開專案時 status fetch 失敗 → 全屏 EmptyProject
  // - actionError = 跑 / 暫停 / 刪 / 建 等動作失敗 → top banner 顯示+自動消
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  // activeId 持久化到 URL ?pipeline=<id> — F5 / 分享連結 / 上一頁都不丟。
  // URL 是 source of truth,setActiveId wrapper 同時 push URL。
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get("pipeline") ?? "";
  const setActiveId = useCallback(
    (next: string | ((prev: string) => string)) => {
      const resolved = typeof next === "function" ? next(activeId) : next;
      if (resolved === activeId) return;
      const p = new URLSearchParams(searchParams);
      if (resolved) p.set("pipeline", resolved);
      else p.delete("pipeline");
      setSearchParams(p, { replace: false });
    },
    [activeId, searchParams, setSearchParams]
  );
  const [activeTab, setActiveTab] = useState<"rail" | "focus">("focus");
  // hash mount race grace period — 200ms 內顯「載入中」,過了還 !hash 才顯「請選專案」
  const [hashGraceExpired, setHashGraceExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHashGraceExpired(true), 200);
    return () => clearTimeout(t);
  }, []);
  const [creating, setCreating] = useState(startCreating);
  const [tick, setTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const qa = useQA(hash);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [splittingTicketId, setSplittingTicketId] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [maxParallel, setMaxParallel] = useState<number>(0);
  const [defaultAutoMerge, setDefaultAutoMerge] = useState<boolean>(false);

  const [inboxState, setInboxState] = useState<InboxState>("collapsed");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [items, setItems] = useState<NotifItem[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const unreadCount = items.filter((i) => i.unread).length;

  // 失敗 / 警告 / 成功 toast — 只走 setActionError(5s 自消),不再 emit notif 進 Inbox。
  // (原 A2 ticket 把 toast 同步 emit 進 Inbox,user 反映「這不該進 Inbox」,改回純 toast)
  function notifyError(msg: string, _opts?: { sub?: string; pipelineId?: string }) {
    setActionError(msg);
  }
  function notifyWarn(msg: string, _opts?: { sub?: string; pipelineId?: string }) {
    setActionError(msg);
  }
  function notifyInfo(msg: string, _opts?: { sub?: string; pipelineId?: string }) {
    setActionError(msg);
  }

  const confirmDialog = useConfirm();

  async function handleCleanupWorktree(pid: string) {
    if (!project) return;
    const target = pipelines.find((p) => p.id === pid);
    const name = target?.name ?? pid;
    const okay = await confirmDialog({
      title: `清除已合併的 worktree:${name}?`,
      description:
        "只清掉磁碟上的 worktree 資料夾(~/.vibe-pipeline/worktrees/...),\n" +
        "pipeline 紀錄 / branch / state 都不會動。\n" +
        "下次 Run 會從 base 重建 worktree。",
      confirmLabel: "清除",
    });
    if (!okay) return;
    try {
      const r = await api.cleanupWorktree(project.hash, pid);
      if (r.removed) {
        notifyInfo(`✓ 已清除 worktree(${name})`, { pipelineId: pid });
      } else {
        notifyInfo(`worktree 已不在(${name})— 已清過或從未建立`, { pipelineId: pid });
      }
    } catch (e) {
      notifyError(`清除 worktree 失敗: ${e instanceof Error ? e.message : String(e)}`, {
        pipelineId: pid,
      });
    }
  }

  function buildRailRowMenu(p: Pipeline): RailMenuItem[] {
    const isMerged = p.state === "merged";
    return [
      {
        key: "cleanup-worktree",
        label: "清除已合併的 worktree",
        icon: <TrashIcon />,
        disabledReason: isMerged ? undefined : "pipeline 還沒 merge",
        onClick: () => {
          void handleCleanupWorktree(p.id);
        },
      },
    ];
  }

  function markRead(id: string) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, unread: false } : it)));
    if (hash) api.markNotifRead(hash, id).catch(() => {});
  }
  function dismissNotif(id: string) {
    setItems((arr) => arr.filter((it) => it.id !== id));
    if (hash) api.dismissNotif(hash, id).catch(() => {});
  }
  function markAllRead() {
    setItems((arr) => arr.map((it) => ({ ...it, unread: false })));
    if (hash) api.markAllNotifsRead(hash).catch(() => {});
  }
  function dismissAllNotifs() {
    setItems([]);
    if (hash) api.dismissAllNotifs(hash).catch(() => {});
  }
  function focusNotif(id: string, pipelineId?: string) {
    setInboxState("expanded");
    if (pipelineId) {
      setActiveId(pipelineId);
      setActiveTab("focus");
    }
    setHighlightId(id);
    markRead(id);
  }

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Notifs polling 10s — 通知不是即時訊息,過頻只是 backend 噪音
  const notifsResult = useApi(
    async () => (hash ? await api.listNotifs(hash) : null),
    { intervalMs: 10000, gate: !!hash, deps: [hash] }
  );
  useEffect(() => {
    if (!hash) {
      setItems([]);
      return;
    }
    if (notifsResult.data) {
      setItems(notifsResult.data.map(toNotifItem));
    }
  }, [hash, notifsResult.data]);

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

  // actionError 自動消(6s),跟切換 project 一起 reset
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(t);
  }, [actionError]);

  // browser tab title 反映 project / pipeline 狀態(背景 tab 也看得見)
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

  // hash 切換時 reset 該 project 專屬 UI state
  // activeId / pipelines 必須一起清:否則切 project 後 FocusColumn 拿舊 pipeline id
  // 配新 project hash 去 fetch sync-status / diff-stat → 404(pipeline 不在那 project)
  // 注意:初次 mount(prevHash=null → 有值)不清 activeId,保留 URL ?pipeline= F5 持久化
  // biome-ignore lint/correctness/useExhaustiveDependencies: hash is the intentional trigger
  const prevHashRef = useRef<string | null>(null);
  useEffect(() => {
    setPopupDismissed(false);
    setActionError(null);
    // 真實切換才清(prevHash 已有 + 跟新 hash 不同);初次 mount 留 URL 內 ?pipeline=
    if (prevHashRef.current !== null && prevHashRef.current !== hash) {
      setActiveId("");
      setPipelines([]);
    }
    prevHashRef.current = hash ?? null;
  }, [hash]);

  // reloadKey 是手動 force-refetch counter,改變即使內容沒變也要重抓
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
        try {
          localStorage.setItem(`vp-cache:project:${hash}`, JSON.stringify(p));
        } catch {
          /* quota / serialize 失敗 — memory 仍有 */
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, reloadKey]);

  // Pipelines fetch + polling:
  // - 永遠跑 1.5s interval(原本 gate 在「有 running pipeline」會被 inactive tab 的 setInterval 節流卡死,
  //   切回 tab 時看到舊的 running 直到下一次 fire)
  // - 加 visibilitychange / focus refetch,tab 重新可見立刻 sync
  // Lazy fetch branches — 只在 CreateCard 開啟時打,mount 時不浪費 git spawn
  // (`git for-each-ref` 在 Windows 還 spawn 3 個視窗,mount 時根本沒人看到)
  useEffect(() => {
    if (!creating || !project?.hasGit) {
      return;
    }
    api
      .listBranches(project.hash)
      .then((bs) => setBranches(bs))
      .catch(() => setBranches([]));
  }, [creating, project?.hash, project?.hasGit]);

  // max_parallel 只在 hash / hasInit 變動時抓一次。Settings 儲存完透過 onConfigSaved
  // 或 reloadKey 也會 trigger,不另開 polling(避免 1.5s 衝撞 listPipelines)
  // deps 用 project?.hash(primitive)避免 project ref 變就 refire — config 幾乎不變,refire 浪費 git spawn(currentBranch)
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

  // reloadKey 同上 — force-refetch trigger
  const pipelinesResult = useApi<{ projectHash: string; pipelines: Pipeline[] } | null>(
    async () => {
      if (!project?.hasInit) return null;
      const projectHash = project.hash;
      const arr = await api.listPipelines(projectHash);
      // 按 createdAt 倒序(新建在上)。backend listPipelines 已 sort 過,
      // 這裡保險再排一次,避免 backend 改邏輯時 UI 順序漂走。
      // 沒 createdAt(極舊資料)→ fallback 用 id 內嵌 hex timestamp
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
      // primitive deps,避免 api.status 拿到 project 新 ref 就 trigger 重 fire(本來預期 5s 才 fire)
      deps: [project?.hash, project?.hasInit, reloadKey],
      // PWA reload 體感 — mount 立刻顯上次 pipelines 快照(不等 network);背景 fetch 更新。
      // 用 hash 不用 project.hash:hash 從 useActiveProjectHash lazy init 第一 frame 就有,
      // project.hash 要等 fetch 才填,會錯過 useState lazy init 的時機。
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

  async function handleCreate({
    name,
    baseBranch,
    autoMerge,
  }: {
    name: string;
    baseBranch: string;
    autoMerge: boolean;
  }) {
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
  }

  // running 條數從 pipelines 推(pipelines 已 1.5s polling,不另起 setInterval)。
  const runningCount = pipelines.filter((p) => p.state === "running").length;
  // queue 順位:state=queued 的依 id desc(列表 sort 順序)排,但 backend FIFO 是 enqueue 時間。
  // 沒 enqueueAt 持久化,只能近似 — 顯示順位從 1 起算同一批 queued 的 index。
  // (跨 server restart 會 reset 到 paused,reset 後重排 OK。)
  const queuedIds = pipelines
    .filter((p) => p.state === "queued")
    .map((p) => p.id)
    .sort();
  function queuePositionOf(pid: string): number {
    const i = queuedIds.indexOf(pid);
    return i < 0 ? 0 : i + 1;
  }

  const topBar = (
    <TopBar
      runningCount={runningCount}
      maxParallel={maxParallel}
      settingsSlot={
        <SettingsButton
          hash={hash}
          onActionError={(message) => {
            // Settings / Security / Push tab 的 action 失敗訊息亦寫進 Inbox 留 history
            const looksOk = message.trim().startsWith("✓");
            if (looksOk) notifyInfo(message);
            else notifyError(message);
          }}
          onConfigSaved={(cfg) => {
            setMaxParallel(cfg.defaults.max_parallel);
            setDefaultAutoMerge(!!cfg.defaults.auto_merge);
          }}
        />
      }
    />
  );
  // actionError 用右下角小 toast 浮現,別用 NotifBanner(那是 prototype 用,真 notif 走 inbox)
  const actionToast = actionError ? (
    <div role="alert" className="action-toast">
      <span className="action-toast-msg">{actionError}</span>
      <button type="button"
        className="action-toast-close"
        onClick={() => setActionError(null)}
        title="關閉"
        aria-label="關閉"
      >
        ×
      </button>
    </div>
  ) : null;
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
  function handleSelectPipeline(id: string) {
    setActiveId(id);
    setActiveTab("focus");
  }

  if (!hash) {
    // 短 grace period(200ms)防 PWA mobile mount race 一閃「請選專案」;
    // 過了 grace 還 !hash → 真的沒選,顯預設提示對齊 TopBar「選擇專案」字樣
    return (
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
    );
  }

  if (loadError) {
    return (
      <AppShell
        density={density}
        rootClassName={shellRootClass}
        topBar={topBar}
        rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />}
        main={<EmptyProject message="找不到這個專案" hint={loadError} />}
        aside={inboxAside}
        mobileTabBar={mobileTabBar}
      />
    );
  }

  if (!project) {
    return (
      <AppShell
        density={density}
        rootClassName={shellRootClass}
        topBar={topBar}
        rail={<Rail pipelines={[]} activeId="" onSelect={() => {}} />}
        main={<EmptyProject message="載入中…" hint="" pointToTopBar={false} />}
        aside={inboxAside}
        mobileTabBar={mobileTabBar}
      />
    );
  }

  const initOverlay = !project.hasInit && !popupDismissed ? (
    <InitPopup
      project={project}
      onInitialized={(next) => {
        setProject(next);
        setReloadKey((k) => k + 1);
      }}
      onDismiss={() => setPopupDismissed(true)}
    />
  ) : null;

  const qaOverlay = qa.state.open && qa.state.pipelineId ? (
    <QADrawer
      pipelineName={
        pipelines.find((p) => p.id === qa.state.pipelineId)?.name ?? qa.state.pipelineId
      }
      draft={qa.state.draft}
      busy={qa.state.busy}
      error={qa.state.error}
      onSendTurn={qa.sendTurn}
      onCancel={qa.cancel}
      onClose={qa.close}
      onFinalize={async (edits, splitInto) => {
        // QA AI 已在對話中提案 splitInto(若範圍多件)→ QADrawer 上 user 已選好拆/保 1。
        // 這裡直接 finalize,沒額外 AI call,瞬間關 drawer。
        try {
          const result = (await qa.finalize(edits, splitInto)) as
            | { pipeline: Pipeline; tickets: Array<{ id: string }>; splitCount: number }
            | null;
          if (result) {
            setPipelines((arr) =>
              arr.map((p) => (p.id === result.pipeline.id ? result.pipeline : p))
            );
            notifyInfo(
              result.splitCount > 1
                ? `✓ 已建立 ${result.splitCount} 張 ticket`
                : "✓ ticket 已建立",
              { pipelineId: result.pipeline.id }
            );
          }
        } catch (e) {
          notifyError(`送出 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
      }}
    />
  ) : null;

  // Re-pick latest ticket data when pipelines update so drawer reflects polled changes
  const liveTicket = openTicket && active
    ? active.tickets.find((t) => t.id === openTicket.id) ?? openTicket
    : null;
  const ticketOverlay = liveTicket && active ? (
    <TicketDrawer
      ticket={liveTicket}
      pipelineName={active.name}
      pipelineBranch={active.branch}
      pipelineId={active.id}
      projectHash={project.hash}
      onClose={() => setOpenTicket(null)}
      onResetTicket={async (ticketId) => {
        if (!project || !active) return;
        const next: Pipeline = {
          ...active,
          // pipeline.state 也要回 planning,讓 RunButton 重出現
          state: "planning",
          tickets: active.tickets.map((t) => {
            if (t.id !== ticketId) return t;
            // strip iter/commits/liveLog/reason,status 回 draft
            const { iter: _i, commits: _c, liveLog: _l, reason: _r, ...rest } = t;
            void _i; void _c; void _l; void _r;
            return { ...rest, status: "draft" };
          }),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          setReloadKey((k) => k + 1);
          notifyInfo("✓ ticket 已重置回 draft", { pipelineId: active.id });
        } catch (e) {
          notifyError(`重置 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      isSplitting={splittingTicketId === openTicket?.id}
      onSplitTicket={async (ticketId) => {
        if (!project || !active) return;
        setSplittingTicketId(ticketId);
        try {
          const r = await qaApi.splitTicket(project.hash, active.id, ticketId);
          if ("nothingToSplit" in r) {
            notifyInfo("✓ AI 認為這張 ticket 不需拆", { pipelineId: active.id });
          } else {
            notifyInfo(`✓ 已拆成 ${r.count} 張 ticket`, { pipelineId: active.id });
            setOpenTicket(null); // 關 drawer,讓 user 看到新 ticket 列表
          }
          setReloadKey((k) => k + 1);
        } catch (e) {
          notifyError(`AI 拆分失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        } finally {
          setSplittingTicketId(null);
        }
      }}
      onDeleteTicket={async (ticketId) => {
        if (!project || !active) return;
        try {
          await qaApi.deleteTicket(project.hash, active.id, ticketId);
          setOpenTicket(null);
          setReloadKey((k) => k + 1);
          notifyInfo("✓ ticket 已刪除", { pipelineId: active.id });
        } catch (e) {
          notifyError(`刪除 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      onToggleMode={async (ticketId, nextMode) => {
        if (!project || !active) return;
        const next: Pipeline = {
          ...active,
          tickets: active.tickets.map((t) =>
            t.id === ticketId ? { ...t, mode: nextMode } : t
          ),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          setReloadKey((k) => k + 1);
        } catch (e) {
          notifyError(`切換 mode 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      onChangeIterLimit={async (ticketId, limit) => {
        if (!project || !active) return;
        const next: Pipeline = {
          ...active,
          tickets: active.tickets.map((t) =>
            t.id === ticketId ? { ...t, iterLimit: limit } : t
          ),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          setReloadKey((k) => k + 1);
        } catch (e) {
          notifyError(`改 iter 上限失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
    />
  ) : null;

  const overlay = (
    <>
      {initOverlay}
      {qaOverlay}
      {ticketOverlay}
      {actionToast}
    </>
  );

  const isUninit = !project.hasInit;

  return (
    <AppShell
      density={density}
      rootClassName={shellRootClass}
      topBar={topBar}
      rail={
        <Rail
          pipelines={pipelines}
          activeId={activeId}
          onSelect={handleSelectPipeline}
          creating={creating}
          onStartCreate={
            isUninit ? () => setPopupDismissed(false) : () => setCreating(true)
          }
          addLabel={isUninit ? "開始初始化" : "新 pipeline"}
          draftPipelineIds={new Set(qa.drafts.map((d) => d.pipelineId))}
          buildRowMenu={buildRailRowMenu}
          createSlot={
            <CreateCard
              onCancel={() => setCreating(false)}
              onSubmit={handleCreate}
              existingNames={pipelines.map((p) => p.name)}
              branches={branches}
              defaultAutoMerge={defaultAutoMerge}
            />
          }
        />
      }
      main={
        creating ? (
          <CreatePlaceholder />
        ) : isUninit ? (
          <EmptyProject
            message="這個專案還沒初始化"
            hint="點左邊「開始初始化」打開引導,或在上方專案切換器選其他資料夾。"
            pointToTopBar={false}
          />
        ) : pipelines.length === 0 ? (
          <EmptyProject
            message="還沒任何 pipeline"
            hint="點左邊「+ 新 pipeline」建立第一條。"
            pointToTopBar={false}
          />
        ) : !active ? (
          <EmptyProject message="載入中…" hint="" pointToTopBar={false} />
        ) : (
          <FocusColumn
            pipeline={active}
            tick={tick}
            projectHash={project.hash}
            reloadKey={reloadKey}
            queuePosition={queuePositionOf(active.id)}
            splittingTicketId={splittingTicketId}
            onAddTicket={(pid) => qa.open(pid)}
            hasActiveDraft={!!qa.draftFor(active.id)}
            onTicketClick={(t) => setOpenTicket(t)}
            onRun={async (pid) => {
              if (!project) return;
              try {
                await api.runPipeline(project.hash, pid);
                setReloadKey((k) => k + 1);
                notifyInfo("✓ pipeline 已啟動,runner 接手中…", { pipelineId: pid });
              } catch (e) {
                notifyError(`開始運行失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onStop={async (pid) => {
              if (!project) return;
              try {
                await api.pausePipeline(project.hash, pid);
                setReloadKey((k) => k + 1);
                notifyInfo("✓ 已停止 pipeline", { pipelineId: pid });
              } catch (e) {
                notifyError(`停止失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onDelete={async (pid) => {
              if (!project) return;
              const targetName = pipelines.find((p) => p.id === pid)?.name ?? pid;
              try {
                await api.deletePipeline(project.hash, pid);
                // 從本地移除,順便切到下一條(若有)
                setPipelines((arr) => {
                  const next = arr.filter((p) => p.id !== pid);
                  if (pid === activeId) setActiveId(next[0]?.id ?? "");
                  return next;
                });
                notifyInfo(`✓ pipeline "${targetName}" 已刪除`, { pipelineId: pid });
              } catch (e) {
                notifyError(`刪除失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onRename={async (pid, newName) => {
              if (!project) return;
              const target = pipelines.find((p) => p.id === pid);
              if (!target) return;
              // pipeline.id 與 .json filename 不變;branch 也不變(已 push 出去的可能有人引用)
              const next: Pipeline = { ...target, name: newName };
              try {
                await api.savePipeline(project.hash, pid, next);
                setPipelines((arr) =>
                  arr.map((p) => (p.id === pid ? next : p))
                );
                notifyInfo(`✓ 已改名為 "${newName}"`, { pipelineId: pid });
              } catch (e) {
                notifyError(`改名失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onResetPipeline={async (pid) => {
              if (!project) return;
              try {
                await api.resetPipeline(project.hash, pid);
                setReloadKey((k) => k + 1);
                notifyInfo("✓ pipeline 已重置(worktree + branch 全清,tickets 回 draft)", { pipelineId: pid });
              } catch (e) {
                notifyError(`重置失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            existingNames={pipelines.map((p) => p.name)}
            onRevealWorktree={async (pid) => {
              if (!project) return;
              try {
                await api.revealWorktree(project.hash, pid);
              } catch (e) {
                notifyError(`開啟 worktree 失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onMerge={async (pid) => {
              if (!project) return;
              // 2026-05-13 後 backend 二段式:先試純 git merge,衝突才 fallback AI
              try {
                const r = await api.mergePipeline(project.hash, pid);
                setReloadKey((k) => k + 1);
                if (r.mode === "mechanical") {
                  notifyInfo(r.alreadyMerged ? "✓ 已合併過" : `✓ 合併完成(純 git,無 AI)`, {
                    pipelineId: pid,
                  });
                } else {
                  const n = r.conflictFiles?.length ?? 0;
                  notifyWarn(`⚠ 撞 ${n} 衝突檔,AI 開始解中(約 2 分鐘)…`, { pipelineId: pid });
                }
              } catch (e) {
                notifyError(`觸發合併失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onSync={async (pid) => {
              if (!project) return;
              try {
                const r = await api.syncPipeline(project.hash, pid);
                setReloadKey((k) => k + 1);
                if (r.state === "done") {
                  notifyInfo(
                    r.behind && r.behind > 0
                      ? "✓ 同步完成(git merge 直接成功,無需 AI)"
                      : "✓ worktree 已是最新,無需同步",
                    { pipelineId: pid }
                  );
                } else if (r.state === "conflict_await") {
                  notifyWarn(
                    `⚠ git merge 撞到 ${r.conflictFiles?.length ?? 0} 個衝突,modal 已跳出等決定`,
                    { pipelineId: pid }
                  );
                } else if (r.state === "failed") {
                  notifyError("✕ 同步失敗,看 pipeline 上的提示", { pipelineId: pid });
                } else {
                  notifyInfo("同步啟動中…", { pipelineId: pid });
                }
              } catch (e) {
                notifyError(`觸發同步失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onSyncConfirmAi={async (pid) => {
              if (!project) return;
              try {
                await api.syncConfirmAi(project.hash, pid);
                setReloadKey((k) => k + 1);
                notifyInfo("✓ AI 解衝突已啟動", { pipelineId: pid });
              } catch (e) {
                notifyError(
                  `啟動 AI 解衝突失敗: ${e instanceof Error ? e.message : String(e)}`,
                  { pipelineId: pid }
                );
              }
            }}
            onSyncCancel={async (pid) => {
              if (!project) return;
              try {
                await api.syncCancel(project.hash, pid);
                setReloadKey((k) => k + 1);
                notifyInfo("✓ 已取消同步,worktree 已回原狀", { pipelineId: pid });
              } catch (e) {
                notifyError(`取消同步失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onSyncDismiss={async (pid) => {
              if (!project) return;
              try {
                await api.syncDismiss(project.hash, pid);
                setReloadKey((k) => k + 1);
              } catch (e) {
                notifyError(`清掉同步狀態失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
            onToggleAutoMerge={async (pid, nextValue) => {
              if (!project) return;
              const target = pipelines.find((p) => p.id === pid);
              if (!target) return;
              const next: Pipeline = { ...target, autoMerge: nextValue };
              // optimistic 先更
              setPipelines((arr) => arr.map((p) => (p.id === pid ? next : p)));
              try {
                await api.savePipeline(project.hash, pid, next);
                notifyInfo(
                  nextValue ? "✓ 已啟用自動合併" : "✓ 已關閉自動合併",
                  { pipelineId: pid }
                );
              } catch (e) {
                // rollback
                setPipelines((arr) => arr.map((p) => (p.id === pid ? target : p)));
                notifyError(`切換自動合併失敗: ${e instanceof Error ? e.message : String(e)}`, {
                  pipelineId: pid,
                });
              }
            }}
          />
        )
      }
      overlay={overlay}
      aside={inboxAside}
      mobileTabBar={mobileTabBar}
    />
  );
}

// ── Notif adapter: backend NotifRecord → frontend NotifItem ──
const SEV_BY_EVENT: Record<string, "block" | "info" | "muted"> = {
  pipeline_started: "muted",
  pipeline_paused: "info",
  pipeline_ready_to_merge: "info",
  pipeline_failed: "block",
  pipeline_merged: "info",
  pipeline_merge_cleanup_failed: "info",
  pipeline_auto_merge_started: "info",
  merge_started: "muted",
  merge_blocked: "block",
  ticket_started: "muted",
  ticket_done: "info",
  ticket_failed: "block",
  iter_critic_pass: "info",
  iter_critic_fail: "muted",
  budget_warn: "info",
  budget_hard_cap: "block",
  runner_stall: "block",
  runner_crash: "block",
};

function iconFor(sev: "block" | "info" | "muted"): { icon: string; iconKind: "alert" | "warn" | "check" | "iter" | "skill" | "dot" } {
  if (sev === "block") return { icon: "🚨", iconKind: "alert" };
  if (sev === "info") return { icon: "✓", iconKind: "check" };
  return { icon: "·", iconKind: "dot" };
}

function fmtTs(ms: number): { ts: string; since: number } {
  const since = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (since < 60) return { ts: "just now", since };
  if (since < 3600) return { ts: `${Math.floor(since / 60)} min`, since };
  if (since < 86400) return { ts: `${Math.floor(since / 3600)} h`, since };
  return { ts: `${Math.floor(since / 86400)} d`, since };
}

// Gear button + Settings popover。原本在 shell/TopBar 內,因為 SettingsPopover 屬 features/
// 不該被 shell 認識,改由 BoardScreen 注入 TopBar 的 settingsSlot。
function SettingsButton({
  hash,
  onConfigSaved,
  onActionError,
}: {
  hash: string | null;
  onConfigSaved?: (cfg: api.ProjectConfig) => void;
  onActionError?: (message: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        type="button"
        className={"icon-btn" + (open ? " is-active" : "")}
        title={hash ? "設定" : "選擇 project 後可開設定"}
        onClick={() => hash && setOpen((o) => !o)}
        disabled={!hash}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GearIcon />
      </button>
      {hash && (
        <SettingsPopover
          hash={hash}
          open={open}
          onClose={() => setOpen(false)}
          onSaved={(cfg) => {
            onConfigSaved?.(cfg);
          }}
          onActionError={onActionError}
          anchorRef={btnRef}
        />
      )}
    </span>
  );
}

function toNotifItem(r: api.NotifRecord): NotifItem {
  // record.sev override 優先(frontend_action_* 用 caller 帶的 sev);否則查字典
  const sev = (r.sev ?? SEV_BY_EVENT[r.type] ?? "muted") as "block" | "info" | "muted";
  const { icon, iconKind } = iconFor(sev);
  const { ts, since } = fmtTs(r.ts);
  return {
    id: r.id,
    type: r.type,
    sev,
    icon,
    iconKind,
    title: r.title,
    sub: r.sub ?? "",
    ts,
    since,
    unread: r.unread,
    pipelineId: r.pipelineId,
  };
}
