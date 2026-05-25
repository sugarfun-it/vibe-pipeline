/* ============================================================================
   TicketDrawer Redesign — demo app
   Uses verbatim TicketDrawer / Overlay / AuditTimeline / etc from
   ticketdrawer-source.jsx (loaded earlier as a sibling script).
   Adds a fixture-driven demo panel that switches through every state.
   ============================================================================ */

const { useState: useStateTDR, useEffect: useEffectTDR, useMemo: useMemoTDR } = React;

/* ─── fixtures ──────────────────────────────────────────────────────── */

const LONG_PROMPT_TDR =
  "請你協助設計並實作 TicketDrawer 元件的迭代任務狀態顯示。\n\n" +
  "## 需求\n\n" +
  "- 每一輪 iter 都顯示一個 round card,內含 #N、verdict chip、執行時間、執行 AI 摘要、審核 AI 回饋。\n" +
  "- PASS / FAIL / PARTIAL 三種 verdict 各用不同 tone 顯色;UNKNOWN 視為 partial。\n" +
  "- 空 feedback 時顯 placeholder,不可整段隱藏(否則 user 以為審核沒跑)。\n\n" +
  "## 互動\n\n" +
  "1. drawer 從右側 slide-in,scrim 點擊或 ESC 可關閉。\n" +
  "2. 若有 inline AI 拆分確認卡開著,ESC 先收確認卡,不關 drawer。\n" +
  "3. commit hash 可點擊複製完整 hash;chip 浮在 hash 上方做視覺回饋。\n" +
  "4. 提示詞超過 400 字會折疊,fade 遮罩 + 「展開全部 · 共 N 字」按鈕。\n\n" +
  "## 邊界\n\n" +
  "- synthetic mode(merge / sync)不可切 mode、不可拆、不可刪。\n" +
  "- running 狀態不可刪(撞 runner);只 draft / ready 可切 mode、可拆。\n" +
  "- 只 terminal status(done / failed / failed_iter_limit / failed_transient)可重開。\n";

const FIXTURE_AUDIT_TDR = [
  { ts: Date.parse("2026-05-25T05:42:18"), pipelineId: "p1", type: "state_change",
    from: "ready", to: "merged", source: "user-action", sourceDetail: "click 合併入 main" },
  { ts: Date.parse("2026-05-25T05:30:02"), pipelineId: "p1", type: "state_change",
    from: "running", to: "ready", source: "runner-self-detected", sourceDetail: "all tickets done" },
  { ts: Date.parse("2026-05-25T03:11:50"), pipelineId: "p1", type: "state_change",
    from: "queued", to: "running", source: "orchestrator.spawnDirect", sourceDetail: "ticket 2 started" },
  { ts: Date.parse("2026-05-25T03:11:48"), pipelineId: "p1", type: "state_change",
    from: "planning", to: "queued", source: "user-action", sourceDetail: "tickets added (3)" },
  { ts: Date.parse("2026-05-25T03:10:00"), pipelineId: "p1", type: "state_change",
    from: "draft", to: "planning", source: "api-handler-explicit", sourceDetail: "pipeline created" },
];

const FIXTURE_COMMITS_TDR = [
  { hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", subject: "feat(ticket): TicketDrawer outcome section reorder for done state", ts: Date.parse("2026-05-25T05:28:14") },
  { hash: "f1e2d3c4b5a69788776655443322110099aabbcc", subject: "refactor(iter): normalize verdict to PASS/FAIL/PARTIAL", ts: Date.parse("2026-05-25T04:51:02") },
  { hash: "9988776655443322110099aabbccddeeff001122", subject: "fix(drawer): ESC inside IterLimitField should not close drawer", ts: Date.parse("2026-05-25T03:42:30") },
];

const FIXTURE_ROUNDS_TDR = [
  { n: 1, startedAt: 1735000000000, endedAt: 1735000120000,
    executorSummary: "建立 IterRounds 元件骨架、定義 round card grid + verdict 顏色 token。",
    criticVerdict: "FAIL",
    criticFeedback: "驗收第 2 條未滿足:UNKNOWN verdict 應視為 partial,目前 fallthrough 沒處理。" },
  { n: 2, startedAt: 1735000120000, endedAt: 1735000240000,
    executorSummary: "補 UNKNOWN → partial,加 normalizeVerdict helper,並更新 IterRounds 使用點。",
    criticVerdict: "PARTIAL",
    criticFeedback: "normalize 已對,但 PASS round 的 feedback 為空時整段隱藏,違反需求 3。" },
  { n: 3, startedAt: 1735000240000, endedAt: 1735000312000,
    executorSummary: "feedback empty 改 placeholder「(通過,無補充意見)」 / 「(無 feedback)」",
    criticVerdict: "PASS",
    criticFeedback: "" },
];

const FIXTURE_ROUNDS_FAILED = [
  { n: 1, startedAt: 1735000000000, endedAt: 1735000080000,
    executorSummary: "嘗試 commit 但 normalize helper 漏一個 case。",
    criticVerdict: "FAIL",
    criticFeedback: "feedback 為空時被隱藏。" },
  { n: 2, startedAt: 1735000080000, endedAt: 1735000180000,
    executorSummary: "改 placeholder 顯示但 acceptance 第 2 條 colour token 還沒對。",
    criticVerdict: "FAIL",
    criticFeedback: "is-partial 應該用 paused token 不是 fg-mute。" },
  { n: 3, startedAt: 1735000180000, endedAt: 1735000300000,
    executorSummary: "對齊 verdict tone token,但有殘留 inline style。",
    criticVerdict: "PARTIAL",
    criticFeedback: "inline style 該抽 class。" },
  { n: 4, startedAt: 1735000300000, endedAt: 1735000400000,
    executorSummary: "抽 class,但 normalize 還是漏 case=0。",
    criticVerdict: "FAIL",
    criticFeedback: "normalize(0) 應 → PARTIAL 不是 UNKNOWN。" },
  { n: 5, startedAt: 1735000400000, endedAt: 1735000520000,
    executorSummary: "補 case=0,但 e2e snapshot 還沒更新。",
    criticVerdict: "FAIL",
    criticFeedback: "e2e 應跟著修。" },
];

function makeBaseTicketTDR() {
  return {
    id: "tkt-001",
    n: 2,
    title: "TicketDrawer iter rounds 顯示優化",
    goal: "讓 user 能在 drawer 內一眼看出每一輪 iter 的執行與審核結果,以及失敗時 feedback 的全文。",
    acceptance: [
      "每一輪 round 顯示 #N、verdict chip、執行時間、執行 AI 摘要、審核 AI 回饋。",
      "PASS / FAIL / PARTIAL 三種 verdict 各用不同 tone 顯色。",
      "空 feedback 時顯 placeholder,不整段隱藏。",
    ],
    prompt: LONG_PROMPT_TDR,
    mode: "iter",
    status: "draft",
    iterLimit: 5,
    iterStopAtLimit: true,
  };
}

const STATUS_OPTIONS_TDR = ["draft", "ready", "running", "paused", "done", "failed", "failed_iter_limit", "failed_transient"];
const MODE_OPTIONS_TDR = ["step", "iter", "merge", "sync"];
const SECTION_PRESETS_TDR = ["minimal", "iter-running", "iter-with-rounds", "done-with-commits", "failed-with-reason", "running-with-livelog", "all-fields"];
const AUDIT_OPTIONS_TDR = ["none", "loading", "empty", "5 entries"];
const PROMPT_OPTIONS_TDR = ["long-markdown", "short", "empty"];
const BRANCH_OPTIONS_TDR = ["with-branch", "no-branch"];
const CONFIRM_OPTIONS_TDR = ["auto-confirm", "auto-cancel", "real-dialog"];

/* ─── Faux board behind the drawer ─────────────────────────────────── */

function FauxBoard({ pipelineName, ticketN, ticketTitle, status }) {
  // mimic a focus column with the active ticket highlighted
  const rows = [
    { n: 1, title: "TicketDrawer 加 audit timeline empty state", state: "done", color: "var(--done)" },
    { n: 2, title: ticketTitle, state: status, color: "var(--accent)", active: true },
    { n: 3, title: "Commits 顯示優化、按鈕複製 hash", state: "ready", color: "var(--done)" },
    { n: 4, title: "RWD: drawer 在 mobile 全螢幕貼齊", state: "draft", color: "var(--draft)" },
    { n: 5, title: "split confirm 卡 ESC 鍵收合行為", state: "draft", color: "var(--draft)" },
  ];
  return (
    <>
      <div className="demo-stage-bg" />
      <div className="demo-faux-board">
        <span className="demo-brand">
          <span className="demo-brand-dot" />
          vbpl
        </span>
        <span className="demo-sep">·</span>
        <span className="demo-crumb-pipeline">pipeline/{pipelineName}</span>
        <span className="demo-sep">›</span>
        <span className="demo-crumb-active">Ticket #{String(ticketN).padStart(2, "0")}</span>
      </div>
      <div className="demo-faux-tickets" aria-hidden="true">
        <div className="demo-faux-title">{pipelineName}</div>
        <div className="demo-faux-sub">
          5 tickets · 2 done · 1 running · 2 ready
        </div>
        {rows.map((r) => (
          <div
            key={r.n}
            className={"demo-faux-ticket" + (r.active ? " is-active" : "")}
          >
            <span className="demo-faux-tnum">#{String(r.n).padStart(2, "0")}</span>
            <span className="demo-faux-tname">{r.title}</span>
            <span className="demo-faux-tstate" style={{ color: r.color }}>
              {r.state}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── App ──────────────────────────────────────────────────────────── */

function App() {
  const [theme, setTheme] = useStateTDR("dark");
  useEffectTDR(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const [status, setStatus] = useStateTDR("draft");
  const [mode, setMode] = useStateTDR("iter");
  const [sectionPreset, setSectionPreset] = useStateTDR("iter-with-rounds");
  const [auditOpt, setAuditOpt] = useStateTDR("5 entries");
  const [promptOpt, setPromptOpt] = useStateTDR("long-markdown");
  const [branchOpt, setBranchOpt] = useStateTDR("with-branch");
  const [iterLimitOverride, setIterLimitOverride] = useStateTDR(5);
  const [isSplitting, setIsSplitting] = useStateTDR(false);
  const [confirmMode, setConfirmMode] = useStateTDR("real-dialog");
  const [enableActions, setEnableActions] = useStateTDR(true);
  const [panelCollapsed, setPanelCollapsed] = useStateTDR(false);

  const [confirmState, setConfirmState] = useStateTDR(null);

  const ticket = useMemoTDR(() => {
    const t = makeBaseTicketTDR();
    t.status = status;
    t.mode = mode;
    t.iterLimit = iterLimitOverride;

    if (promptOpt === "short") {
      t.prompt = "在 IterRounds 內顯每輪 verdict + feedback。";
    } else if (promptOpt === "empty") {
      t.prompt = "";
    } else {
      t.prompt = LONG_PROMPT_TDR;
    }

    t.iter = undefined;
    t.commits = undefined;
    t.liveLog = undefined;
    t.reason = undefined;

    if (sectionPreset === "minimal") {
      // nothing extra
    } else if (sectionPreset === "iter-running") {
      t.iter = { current: 2, stage: "critic", verdicts: ["FAIL", "PARTIAL"], rounds: FIXTURE_ROUNDS_TDR.slice(0, 2) };
    } else if (sectionPreset === "iter-with-rounds") {
      t.iter = { current: 3, stage: "done", verdicts: ["FAIL", "PARTIAL", "PASS"], rounds: FIXTURE_ROUNDS_TDR };
    } else if (sectionPreset === "done-with-commits") {
      t.iter = { current: 3, stage: "done", verdicts: ["FAIL", "PARTIAL", "PASS"], rounds: FIXTURE_ROUNDS_TDR };
      t.commits = FIXTURE_COMMITS_TDR;
    } else if (sectionPreset === "failed-with-reason") {
      t.iter = { current: 5, stage: "done", verdicts: ["FAIL","FAIL","PARTIAL","FAIL","FAIL"], rounds: FIXTURE_ROUNDS_FAILED };
      t.reason = "達 iter 上限 5 輪審核仍未通過,執行流程暫停,等使用者手動接手。";
    } else if (sectionPreset === "running-with-livelog") {
      t.iter = { current: 2, stage: "doer", verdicts: ["FAIL"], rounds: FIXTURE_ROUNDS_TDR.slice(0, 1) };
      t.liveLog =
        "[runner] 第 2 輪 executor 啟動 (claude-opus-4-7 / high)\n" +
        "[runner] 讀取 acceptance + critic feedback...\n" +
        "[runner] worktree git status: clean\n" +
        "[runner] subagent 派出 prompt size=4.2KB\n" +
        "[executor] tool_use=Edit src/features/pipeline/TicketDrawer.tsx\n" +
        "[executor] tool_use=Edit src/features/pipeline/ticketDrawer.css\n" +
        "[runner] elapsed=00:42 — executor 仍在執行...";
    } else if (sectionPreset === "all-fields") {
      t.iter = { current: 3, stage: "done", verdicts: ["FAIL","PARTIAL","PASS"], rounds: FIXTURE_ROUNDS_TDR };
      t.commits = FIXTURE_COMMITS_TDR;
      t.liveLog = "[runner] 第 3 輪 critic PASS,ticket done。\n[runner] worktree 仍開,等 pipeline next ticket。";
      t.reason = "iter 通過,所有 acceptance 條件已滿足。";
    }
    return t;
  }, [status, mode, sectionPreset, iterLimitOverride, promptOpt]);

  const auditEntries =
    auditOpt === "none" ? null :
    auditOpt === "loading" ? null :
    auditOpt === "empty" ? [] :
    FIXTURE_AUDIT_TDR;

  function requestConfirm(opts) {
    if (confirmMode === "auto-confirm") return Promise.resolve(true);
    if (confirmMode === "auto-cancel") return Promise.resolve(false);
    return new Promise((resolve) => {
      setConfirmState({
        opts,
        resolve: (r) => { setConfirmState(null); resolve(r === "confirm"); },
      });
    });
  }

  // Render the Drawer wired with a custom stage class so we can host it
  // inside the demo backdrop rather than at viewport-level fixed.
  return (
    <>
      <FauxBoard
        pipelineName="ui-iter-2026-05-25"
        ticketN={ticket.n}
        ticketTitle={ticket.title}
        status={ticket.status}
      />

      <DrawerHost>
        <TicketDrawer
          ticket={ticket}
          pipelineName="ui-iter-2026-05-25"
          pipelineBranch={branchOpt === "with-branch" ? "pipeline/ui-iter-2026-05-25-a1b2" : ""}
          pipelineId="p1"
          projectHash="ab12cd34"
          auditEntries={auditEntries}
          isSplitting={isSplitting}
          onClose={() => alert("(demo) drawer onClose — 真實環境會回到 BoardScreen / FocusColumn")}
          onResetTicket={enableActions ? async (id) => { console.log("reset", id); alert("(demo) ticket reset 已派出"); } : undefined}
          onSplitTicket={enableActions ? async (id) => {
            console.log("split", id);
            setIsSplitting(true);
            setTimeout(() => setIsSplitting(false), 2500);
          } : undefined}
          onDeleteTicket={enableActions ? async (id) => { console.log("delete", id); alert("(demo) ticket 已刪除"); } : undefined}
          onToggleMode={enableActions ? async (id, next) => { console.log("toggle mode", id, next); setMode(next); } : undefined}
          onChangeIterLimit={enableActions ? async (id, n) => { console.log("change iter limit", id, n); setIterLimitOverride(n); } : undefined}
          onRequestConfirm={requestConfirm}
        />
      </DrawerHost>

      <ConfirmDialog
        open={!!confirmState}
        opts={confirmState?.opts}
        onResult={(r) => confirmState?.resolve(r)}
      />

      <DemoPanel
        collapsed={panelCollapsed}
        onCollapseToggle={() => setPanelCollapsed(v => !v)}
        theme={theme} setTheme={setTheme}
        status={status} setStatus={setStatus}
        mode={mode} setMode={setMode}
        sectionPreset={sectionPreset} setSectionPreset={setSectionPreset}
        auditOpt={auditOpt} setAuditOpt={setAuditOpt}
        promptOpt={promptOpt} setPromptOpt={setPromptOpt}
        branchOpt={branchOpt} setBranchOpt={setBranchOpt}
        iterLimitOverride={iterLimitOverride} setIterLimitOverride={setIterLimitOverride}
        isSplitting={isSplitting} setIsSplitting={setIsSplitting}
        enableActions={enableActions} setEnableActions={setEnableActions}
        confirmMode={confirmMode} setConfirmMode={setConfirmMode}
      />
    </>
  );
}

/* DrawerHost: the source uses .tdrw-stage (position:fixed). We tag it with
   --demo-host so our redesign CSS can scope a few overrides without touching
   the actual TicketDrawer component. */
function DrawerHost({ children }) {
  useEffectTDR(() => {
    // Mark the stage element after it mounts.
    const stages = document.querySelectorAll(".tdrw-stage");
    stages.forEach((s) => s.classList.add("tdrw-stage--demo-host"));
  });
  return <>{children}</>;
}

function DemoPanel(props) {
  const {
    collapsed, onCollapseToggle,
    theme, setTheme,
    status, setStatus,
    mode, setMode,
    sectionPreset, setSectionPreset,
    auditOpt, setAuditOpt,
    promptOpt, setPromptOpt,
    branchOpt, setBranchOpt,
    iterLimitOverride, setIterLimitOverride,
    isSplitting, setIsSplitting,
    enableActions, setEnableActions,
    confirmMode, setConfirmMode,
  } = props;
  return (
    <div className={"demo-panel" + (collapsed ? " is-collapsed" : "")}>
      <div className="demo-collapse">
        <strong>TICKETDRAWER · STATE</strong>
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
        <h3>ticket.status (8)</h3>
        <label className="demo-row">
          <span>status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="demo-hint">
          terminal → 顯「重開」 · draft/ready → 顯「AI 拆分」 · running → 不可刪
        </div>
      </div>

      <div className="demo-section">
        <h3>ticket.mode (4)</h3>
        <label className="demo-row">
          <span>mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODE_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="demo-hint">
          merge / sync 不可切 / 不可拆 / 不可刪。iter + draft/ready → 顯 iter limit。
        </div>
      </div>

      <div className="demo-section">
        <h3>section content preset</h3>
        <label className="demo-row">
          <span>preset</span>
          <select value={sectionPreset} onChange={(e) => setSectionPreset(e.target.value)}>
            {SECTION_PRESETS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="demo-hint">
          控制 iter / commits / liveLog / reason 是否存在。
        </div>
      </div>

      <div className="demo-section">
        <h3>prompt 內容</h3>
        <label className="demo-row">
          <span>prompt</span>
          <select value={promptOpt} onChange={(e) => setPromptOpt(e.target.value)}>
            {PROMPT_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="demo-section">
        <h3>iter limit (1–5)</h3>
        <label className="demo-row">
          <span>iterLimit</span>
          <select value={String(iterLimitOverride)} onChange={(e) => setIterLimitOverride(Number(e.target.value))}>
            {[1,2,3,4,5].map(n => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </label>
        <div className="demo-hint">
          要看 invalid:直接在 drawer 的 input 內打 0 / 6 / 空。
        </div>
      </div>

      <div className="demo-section">
        <h3>breadcrumb branch</h3>
        <label className="demo-row">
          <span>branch chip</span>
          <select value={branchOpt} onChange={(e) => setBranchOpt(e.target.value)}>
            {BRANCH_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="demo-section">
        <h3>AuditTimeline</h3>
        <label className="demo-row">
          <span>entries</span>
          <select value={auditOpt} onChange={(e) => setAuditOpt(e.target.value)}>
            {AUDIT_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="demo-section">
        <h3>footer 狀態</h3>
        <label className="demo-row">
          <span>isSplitting</span>
          <input type="checkbox" checked={isSplitting} onChange={(e) => setIsSplitting(e.target.checked)} />
        </label>
        <label className="demo-row">
          <span>actions 可用</span>
          <input type="checkbox" checked={enableActions} onChange={(e) => setEnableActions(e.target.checked)} />
        </label>
      </div>

      <div className="demo-section">
        <h3>ConfirmDialog</h3>
        <label className="demo-row">
          <span>reset/delete</span>
          <select value={confirmMode} onChange={(e) => setConfirmMode(e.target.value)}>
            {CONFIRM_OPTIONS_TDR.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
