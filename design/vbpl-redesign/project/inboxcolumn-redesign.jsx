/* ============================================================================
   InboxColumn Redesign — demo harness (V1 Refined)
   Wraps verbatim InboxColumn from inboxcolumn-source.jsx in a full-screen
   shell: scenario picker top bar, faux board behind, Tweaks panel for
   theme + density. Same DOM, polished chrome via inboxcolumn-redesign.css.
   ============================================================================ */

const { useEffect: useEffectIR, useMemo: useMemoIR, useState: useStateIR } = React;

const {
  InboxColumn,
  SCENARIOS,
  useTweaks, TweaksPanel, TweakSection, TweakRadio,
} = window;

/* Tweakable defaults — host rewrites this block on persist */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "normal"
}/*EDITMODE-END*/;

/* ─── Scenario presets (label-only, fixture lives in SCENARIOS) ───── */

const PRESETS = [
  { id: "mixed-some-unread",          label: "Mixed · 含 block",     desc: "9 則:1 block / 2 info / 6 muted" },
  { id: "only-blocking",              label: "全 block",              desc: "全未讀,全有 primary action" },
  { id: "full-43",                    label: "全 38 種事件",          desc: "kitchen sink · 半數未讀" },
  { id: "only-info",                  label: "全 info",               desc: "完成 / 警告 / 候選" },
  { id: "only-muted",                 label: "全 activity",           desc: "已讀 log 列(訊息流)" },
  { id: "long-titles",                label: "極長文字",              desc: "wrap / overflow 測試" },
  { id: "empty-unread-filter-active", label: "已讀完",                desc: "filter=unread 空狀態" },
  { id: "empty",                      label: "空 inbox",              desc: "完全沒通知" },
];

const STATES = [
  { id: "expanded",  label: "Expanded"  },
  { id: "collapsed", label: "Collapsed" },
  { id: "hidden",    label: "Hidden"    },
];

/* ─── Faux board behind the inbox (visual context) ────────────────── */

const FAUX_TICKETS = [
  { num: "T-013", name: "Pause / resume runtime 控制",     time: "running · 4 min",  state: "running", stateColor: "var(--running)" },
  { num: "T-012", name: "Topbar 通知 chip 與 inbox 同步",   time: "iter · 2/6 輪",    state: "iter",    stateColor: "var(--iter)" },
  { num: "T-011", name: "重試 stderr 已存(等使用者處理)",  time: "failed · 8 min 前", state: "failed",  stateColor: "var(--failed)" },
  { num: "T-010", name: "Settings 撤銷裝置二次確認",        time: "done · 12 min 前",  state: "done",    stateColor: "var(--done)" },
  { num: "T-009", name: "QA 對話收斂與 spec sync",          time: "done · 1 h 前",     state: "done",    stateColor: "var(--done)" },
  { num: "T-008", name: "iOS Safari 安裝引導浮層",          time: "ready · 草稿",      state: "ready",   stateColor: "var(--queued)" },
];

function FauxBoard({ pipelineName, unread, total }) {
  return (
    <section className="ibx-faux" aria-hidden="true">
      <nav className="ibx-faux-crumbs">
        <span className="ibx-faux-crumb-brand mono">vbpl</span>
        <span className="ibx-faux-crumb-sep">/</span>
        <span className="mono">{pipelineName}</span>
        <span className="ibx-faux-crumb-sep">›</span>
        <span className="ibx-faux-crumb-active">Pipeline</span>
      </nav>
      <div className="ibx-faux-title-row">
        <div className="ibx-faux-title">{pipelineName}</div>
        <span className="ibx-faux-state-chip mono">running</span>
        <div className="ibx-faux-stats">
          <span>6 ticket<em>· 2 done · 1 failed</em></span>
          <span>budget<em>$1.68 / $2.00</em></span>
          <span>inbox<em>{unread}/{total}</em></span>
        </div>
      </div>
      <div className="ibx-faux-board">
        <div className="ibx-faux-tabs">
          <span className="ibx-faux-tab is-active">Tickets</span>
          <span className="ibx-faux-tab">Diff</span>
          <span className="ibx-faux-tab">Runs</span>
          <span className="ibx-faux-tab">Sync</span>
        </div>
        <div className="ibx-faux-tickets">
          {FAUX_TICKETS.map((t) => (
            <div key={t.num} className="ibx-faux-ticket">
              <span className="ibx-faux-tnum mono">{t.num}</span>
              <span className="ibx-faux-tname">{t.name}</span>
              <span className="ibx-faux-ttime mono">{t.time}</span>
              <span className="ibx-faux-tstate" style={{ color: t.stateColor }}>{t.state}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── App ──────────────────────────────────────────────────────────── */

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [presetId, setPresetId] = useStateIR("mixed-some-unread");
  const [columnState, setColumnState] = useStateIR("expanded");
  const [filter, setFilter] = useStateIR("all");
  const [highlightId, setHighlightId] = useStateIR(null);

  /* Theme / density apply to html element so source tokens.css responds */
  useEffectIR(() => {
    const html = document.documentElement;
    if (t.theme === "light") html.classList.add("light");
    else html.classList.remove("light");
    html.setAttribute("data-density", t.density === "compact" ? "compact" : "normal");
  }, [t.theme, t.density]);

  /* Build fixture for current scenario, keep a local mutable copy
     so dismiss / markRead feel real. */
  const baseItems = useMemoIR(() => SCENARIOS[presetId].build(), [presetId]);
  const [localItems, setLocalItems] = useStateIR(baseItems);
  useEffectIR(() => {
    setLocalItems(baseItems);
    setFilter("all");
    setHighlightId(null);
  }, [baseItems]);

  const unreadCount = localItems.filter((i) => i.unread).length;

  const onMarkRead    = (id) => setLocalItems((xs) => xs.map((it) => it.id === id ? { ...it, unread: false } : it));
  const onDismiss     = (id) => setLocalItems((xs) => xs.filter((it) => it.id !== id));
  const onMarkAllRead = ()   => setLocalItems((xs) => xs.map((it) => ({ ...it, unread: false })));
  const onDismissAll  = ()   => setLocalItems([]);
  const onItemClick   = (id) => { onMarkRead(id); setHighlightId(id); };

  const totalItems = localItems.length;

  const colClass =
    "ibx--refined " +
    (columnState === "collapsed" ? "is-collapsed" : columnState === "expanded" ? "is-expanded" : "");

  return (
    <div className={"ibx-app ibx--refined"}>
      <header className="ibx-app-bar">
        <div className="ibx-app-brand">
          <span className="ibx-app-brand-dot" />
          <span className="ibx-app-brand-text">vibe-pipeline</span>
          <span className="ibx-app-brand-sep">·</span>
          <span className="ibx-app-brand-sub">InboxColumn Redesign</span>
        </div>
        <div className="ibx-app-presets" role="tablist" aria-label="情境切換">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={presetId === p.id}
              className={"ibx-app-preset" + (presetId === p.id ? " is-active" : "")}
              onClick={() => setPresetId(p.id)}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ibx-app-states" role="tablist" aria-label="InboxState">
          {STATES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={columnState === s.id}
              className={"ibx-app-state" + (columnState === s.id ? " is-active" : "")}
              onClick={() => setColumnState(s.id)}
              title={`InboxState = ${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="ibx-app-body">
        <FauxBoard pipelineName="feat-ui-refresh" unread={unreadCount} total={totalItems} />
        {/* Inline wrapper so column gets a flexible width that animates between
            expanded (340) / collapsed (56) / hidden (0). State=hidden returns null
            from InboxColumn — we wrap so layout stays steady. */}
        {columnState !== "hidden" && (
          <div
            className={"inbox-col-host " + colClass}
            style={{
              width: columnState === "collapsed" ? 56 : 340,
              flex: "0 0 auto",
              display: "flex",
              transition: "width 240ms cubic-bezier(0.2, 0.7, 0.2, 1)",
            }}
          >
            <InboxColumn
              items={localItems}
              filter={filter}
              setFilter={setFilter}
              unreadCount={unreadCount}
              highlightId={highlightId}
              state={columnState}
              setState={setColumnState}
              onMarkRead={onMarkRead}
              onDismiss={onDismiss}
              onMarkAllRead={onMarkAllRead}
              onDismissAll={onDismissAll}
              onItemClick={onItemClick}
            />
          </div>
        )}
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
        <TweakSection label="重設" />
        <button
          type="button"
          onClick={() => { setLocalItems(baseItems); setHighlightId(null); }}
          style={{
            font: "inherit",
            fontSize: 11,
            padding: "5px 10px",
            background: "rgba(0,0,0,.04)",
            border: "1px solid rgba(0,0,0,.10)",
            borderRadius: 6,
            cursor: "pointer",
            color: "inherit",
          }}
        >
          reset scenario
        </button>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
