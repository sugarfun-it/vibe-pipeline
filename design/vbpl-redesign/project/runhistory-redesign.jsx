/* ============================================================================
 * runhistory-redesign.jsx — demo harness for the RunHistory redesign.
 * Mounts the source <RunHistory> verbatim, surrounds it with an app shell,
 * and exposes every state via a control panel.
 *
 * Consumes from runhistory-source.jsx:
 *   RunHistory, fmtDuration, fmtTime, …
 * ========================================================================= */

const { useEffect: useEffectRHX, useMemo: useMemoRHX, useState: useStateRHX } = React;

// ─── close icon (local, redesign-only) ──────────────────────────
function XIconRH(p) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ─── fixtures ───────────────────────────────────────────────────
const T_BASE_RH = Date.parse("2026-05-25T08:30:00Z");
const minutesRH = (m) => m * 60_000;

const RUN_CLAUDE_SUCCESS_RH = {
  filename: "pipe-019e36fbea63-1716624000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716624000000.log",
  startedAt: T_BASE_RH - minutesRH(15),
  exitCode: 0,
  durationMs: 122_000,
  costUsd: 0.483,
  numTurns: 14,
  result: "全 PASS,3 commit。pipeline.state=ready, 可 merge。",
  tokens: { input: 24830, output: 8124, cacheRead: 162000, cacheCreate: 8400, reasoning: 0 },
  sessionId: "sess_01HXYZ8K3M2N1PQR4S5T6U7V8W",
  hasStderr: false,
  provider: "claude",
  model: "claude-opus-4-7",
  failureReason: null,
  ticketsBefore: [
    { id: "t1", status: "draft" },
    { id: "t2", status: "draft" },
    { id: "t3", status: "draft" },
  ],
  ticketsAfter: [
    { id: "t1", status: "done" },
    { id: "t2", status: "done" },
    { id: "t3", status: "done" },
  ],
};

const RUN_CLAUDE_LONG_RH = {
  filename: "pipe-019e36fbea63-1716620000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716620000000.log",
  startedAt: T_BASE_RH - minutesRH(90),
  exitCode: 0,
  durationMs: 3_840_000,
  costUsd: 4.21,
  numTurns: 38,
  result: "iter round 4/5 PASS。t2 split→3 個子 ticket,t3 draft→done。pipeline.state=running",
  tokens: { input: 412300, output: 88240, cacheRead: 1_240_000, cacheCreate: 32_100, reasoning: 18_400 },
  sessionId: "sess_01HXAB1CDE2FG3HI4JK5LM6NO7",
  hasStderr: true,
  provider: "claude",
  model: "claude-sonnet-4-7",
  failureReason: null,
  ticketsBefore: [
    { id: "t2", status: "draft" },
    { id: "t3", status: "draft" },
  ],
  ticketsAfter: [
    { id: "t2", status: "split" },
    { id: "t3", status: "done" },
  ],
};

const RUN_CLAUDE_FAIL_RH = {
  filename: "pipe-019e36fbea63-1716615000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716615000000.log",
  startedAt: T_BASE_RH - minutesRH(180),
  exitCode: 137,
  durationMs: 18_500,
  costUsd: 0.024,
  numTurns: 2,
  result: "critic FAIL · t1 single-file edit 超出 budget",
  tokens: { input: 1820, output: 420, cacheRead: 0, cacheCreate: 0, reasoning: 0 },
  sessionId: "sess_01HXFAIL2A3B4C5D6E7F8G9HI0",
  hasStderr: true,
  provider: "claude",
  model: "claude-opus-4-7",
  failureReason: '{"error":{"message":"API 529: Overloaded — retry after 30s","type":"overloaded_error"},"api_error_status":529}',
  ticketsBefore: [{ id: "t1", status: "draft" }],
  ticketsAfter: [{ id: "t1", status: "draft" }],
};

const RUN_CODEX_SUCCESS_RH = {
  filename: "pipe-019e36fbea63-1716610000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716610000000.log",
  startedAt: T_BASE_RH - minutesRH(280),
  exitCode: 0,
  durationMs: 87_500,
  costUsd: null,
  numTurns: null,
  result: "draft→done,1 commit。state=done",
  tokens: null,
  sessionId: null,
  hasStderr: false,
  provider: "codex",
  model: "gpt-5.5-mini · effort=medium",
  failureReason: null,
  ticketsBefore: [{ id: "t4", status: "draft" }],
  ticketsAfter: [{ id: "t4", status: "done" }],
};

const RUN_CODEX_FAIL_RH = {
  filename: "pipe-019e36fbea63-1716605000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716605000000.log",
  startedAt: T_BASE_RH - minutesRH(380),
  exitCode: 1,
  durationMs: 5_200,
  costUsd: null,
  numTurns: null,
  result: null,
  tokens: null,
  sessionId: null,
  hasStderr: true,
  provider: "codex",
  model: "gpt-5.5 · effort=xhigh",
  failureReason: "spawn ENOENT: codex binary not found in $PATH (~/.local/bin/codex)",
  ticketsBefore: null,
  ticketsAfter: null,
};

const RUN_MIN_RH = {
  filename: "pipe-019e36fbea63-1716600000000.log",
  logPath: "/runtime/logs/pipe-019e36fbea63-1716600000000.log",
  startedAt: T_BASE_RH - minutesRH(520),
  exitCode: 0,
  durationMs: 9_000,
  costUsd: 0.0012,
  numTurns: 1,
  result: null,
  tokens: { input: 240, output: 38, cacheRead: 0, cacheCreate: 0 },
  sessionId: null,
  hasStderr: false,
  provider: "claude",
  model: "claude-haiku-4-7",
  failureReason: null,
  ticketsBefore: null,
  ticketsAfter: null,
};

const FIXTURE_SETS_RH = {
  rich:      [RUN_CLAUDE_SUCCESS_RH, RUN_CLAUDE_LONG_RH, RUN_CLAUDE_FAIL_RH, RUN_CODEX_SUCCESS_RH, RUN_CODEX_FAIL_RH, RUN_MIN_RH],
  single:    [RUN_CLAUDE_SUCCESS_RH],
  failHeavy: [RUN_CLAUDE_FAIL_RH, RUN_CODEX_FAIL_RH],
  codexOnly: [RUN_CODEX_SUCCESS_RH, RUN_CODEX_FAIL_RH],
};

const SHORT_STDOUT_RH = `[09:30:01] orchestrator.spawn ticket=t1
[09:30:02] runner ready, model=claude-opus-4-7
[09:30:18] tool: read_file path=server/lib/runner/index.ts
[09:30:24] tool: edit  path=server/lib/runner/index.ts +12 -3
[09:30:31] tool: run   "bun run typecheck"
[09:30:42] critic: PASS · 12 token, 1 round
[09:30:43] commit abc1234 "feat(runner): expose retry counter"
[09:30:44] orchestrator.exit code=0`;

function buildLongStdoutRH() {
  const lines = [];
  for (let i = 1; i <= 220; i++) {
    if (i === 1) lines.push(`{"type":"system","subtype":"init","model":"claude-opus-4-7","cwd":"/repo"}`);
    else if (i % 18 === 0) lines.push(`{"type":"assistant","message":{"content":[{"type":"text","text":"checkpoint ${i}"}]}}`);
    else if (i % 9 === 0) lines.push(`{"type":"tool_use","tool":"bash","input":{"command":"git status --porcelain"}}`);
    else if (i % 7 === 0) lines.push(`{"type":"tool_result","is_error":false,"content":"ok (${i})"}`);
    else lines.push(`{"type":"progress","step":${i},"detail":"scanning candidate ${i.toString(16)}"}`);
  }
  return lines.join("\n");
}
const LONG_STDOUT_RH = buildLongStdoutRH();

const SHORT_STDERR_RH = `warning: ESLint disabled for this run
warning: bun test --silent suppressed 3 deprecation notices`;
const LONG_STDERR_RH = `[err] 2026-05-25T08:21:11Z worker stalled (ticket=t2)
[err] 2026-05-25T08:21:12Z retry 1/3
[err] 2026-05-25T08:21:18Z retry 2/3
[err] 2026-05-25T08:21:25Z circuit-breaker tripped: model=opus rate-limit (429)
[err] 2026-05-25T08:21:25Z falling back to model=sonnet
[err] 2026-05-25T08:21:32Z worker recovered, resuming pipeline`;

function buildDetailRH(run, opts) {
  const { stdoutMode, stderrMode } = opts;
  let stdout = "";
  if (stdoutMode === "short") stdout = SHORT_STDOUT_RH;
  else if (stdoutMode === "long") stdout = LONG_STDOUT_RH;
  let stderr = "";
  if (run.hasStderr) {
    if (stderrMode === "short") stderr = SHORT_STDERR_RH;
    else if (stderrMode === "long") stderr = LONG_STDERR_RH;
  }
  return { ...run, stdout, stderr };
}

// ─── faux board behind the drawer ──────────────────────────────
function FauxBoardRH() {
  const rows = [
    { n: 1, title: "BoardRail / FocusColumn 整合 split commit 顯示", state: "done",    color: "var(--done)" },
    { n: 2, title: "iter rounds: UNKNOWN → partial fallthrough",      state: "ready",   color: "var(--queued)" },
    { n: 3, title: "TicketDrawer · 顯示 acceptance 進度 chip",        state: "running", color: "var(--running)", active: true },
    { n: 4, title: "Run history drawer 顯示 stdout / stderr",         state: "draft",   color: "var(--draft)" },
  ];
  return (
    <>
      <div className="rh-app-bg" aria-hidden="true" />
      <div className="rh-app-bar">
        <span className="rh-app-brand">
          <span className="rh-app-brand-dot" />
          vbpl
        </span>
        <span className="rh-app-sep">·</span>
        <span className="rh-app-crumb-pipe">pipeline/ui-iter-2026-05-25</span>
        <span className="rh-app-sep">›</span>
        <span className="rh-app-crumb-active">執行紀錄</span>
        <span className="rh-app-spacer" />
        <span className="rh-app-state-toggle" title="pipeline 執行中">
          <span className="dot" />
          running · round 4
        </span>
      </div>
      <div className="rh-faux-tickets" aria-hidden="true">
        <div className="rh-faux-title">ui-iter-2026-05-25</div>
        <div className="rh-faux-sub">4 tickets · 1 done · 1 ready · 1 running · 1 draft</div>
        {rows.map((r) => (
          <div key={r.n} className="rh-faux-ticket">
            <span className="rh-faux-tnum">#{String(r.n).padStart(2, "0")}</span>
            <span className="rh-faux-tname">{r.title}</span>
            <span className="rh-faux-tstate" style={{ color: r.color }}>{r.state}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── App ─────────────────────────────────────────────────────────
function App() {
  const [theme, setTheme] = useStateRHX("dark");
  const [rootState, setRootState] = useStateRHX("populated"); // loading | empty | populated
  const [dataset, setDataset] = useStateRHX("rich");
  const [forceOpenAll, setForceOpenAll] = useStateRHX(false);
  const [detailMode, setDetailMode] = useStateRHX("loaded"); // loaded | loading | error
  const [stdoutMode, setStdoutMode] = useStateRHX("long");
  const [stderrMode, setStderrMode] = useStateRHX("short");
  const [panelOpen, setPanelOpen] = useStateRHX(true);

  useEffectRHX(() => {
    document.documentElement.className = theme === "light" ? "light" : "";
  }, [theme]);

  const baseRuns = FIXTURE_SETS_RH[dataset];
  const runs = useMemoRHX(() => {
    if (rootState === "loading") return null;
    if (rootState === "empty") return [];
    return baseRuns.map((r, idx) => {
      const openByDefault = forceOpenAll || idx === 0;
      const initialDetail =
        openByDefault && detailMode === "loaded"
          ? buildDetailRH(r, { stdoutMode, stderrMode })
          : null;
      return {
        ...r,
        _initialOpen: openByDefault,
        _initialDetail: initialDetail,
        _initialDetailLoading: openByDefault && detailMode === "loading",
        _initialDetailFailed: openByDefault && detailMode === "error",
      };
    });
  }, [rootState, baseRuns, forceOpenAll, detailMode, stdoutMode, stderrMode]);

  const fetchDetail = async (_h, _p, filename) => {
    const r = baseRuns.find((x) => x.filename === filename);
    if (!r) throw new Error("not found");
    if (detailMode === "error") {
      await new Promise((res) => setTimeout(res, 300));
      throw new Error("backend 5xx");
    }
    await new Promise((res) => setTimeout(res, detailMode === "loading" ? 4000 : 350));
    return buildDetailRH(r, { stdoutMode, stderrMode });
  };

  return (
    <>
      <FauxBoardRH />

      <div className="tdrw-drawer" role="dialog" aria-label="pipeline 執行紀錄">
        <div className="tdrw-drawer-head">
          <div>
            <div className="tdrw-drawer-title">執行紀錄</div>
            <div className="pipeline-history-scope">
              pipeline · <span className="mono">019e36fbea63-phase8</span>
            </div>
          </div>
          <button
            type="button"
            className="tdrw-drawer-close"
            aria-label="關閉抽屜"
            onClick={() => alert("(prototype) close drawer")}
            title="關閉抽屜"
          >
            <XIconRH />
          </button>
        </div>

        <div className="drawer-body">
          <div className="pipeline-history-top-summary">
            <div className="pipeline-history-top-summary-line">
              <span className="pipeline-history-top-summary-label">目前狀態</span>
              <span className="pipeline-history-top-summary-state">執行中 · 第 4 輪</span>
              <span className="pipeline-history-top-summary-sep">·</span>
              <span className="pipeline-history-top-summary-line-meta">
                最後變動於 <span className="mono">2026-05-25 08:21</span>
              </span>
            </div>
            <div className="pipeline-history-top-summary-line">
              <span className="pipeline-history-top-summary-label">最後動作</span>
              <span className="pipeline-history-top-summary-reason">critic PASS → executor 接續 t2</span>
            </div>
          </div>

          <RunHistory
            projectHash="proj-demo"
            pipelineId="019e36fbea63"
            onCloseDrawer={() => alert("(prototype) close drawer from empty state")}
            fetchRuns={async () => runs}
            fetchDetail={fetchDetail}
            initialRuns={runs}
          />
        </div>
      </div>

      <DemoPanelRH
        open={panelOpen}
        onToggle={() => setPanelOpen((v) => !v)}
        theme={theme} setTheme={setTheme}
        rootState={rootState} setRootState={setRootState}
        dataset={dataset} setDataset={setDataset}
        forceOpenAll={forceOpenAll} setForceOpenAll={setForceOpenAll}
        detailMode={detailMode} setDetailMode={setDetailMode}
        stdoutMode={stdoutMode} setStdoutMode={setStdoutMode}
        stderrMode={stderrMode} setStderrMode={setStderrMode}
      />
    </>
  );
}

function DemoPanelRH(props) {
  const {
    open, onToggle,
    theme, setTheme,
    rootState, setRootState,
    dataset, setDataset,
    forceOpenAll, setForceOpenAll,
    detailMode, setDetailMode,
    stdoutMode, setStdoutMode,
    stderrMode, setStderrMode,
  } = props;
  return (
    <div className="demo-panel">
      <div className="demo-panel-head" onClick={onToggle}>
        <span className="demo-panel-title">RunHistory · demo</span>
        <span className="demo-panel-toggle">{open ? "收合 ▾" : "展開 ▸"}</span>
      </div>
      {open && (
        <div className="demo-panel-body">
          <Row label="主題">
            {["dark", "light"].map((v) => (
              <Chip key={v} active={theme === v} onClick={() => setTheme(v)}>{v}</Chip>
            ))}
          </Row>
          <hr className="demo-divider" />
          <Row label="root state">
            {[
              ["populated", "populated"],
              ["empty", "empty"],
              ["loading", "loading"],
            ].map(([v, label]) => (
              <Chip key={v} active={rootState === v} onClick={() => setRootState(v)}>{label}</Chip>
            ))}
          </Row>
          <Row label="dataset">
            {[
              ["rich", "rich (6 runs)"],
              ["single", "single"],
              ["failHeavy", "fail-heavy"],
              ["codexOnly", "codex-only"],
            ].map(([v, label]) => (
              <Chip key={v} active={dataset === v} onClick={() => setDataset(v)}>{label}</Chip>
            ))}
          </Row>
          <label className="demo-toggle">
            <input
              type="checkbox"
              checked={forceOpenAll}
              onChange={(e) => setForceOpenAll(e.target.checked)}
            />
            展開全部 run cards
          </label>
          <hr className="demo-divider" />
          <Row label="detail state">
            {[
              ["loaded", "loaded"],
              ["loading", "loading"],
              ["error", "error + retry"],
            ].map(([v, label]) => (
              <Chip key={v} active={detailMode === v} onClick={() => setDetailMode(v)}>{label}</Chip>
            ))}
          </Row>
          <Row label="stdout">
            {[
              ["empty", "empty"],
              ["short", "short"],
              ["long", "long (>80)"],
            ].map(([v, label]) => (
              <Chip key={v} active={stdoutMode === v} onClick={() => setStdoutMode(v)}>{label}</Chip>
            ))}
          </Row>
          <Row label="stderr">
            {[
              ["empty", "empty"],
              ["short", "short"],
              ["long", "long"],
            ].map(([v, label]) => (
              <Chip key={v} active={stderrMode === v} onClick={() => setStderrMode(v)}>{label}</Chip>
            ))}
          </Row>
          <div className="demo-hint">
            run card 1 永遠是預設展開的(可看到 detail/stdout/stderr 區塊變化)
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="demo-row">
      <span className="demo-row-label">{label}</span>
      <div className="demo-row-controls">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={"demo-chip" + (active ? " is-active" : "")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
