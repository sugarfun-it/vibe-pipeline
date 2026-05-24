/* ============================================================================
   BoardRail V2 · app — fixtures + BoardRail + DemoApp + DemoPanel
   ============================================================================ */

const { useState: useStateA, useMemo: useMemoA, useEffect: useEffectA } = React;

/* ─── fixtures ──────────────────────────────────────────────────────── */

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const mk = (n, status, title, extra = {}) => ({ id: `t-${n}-${status}`, n, title, mode: "iter", status, ...extra });

const FIXTURE_PIPELINES = {
  mixed: [
    {
      id: "p-planning", name: "draft-feature", branch: "pipeline/draft-feature", baseBranch: "main",
      state: "planning", createdAt: NOW - 5 * MIN,
      tickets: [mk(1, "draft", "規劃登入流程"), mk(2, "ready", "建 OAuth callback"), mk(3, "draft", "寫 e2e 測試")],
    },
    {
      id: "p-running", name: "checkout-redesign", branch: "pipeline/checkout-redesign", baseBranch: "main",
      state: "running", createdAt: NOW - 4 * HOUR,
      tickets: [
        mk(1, "done", "拉 spec", { startedAt: NOW - 4 * HOUR, endedAt: NOW - 3 * HOUR }),
        mk(2, "done", "切版", { startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR }),
        mk(3, "running", "綁付款 webhook", { startedAt: NOW - 8 * MIN }),
        mk(4, "ready", "整合 e2e"),
      ],
    },
    {
      id: "p-paused", name: "stripe-migration", branch: "pipeline/stripe-migration", baseBranch: "main",
      state: "paused", createdAt: NOW - 2 * DAY,
      tickets: [
        mk(1, "done", "API 抽象層", { endedAt: NOW - 6 * HOUR }),
        mk(2, "paused", "改 charge flow", { startedAt: NOW - 90 * MIN }),
        mk(3, "ready", "改 refund flow"),
      ],
    },
    {
      id: "p-ready", name: "perf-pass", branch: "pipeline/perf-pass", baseBranch: "main",
      state: "ready", createdAt: NOW - 18 * HOUR,
      tickets: [
        mk(1, "done", "profile 主 list 渲染", { endedAt: NOW - 12 * HOUR }),
        mk(2, "done", "lazy load images", { endedAt: NOW - 6 * HOUR }),
        mk(3, "done", "trim bundle", { endedAt: NOW - 30 * MIN }),
      ],
    },
    {
      id: "p-failed", name: "broken-build", branch: "pipeline/broken-build", baseBranch: "main",
      state: "failed", createdAt: NOW - 25 * HOUR,
      tickets: [
        mk(1, "done", "改 webpack", { endedAt: NOW - 24 * HOUR }),
        mk(2, "failed", "升 ts 5", { endedAt: NOW - 20 * HOUR }),
        mk(3, "failed_iter_limit", "修 typecheck", { endedAt: NOW - 18 * HOUR }),
        mk(4, "failed_transient", "重跑 ci", { endedAt: NOW - 17 * HOUR }),
      ],
    },
    {
      id: "p-merged", name: "intl-zh-tw", branch: "pipeline/intl-zh-tw", baseBranch: "main",
      state: "merged", createdAt: NOW - 3 * DAY, mergedAt: NOW - 6 * HOUR,
      tickets: [
        mk(1, "done", "抽 zh-TW 字典", { endedAt: NOW - 2 * DAY }),
        mk(2, "done", "替 prompt 加 hint", { endedAt: NOW - 18 * HOUR }),
      ],
    },
    {
      id: "p-merged-2", name: "dark-mode-tokens", branch: "pipeline/dark-mode-tokens", baseBranch: "main",
      state: "merged", createdAt: NOW - 5 * DAY, mergedAt: NOW - 25 * HOUR,
      tickets: [mk(1, "done", "重抽 token", { endedAt: NOW - 4 * DAY })],
    },
  ],
  empty: [],
  single: [
    {
      id: "p-only", name: "tidy-readme", branch: "pipeline/tidy-readme", baseBranch: "main",
      state: "planning", createdAt: NOW - 2 * MIN,
      tickets: [mk(1, "ready", "改 README 目錄")],
    },
  ],
  "all-merged": Array.from({ length: 4 }).map((_, i) => ({
    id: `p-am-${i}`, name: `merged-feature-${i + 1}`,
    branch: `pipeline/merged-feature-${i + 1}`, baseBranch: "main",
    state: "merged", createdAt: NOW - (10 + i) * HOUR, mergedAt: NOW - (3 + i) * HOUR,
    tickets: [mk(1, "done", `合併 #${i + 1}`, { endedAt: NOW - (3 + i) * HOUR })],
  })),
  "failed-only": [
    {
      id: "p-fo", name: "ci-pipeline", branch: "pipeline/ci-pipeline", baseBranch: "main",
      state: "failed", createdAt: NOW - 30 * HOUR,
      tickets: [mk(1, "done", "升 bun"), mk(2, "failed", "跑單元測試")],
    },
  ],
};

/* ─── BoardRail (verbatim shape, V2 rail) ───────────────────────────── */

function BoardRailV2({
  pipelines, activeId, onSelect,
  creating, setCreating, isUninit, onStartInit,
  draftPipelineIds, branches, defaultAutoMerge, onCreate,
  openConfirm, notifyInfo,
}) {
  const existingNames = useMemoA(() => pipelines.map((p) => p.name), [pipelines]);

  async function handleCleanupAllMergedWorktrees() {
    const mergedPipelines = pipelines.filter((p) => p.state === "merged");
    const n = mergedPipelines.length;
    if (n === 0) { notifyInfo("目前沒有已合併的 pipeline,無需清除"); return; }
    const okay = await openConfirm({
      title: `清除所有已合併的 worktree?`,
      description:
        `將清除目前 project 內所有 state=merged 的 pipeline worktree(共 ${n} 個):\n` +
        mergedPipelines.map((p) => `  · ${p.name}`).join("\n") +
        "\n\n只清磁碟,pipeline 紀錄 / branch 不動。",
      confirmLabel: `清除 ${n} 個`,
    });
    if (!okay) return;
    notifyInfo(`✓ 清除 ${n} 個 worktree(mock)`);
  }

  const mergedCount = pipelines.filter((p) => p.state === "merged").length;
  const sectionMenuItems = [
    {
      key: "cleanup-all-merged-worktrees",
      label: "清理已合併 worktree",
      icon: <TrashIcon />,
      danger: true,
      disabledReason: mergedCount === 0 ? "目前無已合併" : undefined,
      onClick: handleCleanupAllMergedWorktrees,
    },
  ];

  return (
    <RailV2
      pipelines={pipelines}
      activeId={activeId}
      onSelect={onSelect}
      creating={creating}
      onStartCreate={isUninit ? onStartInit : () => setCreating(true)}
      addLabel={isUninit ? "開始初始化" : "新 pipeline"}
      draftPipelineIds={draftPipelineIds}
      sectionMenuItems={sectionMenuItems}
      createSlot={
        <CreateCard
          onCancel={() => setCreating(false)}
          onSubmit={onCreate}
          existingNames={existingNames}
          branches={branches}
          defaultAutoMerge={defaultAutoMerge}
        />
      }
    />
  );
}

/* ─── Demo panel ────────────────────────────────────────────────────── */

function DemoPanel(props) {
  const {
    theme, setTheme,
    dataKey, setDataKey,
    activeId, setActiveId, pipelines,
    creating, setCreating,
    isUninit, setIsUninit,
    hasDraftFirst, setHasDraftFirst,
    defaultAutoMerge, setDefaultAutoMerge,
  } = props;
  return (
    <aside className="demo-panel" aria-label="Demo controls">
      <h2>BoardRail V2 · demo controls</h2>

      <div className="demo-row">
        <label htmlFor="d-theme">theme</label>
        <select id="d-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="dark">dark</option>
          <option value="light">light</option>
        </select>
      </div>

      <div className="demo-divider" />

      <div className="demo-row">
        <label htmlFor="d-data">pipelines fixture</label>
        <select id="d-data" value={dataKey} onChange={(e) => setDataKey(e.target.value)}>
          <option value="mixed">mixed — 7 rows, every state</option>
          <option value="single">single — 1 planning row</option>
          <option value="empty">empty — exercises rail-empty-hint</option>
          <option value="all-merged">all-merged — 4 merged rows</option>
          <option value="failed-only">failed-only — single failed row</option>
        </select>
      </div>

      <div className="demo-row">
        <label htmlFor="d-active">activeId</label>
        <select id="d-active" value={activeId} onChange={(e) => setActiveId(e.target.value)}>
          {pipelines.length === 0 && <option value="">(no pipelines)</option>}
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.state}</option>
          ))}
        </select>
      </div>

      <div className="demo-divider" />

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-creating">creating (CreateCard 顯示)</label>
        <input id="d-creating" type="checkbox" checked={creating} onChange={(e) => setCreating(e.target.checked)} />
      </div>
      <div className="demo-row demo-row-inline">
        <label htmlFor="d-uninit">isUninit (addLabel = 開始初始化)</label>
        <input id="d-uninit" type="checkbox" checked={isUninit} onChange={(e) => setIsUninit(e.target.checked)} />
      </div>
      <div className="demo-row demo-row-inline">
        <label htmlFor="d-qa">draft on first row (QA badge)</label>
        <input id="d-qa" type="checkbox" checked={hasDraftFirst} onChange={(e) => setHasDraftFirst(e.target.checked)} />
      </div>

      <div className="demo-divider" />

      <div className="demo-row demo-row-inline">
        <label htmlFor="d-am">CreateCard defaultAutoMerge</label>
        <input id="d-am" type="checkbox" checked={defaultAutoMerge} onChange={(e) => setDefaultAutoMerge(e.target.checked)} />
      </div>

      <div className="demo-divider" />

      <p style={{ fontSize: 11, color: "var(--fg-mute)", lineHeight: 1.55, margin: 0 }}>
        切 fixture → mixed 看完整 7 種狀態; all-merged → 點 ⋯ → 清理已合併 worktree (跳 ConfirmDialog,desc 列名);
        empty → 看 rail-empty-hint。CreateCard 試名稱 <span className="mono">Bad-Name</span>(format error)、
        <span className="mono">draft-feature</span>(taken)、打滿 60 字看 counter is-near / is-limit。
      </p>
    </aside>
  );
}

/* ─── App ───────────────────────────────────────────────────────────── */

function App() {
  const [theme, setTheme] = useStateA("dark");
  useEffectA(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const [dataKey, setDataKey] = useStateA("mixed");
  const pipelines = FIXTURE_PIPELINES[dataKey];

  const [activeId, setActiveId] = useStateA((pipelines[0] && pipelines[0].id) || "");
  useEffectA(() => {
    setActiveId((FIXTURE_PIPELINES[dataKey][0] && FIXTURE_PIPELINES[dataKey][0].id) || "");
  }, [dataKey]);

  const [creating, setCreating] = useStateA(false);
  const [isUninit, setIsUninit] = useStateA(false);
  const [hasDraftFirst, setHasDraftFirst] = useStateA(true);
  const [defaultAutoMerge, setDefaultAutoMerge] = useStateA(false);

  const draftPipelineIds = useMemoA(() => {
    const s = new Set();
    if (hasDraftFirst && pipelines[0]) s.add(pipelines[0].id);
    return s;
  }, [pipelines, hasDraftFirst]);

  const [toasts, setToasts] = useStateA([]);
  function pushToast(kind, msg) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }

  const [confirmState, setConfirmState] = useStateA(null);
  function openConfirm(opts) {
    return new Promise((resolve) => setConfirmState({ opts, resolve }));
  }
  function closeConfirm(result) {
    if (!confirmState) return;
    confirmState.resolve(result === "confirm");
    setConfirmState(null);
  }

  function onCreate({ name }) {
    pushToast("info", `(mock) 建立 pipeline:${name}`);
    setCreating(false);
  }

  return (
    <>
      <div className="preview-shell">
        <div className="preview-rail-host">
          <BoardRailV2
            pipelines={pipelines}
            activeId={activeId}
            onSelect={setActiveId}
            creating={creating}
            setCreating={setCreating}
            isUninit={isUninit}
            onStartInit={() => pushToast("info", "(mock) 開始初始化專案")}
            draftPipelineIds={draftPipelineIds}
            branches={["main", "master", "develop", "release/2026.05"]}
            defaultAutoMerge={defaultAutoMerge}
            onCreate={onCreate}
            openConfirm={openConfirm}
            notifyInfo={(m) => pushToast("info", m)}
          />
        </div>
        <div className="preview-stage-fill">
          <span>focus column placeholder · BoardRail V2 preview</span>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        options={confirmState ? confirmState.opts : null}
        onClose={closeConfirm}
      />

      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={"toast is-" + t.kind}>{t.msg}</div>
        ))}
      </div>

      <DemoPanel
        theme={theme} setTheme={setTheme}
        dataKey={dataKey} setDataKey={setDataKey}
        activeId={activeId} setActiveId={setActiveId} pipelines={pipelines}
        creating={creating} setCreating={setCreating}
        isUninit={isUninit} setIsUninit={setIsUninit}
        hasDraftFirst={hasDraftFirst} setHasDraftFirst={setHasDraftFirst}
        defaultAutoMerge={defaultAutoMerge} setDefaultAutoMerge={setDefaultAutoMerge}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
