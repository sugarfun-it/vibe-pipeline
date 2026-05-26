// E2E mock 注入點。VP_TEST_MODE=mock 時:
//  - claudeCli.runTurn 不 spawn,讀 qaScripts(projectHash) 拿下一筆 reply
//  - orchestrator.start 不 spawn,讀 runnerScripts(projectHash, pipelineId) 模擬時間軸
// 控制端點 /api/__test/* 寫入這兩個 store。
//
// real 模式 (VP_TEST_MODE 非 "mock"):isTestMode() 回 false,所有 fake 分支跳過,行為跟以前一樣。

import type { QAReply } from "../../shared/types";

export function isTestMode(): boolean {
  return process.env.VP_TEST_MODE === "mock";
}

// ─── QA mock ──────────────────────────────────────────────────────────
// per project hash 一條 queue。每呼叫 runTurn 從前面取一筆。空 queue 拋錯讓 spec 看到問題。

const qaScripts = new Map<string, QAReply[]>();

export function setQAScript(projectHash: string, replies: QAReply[]): void {
  qaScripts.set(projectHash, [...replies]);
}

export function nextQAReply(projectHash: string): QAReply {
  const q = qaScripts.get(projectHash);
  if (!q || q.length === 0) {
    throw new Error(
      `[testMode] QA script empty for projectHash=${projectHash}. ` +
        `先 POST /api/__test/script/qa 設劇本`
    );
  }
  const reply = q.shift();
  if (!reply) throw new Error("[testMode] QA reply unexpectedly null");
  return reply;
}

// ─── Runner mock ──────────────────────────────────────────────────────
// per (projectHash, pipelineId) 一個劇本。tickets 陣列依序模擬。
// runner orchestrator 啟動後:
//  for each ticket:
//    delay(beforeRunningMs) → ticket.status = running
//    iter mode:依 iterRounds 序列模擬 (每輪 delay + 寫 round + verdict),最後一筆 PASS / 達 finalStatus
//    step mode:delay(workMs) 後直接設 finalStatus
//    寫 commits[] 用假 hash
//  所有 ticket done → pipeline.state = "ready"(或 "paused" / "failed" 看 script.outcome)

export type RunnerScriptRound = {
  verdict: "PASS" | "FAIL" | "PARTIAL";
  executorSummary?: string;
  criticFeedback?: string;
  durationMs?: number;
};

export type RunnerScriptTicket = {
  beforeRunningMs?: number;
  iterRounds?: RunnerScriptRound[]; // iter 模式才用,step 模式給空陣列
  workMs?: number; // step 模式 ticket 執行時間
  finalStatus: "done" | "failed" | "failed_iter_limit" | "failed_transient";
  commitHash?: string; // 假 hash,例如 "mock-abc1234"
  commitSubject?: string;
};

export type RunnerScript = {
  tickets: RunnerScriptTicket[];
  // pipeline 收尾 state。預設 "ready" (全成功);測 pause/fail 流程用 "paused" / "failed";
  // "merged" 給 merge / auto-merge spec 驗 worktree prune 用
  finalState?: "ready" | "paused" | "failed" | "merged";
};

const runnerScripts = new Map<string, RunnerScript>();

function runnerKey(projectHash: string, pipelineId: string): string {
  return `${projectHash}:${pipelineId}`;
}

export function setRunnerScript(
  projectHash: string,
  pipelineId: string,
  script: RunnerScript
): void {
  runnerScripts.set(runnerKey(projectHash, pipelineId), script);
}

export function getRunnerScript(
  projectHash: string,
  pipelineId: string
): RunnerScript | null {
  return runnerScripts.get(runnerKey(projectHash, pipelineId)) ?? null;
}

// ─── Split mock ───────────────────────────────────────────────────────
// per projectHash 一筆 splitInto[]。inline ticket split(routes/qa.ts:splitTicket)
// 在 mock 模式不 spawn claude,直接吐預定義 splitInto。
// 注意:長度 1 → backend 視為 nothingToSplit;長度 >= 2 → 拆。
// 長度 0(empty list)→ 模擬「沒設劇本」場景,沿用「不拆」fallback([spec])。

import type { TicketSpec } from "../../shared/types";

const splitScripts = new Map<string, TicketSpec[]>();

export function setSplitScript(projectHash: string, specs: TicketSpec[]): void {
  splitScripts.set(projectHash, [...specs]);
}

export function getSplitScript(projectHash: string): TicketSpec[] | null {
  return splitScripts.get(projectHash) ?? null;
}

// ─── Reset ────────────────────────────────────────────────────────────

export function resetMocks(): void {
  qaScripts.clear();
  runnerScripts.clear();
  splitScripts.clear();
}

// ─── Rich-ticket pipeline fixture ────────────────────────────────────
// 一條 pipeline 內含 6 個 ticket 涵蓋多數 UI state(done step+commits / done iter
// 多輪 / paused 中斷 / failed_iter_limit terminal / ready / draft),pipeline 本身
// state=paused。
//
// 用途:給 iter-uiux drive recipe 跟 e2e demo 一鍵 seed 一個能驗 ticket-card /
// iter-stages / focus-list / focus-diff-chip / overflow-menu / paused-actions 全
// 系列的「示範 pipeline」,免每 spec 重 craft 一份。
//
// 透過 /api/__test/seed/rich-pipeline 寫 .vibe-pipeline/pipelines/<id>.json 落地;
// 寫入後跟一般 pipeline.json 等價,listPipelines / projectStore 都能讀。
import type { Pipeline } from "../../shared/types";

export function richTicketPipeline(opts?: {
  id?: string;
  name?: string;
  baseBranch?: string;
}): Pipeline {
  const now = Date.now();
  const H = 3_600_000;
  const M = 60_000;
  const id = opts?.id ?? "019fffffffff-rich-tickets";
  const name = opts?.name ?? "rich-ticket-demo";
  const branch = `pipeline/${id.slice(-12)}`;
  const baseBranch = opts?.baseBranch ?? "main";

  return {
    id,
    name,
    branch,
    baseBranch,
    state: "paused",
    createdAt: now - 6 * H,
    autoMerge: false,
    tickets: [
      // ── t1: done step + commits ──────────────────────────────────
      {
        id: "t-rich-1",
        n: 1,
        title: "phase4-tokens — 抽 control-h / radius / shadow 到 tokens.css",
        goal: "讓 .btn / .form-input / popover 統一吃同一組 size token,改一處全 app 同步",
        acceptance: [
          "tokens.css 加 --control-h / --control-h-sm / --radius-control / --shadow-popover",
          "btn / form-input / picker-trigger 都 import 同 token",
        ],
        prompt: "從 src/styles/tokens.css 抽 control sizing token,把硬寫值改 var(...)",
        mode: "step",
        status: "done",
        startedAt: now - 5 * H,
        endedAt: now - 5 * H + 18 * M,
        commits: [
          { hash: "a1b2c3d4e5f6789012345678901234567890abcd", subject: "feat(tokens): 抽 control sizing 到 tokens.css", ts: now - 5 * H + 18 * M },
        ],
      },
      // ── t2: done iter(2 round FAIL→PASS,含 feedback)──────────
      {
        id: "t-rich-2",
        n: 2,
        title: "settings popover — refined visual(segmented tab + eyebrow title)",
        goal: "更新 SettingsPopover.css 套 V1 Refined,tab 換 segmented pill,section title 改 eyebrow",
        acceptance: ["segmented pill tab", "eyebrow section title + accent dot", "保留所有 state branch"],
        prompt: "套 V1 Refined CSS 進 settings popover,scope 不蔓延 forms.css",
        mode: "iter",
        status: "done",
        iterLimit: 3,
        startedAt: now - 4 * H,
        endedAt: now - 4 * H + 42 * M,
        iter: {
          current: 2,
          stage: "✓",
          verdicts: ["FAIL", "PASS"],
          rounds: [
            {
              n: 1,
              startedAt: now - 4 * H,
              endedAt: now - 4 * H + 20 * M,
              criticVerdict: "FAIL",
              executorSummary: "改了 SettingsPopover.css 的 tab style + 加 eyebrow,但 saved chip 浮動位置撞到 close 按鈕",
              criticFeedback: "saved chip 的 absolute right:46px 跟 close 重疊,且 mobile 沒 reset。需把 saved chip 改 right:8 + top:8 並在 767.98 mobile 媒體查詢加 reset",
            },
            {
              n: 2,
              startedAt: now - 4 * H + 22 * M,
              endedAt: now - 4 * H + 42 * M,
              criticVerdict: "PASS",
              executorSummary: "調整 saved chip 位置 + mobile reset,close 與 chip 不重疊,desktop / mobile 兩斷點都驗過",
              criticFeedback: "PASS — 視覺對齊,a11y 沒退,acceptance 全中。",
            },
          ],
        },
        commits: [
          { hash: "b2c3d4e5f6789012345678901234567890abcdef", subject: "refactor(settings): V1 Refined visual + saved chip 浮動位置", ts: now - 4 * H + 42 * M },
        ],
      },
      // ── t3: paused(was running iter,中斷在 round 2 doer stage)──
      {
        id: "t-rich-3",
        n: 3,
        title: "boardrail — V2 chip + data-state attr + chipPulse dual-ring",
        goal: "rail row 的 7px 小點換成 status chip(顏色 + 中文 + running pulse 雙層 ring)",
        acceptance: ["data-state 屬性 selector", "chipPulse + chipPulseRing 雙層 keyframe", "creating 模式 muted 含 chip"],
        prompt: "依 V2 chip 設計,Rail.tsx + rail.css 替換 state-dot 為 status-chip",
        mode: "iter",
        status: "paused",
        iterLimit: 3,
        startedAt: now - 2 * H,
        endedAt: now - 30 * M,
        meta: "user 主動 pause(iter round 2 進行中)",
        reason: "user 在 critic feedback 後按停,想先驗證 round 1 改動再決定 round 2 是否繼續",
        liveLog: "doer agent: 正在改 CreateCard.tsx head dot → chip…",
        iter: {
          current: 2,
          stage: "doer",
          verdicts: ["FAIL"],
          rounds: [
            {
              n: 1,
              startedAt: now - 2 * H,
              endedAt: now - 2 * H + 24 * M,
              criticVerdict: "FAIL",
              executorSummary: "Rail.tsx 用 inline style --state CSS var 設色,chip 樣式套用 done",
              criticFeedback: "inline style 不夠語意化,改用 data-state attribute selector;另外 chip 內 pulse 用 tokens.css 的通用 pulseDot 不夠精緻,設計指定要雙層 chipPulse + chipPulseRing",
            },
            // round 2 doer 還沒交,所以沒 endedAt
            {
              n: 2,
              startedAt: now - 40 * M,
              criticVerdict: "FAIL", // placeholder,實際上 doer 還沒交,critic 還沒看
              executorSummary: "(進行中)",
            },
          ],
        },
      },
      // ── t4: failed_iter_limit(3 round 全 FAIL,terminal)────────
      {
        id: "t-rich-4",
        n: 4,
        title: "focuscolumn — sync 狀態各 phase 的 chip 視覺(conflict / ai_running / failed)",
        goal: "FocusHeader 的 sync chip 4 種 syncJob.state 都要對應顏色 + icon + behind count",
        acceptance: ["conflict / ai_running / failed / done 4 種視覺", "behind count 顯示", "icon 按鈕 trigger drawer"],
        prompt: "SyncStatusBar + sync chip 樣式對齊 V1 Refined",
        mode: "iter",
        status: "failed_iter_limit",
        iterLimit: 3,
        startedAt: now - 3 * H,
        endedAt: now - 3 * H + 90 * M,
        reason: "達 iter 上限 3 輪,critic 仍 FAIL — 視覺對齊一直沒過,設計 spec 不一致,需要 user 手動釐清 acceptance",
        iter: {
          current: 3,
          stage: "✓",
          verdicts: ["FAIL", "FAIL", "FAIL"],
          rounds: [
            {
              n: 1,
              startedAt: now - 3 * H,
              endedAt: now - 3 * H + 25 * M,
              criticVerdict: "FAIL",
              executorSummary: "改 SyncStatusBar.tsx,加 4 種 syncJob.state 對應 className",
              criticFeedback: "ai_running 的 spinner 顏色不對(用了 var(--accent) 應該用 var(--queued)),behind count chip 沒對齊基線",
            },
            {
              n: 2,
              startedAt: now - 3 * H + 27 * M,
              endedAt: now - 3 * H + 55 * M,
              criticVerdict: "FAIL",
              executorSummary: "修了 ai_running spinner 顏色 + behind count baseline,加 conflict state 紅色框",
              criticFeedback: "conflict state 紅框太重(border + bg 都飽和),應該只 border var(--failed) 不要 bg tint;另外 done state 缺少 fade-out 動畫",
            },
            {
              n: 3,
              startedAt: now - 3 * H + 60 * M,
              endedAt: now - 3 * H + 90 * M,
              criticVerdict: "FAIL",
              executorSummary: "改 conflict state 只剩 border,done 加 fade-out transition",
              criticFeedback: "FAIL — fade-out 與 syncJob auto-dismiss 時序衝突,visual 退場了但 state 還在 done 沒 reset,user 看不到下次 sync 結果。需要 backend 配合改 done auto-clear 時序,不是純 frontend 能解。建議拆 ticket 給 backend 先改 state machine",
            },
          ],
        },
      },
      // ── t5: ready(QA 完成,還沒執行)──────────────────────────
      {
        id: "t-rich-5",
        n: 5,
        title: "inboxcolumn — 43 個 NotifEventType 對應 sev / icon 對照表",
        goal: "把 shared/types.ts 的 NOTIF_EVENTS 補齊 43 種對應的 sev / icon mapping",
        acceptance: [
          "43 種 NotifEventType 全列在 SEV_COLOR / SEV_ICON",
          "muted / info / block 三層 sev 分類",
          "frontend InboxItem 視覺自動取對應顏色",
        ],
        prompt: "從 shared/types.ts grep NOTIF_EVENTS,補 SEV mapping 到 src/data/notifications.ts",
        mode: "step",
        status: "ready",
      },
      // ── t6: draft(QA 還沒收斂完)──────────────────────────────
      {
        id: "t-rich-6",
        n: 6,
        title: "(QA 中)新功能討論 — pipeline export / import",
        mode: "step",
        status: "draft",
      },
    ],
  };
}
