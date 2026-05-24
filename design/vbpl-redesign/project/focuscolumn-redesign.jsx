/* ============================================================================
   FocusColumn Redesign — V1 Refined (full-screen functional)
   Single full-viewport FocusColumn with all source functional details intact.
   A slim top bar exposes the source's scenario / sync / diff / state matrix
   so you can flip through every meaningful combination.
   ============================================================================ */

const { useEffect, useMemo, useState } = React;

const {
  FocusColumn,
  STATE_COLOR, STATE_LABEL,
  SCENARIO_TICKETS, SYNC_JOB_FIXTURES, DIFF_FIXTURES, RUN_FIXTURES,
  TICKET_FIXTURES,
  nowMinus,
  useTweaks, TweaksPanel, TweakSection, TweakRadio,
} = window;

/* Tweakable defaults — host rewrites this block on persist */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "normal"
}/*EDITMODE-END*/;

/* Patch source's all_done fixture (had duplicate round n=2). */
SCENARIO_TICKETS.all_done = [
  TICKET_FIXTURES.done_step,
  TICKET_FIXTURES.done_iter,
  {
    ...TICKET_FIXTURES.done_iter,
    id: "t-extra-done",
    n: 9,
    title: "另一張 iter ticket 完成 — 2 輪 PASS",
    iter: {
      current: 2, stage: "✓", verdicts: ["FAIL", "PASS"],
      rounds: [
        { n: 1, startedAt: nowMinus(1800), endedAt: nowMinus(900), criticVerdict: "FAIL" },
        { n: 2, startedAt: nowMinus(900),  endedAt: nowMinus(60),  criticVerdict: "PASS" },
      ],
    },
  },
];

/* ─── presets ─────────────────────────────────────────────────────── */

const PRESETS = [
  { id: "running-doer",   label: "執行中 · iter doer",       state: "running",  tickets: "with_running_iter",    sync: "none",          behind: 3,    diff: "small" },
  { id: "running-critic", label: "iter critic 審核中 · 助理同步", state: "running",  tickets: "with_critic_running",  sync: "ai_running",    behind: null, diff: "small" },
  { id: "ready-merge",    label: "全完成 · 等合併",            state: "ready",    tickets: "all_done",             sync: "done",          behind: null, diff: "big" },
  { id: "paused-iter",    label: "暫停 · iter paused",        state: "paused",   tickets: "with_paused_iter",     sync: "failed",        behind: null, diff: "small" },
  { id: "all-failed",     label: "全失敗 · 修復重試",          state: "failed",   tickets: "all_failed",           sync: "none",          behind: null, diff: "small" },
  { id: "merge-running",  label: "AI 合併進行中",              state: "running",  tickets: "with_merge_running",   sync: "none",          behind: null, diff: "big" },
  { id: "splitting",      label: "AI 拆解中的 ticket",         state: "planning", tickets: "with_splitting",       sync: "none",          behind: null, diff: "zero" },
  { id: "livelog",        label: "step 跑中(live log)",       state: "running",  tickets: "livelog_running",      sync: "none",          behind: null, diff: "small" },
  { id: "queued",         label: "排隊中",                     state: "queued",   tickets: "with_running_iter",    sync: "none",          behind: null, diff: "small", queuePos: 2 },
  { id: "empty",          label: "空 pipeline",                state: "planning", tickets: "empty",                sync: "none",          behind: null, diff: "null" },
];

/* ─── app ─────────────────────────────────────────────────────────── */

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [presetId, setPresetId] = useState("running-doer");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [autoMerge, setAutoMerge] = useState(true);

  useEffect(() => {
    const html = document.documentElement;
    if (t.theme === "light") html.classList.add("light");
    else html.classList.remove("light");
    html.setAttribute("data-density", t.density === "compact" ? "compact" : "normal");
  }, [t.theme, t.density]);

  // 1-second tick for live timers
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // close popovers when switching scenarios
  useEffect(() => {
    setOverflowOpen(false);
    setHistoryOpen(false);
    setDiffOpen(false);
    setTitleEditing(false);
  }, [presetId]);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const tickets = SCENARIO_TICKETS[preset.tickets] ?? [];
  const splittingTicketId = tickets.find((t) => t.id === "t-splitting")?.id ?? null;
  const pipeline = useMemo(() => ({
    id: "pl-demo",
    name: "feat-ui-refresh",
    branch: "pipeline/feat-ui-refresh",
    baseBranch: "main",
    state: preset.state,
    tickets,
    autoMerge,
    hasWorktree: preset.state !== "planning" && preset.state !== "merged",
    syncJob: SYNC_JOB_FIXTURES[preset.sync],
    createdAt: nowMinus(7 * 86400),
  }), [preset, autoMerge]);

  const diffStat = DIFF_FIXTURES[preset.diff];
  const runs = RUN_FIXTURES.some;

  return (
    <div className="fc-app fc--refined">
      <header className="fc-app-bar">
        <div className="fc-app-brand">
          <span className="fc-app-brand-dot" />
          <span className="fc-app-brand-text">vibe-pipeline</span>
          <span className="fc-app-brand-sep">·</span>
          <span className="fc-app-brand-sub">FocusColumn V1 Refined</span>
        </div>
        <div className="fc-app-presets" role="tablist" aria-label="情境切換">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={presetId === p.id}
              className={"fc-app-preset" + (presetId === p.id ? " is-active" : "")}
              onClick={() => setPresetId(p.id)}
              title={`${p.state} · tickets=${p.tickets} · sync=${p.sync}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="fc-app-body">
        <FocusColumn
          pipeline={pipeline}
          tick={tick}
          hasActiveDraft={false}
          existingNames={["hotfix-toast-z", "chore-tokens", "refactor-runner"]}
          projectHash="abc123def"
          queuePosition={preset.queuePos}
          splittingTicketId={splittingTicketId}
          diffStat={diffStat}
          runs={runs}
          behind={preset.behind}
          spawning={false}
          onRun={() => {}}
          onStop={() => {}}
          onAddTicket={() => {}}
          onDelete={() => {}}
          onRename={() => {}}
          onResetPipeline={() => {}}
          onRevealWorktree={() => {}}
          onMerge={() => {}}
          onSync={() => {}}
          onSyncConfirmAi={() => {}}
          onSyncCancel={() => {}}
          onSyncDismiss={() => {}}
          onToggleAutoMerge={(_, next) => setAutoMerge(next)}
          onTicketClick={() => {}}
          historyOpen={historyOpen} setHistoryOpen={setHistoryOpen}
          diffOpen={diffOpen} setDiffOpen={setDiffOpen}
          overflowOpen={overflowOpen} setOverflowOpen={setOverflowOpen}
          titleEditing={titleEditing} setTitleEditing={setTitleEditing}
        />
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="主題" />
        <TweakRadio
          label="theme"
          value={t.theme}
          onChange={(v) => setTweak("theme", v)}
          options={[
            { value: "dark",  label: "Dark"  },
            { value: "light", label: "Light" },
          ]}
        />
        <TweakRadio
          label="density"
          value={t.density}
          onChange={(v) => setTweak("density", v)}
          options={[
            { value: "normal",  label: "Normal"  },
            { value: "compact", label: "Compact" },
          ]}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
