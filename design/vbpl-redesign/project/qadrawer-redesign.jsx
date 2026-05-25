/* ============================================================================
   QADrawer Redesign — demo harness
   Uses verbatim QADrawer / Overlay / Composer / SpecReview / etc from
   qadrawer-source.jsx (loaded earlier as a sibling script).
   Adds a fixture-driven demo panel that switches through every state.
   ============================================================================ */

const {
  useState: useStateQDR,
  useEffect: useEffectQDR,
  useRef: useRefQDR,
  useMemo: useMemoQDR,
} = React;

/* ─── Faux board behind the drawer ─────────────────────────────────── */

function FauxBoard({ pipelineName, scenario }) {
  return (
    <>
      <div className="demo-stage-bg" />
      <div className="demo-faux-board">
        <span className="demo-brand">
          <span className="demo-brand-dot" />
          vbpl
        </span>
        <span className="demo-sep">·</span>
        <span className="mono">pipeline/{pipelineName}</span>
        <span className="demo-sep">›</span>
        <span className="demo-crumb-active">新需求單</span>
        <span className="demo-spacer" />
        <span className="demo-scenariotag">scenario: {scenario}</span>
      </div>
      <div className="demo-faux-tickets" aria-hidden="true">
        <div className="demo-faux-title">{pipelineName}</div>
        <div className="demo-faux-sub">
          4 tickets · 1 done · 1 running · 2 ready · 對話收斂中
        </div>
        <div className="demo-faux-ticket">
          <span className="demo-faux-tnum">#01</span>
          <span className="demo-faux-tname">OAuth callback 失敗時的 fallback 入口</span>
          <span className="demo-faux-tstate" style={{ color: "var(--done)" }}>done</span>
        </div>
        <div className="demo-faux-ticket">
          <span className="demo-faux-tnum">#02</span>
          <span className="demo-faux-tname">Topbar 推播 sub 狀態 chip 與 settings 同步</span>
          <span className="demo-faux-tstate" style={{ color: "var(--running)" }}>running</span>
        </div>
        <div className="demo-faux-ticket">
          <span className="demo-faux-tnum">#03</span>
          <span className="demo-faux-tname">Settings 撤銷裝置二次確認</span>
          <span className="demo-faux-tstate" style={{ color: "var(--done)" }}>ready</span>
        </div>
        <div className="demo-faux-ticket">
          <span className="demo-faux-tnum">#04</span>
          <span className="demo-faux-tname">iOS Safari 安裝引導浮層</span>
          <span className="demo-faux-tstate" style={{ color: "var(--draft)" }}>draft</span>
        </div>
        <div className="demo-faux-ghostslot">新需求單 · 對話收斂中…</div>
      </div>
    </>
  );
}

/* ─── App ──────────────────────────────────────────────────────────── */

const SCENARIO_OPTS = [
  { v: "bootstrap",     label: "1. bootstrap (no draft + busy)" },
  { v: "welcome",       label: "2. welcome (empty + starters)" },
  { v: "dialogSingle",  label: "3. dialog + single quick reply" },
  { v: "dialogMulti",   label: "4. dialog + InlineMultiSelect" },
  { v: "thinking",      label: "5. waitingForAI 助理思考中" },
  { v: "ready",         label: "6. spec 5/5 + ready-bar" },
  { v: "reviewSimple",  label: "7. review (no split)" },
  { v: "reviewSplit",   label: "8. review + split-proposal (3)" },
];

function App() {
  const [theme, setTheme] = useStateQDR("dark");
  useEffectQDR(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const [scenario, setScenario] = useStateQDR("welcome");
  const [busy, setBusy] = useStateQDR(false);
  const [pipelineName, setPipelineName] = useStateQDR("auth-fallback-pipeline");
  const [showCloseConfirmDemo, setShowCloseConfirmDemo] = useStateQDR(false);
  const [panelCollapsed, setPanelCollapsed] = useStateQDR(false);

  const draft = MOCK_DRAFTS[scenario];
  // bootstrap scenario forces busy=true (沒 draft 才 render bootstrap UI)
  const effectiveBusy = scenario === "bootstrap" ? true : busy;

  // pendingClose demo: stuff text into textarea then click close
  useEffectQDR(() => {
    if (!showCloseConfirmDemo) return;
    const id = requestAnimationFrame(() => {
      const ta = document.getElementById("qadr-composer-textarea");
      if (ta) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        )?.set;
        nativeSetter?.call(ta, "（demo: 假裝這裡有未送出的文字）");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        const closeBtn = document.querySelector(".qadr-drawer .drawer-close.create-x");
        closeBtn?.click();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [showCloseConfirmDemo, scenario]);

  function noop() {}

  return (
    <>
      <FauxBoard pipelineName={pipelineName} scenario={scenario} />

      <QADrawer
        key={scenario /* re-mount so SpecReview's edited state resets */}
        pipelineName={pipelineName}
        draft={draft}
        busy={effectiveBusy}
        onSendTurn={noop}
        onFinalize={noop}
        onCancel={noop}
        onClose={noop}
      />

      <DemoPanel
        collapsed={panelCollapsed}
        onCollapseToggle={() => setPanelCollapsed(v => !v)}
        theme={theme} setTheme={setTheme}
        scenario={scenario} setScenario={(v) => { setShowCloseConfirmDemo(false); setScenario(v); }}
        busy={busy} setBusy={setBusy}
        showCloseConfirmDemo={showCloseConfirmDemo}
        setShowCloseConfirmDemo={setShowCloseConfirmDemo}
        pipelineName={pipelineName} setPipelineName={setPipelineName}
        hasDraft={!!draft}
      />
    </>
  );
}

function DemoPanel(props) {
  const {
    collapsed, onCollapseToggle,
    theme, setTheme,
    scenario, setScenario,
    busy, setBusy,
    showCloseConfirmDemo, setShowCloseConfirmDemo,
    pipelineName, setPipelineName,
    hasDraft,
  } = props;
  return (
    <div className={"demo-panel" + (collapsed ? " is-collapsed" : "")}>
      <div className="demo-collapse">
        <strong>QADRAWER · STATE</strong>
        <button className="demo-toggle" onClick={onCollapseToggle}>
          {collapsed ? "展開" : "收起"}
        </button>
      </div>

      <div className="demo-section">
        <h3>theme</h3>
        <label className="demo-row">
          <span>theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">dark</option>
            <option value="light">light</option>
          </select>
        </label>
      </div>

      <div className="demo-section">
        <h3>scenario (8)</h3>
        <label className="demo-row">
          <span>scenario</span>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIO_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <div className="demo-hint">
          1 = 啟動中, 2 = 起點 chips, 3/4 = 對話進行, 5 = 助理思考, 6 = 規格 ready, 7/8 = 最終預覽。
        </div>
      </div>

      <div className="demo-section">
        <h3>flags</h3>
        <label className="demo-row">
          <span>busy（鎖 composer / actions）</span>
          <input
            type="checkbox"
            checked={busy}
            onChange={(e) => setBusy(e.target.checked)}
          />
        </label>
        <label className="demo-row">
          <span>顯示關閉確認</span>
          <input
            type="checkbox"
            checked={showCloseConfirmDemo}
            onChange={(e) => setShowCloseConfirmDemo(e.target.checked)}
            disabled={!hasDraft}
          />
        </label>
        <div className="demo-hint">
          關閉確認需要先有 draft（scenario ≥ 2）。
        </div>
      </div>

      <div className="demo-section">
        <h3>pipeline name</h3>
        <input
          type="text"
          value={pipelineName}
          onChange={(e) => setPipelineName(e.target.value)}
        />
      </div>

      <div className="demo-section">
        <h3>notes</h3>
        <div className="demo-hint">
          7/8 會自動進 review 視圖（<code>complete=true</code>）。
          按「繼續討論」可回 chat 視圖；若 spec 仍 5/5 會看到 ready-bar 出現
          （<code>viewOverride</code> sticky）。
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
