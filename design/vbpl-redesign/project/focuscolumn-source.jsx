// FocusColumn — JSX SSOT for claude.ai/design reverse handoff.
//
// Source coverage(verbatim DOM / className alignment):
//   - src/features/pipeline/FocusColumn.tsx      (top-level shell)
//   - src/features/pipeline/FocusHeader.tsx      (title row + meta row + actions)
//   - src/features/pipeline/FocusTitle.tsx       (view / edit modes)
//   - src/features/pipeline/OverflowMenu.tsx     (⋯ menu, items, separators)
//   - src/features/pipeline/SyncStatusBar.tsx    (sync chip — 6 states)
//   - src/features/pipeline/FocusDiffChip.tsx    (diff chip)
//   - src/features/pipeline/ReadyBanner.tsx      (4 variants × queued sub-branch)
//   - src/features/pipeline/RunButton.tsx        (8 visible visual states)
//   - src/features/pipeline/FocusTicketList.tsx  (empty / list render)
//   - src/features/pipeline/EmptyTickets.tsx     (active draft vs first ticket)
//   - src/features/pipeline/TicketCard.tsx       (every status × mode × iter branch)
//   - src/features/pipeline/IterStages.tsx       (past/active/future × verdict marks)
//   - shared/types.ts                            (PipelineState / TicketStatus / TicketMode / IterStage / SyncJobState / MODE_LABELS)
//   - src/data/pipelines.ts                      (STATE_COLOR / STATE_LABEL / TICKET_STATUS_LABEL / TICKET_STATUS_COLOR / fmtElapsed / normalizeVerdict)
//
// PipelineHistoryDrawer / DiffModal / SyncConflictModal / Popover / ConfirmDialog
// are stubbed inline (proto-mock-modal) — own component scope; design 端對它們各自迭代時另開 reference。
//
// Stub strategy:
//   - fetch / useApi / useTimeout / api.* :  inline fixture data sets, swap via demo control
//   - tick:  setInterval(1000) (TicketCard live timers / sync ai_running elapsed)
//   - icons:  inline minimal SVG matching src/ui/icons.tsx visual semantics

const { useEffect, useId, useMemo, useRef, useState } = React;

// ─── Constants (verbatim from shared/types.ts + src/data/pipelines.ts) ───

const STATE_COLOR = {
  paused: "var(--paused)",
  running: "var(--running)",
  queued: "var(--queued)",
  ready: "var(--done)",
  planning: "var(--draft)",
  failed: "var(--failed)",
  merged: "var(--fg-faint)",
  done: "var(--done)",
  draft: "var(--draft)",
  failed_iter_limit: "var(--failed)",
  failed_transient: "var(--failed)",
};

const STATE_LABEL = {
  paused: "暫停",
  running: "執行中",
  queued: "排隊中",
  ready: "可合併",
  planning: "規劃中",
  failed: "失敗",
  merged: "已合併",
};

const TICKET_STATUS_LABEL = {
  draft: "未執行",
  ready: "未執行",
  running: "執行中",
  paused: "暫停",
  done: "完成",
  failed: "失敗",
  failed_iter_limit: "達 iter 上限",
  failed_transient: "暫時錯誤",
};

const TICKET_STATUS_COLOR = {
  draft: "var(--draft)",
  ready: "var(--draft)",
  running: "var(--running)",
  paused: "var(--paused)",
  done: "var(--done)",
  failed: "var(--failed)",
  failed_iter_limit: "var(--failed)",
  failed_transient: "var(--failed)",
};

const MODE_LABELS = {
  iter: "迭代任務",
  step: "單次任務",
  merge: "AI 合併",
  sync: "AI 同步",
};

const STAGE_LABEL = {
  doer: "執行",
  critic: "審核",
  "✓": "結果",
  done: "結果",
};

function fmtElapsed(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function normalizeVerdict(v) {
  if (v == null) return "UNKNOWN";
  const k = typeof v === "string" ? v.toUpperCase() : String(v);
  if (k === "PASS" || k === "1") return "PASS";
  if (k === "FAIL" || k === "-1") return "FAIL";
  if (k === "PARTIAL" || k === "0") return "PARTIAL";
  return "UNKNOWN";
}

function fmtVerdict(v) {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "未知";
  if (n === "PARTIAL") return "部分通過";
  if (n === "PASS") return "通過";
  if (n === "FAIL") return "失敗";
  return String(v);
}
function verdictToken(v) {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "unknown";
  if (n === "PARTIAL") return "part";
  if (n === "PASS") return "pass";
  if (n === "FAIL") return "fail";
  return "unknown";
}

// ─── Inline icons (semantics aligned with src/ui/icons.tsx) ─────────────

const Svg = ({ children, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>;
const PlayIcon = () => <Svg><path d="M4 3l9 5-9 5V3z" fill="currentColor" /></Svg>;
const StopIcon = () => <Svg><rect x="4" y="4" width="8" height="8" fill="currentColor" /></Svg>;
const HourglassIcon = () => <Svg><path d="M4 2h8M4 14h8M5 2c0 3 2 4 3 6 1-2 3-3 3-6M5 14c0-3 2-4 3-6 1 2 3 3 3 6" /></Svg>;
const PencilIcon = () => <Svg><path d="M11 2l3 3-8 8H3v-3l8-8z" /></Svg>;
const CheckIconSm = () => <Svg size={12}><path d="M3 8l3 3 7-7" /></Svg>;
const CloseIcon = () => <Svg size={12}><path d="M3 3l10 10M13 3L3 13" /></Svg>;
const DotsHorizontalIcon = () => <Svg><circle cx="4" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12" cy="8" r="1" fill="currentColor" /></Svg>;
const ChevronRightIcon = ({ className, ...rest }) => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}><path d="M6 4l4 4-4 4" /></svg>;
const ArrowRightIcon = () => <Svg size={11}><path d="M3 8h10M9 4l4 4-4 4" /></Svg>;
const CheckCircleIcon = () => <Svg size={18}><circle cx="8" cy="8" r="6.5" /><path d="M5 8l2 2 4-4" /></Svg>;
const MergeIcon = () => <Svg><path d="M5 3v6c0 2 2 4 4 4M11 3v10M11 7l-2-2M11 7l2-2" /></Svg>;
const SpinnerIcon = () => <span className="spin" style={{ display: "inline-flex" }}><Svg size={16}><path d="M8 2a6 6 0 0 1 6 6" /></Svg></span>;
const WarnIcon = () => <Svg size={18}><path d="M8 2l6.5 11h-13L8 2z" /><path d="M8 6v4M8 12v.5" /></Svg>;
const FolderIcon = () => <Svg><path d="M2 5l1-1h4l1 1h5v7H2V5z" /></Svg>;
const HistoryIcon = () => <Svg><circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" /></Svg>;
const RefreshIcon = () => <Svg size={13}><path d="M3 8a5 5 0 0 1 9-3M13 4v3h-3M13 8a5 5 0 0 1-9 3M3 12V9h3" /></Svg>;
const TrashIcon = () => <Svg><path d="M3 4h10M6 4V3h4v1M5 4l1 9h4l1-9" /></Svg>;

// ─── Fixture pipelines (covers every state matrix the components branch on) ──

function nowMinus(sec) { return Date.now() - sec * 1000; }

const TICKET_FIXTURES = {
  draft: {
    id: "t-draft", n: 1, title: "草稿 ticket — 還沒執行", mode: "step", status: "draft",
    goal: "把 settings 設定面板抽成獨立 popover,跟 topbar action 分離"
  },
  ready: {
    id: "t-ready", n: 2, title: "已就緒 ticket — 等待 runner 接手", mode: "iter", status: "ready",
    iterLimit: 5, goal: "驗收條件改成可機讀 list"
  },
  running_step: {
    id: "t-running-step", n: 3, title: "step ticket 跑中 — 純 doer", mode: "step", status: "running",
    startedAt: nowMinus(45), goal: "把 toast 端送進 portal",
    liveLog: "[runner] writing src/ui/Toast.tsx ..."
  },
  running_iter_doer: {
    id: "t-iter-doer", n: 4, title: "iter ticket round 2 — doer 執行中", mode: "iter", status: "running",
    iterLimit: 5, iterStopAtLimit: true, startedAt: nowMinus(900),
    goal: "把 NumberField primitive 抽出,讓 settings / drawer 同款",
    liveLog: "[doer] editing src/ui/NumberField.tsx ...",
    iter: {
      current: 2, stage: "doer",
      verdicts: ["FAIL"],
      rounds: [
        { n: 1, startedAt: nowMinus(1400), endedAt: nowMinus(900), criticVerdict: "FAIL", criticFeedback: "缺 disabled 樣式" },
        { n: 2, startedAt: nowMinus(900) }
      ]
    }
  },
  running_iter_critic: {
    id: "t-iter-critic", n: 5, title: "iter ticket round 3 — critic 審核中", mode: "iter", status: "running",
    iterLimit: 5, startedAt: nowMinus(1800),
    goal: "TopBar 加 sync indicator + offline state",
    iter: {
      current: 3, stage: "critic",
      verdicts: ["FAIL", "PARTIAL"],
      rounds: [
        { n: 1, startedAt: nowMinus(2700), endedAt: nowMinus(2200), criticVerdict: "FAIL" },
        { n: 2, startedAt: nowMinus(2200), endedAt: nowMinus(1800), criticVerdict: "PARTIAL", criticFeedback: "部分通過,offline state 還缺" },
        { n: 3, startedAt: nowMinus(1800) }
      ]
    }
  },
  paused_iter: {
    id: "t-paused-iter", n: 6, title: "iter ticket round 2 — 已暫停", mode: "iter", status: "paused",
    iterLimit: 5, startedAt: nowMinus(7200), reason: "user 手動暫停以檢查 worktree",
    goal: "整理 toast / notif 統一 emit 路徑",
    iter: {
      current: 2, stage: "critic",
      verdicts: ["FAIL"],
      rounds: [
        { n: 1, startedAt: nowMinus(7700), endedAt: nowMinus(7400), criticVerdict: "FAIL" },
        { n: 2, startedAt: nowMinus(7400), endedAt: nowMinus(7200) }
      ]
    }
  },
  done_step: {
    id: "t-done-step", n: 7, title: "step ticket 完成 — 單輪終結", mode: "step", status: "done",
    startedAt: nowMinus(600), endedAt: nowMinus(120),
    goal: "init wizard token 對齊"
  },
  done_iter: {
    id: "t-done-iter", n: 8, title: "iter ticket 完成 — 3 輪 PASS", mode: "iter", status: "done",
    iterLimit: 5, startedAt: nowMinus(4500), endedAt: nowMinus(120),
    goal: "QA drawer 對話流轉統一 reopen logic",
    iter: {
      current: 3, stage: "✓",
      verdicts: ["FAIL", "PARTIAL", "PASS"],
      rounds: [
        { n: 1, startedAt: nowMinus(4500), endedAt: nowMinus(3600), criticVerdict: "FAIL" },
        { n: 2, startedAt: nowMinus(3600), endedAt: nowMinus(2400), criticVerdict: "PARTIAL" },
        { n: 3, startedAt: nowMinus(2400), endedAt: nowMinus(120),  criticVerdict: "PASS" }
      ]
    }
  },
  failed_step: {
    id: "t-failed-step", n: 9, title: "step ticket 失敗 — runner exit 1", mode: "step", status: "failed",
    startedAt: nowMinus(300), endedAt: nowMinus(60),
    reason: "exit code 1 — bun install 找不到 package",
    goal: "加 settings update 全進度條"
  },
  failed_iter_limit: {
    id: "t-failed-limit", n: 10, title: "iter ticket — 達 iter 上限失敗", mode: "iter", status: "failed_iter_limit",
    iterLimit: 5, startedAt: nowMinus(6000), endedAt: nowMinus(60),
    reason: "5 輪 critic 都未通過,放棄並標 failed_iter_limit",
    goal: "把 BoardRail 改成 collapsible 抽屜",
    iter: {
      current: 5, stage: "critic",
      verdicts: ["FAIL", "PARTIAL", "FAIL", "FAIL", "FAIL"],
      rounds: [
        { n: 1, startedAt: nowMinus(6000), endedAt: nowMinus(5000), criticVerdict: "FAIL" },
        { n: 2, startedAt: nowMinus(5000), endedAt: nowMinus(4000), criticVerdict: "PARTIAL" },
        { n: 3, startedAt: nowMinus(4000), endedAt: nowMinus(3000), criticVerdict: "FAIL" },
        { n: 4, startedAt: nowMinus(3000), endedAt: nowMinus(2000), criticVerdict: "FAIL" },
        { n: 5, startedAt: nowMinus(2000), endedAt: nowMinus(60),   criticVerdict: "FAIL" }
      ]
    }
  },
  failed_transient: {
    id: "t-failed-tr", n: 11, title: "iter ticket — 暫時錯誤(network/CLI fail)", mode: "iter", status: "failed_transient",
    iterLimit: 5, startedAt: nowMinus(400), endedAt: nowMinus(30),
    reason: "claude CLI spawn 超時,re-run 即可恢復",
    goal: "更新 README 遠端設定段落"
  },
  merge_running: {
    id: "t-merge-running", n: 99, title: "AI 合併 — 進行中", mode: "merge", status: "running",
    startedAt: nowMinus(40),
    goal: "把 pipeline/feat-ui-refresh 合進 main",
    liveLog: "[merge-ai] resolving conflict in src/styles/board.css ...",
    iter: {
      current: 1, stage: "doer", verdicts: [],
      rounds: [{ n: 1, startedAt: nowMinus(40) }]
    }
  },
  merge_failed: {
    id: "t-merge-failed", n: 99, title: "AI 合併 — 失敗", mode: "merge", status: "failed",
    startedAt: nowMinus(120), endedAt: nowMinus(30),
    reason: "AI 解衝突後 critic 判 FAIL,worktree 已 reset",
    goal: "把 pipeline/feat-ui-refresh 合進 main",
    iter: {
      current: 1, stage: "✓", verdicts: ["FAIL"],
      rounds: [{ n: 1, startedAt: nowMinus(120), endedAt: nowMinus(30), criticVerdict: "FAIL" }]
    }
  },
  splitting: {
    id: "t-splitting", n: 12, title: "巨型 ticket — AI 正在拆解中", mode: "step", status: "draft",
    goal: "整理 backend runner 全部 spawn / IPC / state 共用層"
  }
};

const SCENARIO_TICKETS = {
  empty: [],
  mixed: [
    TICKET_FIXTURES.done_step,
    TICKET_FIXTURES.done_iter,
    TICKET_FIXTURES.running_iter_doer,
    TICKET_FIXTURES.ready,
    TICKET_FIXTURES.draft
  ],
  all_done: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.done_iter, { ...TICKET_FIXTURES.done_iter, id: "t-extra-done", n: 9, title: "另一張 iter ticket 完成 — 2 輪 PASS", iter: { ...TICKET_FIXTURES.done_iter.iter, verdicts: ["FAIL", "PASS"], rounds: TICKET_FIXTURES.done_iter.iter.rounds.slice(0, 2).concat([{ n: 2, startedAt: nowMinus(900), endedAt: nowMinus(60), criticVerdict: "PASS" }]) } }],
  all_failed: [TICKET_FIXTURES.failed_step, TICKET_FIXTURES.failed_iter_limit, TICKET_FIXTURES.failed_transient],
  with_splitting: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.splitting, TICKET_FIXTURES.ready],
  with_running_iter: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.running_iter_doer, TICKET_FIXTURES.ready, TICKET_FIXTURES.draft],
  with_paused_iter: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.paused_iter, TICKET_FIXTURES.ready],
  with_critic_running: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.running_iter_critic, TICKET_FIXTURES.draft],
  with_merge_running: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.done_iter, TICKET_FIXTURES.merge_running],
  with_merge_failed: [TICKET_FIXTURES.done_step, TICKET_FIXTURES.done_iter, TICKET_FIXTURES.merge_failed],
  livelog_running: [TICKET_FIXTURES.running_step, TICKET_FIXTURES.ready]
};

const SCENARIO_LABELS = {
  empty: "空 pipeline(沒 ticket)",
  mixed: "混合(done + iter 跑中 + ready + draft)",
  all_done: "全完成(等合併)",
  all_failed: "全失敗",
  with_splitting: "含 AI 拆分中 ticket",
  with_running_iter: "含 iter doer 跑中",
  with_critic_running: "含 iter critic 審核中",
  with_paused_iter: "含 iter 已暫停",
  with_merge_running: "含 AI 合併進行中",
  with_merge_failed: "含 AI 合併失敗",
  livelog_running: "step 跑中(liveLog)"
};

const SYNC_JOB_FIXTURES = {
  none: undefined,
  merging: { state: "merging", startedAt: nowMinus(2), behindCount: 3 },
  conflict_await: { state: "conflict_await", startedAt: nowMinus(20), behindCount: 3, conflictFiles: ["src/features/qa/QADrawer.tsx", "src/styles/board.css", "server/lib/notif/store.ts"] },
  ai_running: { state: "ai_running", startedAt: nowMinus(45), behindCount: 3, conflictFiles: ["src/features/qa/QADrawer.tsx"], liveLog: "[merge-ai] inspecting hunk 2 of 5 ..." },
  failed: { state: "failed", startedAt: nowMinus(120), endedAt: nowMinus(30), behindCount: 3, conflictFiles: ["src/features/qa/QADrawer.tsx", "src/styles/board.css"], reason: "AI 解衝突後 critic 判 FAIL,worktree 已 git merge --abort" },
  done: { state: "done", startedAt: nowMinus(60), endedAt: nowMinus(20), behindCount: 3, mergeCommit: { hash: "a1b2c3d4e5f6", subject: "Merge main into pipeline/feat-ui-refresh", ts: nowMinus(20) } }
};

const SYNC_LABELS = {
  none: "(無 syncJob,看 behindFallback)",
  merging: "merging — 純 git merge 中",
  conflict_await: "conflict_await — 等 user 決定",
  ai_running: "ai_running — 助理處理中",
  failed: "failed — 同步失敗",
  done: "done — 已同步"
};

const DIFF_FIXTURES = {
  null: null,
  zero: { files: 0, added: 0, deleted: 0 },
  small: { files: 3, added: 42, deleted: 18 },
  big: { files: 17, added: 1240, deleted: 689 }
};

const RUN_FIXTURES = {
  none: [],
  some: [
    { startedAt: nowMinus(3600), costUsd: 0.42, durationMs: 600_000, exitCode: 0 },
    { startedAt: nowMinus(7200), costUsd: 1.13, durationMs: 1_200_000, exitCode: 0 },
    { startedAt: nowMinus(86400), costUsd: 0.71, durationMs: 480_000, exitCode: 1 }
  ]
};

// ─── IterStages (matches src/features/pipeline/IterStages.tsx verbatim) ──

function IterStages({ stage, status, stages = ["doer", "critic", "✓"], lastVerdict }) {
  const raw = String(stage);
  const normalized =
    raw === "doer" || raw === "critic" || raw === "✓"
      ? raw
      : raw === "done" || /done|complete|pass|finish|✓/i.test(raw)
      ? "✓"
      : /crit|review|judge|check/i.test(raw)
      ? "critic"
      : /exec|run|do|work/i.test(raw)
      ? "doer"
      : "doer";
  let idx = stages.indexOf(normalized === "done" ? "✓" : normalized);
  if (idx === -1) idx = 0;
  const currentName = STAGE_LABEL[stages[idx] ?? "doer"];
  const isResultStage = stages[idx] === "✓";
  const statusText = status === "running" ? "執行中" : status === "paused" ? "已暫停" : status === "done" ? "已完成" : "";
  const resultText = isResultStage ? `,結果:${fmtVerdict(lastVerdict)}` : "";
  const ariaSummary = `目前階段:${currentName}${statusText ? `,狀態:${statusText}` : ""}${resultText}`;
  return (
    <div className="iter-stages" role="group" aria-label={ariaSummary}>
      {stages.map((s, i) => {
        const isPast = i < idx;
        const isCurrent = i === idx;
        const isFuture = i > idx;
        const isResult = s === "✓";
        let mark = null;
        if (isPast) {
          mark = { text: "✓", cls: "is-past-mark", srLabel: "完成" };
        } else if (isCurrent) {
          if (isResult) {
            const v = fmtVerdict(lastVerdict);
            const tok = verdictToken(lastVerdict);
            const verdictLabel = tok === "pass" ? "通過" : tok === "fail" ? "未通過" : tok === "part" ? "部分通過" : "結果未知";
            mark = { text: v, cls: "is-result-" + tok, srLabel: verdictLabel };
          } else if (status === "running") {
            mark = { text: "▶", cls: "is-running", srLabel: "執行中" };
          } else if (status === "paused") {
            mark = { text: "⏸", cls: "is-paused", srLabel: "已暫停" };
          } else if (status === "failed" || status === "failed_iter_limit" || status === "failed_transient") {
            mark = { text: "✕", cls: "is-failed-mark", srLabel: "失敗" };
          }
        } else if (isFuture) {
          mark = { text: "?", cls: "is-future-mark", srLabel: "待進行" };
        }
        return (
          <span key={s} style={{ display: "contents" }}>
            <span className={"iter-stage" + (isPast ? " is-past" : "") + (isCurrent ? " is-active" : "") + (isFuture ? " is-future" : "") + (status === "paused" && isCurrent ? " is-paused" : "")}>
              {STAGE_LABEL[s]}
              {mark && (<>
                <span className={"iter-stage-mark " + mark.cls} aria-hidden>{mark.text}</span>
                {mark.srLabel && <span className="sr-only">{` ${mark.srLabel}`}</span>}
              </>)}
            </span>
            {i < stages.length - 1 && <span aria-hidden className="iter-stage-arrow"><ArrowRightIcon /></span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── TicketCard (matches src/features/pipeline/TicketCard.tsx verbatim) ──

function TicketCard({ ticket, tick, index, isSplitting = false, onSelect }) {
  const onClick = onSelect ? () => onSelect(ticket) : undefined;
  const isIter = ticket.mode === "iter" || ticket.mode === "merge" || ticket.mode === "sync";
  const hasCritic = ticket.mode === "iter";
  const stageList = hasCritic ? ["doer", "critic", "✓"] : ["doer", "✓"];
  const isRunning = ticket.status === "running";
  const isPaused = ticket.status === "paused";
  const isDraft = ticket.status === "draft" || ticket.status === "ready";
  const isDone = ticket.status === "done";
  const isFailed = ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient";
  const isTerminal = isDone || isFailed;
  const isRoundComplete = (r) => Boolean(r.endedAt && (!hasCritic || r.criticVerdict));

  void tick;
  let elapsed;
  const rs = ticket.iter?.rounds ?? [];
  if (rs.length > 0) {
    const completedSec = rs.reduce((sum, r) => sum + (isRoundComplete(r) && r.startedAt ? Math.max(0, r.endedAt - r.startedAt) : 0), 0) / 1000;
    const inProg = rs.find((r) => !isRoundComplete(r));
    const inProgEndCap = isRunning ? Date.now() : isTerminal ? (ticket.endedAt ?? inProg?.endedAt) : undefined;
    const liveSec = inProg?.startedAt && typeof inProgEndCap === "number" ? Math.max(0, (inProgEndCap - inProg.startedAt) / 1000) : 0;
    elapsed = Math.round(completedSec + liveSec);
  } else {
    const ts = ticket.startedAt;
    const te = ticket.endedAt;
    if (typeof ts === "number") {
      const end = isRunning ? Date.now() : (te ?? Date.now());
      elapsed = Math.max(0, Math.round((end - ts) / 1000));
    } else {
      elapsed = ticket.iter?.totalElapsed ?? 0;
    }
  }
  const completedRoundsForLabel = rs.filter((r) => isRoundComplete(r));
  const inProgForLabel = rs.find((r) => !isRoundComplete(r));
  const lastCompletedN = completedRoundsForLabel[completedRoundsForLabel.length - 1]?.n;
  const iterCurrentLabel = ticket.iter ? (inProgForLabel?.n ?? lastCompletedN ?? Math.max(1, ticket.iter.current)) : 0;
  const accent = TICKET_STATUS_COLOR[ticket.status] || "var(--draft)";
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] ?? ticket.status;
  const accessibleState = isSplitting ? "AI 拆分中" : statusLabel;
  const modeLabel = MODE_LABELS[ticket.mode] ?? ticket.mode;
  const summaryText = isTerminal
    ? `共 ${iterCurrentLabel} 輪 · 總耗時 ${fmtElapsed(elapsed)}`
    : isPaused
    ? `第 ${iterCurrentLabel} 輪 · 已暫停 · 已耗時 ${fmtElapsed(elapsed)}`
    : `第 ${iterCurrentLabel} 輪 · 已耗時 ${fmtElapsed(elapsed)}`;
  const completedRoundCount = rs.filter((r) => isRoundComplete(r)).length;
  const hideSummary = isTerminal && completedRoundCount <= 1 && rs.length <= 1;

  const ariaLabelParts = [];
  if (onClick) {
    ariaLabelParts.push(`開啟 ticket #${String(ticket.n).padStart(2, "0")} ${ticket.title}`);
    ariaLabelParts.push(modeLabel);
    ariaLabelParts.push(accessibleState);
    if (ticket.goal) ariaLabelParts.push(ticket.goal);
    if (isIter && ticket.iter && ((ticket.iter.rounds?.length ?? 0) > 0 || isRunning || isPaused || isTerminal)) {
      ariaLabelParts.push(summaryText);
    }
    if (isPaused && ticket.reason) ariaLabelParts.push(`暫停原因:${ticket.reason}`);
  }
  const ariaLabel = onClick ? ariaLabelParts.join("，") : undefined;

  return (
    <div
      className={"ticket"
        + (onClick ? " is-clickable" : "")
        + (isDraft ? " is-draft" : "")
        + (isPaused ? " is-paused" : "")
        + (isRunning ? " is-running" : "")
        + (ticket.status === "done" ? " is-done" : "")
        + ((ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") ? " is-failed" : "")
        + (isSplitting ? " is-splitting" : "")}
      style={{
        animationDelay: `${index * 40}ms`,
        cursor: onClick ? "pointer" : undefined,
        ["--ticket-accent"]: accent
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
    >
      <span className="ticket-band" aria-hidden style={{ background: accent }} />
      <div className="ticket-row ticket-card__header">
        <span className="ticket-num mono">{String(ticket.n).padStart(2, "0")}</span>
        <div className="ticket-card__titleline">
          {modeLabel && (
            <span className={"chip ticket-mode" + (isIter ? " is-iter" : "")}>{modeLabel}</span>
          )}
          <div className="ticket-title">{ticket.title}</div>
        </div>
        <div className="ticket-card__trailing">
          {isSplitting ? (
            <span className="chip ticket-splitting">
              <span className="ticket-splitting-spinner" aria-hidden />
              AI 拆分中
            </span>
          ) : (
            <StatusPill status={ticket.status} />
          )}
          {onClick && <ChevronRightIcon className="ticket-card__chevron" />}
        </div>
      </div>

      {ticket.meta && !isIter && (
        <div className="ticket-card__sub">
          <span className="ticket-meta mono">{ticket.meta}</span>
        </div>
      )}
      {ticket.goal && <div className="ticket-goal ticket-card__description">{ticket.goal}</div>}

      {isIter && ticket.iter && ((ticket.iter.rounds?.length ?? 0) > 0 || ticket.status === "running" || ticket.status === "paused" || ticket.status === "done" || ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") && (() => {
        const rounds = ticket.iter.rounds ?? [];
        const hasIncompleteRound = rounds.some((r) => !isRoundComplete(r));
        const inProgress = (ticket.status === "running" || ticket.status === "paused" || isFailed) && hasIncompleteRound && ticket.iter.stage !== "✓" && ticket.iter.stage !== "done";
        return (<>
          {rounds.filter((r) => isRoundComplete(r)).map((r) => (
            <div key={r.n} className="ticket-iter ticket-iter-row">
              <span className="iter-round-num mono">第 {r.n} 輪</span>
              <IterStages stage="✓" status="done" stages={stageList} lastVerdict={r.criticVerdict} />
              <span className="iter-meta mono">
                {r.startedAt ? fmtElapsed(Math.round((r.endedAt - r.startedAt) / 1000)) : "—"}
              </span>
            </div>
          ))}
          {inProgress && (() => {
            const inProg = rounds.find((r) => !isRoundComplete(r));
            const completed = rounds.filter((r) => isRoundComplete(r));
            const lastEnded = completed[completed.length - 1]?.endedAt;
            const roundStart = inProg?.startedAt ?? lastEnded ?? ticket.startedAt;
            const roundEnd = isTerminal ? (ticket.endedAt ?? inProg?.endedAt ?? Date.now()) : Date.now();
            const live = typeof roundStart === "number" ? Math.max(0, Math.round((roundEnd - roundStart) / 1000)) : 0;
            const roundNum = inProg?.n ?? ticket.iter?.current ?? completed.length + 1;
            return (
              <div className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">第 {roundNum} 輪</span>
                <IterStages stage={ticket.iter.stage} status={ticket.status} stages={stageList} />
                <span className="iter-meta mono">{fmtElapsed(live)}</span>
              </div>
            );
          })()}
          {rounds.length === 0 && !inProgress && (
            <div className="ticket-iter ticket-iter-row">
              <span className="iter-round-num mono">第 1 輪</span>
              <IterStages stage="doer" status={ticket.status} stages={stageList} />
            </div>
          )}
          {!hideSummary && (
            <div className="ticket-iter-summary mono">{summaryText}</div>
          )}
        </>);
      })()}

      {!isIter && (ticket.status === "running" || ticket.status === "paused" || ticket.status === "done" || ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") && (() => {
        const sa = ticket.startedAt;
        const ea = ticket.endedAt;
        const ms = sa ? (ea ?? Date.now()) - sa : 0;
        const elapsedStr = sa ? fmtElapsed(Math.max(0, Math.round(ms / 1000))) : null;
        const terminalStage = isTerminal ? "✓" : "doer";
        const terminalStatus = isTerminal && ticket.status !== "done" ? "failed" : ticket.status;
        const verdictHint = isTerminal ? (ticket.status === "done" ? "PASS" : "FAIL") : undefined;
        return (
          <div className="ticket-iter ticket-iter-row ticket-iter-row--single">
            <IterStages stage={terminalStage} status={terminalStatus} stages={["doer", "✓"]} lastVerdict={verdictHint} />
            {elapsedStr && <span className="iter-meta mono">{elapsedStr}</span>}
          </div>
        );
      })()}

      {isRunning && ticket.liveLog && (
        <div className="ticket-livelog mono" role="status" aria-live="polite" aria-atomic="true">
          <span className="livelog-cursor blink" aria-hidden>▸</span> {ticket.liveLog}
        </div>
      )}

      {(isPaused || isFailed) && ticket.reason && (
        <div className={"ticket-paused-actions" + (isFailed ? " is-failed-reason" : "")}>
          <span className={"paused-reason" + (isFailed ? " is-failed" : "")}>{ticket.reason}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const c = TICKET_STATUS_COLOR[status] ?? STATE_COLOR[status];
  const label = TICKET_STATUS_LABEL[status] ?? status;
  const isLive = status === "running";
  return (
    <span className="status-pill mono" style={{ color: c }}>
      <span className={"status-pill-dot" + (isLive ? " pulse" : "")} style={{ background: c }} aria-hidden />
      {label}
    </span>
  );
}

// ─── RunButton (matches src/features/pipeline/RunButton.tsx verbatim) ───

function RunButton({ pipeline, onRun, onStop, spawning = false, queuePosition, syncActive = false }) {
  const s = pipeline.state;
  const noTickets = pipeline.tickets.length === 0;
  if (s === "running") {
    return (
      <button type="button" className="btn btn-danger run-btn-stop-now" onClick={() => onStop?.(pipeline.id)} aria-label="停止 pipeline" title={syncActive ? "同步進行中,但 runner 仍可停止" : undefined}>
        <StopIcon /> 停止
      </button>
    );
  }
  if (s === "queued") {
    const hasPos = !!(queuePosition && queuePosition > 0);
    const posLabel = hasPos ? `順位 ${queuePosition}` : "排隊中";
    const ariaLabel = hasPos ? `取消排隊(目前順位 ${queuePosition})` : "取消排隊";
    return (
      <button type="button" className="btn btn-queued" onClick={() => onStop?.(pipeline.id)} aria-label={ariaLabel}>
        <HourglassIcon /> {posLabel} · 取消
      </button>
    );
  }
  if (syncActive) {
    const reason = "同步收尾後可執行 ticket";
    return (<>
      <button type="button" className="btn run-btn-sync-busy" aria-disabled="true" aria-label={`助理處理中 — ${reason}`} title={reason}>
        <span className="qadr-thinking-dots" aria-hidden><span /><span /><span /></span>{" "}助理處理中
      </button>
      <span className="sr-only" role="status" aria-live="polite">助理處理中</span>
    </>);
  }
  if (spawning && (s === "planning" || s === "paused" || s === "failed" || s === "ready" || s === "merged")) {
    const reason = "啟動 runner(約 1-5 秒)";
    return (<>
      <button type="button" className="btn" aria-disabled="true" aria-label={`啟動中 — ${reason}`} title={reason}>
        <span className="qadr-thinking-dots" aria-hidden><span /><span /><span /></span>{" "}啟動中
      </button>
      <span className="sr-only" role="status" aria-live="polite">啟動中</span>
    </>);
  }
  if (s === "planning" || s === "paused" || s === "failed" || s === "ready" || s === "merged") {
    const hasRunnableReal = pipeline.tickets.some((t) => t.mode !== "merge" && t.mode !== "sync" && (t.status === "draft" || t.status === "ready" || t.status === "paused" || t.status === "failed_transient"));
    if (noTickets || !hasRunnableReal) {
      const reason = noTickets ? "上方「+ 新增 ticket」開 QA 建第一張" : "目前 ticket 都已完成或永久失敗;新增或修復 ticket 後即可執行";
      return (
        <button type="button" className={"btn run-btn-empty" + (s === "merged" ? " run-btn-empty-merged" : "")} aria-disabled="true" aria-label={`無可執行 ticket — ${reason}`} title={reason}>
          <span className="run-btn-empty-label-full" aria-hidden>無可執行 ticket</span>
          <span className="run-btn-empty-label-short" aria-hidden>無 ticket</span>
        </button>
      );
    }
    const label = s === "paused" ? "繼續" : s === "failed" ? "重試" : "執行";
    const ariaLabel = s === "paused" ? "繼續執行 pipeline" : s === "failed" ? "重試 pipeline" : "執行 pipeline";
    return (
      <button type="button" className="btn btn-primary" onClick={() => onRun?.(pipeline.id)} aria-label={ariaLabel}>
        <PlayIcon /> {label}
      </button>
    );
  }
  return null;
}

// ─── ReadyBanner (matches src/features/pipeline/ReadyBanner.tsx verbatim) ──

const BANNER_M = {
  merged: (base) => `已合併入 ${base}`,
  failedWithRetry: "合併失敗 — 修正工作區後重試",
  failedNoAction: "合併失敗 — 請至執行紀錄查看錯誤並修正工作區",
  merging: "正在合併,處理衝突中",
  mergeQueued: "合併已排入佇列,即將開始",
  ready: "所有 ticket 已完成",
  commits: (n) => `${n} 個 commit`
};

function ReadyBanner({ pipeline, onMerge }) {
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const descId = useId();
  const commitCount = pipeline.tickets.reduce((sum, t) => sum + (t.commits?.length ?? 0), 0);
  const baseBranch = pipeline.baseBranch || "main";
  const isMerged = pipeline.state === "merged";
  const failedMerge = pipeline.tickets.find((t) => t.mode === "merge" && (t.status === "failed" || t.status === "failed_iter_limit" || t.status === "failed_transient" || t.status === "paused"));
  const runningMergeTicket = pipeline.tickets.find((t) => t.mode === "merge" && t.status === "running");
  const queuedMergeTicket = pipeline.tickets.find((t) => t.mode === "merge" && t.status === "ready");
  const mergingTicket = runningMergeTicket || queuedMergeTicket;
  const isMerging = !!mergingTicket && !isMerged;
  const isQueued = !runningMergeTicket && !!queuedMergeTicket && !isMerged;

  const variant = isMerged ? "merged" : isMerging ? "merging" : failedMerge ? "failed" : "ready";
  const variantClass = variant === "merged" ? "banner-ready banner-merged" : variant === "ready" ? "banner-ready" : "banner-paused";
  const iconColor = variant === "merged" ? "var(--done)" : variant === "failed" ? "var(--failed)" : variant === "merging" ? "var(--running)" : "var(--done)";
  const Icon = variant === "failed" ? WarnIcon : variant === "merging" ? SpinnerIcon : CheckCircleIcon;
  const hasRetry = variant === "failed" && !!onMerge;
  const title = variant === "merged" ? BANNER_M.merged(baseBranch) : variant === "failed" ? (hasRetry ? BANNER_M.failedWithRetry : BANNER_M.failedNoAction) : variant === "merging" ? (isQueued ? BANNER_M.mergeQueued : BANNER_M.merging) : BANNER_M.ready;
  const liveRole = variant === "failed" ? "alert" : variant === "merging" ? "status" : "group";
  const ariaLive = variant === "failed" ? "assertive" : variant === "merging" ? "polite" : undefined;
  const showButton = !!onMerge && (variant === "ready" || variant === "failed");
  const buttonLabel = variant === "failed" ? "重試合併" : `合併入 ${baseBranch}`;
  const buttonAriaLabel = variant === "failed" ? `重試合併 pipeline ${pipeline.branch} 進 ${baseBranch}` : `合併 pipeline ${pipeline.branch} 進 ${baseBranch}`;

  return (
    <div
      className={`banner fade-up ${variantClass}`}
      data-state={variant}
      role={liveRole}
      aria-live={ariaLive}
      aria-labelledby={(variant === "merged" || variant === "ready") ? titleId : undefined}
      aria-describedby={(variant === "merged" || variant === "ready") ? descId : undefined}
      aria-busy={(variant === "merging" && !isQueued) ? true : undefined}
    >
      <span className="banner-icon" aria-hidden style={{ color: iconColor }}><Icon /></span>
      <div className="banner-body">
        <div className="banner-title" id={titleId}>{title}</div>
        <div className="banner-desc mono meta-row" id={descId}>
          <span className="meta-atom">{pipeline.branch} → {baseBranch}</span>
          <span className="meta-sep banner-meta-sep" aria-hidden> · </span>
          <span className="meta-atom">{BANNER_M.commits(commitCount)}</span>
        </div>
      </div>
      {showButton && (
        <button type="button" className="btn btn-primary" disabled={pending} aria-disabled={pending || undefined} aria-label={buttonAriaLabel} onClick={() => { setPending(true); setTimeout(() => setPending(false), 1200); onMerge?.(pipeline.id); }}>
          <MergeIcon /> {buttonLabel}
        </button>
      )}
    </div>
  );
}

// ─── SyncStatusBar (matches src/features/pipeline/SyncStatusBar.tsx verbatim) ─

function SyncStatusBar({ pipeline, behindFallback, pipelineBusy, tick, onStart, onConfirmAi, onCancel, onDismiss }) {
  const j = pipeline.syncJob;
  if (!j) {
    if (behindFallback === null || behindFallback <= 0) return null;
    const baseLabel = pipeline.baseBranch || "base";
    const ariaLabel = pipelineBusy
      ? `落後 ${baseLabel} ${behindFallback} 個 commit。同步功能停用中:pipeline 執行中,需等停止或 ready 才能同步`
      : `落後 ${baseLabel} ${behindFallback} 個 commit。按下開始同步:先嘗試 git merge,衝突才呼叫助理`;
    return (
      <button type="button" className="sync-chip"
        title={pipelineBusy ? `落後 ${baseLabel} ${behindFallback} 個 commit(pipeline 在跑,等停止後或 ready 才能同步)` : `落後 ${baseLabel} ${behindFallback} 個 commit · 點擊先試合併,衝突才呼叫助理`}
        aria-label={ariaLabel} disabled={pipelineBusy} onClick={onStart}>
        <span className="sync-chip-arrow" aria-hidden>⇣</span>
        落後 {behindFallback} · 同步
      </button>
    );
  }
  if (j.state === "merging") {
    const baseLabel = pipeline.baseBranch || "base";
    return (
      <span className="sync-chip sync-chip-busy" role="status" aria-live="polite"
        aria-label={`正在合併 ${baseLabel},落後 ${j.behindCount} 個 commit,同步中`}
        title={`合併 ${baseLabel} 進行中(落後 ${j.behindCount} 個 commit)`}>
        <span className="sync-thinking-dots" aria-hidden><span /><span /><span /></span>{" "}同步中
      </span>
    );
  }
  if (j.state === "conflict_await") {
    const files = j.conflictFiles ?? [];
    const n = files.length;
    const tipPreview = files.slice(0, 8).join("\n");
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : "";
    return (
      <span className="sync-chip sync-chip-conflict" role="status" aria-live="polite"
        title={`等待處理衝突 ${n} 個檔案(落後 ${j.behindCount} 個 commit):\n${tipPreview}${tipMore}\n\n按 ✓ 交給助理 / ✕ 取消並中止合併`}>
        <span className="sync-chip-arrow" aria-hidden>!</span>
        等待處理衝突（{n} 個檔案）
        <button type="button" className="sync-chip-icon sync-chip-primary" onClick={onConfirmAi} title="交給助理解衝突" aria-label="交給助理解衝突"><CheckIconSm /></button>
        <button type="button" className="sync-chip-icon" onClick={onCancel} title="取消並中止合併" aria-label="取消並中止合併"><CloseIcon /></button>
      </span>
    );
  }
  if (j.state === "ai_running") {
    const elapsedSec = Math.max(0, Math.round((Date.now() - j.startedAt) / 1000));
    void tick;
    const files = j.conflictFiles ?? [];
    const tipPreview = files.slice(0, 8).join("\n");
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : "";
    return (
      <span className="sync-chip sync-chip-busy" role="status" aria-live="polite" aria-label="助理處理中"
        title={`助理處理中 · 已歷時 ${fmtElapsed(elapsedSec)}\n衝突檔(${files.length}):\n${tipPreview}${tipMore}`}>
        <span className="sync-thinking-dots" aria-hidden><span /><span /><span /></span>{" "}助理處理中 · <span aria-hidden>{fmtElapsed(elapsedSec)}</span>
        <button type="button" className="sync-chip-icon" onClick={onCancel} title="取消" aria-label="取消助理處理"><CloseIcon /></button>
      </span>
    );
  }
  if (j.state === "failed") {
    const files = j.conflictFiles ?? [];
    const tipPreview = files.length > 0 ? `\n衝突檔(${files.length}):\n${files.slice(0, 8).join("\n")}${files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : ""}` : "";
    const shortReason = (j.reason || "(未知)").slice(0, 200);
    return (
      <span className="sync-chip sync-chip-failed" role="status" aria-live="polite"
        title={`同步失敗(落後 ${j.behindCount} 個 commit)\n原因:${shortReason}${tipPreview}`}>
        <span className="sync-chip-arrow" aria-hidden>✕</span>
        同步失敗
        <button type="button" className="sync-chip-icon sync-chip-primary" onClick={onStart} title="重試同步" aria-label="重試同步"><RefreshIcon /></button>
        <button type="button" className="sync-chip-icon sync-chip-ghost" onClick={onDismiss} title="關" aria-label="關閉同步失敗提示"><CloseIcon /></button>
      </span>
    );
  }
  const doneTitle = j.mergeCommit ? `同步完成(merge commit ${j.mergeCommit.hash.slice(0, 7)})\n${j.mergeCommit.subject}` : j.behindCount > 0 ? `同步完成(整合 ${j.behindCount} 個 commit)` : "已是最新,無需同步";
  return (
    <span className="sync-chip sync-chip-done" role="status" aria-live="polite" title={doneTitle}>
      <span className="sync-chip-arrow" aria-hidden>✓</span>
      已同步
      <button type="button" className="sync-chip-icon" onClick={onDismiss} title="關" aria-label="關閉同步完成提示"><CloseIcon /></button>
    </span>
  );
}

// ─── FocusTitle (matches src/features/pipeline/FocusTitle.tsx verbatim) ──

function FocusTitle({ pipeline, onRename, existingNames, editingExternal, onEditingChange }) {
  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingExternal !== undefined ? editingExternal : editingInternal;
  const setEditing = (v) => { setEditingInternal(v); onEditingChange?.(v); };
  const [draft, setDraft] = useState(pipeline.name);
  const inputRef = useRef(null);
  useEffect(() => { setDraft(pipeline.name); setEditingInternal(false); }, [pipeline.id, pipeline.name]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const trimmed = draft.trim();
  const formatOk = /^[a-z0-9][a-z0-9-_]*$/.test(trimmed);
  const taken = trimmed !== pipeline.name && existingNames.includes(trimmed);
  const valid = trimmed.length > 0 && formatOk && !taken;
  const lockedByState = pipeline.state === "running" || pipeline.state === "queued";

  function commit() {
    if (!valid || trimmed === pipeline.name) { setEditing(false); setDraft(pipeline.name); return; }
    onRename?.(pipeline.id, trimmed);
    setEditing(false);
  }
  const errorMsg = taken ? "名稱已存在" : !formatOk ? "只能 a-z / 0-9 / - / _,首字英數" : "";
  const errorId = "focus-title-error";

  if (editing) {
    return (
      <span className="focus-title-edit" role="group" aria-label="重新命名 pipeline">
        <input ref={inputRef} className={"mono focus-title-input" + (valid ? "" : " is-invalid")} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(pipeline.name); } }}
          spellCheck={false} autoComplete="off" aria-label="pipeline 名稱" aria-invalid={!valid} aria-describedby={errorMsg ? errorId : undefined} />
        {errorMsg && (
          <span id={errorId} role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--failed)", marginLeft: 4, whiteSpace: "nowrap" }}>{errorMsg}</span>
        )}
        <button type="button" className="btn btn-primary focus-title-edit-confirm" onClick={commit} disabled={!valid || trimmed === pipeline.name}
          title={taken ? "名稱已存在" : !formatOk ? "只能 a-z / 0-9 / - / _,首字英數" : "儲存 pipeline 名稱"} aria-label="儲存 pipeline 名稱"><CheckIconSm /></button>
        <button type="button" className="btn focus-title-edit-cancel" onClick={() => { setEditing(false); setDraft(pipeline.name); }} title="取消 (Esc)" aria-label="取消重新命名"><CloseIcon /></button>
      </span>
    );
  }
  return (
    <h2 className="focus-title focus-title-edit">
      {pipeline.name}
      {onRename && (
        <button type="button" className="btn btn-ghost focus-title-edit-btn" onClick={() => setEditing(true)} disabled={lockedByState}
          title={lockedByState ? "running 中不能改名" : "改名"} aria-label={lockedByState ? "running 中無法重新命名" : "重新命名 pipeline"}><PencilIcon /></button>
      )}
    </h2>
  );
}

// ─── OverflowMenu (matches src/features/pipeline/OverflowMenu.tsx verbatim) ──
// Popover 用 inline absolute positioning 取代真正 portal(prototype 內無需 viewport flip)。
// useConfirm 略過 — 點按即觸發,demo 不彈 confirm dialog。

function OverflowMenu({ pipeline, lockedByState, onResetPipeline, onRevealWorktree, onDelete, onToggleAutoMerge, onShowHistory, openExternal, onOpenChange }) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openExternal !== undefined ? openExternal : openInternal;
  const setOpen = (v) => { setOpenInternal(v); onOpenChange?.(v); };

  if (!onResetPipeline && !onRevealWorktree && !onDelete && !onToggleAutoMerge && !onShowHistory) return null;
  const hasDangerSection = !!(onResetPipeline || onDelete);
  const hasSafeSection = !!(onToggleAutoMerge || onShowHistory || onRevealWorktree);

  return (
    <div className="focus-overflow">
      <button type="button" className="btn" onClick={() => setOpen(!open)} title="更多操作" aria-label="更多 pipeline 操作" aria-haspopup="menu" aria-expanded={open}>
        <DotsHorizontalIcon />
      </button>
      {open && (
        <div className="focus-overflow-menu" role="menu" aria-label={`pipeline ${pipeline.name} 操作`}
          style={{ position: "absolute", right: 0, top: "calc(100% + 4px)" }}>
          {onToggleAutoMerge && (
            <MenuItem role="menuitemcheckbox" ariaChecked={!!pipeline.autoMerge}
              icon={<span aria-hidden style={{ color: pipeline.autoMerge ? "var(--done)" : "var(--fg-faint)" }}>{pipeline.autoMerge ? "●" : "○"}</span>}
              label="自動合併" hint={lockedByState ? "執行中無法操作" : pipeline.autoMerge ? "已開啟" : "未開啟"} disabled={lockedByState}
              onClick={() => onToggleAutoMerge(pipeline.id, !pipeline.autoMerge)} />
          )}
          {onShowHistory && (
            <MenuItem icon={<HistoryIcon />} label="執行紀錄" hint="" onClick={() => { setOpen(false); onShowHistory(); }} />
          )}
          {onRevealWorktree && (() => {
            const hasWorktree = typeof pipeline.hasWorktree === "boolean" ? pipeline.hasWorktree : pipeline.state !== "planning" && pipeline.state !== "merged";
            const hint = hasWorktree ? "" : pipeline.state === "planning" ? "未建立" : pipeline.state === "merged" ? "已合併" : "已清除";
            return (
              <MenuItem icon={<FolderIcon />} label="開啟 worktree" hint={hint} disabled={!hasWorktree} onClick={() => { setOpen(false); onRevealWorktree(pipeline.id); }} />
            );
          })()}
          {hasSafeSection && hasDangerSection && (
            <div role="separator" aria-orientation="horizontal" className="focus-overflow-sep" style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
          )}
          {onResetPipeline && (
            <MenuItem icon={<RefreshIcon />} label="重置 pipeline" hint={lockedByState ? "執行中無法操作" : ""} disabled={lockedByState} danger
              onClick={() => { setOpen(false); onResetPipeline(pipeline.id); }} />
          )}
          {onDelete && (
            <MenuItem icon={<TrashIcon />} label="刪除 pipeline" hint={lockedByState ? "執行中無法操作" : ""} disabled={lockedByState} danger
              onClick={() => { setOpen(false); onDelete(pipeline.id); }} />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, disabled, danger, onClick, role = "menuitem", ariaChecked }) {
  return (
    <button type="button" role={role} aria-checked={role === "menuitemcheckbox" ? !!ariaChecked : undefined}
      aria-disabled={disabled || undefined} title={disabled ? hint || "目前無法操作" : undefined}
      className={"pipeline-overflow-menu-item focus-overflow-item" + (danger ? " is-danger" : "") + (disabled ? " is-disabled" : "")}
      onClick={onClick} disabled={disabled}>
      <span className="focus-overflow-item-icon">{icon}</span>
      <span className="focus-overflow-item-label">{label}</span>
      {hint && <span className="mono focus-overflow-item-hint">{hint}</span>}
    </button>
  );
}

// ─── FocusDiffChip (matches src/features/pipeline/FocusDiffChip.tsx) ─────

function FocusDiffChip({ pipeline, projectHash, diffStat, onOpenDiff }) {
  return (
    <button type="button" className="chip mono focus-diff-chip"
      title={`點擊看完整 diff:${diffStat.files} files,+${diffStat.added} -${diffStat.deleted} vs ${pipeline.baseBranch || "base"}`}
      aria-label={`查看 diff:${diffStat.files} 個檔案,新增 ${diffStat.added} 行、刪除 ${diffStat.deleted} 行,對比 ${pipeline.baseBranch || "base"}`}
      onClick={() => onOpenDiff?.()}>
      <span aria-hidden className="focus-diff-added">+{diffStat.added}</span>
      <span aria-hidden className="focus-diff-sep">·</span>
      <span aria-hidden className="focus-diff-deleted">-{diffStat.deleted}</span>
      <span aria-hidden className="focus-diff-files">{diffStat.files}f</span>
    </button>
  );
}

// ─── EmptyTickets (matches src/features/pipeline/EmptyTickets.tsx) ──────

function EmptyTickets({ hasActiveDraft, onAddTicket }) {
  return (
    <div className="focus-empty">
      <h2 className="focus-empty-title">
        {hasActiveDraft ? "有一張 ticket 在 QA 中" : "還沒任何 ticket"}
      </h2>
      <div className="focus-empty-desc">
        {hasActiveDraft
          ? "之前開了 QA 但還沒收尾，按「接續 QA」繼續對話。"
          : "用上方「+ 新增 ticket」開始跟 AI 對話,一起整理目標、驗收條件與提示詞,完成後加入 pipeline。"}
      </div>
      <button type="button" className={"btn focus-empty-cta " + (hasActiveDraft ? "btn-accent" : "btn-primary")} onClick={onAddTicket}>
        <PlusIcon /> {hasActiveDraft ? "接續 QA" : "新增第一張 ticket"}
      </button>
    </div>
  );
}

// ─── FocusTicketList (matches src/features/pipeline/FocusTicketList.tsx) ─

function FocusTicketList({ pipeline, tick, hasActiveDraft, onAddTicket, onTicketClick, splittingTicketId }) {
  return (
    <div className="focus-list">
      {pipeline.tickets.length === 0 ? (
        <EmptyTickets hasActiveDraft={hasActiveDraft} onAddTicket={() => onAddTicket?.(pipeline.id)} />
      ) : (
        pipeline.tickets
          .filter((t) => t.mode !== "sync")
          .map((t, i) => (
            <TicketCard key={t.id} ticket={t} tick={tick} index={i} isSplitting={splittingTicketId === t.id} onSelect={onTicketClick} />
          ))
      )}
    </div>
  );
}

// ─── FocusHeader (matches src/features/pipeline/FocusHeader.tsx verbatim) ─

function FocusHeader({ pipeline, tick, hasActiveDraft, existingNames, projectHash, queuePosition,
  diffStat, runs, spawning, behind, totalCost, stateColor, stateLabel, done, total, showMergeBanner, syncActive, lockedByState,
  onStart, onAddTicket, onStop, onDelete, onRename, onResetPipeline, onRevealWorktree, onMerge, onSync, onSyncConfirmAi, onSyncCancel, onSyncDismiss, onToggleAutoMerge,
  historyOpen, setHistoryOpen, diffOpen, setDiffOpen, overflowOpen, setOverflowOpen, titleEditing, setTitleEditing }) {

  const hasInflightMergeTicket = pipeline.tickets.some((t) => t.mode === "merge" && (t.status === "running" || t.status === "ready"));
  const showBanner = showMergeBanner || hasInflightMergeTicket;

  return (
    <div className="focus-head fade-up">
      <div className="focus-head-top">
        <div className="focus-head-title-row">
          <FocusTitle pipeline={pipeline} onRename={onRename} existingNames={existingNames} editingExternal={titleEditing} onEditingChange={setTitleEditing} />
          <div className="focus-head-title-spacer" />
          <OverflowMenu pipeline={pipeline} lockedByState={lockedByState} onResetPipeline={onResetPipeline} onRevealWorktree={onRevealWorktree} onDelete={onDelete} onToggleAutoMerge={onToggleAutoMerge} onShowHistory={projectHash ? () => setHistoryOpen(true) : undefined} openExternal={overflowOpen} onOpenChange={setOverflowOpen} />
        </div>
        <div className="focus-head-meta-row">
          <span className="chip chip-state"
            style={{ color: "var(--fg)", borderColor: "transparent", background: "color-mix(in srgb, " + stateColor + " 14%, transparent)" }}
            aria-label={`pipeline 狀態:${stateLabel}`}>
            <span aria-hidden className={"dot" + (pipeline.state === "running" ? " pulse" : "")} style={{ background: stateColor }} />{" "}{stateLabel}
          </span>
          <span className="focus-count mono" title={`完成 ${done} / 全部 ${total}`}>{done}/{total} 完成</span>
          {runs.length > 0 && (
            <span className="chip mono focus-runs-chip" title={`累計 ${runs.length} 次執行,共 $${totalCost.toFixed(2)}`}>
              {runs.length} 次執行 · ${totalCost.toFixed(2)}
            </span>
          )}
          {diffStat && (diffStat.files > 0 || diffStat.added > 0 || diffStat.deleted > 0) && projectHash && (
            <FocusDiffChip pipeline={pipeline} projectHash={projectHash} diffStat={diffStat} onOpenDiff={() => setDiffOpen(true)} />
          )}
          <SyncStatusBar pipeline={pipeline} behindFallback={behind}
            pipelineBusy={pipeline.state === "running" || pipeline.state === "queued"} tick={tick}
            onStart={() => onSync?.(pipeline.id)} onConfirmAi={() => onSyncConfirmAi?.(pipeline.id)}
            onCancel={() => onSyncCancel?.(pipeline.id)} onDismiss={() => onSyncDismiss?.(pipeline.id)} />
          <div className="focus-head-meta-spacer" />
          <div className="focus-actions" data-pipeline-state={pipeline.state} data-show-merge-banner={showBanner ? "1" : "0"}
            data-empty-mode={pipeline.tickets.length === 0 ? "1" : "0"} data-has-active-draft={hasActiveDraft ? "1" : "0"}>
            <span className="focus-run-wrap" data-pipeline-state={pipeline.state} data-sync-active={syncActive ? "1" : "0"}>
              <RunButton pipeline={pipeline} onRun={onStart} onStop={onStop} spawning={spawning} queuePosition={queuePosition} syncActive={syncActive} />
            </span>
            <button type="button" className={"btn focus-add-ticket " + (pipeline.tickets.length === 0 || hasActiveDraft ? "btn-primary" : "btn-accent")} onClick={() => onAddTicket?.(pipeline.id)}>
              <PlusIcon /> {hasActiveDraft ? "接續 QA" : "新增 ticket"}
            </button>
          </div>
        </div>
      </div>

      {/* PipelineHistoryDrawer mock — design 端對 drawer 自己迭代時另開 reference */}
      {historyOpen && projectHash && (
        <div className="proto-mock-modal" onClick={() => setHistoryOpen(false)}>
          <div className="proto-mock-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="proto-mock-modal-title">PipelineHistoryDrawer (stub) — pipeline {pipeline.name}</div>
            <div className="proto-mock-modal-body">真實實作在 src/features/pipeline/PipelineHistoryDrawer.tsx。<br/>會顯示 RunHistory 條目(start/end/cost/duration/exit code)+ AuditTimeline。</div>
            <div className="proto-mock-modal-foot"><button type="button" className="btn" onClick={() => setHistoryOpen(false)}>關閉</button></div>
          </div>
        </div>
      )}

      {/* DiffModal mock */}
      {diffOpen && (
        <div className="proto-mock-modal" onClick={() => setDiffOpen(false)}>
          <div className="proto-mock-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="proto-mock-modal-title">DiffModal (stub) — {pipeline.branch} → {pipeline.baseBranch || "main"}</div>
            <div className="proto-mock-modal-body">真實實作在 src/features/pipeline/DiffModal.tsx。<br/>會顯示 worktree vs base 的 file-by-file diff。</div>
            <div className="proto-mock-modal-foot"><button type="button" className="btn" onClick={() => setDiffOpen(false)}>關閉</button></div>
          </div>
        </div>
      )}

      {/* SyncConflictModal — 直接走 source 的 trigger 條件:syncJob.state === 'conflict_await' */}
      {pipeline.syncJob?.state === "conflict_await" && (
        <SyncConflictModal pipeline={pipeline} onConfirmAi={() => onSyncConfirmAi?.(pipeline.id)} onCancel={() => onSyncCancel?.(pipeline.id)} />
      )}

      {showBanner && <ReadyBanner pipeline={pipeline} onMerge={onMerge} />}
    </div>
  );
}

// SyncConflictModal stub(真實在 src/features/pipeline/SyncConflictModal.tsx)
function SyncConflictModal({ pipeline, onConfirmAi, onCancel }) {
  const j = pipeline.syncJob;
  if (!j || j.state !== "conflict_await") return null;
  const files = j.conflictFiles ?? [];
  return (
    <div className="proto-mock-modal">
      <div className="proto-mock-modal-card" role="alertdialog" aria-modal="true" aria-labelledby="sync-conflict-title">
        <div className="proto-mock-modal-title" id="sync-conflict-title">同步衝突 — 落後 {j.behindCount} 個 commit</div>
        <div className="proto-mock-modal-body">
          <p className="focus-modal-text">git merge {pipeline.baseBranch || "main"} 進 {pipeline.branch} 後發生衝突,有 {files.length} 個檔案。</p>
          <p className="focus-modal-text focus-modal-text--mt">衝突檔案:</p>
          <ul className="focus-modal-files mono">{files.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="focus-modal-text">交給助理(claude)接手解衝突,或取消(會 git merge --abort)。</p>
        </div>
        <div className="proto-mock-modal-foot">
          <button type="button" className="btn" onClick={onCancel}>取消(merge --abort)</button>
          <button type="button" className="btn btn-primary" onClick={onConfirmAi}>交給助理</button>
        </div>
      </div>
    </div>
  );
}

// ─── useFocusPipeline (matches src/features/pipeline/useFocusPipeline.ts) ─
// fetch / useApi / useTimeout 全 stub — fixture 直接從 props 灌

function useFocusPipeline({ pipeline, diffStat, runs, behind }) {
  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const stateColor = STATE_COLOR[pipeline.state];
  const stateLabel = STATE_LABEL[pipeline.state];
  const realTickets = pipeline.tickets.filter((t) => t.mode !== "sync");
  const done = realTickets.filter((t) => t.status === "done").length;
  const total = realTickets.length;
  const allDone = done === total && pipeline.state === "ready";
  const failedMergeTicket = pipeline.tickets.find((t) => t.mode === "merge" && (t.status === "failed" || t.status === "failed_iter_limit" || t.status === "failed_transient" || t.status === "paused"));
  const noWorktreeDiff = diffStat !== null && diffStat !== undefined && diffStat.files === 0 && diffStat.added === 0 && diffStat.deleted === 0;
  const showMergeBanner = (allDone && !noWorktreeDiff) || pipeline.state === "merged" || !!failedMergeTicket;
  const syncActive = !!pipeline.syncJob && (pipeline.syncJob.state === "merging" || pipeline.syncJob.state === "conflict_await" || pipeline.syncJob.state === "ai_running");
  const lockedByState = pipeline.state === "running" || pipeline.state === "queued" || syncActive;
  return { totalCost, stateColor, stateLabel, done, total, noWorktreeDiff, showMergeBanner, syncActive, lockedByState };
}

// ─── FocusColumn (matches src/features/pipeline/FocusColumn.tsx) ────────

function FocusColumn({
  pipeline, tick, onAddTicket, hasActiveDraft = false,
  onRun, onStop, onDelete, onRename, onResetPipeline, onRevealWorktree, onMerge,
  onSync, onSyncConfirmAi, onSyncCancel, onSyncDismiss, onToggleAutoMerge,
  existingNames = [], onTicketClick, projectHash, reloadKey = 0, queuePosition, splittingTicketId,
  // stub-only injection(取代真 hook 的 API call):
  diffStat, runs, behind, spawning,
  // stub-only:demo control 控制 modal / popover / rename 開關
  historyOpen, setHistoryOpen, diffOpen, setDiffOpen, overflowOpen, setOverflowOpen, titleEditing, setTitleEditing
}) {
  const derived = useFocusPipeline({ pipeline, diffStat, runs, behind });
  const onStart = (pid) => onRun?.(pid);

  return (
    <main className="focus" key={pipeline.id}>
      <FocusHeader
        pipeline={pipeline} tick={tick} hasActiveDraft={hasActiveDraft} existingNames={existingNames} projectHash={projectHash}
        queuePosition={queuePosition}
        diffStat={diffStat} runs={runs} spawning={spawning} behind={behind}
        totalCost={derived.totalCost} stateColor={derived.stateColor} stateLabel={derived.stateLabel}
        done={derived.done} total={derived.total} showMergeBanner={derived.showMergeBanner} syncActive={derived.syncActive} lockedByState={derived.lockedByState}
        onStart={onStart}
        onAddTicket={onAddTicket} onStop={onStop} onDelete={onDelete} onRename={onRename}
        onResetPipeline={onResetPipeline} onRevealWorktree={onRevealWorktree} onMerge={onMerge}
        onSync={onSync} onSyncConfirmAi={onSyncConfirmAi} onSyncCancel={onSyncCancel} onSyncDismiss={onSyncDismiss}
        onToggleAutoMerge={onToggleAutoMerge}
        historyOpen={historyOpen} setHistoryOpen={setHistoryOpen}
        diffOpen={diffOpen} setDiffOpen={setDiffOpen}
        overflowOpen={overflowOpen} setOverflowOpen={setOverflowOpen}
        titleEditing={titleEditing} setTitleEditing={setTitleEditing}
      />
      <FocusTicketList
        pipeline={pipeline} tick={tick} hasActiveDraft={hasActiveDraft}
        onAddTicket={onAddTicket} onTicketClick={onTicketClick} splittingTicketId={splittingTicketId}
      />
    </main>
  );
}

// Expose for showcase scripts
Object.assign(window, {
  FocusColumn, FocusHeader, FocusTicketList, TicketCard, IterStages, StatusPill,
  ReadyBanner, SyncStatusBar, FocusDiffChip, EmptyTickets, RunButton, OverflowMenu, FocusTitle,
  STATE_COLOR, STATE_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, MODE_LABELS,
  TICKET_FIXTURES, SCENARIO_TICKETS, SYNC_JOB_FIXTURES, DIFF_FIXTURES, RUN_FIXTURES,
  fmtElapsed, nowMinus,
});
