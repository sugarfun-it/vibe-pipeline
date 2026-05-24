---
name: iter-uiux-vibe-pipeline
description: |
  iter-uiux project extension for vibe-pipeline. Encodes the (unit, state) catalog
  the base scan cannot infer: pipeline / ticket / syncJob lifecycle stages, drawer
  + modal + popover dynamic surfaces, form async substates (idle / submitting /
  error / saved), per-row item flags, and the project-specific units the base
  unit-dictionary does not cover (pipeline-rail-item, iter-stages, focus-diff-chip,
  audit-timeline, sync-conflict-modal, ready-banner, browse-modal, inbox-strip,
  update-tab phase machine, ...). Phase 3 expands each unit into (unit, state) pairs;
  drive recipes use the `VP_TEST_MODE=mock` channel (`/api/__test/script/{qa,runner,split}`)
  and fixture pipelines wherever no real fs/git side effect is wanted.
---

# iter-uiux extension for vibe-pipeline

## How this extension is loaded

Base SKILL Phase 0 globs `<project>/.claude/skills/iter-uiux-*/SKILL.md`. This file
matches; base persists `project_extension` under `.iter-uiux/.runtime-state.json`.

- **Macro state inventory** below feeds Phase 2's unit list (extension units
  joined with base detected units).
- **(unit, state) pair catalog** drives Phase 3 — each row is a separate
  advisor/reviewer loop. Drive recipe runs before round 1; if drive fails the
  pair is marked `blocked` with the recipe's `BLOCKED — needs <X>` note.
- **Project-specific units** join the detected-units table (source=`extension`).
- **Drive recipes — common fixtures / mocks** centralizes prep_steps reused by
  multiple pairs so each catalog row stays compact.

Owned-files mapping for the parallel-subagent variant of Phase 3 lives in
`.claude/skills/iter-uiux/references/parallel-subagents.md` (already covers
17 units). Extension only adds state coverage; it does not redefine ownership.

## Source-of-truth references

- State enums: `shared/types.ts` — `PipelineState` (302), `TicketStatus` (227-235), `SyncJobState` (336-340), `TicketMode` (225), `Verdict` (238), `NotifEventType` (428-471), `NotifSeverity` (425), `NOTIF_EVENTS` (493-537), `Project.hasInit / hasGit` (134-144).
- Routes: `src/App.tsx` — `/board`, `/setup`, `/login` (74-79).
- Lifecycle: `server/lib/runner/orchestrator.ts` — pipeline state transitions (`state: "queued"` 440, `"running"` 492, `"paused"` 192/637/1014/1374, `"failed"` 172, conflict_await/ai_running handlers 167-200), notif emit points (lines 181-1345 — 25+ sites).
- Notification triggers: `server/lib/notifs/store.ts` (consumer) + the orchestrator emit sites + frontend `frontend_action_*` types from `src/features/pipeline/BoardScreen.tsx:78-86` (notifyError/Warn/Info).
- Mock channel: `server/lib/testMode.ts` + `server/index.ts:150-167` — `/api/__test/{register-project,script/qa,script/runner,script/split,reset,fcm/calls,fcm/reset,push/file-content,auth/reset,auth/seed-secret}`. Requires `VP_TEST_MODE=mock` env on backend.
- Previous-run state hints: `.iter-uiux/units/*.md` (17 unit changelogs + `_phase4.md`) — informational only, do NOT use as authoritative state list (last-run drift). Source code is canonical.

## Macro state inventory

### Routes (top-level surfaces)

| Route | Component | Default state | Notable non-default states |
|---|---|---|---|
| `/board` | `BoardScreen` (`src/features/pipeline/BoardScreen.tsx`) | active project + at least one pipeline + focus column on the most recent | no project / no pipelines / project not initialized / pipeline focus = creating |
| `/board?pipeline=<id>` | `BoardScreen` w/ pinned pipeline | focus column on `<id>` | pipeline running / paused / failed / ready / merged / sync mid-flow |
| `/board?creating=1` | `BoardScreen` + `CreateCard` overlay placeholder | create form open | invalid name / duplicate name / mid-submit |
| `/setup` | `SetupScreen` (`src/features/auth/SetupScreen.tsx`) | QR shown, ready for OTP | `loading` (initial), `init-error`, `submitting`, `code-error` |
| `/login` | `LoginScreen` (`src/features/auth/LoginScreen.tsx`) | 6-digit code input idle | `submitting`, `error` (`驗證碼錯誤`) |

### Pipeline lifecycle (`PipelineState`)

`shared/types.ts:292-302`. Plus legacy/transient `stopping` accepted but unused by current frontend.

| State | Where surfaced | Notes |
|---|---|---|
| `planning` | RailItem dot, FocusHeader chip, RunButton = `執行` | Default after pipeline created; worktree may or may not exist. |
| `queued` | RailItem dot, RunButton = `順位 N · 取消` | Set when `max_parallel` reached at run-attempt. `queuePosition` prop drives label. |
| `running` | RailItem dot pulses, FocusHeader chip + pulse dot, RunButton = `停止` (btn-danger), ticket cards pulse on running ticket | At most one running ticket per pipeline; sync chip / spawn chip may overlay. |
| `paused` | RailItem dot, FocusHeader, RunButton = `繼續`, paused ticket shows `paused-reason` row | Result of stop / server restart / iter-stop-at-limit / runtime crash. |
| `ready` | RailItem dot, FocusHeader, RunButton = `執行`, `ReadyBanner` (variant=`ready`) mounted in FocusHeader | All real tickets done, no merge ticket yet (or merge ticket waiting). |
| `failed` | RailItem dot, FocusHeader, RunButton = `重試` | Permanent terminal failure. |
| `merged` | RailItem dot, FocusHeader, RunButton may render disabled-empty `無可執行 ticket`, `ReadyBanner` (variant=`merged`) | Merge ticket succeeded. hasWorktree may flip to false (cleanup). |

### Ticket lifecycle (`TicketStatus`)

`shared/types.ts:227-235`. `TicketMode` ∈ `step | iter | merge | sync` (225).

| State | Card visual | Drawer footer actions |
|---|---|---|
| `draft` | `is-draft` (opacity-low), `StatusPill = 草稿` | mode-toggle, iter-limit edit, AI split, delete |
| `ready` | `is-draft` style, `StatusPill = 就緒` | mode-toggle, iter-limit edit, AI split, delete |
| `running` | `is-running` (pulse), liveLog row visible (aria-live polite), IterStages stage=`doer`/`critic` | delete disabled |
| `paused` | `is-paused`, `paused-reason` row, IterStages stage frozen | reset, delete |
| `done` | `is-done`, summary `共 N 輪 · 總耗時`, IterStages `✓ PASS` | reset, delete; drawer reorders sections (outcome first, spec collapsed) |
| `failed` | `is-failed`, IterStages `✓ FAIL` (terminal styled), summary `共 N 輪` | reset, delete |
| `failed_iter_limit` | `is-failed`, same as `failed`, in-progress round still rendered to show which stage hit the wall | reset, delete |
| `failed_transient` | `is-failed`, but RunButton counts it as runnable (auto-reset to paused on next run) | reset, delete |

Plus the transient virtual state `splitting` (`isSplitting` prop on `TicketCard`,
`splittingTicketId` on `BoardScreen`/`TicketDrawer`) — card chip shows
`AI 拆分中` with spinner; drawer footer swaps to `tdrw-actions-running` busy block.

### Sync job (`SyncJobState`)

`shared/types.ts:335-358`. Lives at `pipeline.syncJob.state`; undefined = idle.

| State | SyncStatusBar chip | SyncConflictModal | RunButton lock |
|---|---|---|---|
| (no syncJob, behind>0) | `落後 N · 同步` button | hidden | not locked |
| `merging` | `同步中… git merge` (busy) | hidden | RunButton = `同步中` disabled |
| `conflict_await` | `遇衝突 (N 檔)` + ✓ ✕ buttons inline | **modal open** as alertdialog | RunButton = `同步中` disabled |
| `ai_running` | `AI 解衝突 · MM:SS` (busy) + cancel ✕ | hidden | RunButton = `同步中` disabled |
| `failed` | `同步失敗` + 重試 + 關 buttons | hidden | RunButton not locked |
| `done` | `已同步` + 關 button | hidden | RunButton not locked |

### Notification surfaces

`NotifEventType` (43 types, `shared/types.ts:428-471`) drives both
`InboxColumn` items and FCM push. Severities `block | info | muted` map to dot color in the strip / panel; per-row state = `unread | read` and `pending dismiss`.

| Where | What | State variations to cover |
|---|---|---|
| `InboxColumn` strip (collapsed) | dot row + bell badge | empty / 1-3 dots / overflow `+N` / hover preview popover |
| `InboxColumn` panel (expanded) | filter chips (`all / unread / mine`) + list | empty / scrolled / item-hovered / item dismissing / filter active |
| Notif item row | sev dot + title + sub + ts | unread vs read, highlight-flash 1.6s (`highlightId`), pending dismiss |
| Banner (`SwUpdateBanner`) | new SW available | `needRefresh && !dismissed` only — BLOCKED without injected SW state |
| Banner (`ReadyBanner`) | merge ready/merging/merged/failed | 4 variants in §micro-states |
| Toast (`ToastStage`) | dispatched via `useToast` | `success / info / warn / danger`; auto-dismiss timer; enter / exit animation |

## Per-component micro states

Decomposition pass — components with state that changes UI visibly.

### `BoardScreen` (`src/features/pipeline/BoardScreen.tsx`)

useState hooks (lines 42-75):
- `activeId` (URL `?pipeline=`) — drives focus column
- `activeTab: "rail" | "focus"` (mobile) — controls which column is visible on mobile
- `creating: boolean` — toggles `CreateCard` in rail / placeholder in focus
- `openTicket: Ticket | null` — mounts `TicketDrawer`
- `splittingTicketId: string | null` — propagates `isSplitting` to card + drawer
- `inboxState: "hidden" | "collapsed" | "expanded"` — InboxColumn variant
- `filter: InboxFilter` — `all | unread | mine`
- `highlightId: string | null` — 1.6s flash on focused notif row
- `loadError / actionError: string | null` — page-level error band
- `popupDismissed: boolean` — gates `InitPopup` re-show after dismiss

### `FocusColumn` / `FocusHeader` (`src/features/pipeline/FocusHeader.tsx`)

- `historyOpen: boolean` (line 82) — mounts `PipelineHistoryDrawer`
- meta row chip set depends on `diffStat`, `runs.length`, `behind`, `pipeline.syncJob`, `showMergeBanner`, `lockedByState`, `syncActive` — combinatorial visual variants

### `TicketCard` (`src/features/pipeline/TicketCard.tsx`)

Stateless but rendering split by:
- `status` (8 values) × `mode` (4 values) × `isSplitting` flag → ~20 meaningful combos
- `hideSummary` (terminal single-round) toggle (line 101)
- `inProgress` rendering when `failed_*` with incomplete round (line 220)
- liveLog row shown only when `running && ticket.liveLog`
- paused-reason row only when `paused && ticket.reason`

### `TicketDrawer` (`src/features/pipeline/TicketDrawer.tsx`)

- `splitPending: boolean` (line 48) — inline AI-split confirm card (replaces footer)
- `resetPending` / `deletePending` (useAsyncAction) — buttons go aria-busy
- `isSplitting` prop — footer swaps to spinner `AI 拆分中`
- `IterLimitField.draft` (line 420), `invalid` state — input shows error
- `CollapsiblePrompt.expanded` (line 522) — collapsed / expanded
- `Commits.copiedHash` (line 629) — per-row copied flash 1.5s
- `AuditTimeline.open` (line 25) — section folds; `entries=null` (loading) / `[]` (empty) / non-empty

### `QADrawer` (`src/features/qa/QADrawer.tsx`)

- `viewOverride: "chat" | "review" | null` (line 44) — overrides auto chat/review switch
- `pendingClose: boolean` (line 99) — inline alertdialog when composer has unsent text
- `SpecChecklist.expanded: keyof TicketSpec | null` (line 364) — per-chip drilldown panel
- `Composer.text` / `picked: Set<number>` (lines 486-487) — multi-select option state
- `SpecReview.edited` / `useSplit` (lines 666-669) — final form edits + split toggle
- thinking state implied by `busy || lastTurn.role==="user"`
- empty-starter quick-reply chips (`emptyTurns` branch, line 248)
- spec-ready bar (line 222) when spec 5/5 but viewOverride="chat" or backend complete=false

### `SettingsPopover` + tabs (`src/features/settings/`)

- `activeTab: "project" | "ai" | "notifications" | "update" | "security"` (line 37) — 5 panels (security visible only when `authStatus.bound===true`)
- `savedVisible` + `savedFading` — `已儲存` chip lifecycle (3s visible → fade)
- `ProjectTab.savingFields` (per-field record) — number-field shows mid-save indicator per field
- `ProjectTab.fieldErrors` — invalid value, `max_parallel`, `cost_limit_usd`, `default_base_branch`
- `ProjectTab.basePickerOpen` — picker dropdown
- `UpdateTab.phase` (discriminated union: `idle | starting | polling{afterDown} | done{newTag} | error{reason}`) — 5 lifecycle states
- `UpdateTab.lastCheckedAt` — drives `formatLastChecked`
- `NotificationsTab.permission` (`default | granted | denied`), `supported: boolean | null`, `token: string | null` — 3-dim matrix
- `SecurityTab.sessions` (`null` loading / `[]` empty / list), `addDeviceOpen` — drives `AddDeviceDialog`
- `tabs` array shape depends on `authStatus.bound` — security tab appears/disappears

### `AddDeviceDialog` (`src/features/auth/AddDeviceDialog.tsx`)

- `data: SetupInitResp | null` — null = loading, set = ready
- `error: string | null` — fetch failure state
- `secretVisible: boolean` — manual-uri reveal toggle
- `loadQr.pending` — `loading` flag for retry / spinner
- copy-secret toast on success / danger on failure

### `InitPopup` (`src/features/init/InitPopup.tsx`)

- `alsoGitInit: boolean` (line 20) — checkbox shown only when `!project.hasGit`
- `autoInit.pending: busy` — busy hint + button spinner + foot aria-busy
- error → toast `初始化失敗:<msg>`

### `CreateCard` (`src/features/pipelineCreate/CreateCard.tsx`)

- `name` (with validation `taken | format_invalid | ok`)
- `baseBranch` + `baseOpen` (picker)
- `autoMerge: boolean` toggle
- counter near/at limit (line 54-55) shows `name.length/60` chip
- error states: `hasError` (taken or format) — TextField `is-error`

### `RunButton` (`src/features/pipeline/RunButton.tsx`)

Authoritative table at top of file. Rendered variants:
- running → `停止` (btn-danger)
- queued → `順位 N · 取消` (btn-queued)
- syncActive → `同步中` (aria-disabled) + sr-only status
- spawning → `啟動中` (aria-disabled)
- planning/paused/failed/ready/merged with no runnable ticket → `無可執行 ticket` (aria-disabled, two-label desktop/mobile)
- planning/ready/merged → `執行`
- paused → `繼續`
- failed → `重試`

### `OverflowMenu` (`src/features/pipeline/OverflowMenu.tsx`)

- `open: boolean` (popover)
- conditional sections: safe (auto-merge, history, reveal worktree) / danger (reset, delete)
- `isLocalHost()` gates reveal worktree
- `pipeline.hasWorktree` flag derives reveal hint (`未建立 / 已合併 / 已清除`)
- `lockedByState` disables many items with `執行中無法操作` hint
- per-action `useConfirm` dialog (reset / delete) with `descriptionRich`

### `SyncConflictModal` (`src/features/pipeline/SyncConflictModal.tsx`)

Mounts iff `pipeline.syncJob?.state === "conflict_await"`. No own internal state.

### `RunHistory` (`src/features/pipeline/RunHistory.tsx`)

- `runs: null` (loading) / `[]` (empty) / list
- per `RunCard.open: boolean` + `detail / detailFailed / detailLoading`
- `StdoutBlock.expanded` (preview/full)
- `CopyableBlock` copy flash

### `DiffModal` (`src/features/pipeline/DiffModal.tsx`)

- `diff: null` (loading) / `loadFailed` / non-empty / `files.length===0` (empty)
- `activeFile` + IntersectionObserver-driven scrollspy
- copy-diff flash

### `TopBar` (`src/shell/TopBar.tsx`)

- `open: boolean` (project switcher popover)
- `browseOpen: boolean` + `browseData / browseLoading / error` — modal lifecycle (loading / loaded / empty-folder / error / browsing path stack)
- recent-list states: empty / has-recents / active+others / removable hover / removing
- `selectPending / removePending / openByPathPending` async flags
- isDark toggle persistence
- `ParallelChip` 0/M / N/M(<M) / N=M (queued color) / N>M overload variant
- `topbar-active-meta` chips only when project active

### `Rail` + `RailItem` + `RailSectionMenu`

- `creating` flag swaps add-button for `createSlot`
- per `RailItem` per-state secondary text (`railSecondary`) and `rail-mini` cells
- `hasDraft` adds `QA` badge
- `RailSectionMenu.open: boolean`

### `SwUpdateBanner`

- `needRefresh && !dismissed` only
- `dismissed: boolean` — once true never re-renders for the session

### `Toast` (`src/ui/Toast.tsx`)

- per `ToastItem`: variant (`success | info | warn | danger`), duration timer, enter/exit animation flag
- queue: 0 / 1 / many; stack appearance

### `ConfirmDialog`

- mounted iff `state != null`
- variants: `danger=true` (red btn, default focus = cancel, scrim no-close) vs `danger=false` (primary btn, Enter = confirm)
- `warning` block optional, `descriptionRich` slot vs `description` string, optional `tertiaryLabel` (3-button)

### `InboxColumn` (`src/features/notifications/InboxColumn.tsx`)

- `state: hidden | collapsed | expanded`
- collapsed strip: dots (≤12) + overflow `+N`, hover preview popover (`previewIdx`)
- expanded panel: filter pill row + scrollable list + bulk actions
- per row: unread/read flash, dismissing animation
- empty-state (`InboxEmptyIcon`) when 0 items

### `BoardOverlays` / `EmptyTickets` / `EmptyProject`

Stateless. `EmptyTickets` branches on `hasActiveDraft`; `EmptyProject` covers
"no project picked" surface with `pointToTopBar` arrow + optional `action` slot.

## (unit, state) pair catalog

Stable id format: `<unit>.<state>`. Drive recipe column points at a recipe in
§Drive recipes (lowercased token in backticks). Acceptance hint = what the
codex advisor should weigh extra in this state.

| Stable id | Unit(s) | Drive recipe | Acceptance hint |
|---|---|---|---|
| `pipeline.planning` | rail / focus-column / pipeline-rail-item / run-button | `mock-empty-pipeline` | RunButton verb `執行` clear; no merge banner; rail dot uses planning color; meta `尚未執行 · 更新於 ...`. |
| `pipeline.queued` | rail / focus-column / run-button | `mock-queue-saturate` (BLOCKED — needs 2nd running pipeline in same project; use `mock-runner` with two pipelines and lower max_parallel to 1 via project config) | RunButton shows `順位 N · 取消`; aria-label includes position; cancel path still reachable while sync chip present. |
| `pipeline.running` | rail / focus-column / ticket / iter-stages / focus-livelog / run-button | `mock-runner-iter` | Pulse dot on rail + chip; liveLog aria-live polite; stop button (btn-danger) always reachable; only one ticket has `is-running`. |
| `pipeline.paused` | rail / focus-column / ticket / run-button | `mock-runner-pause` (script with `finalState=paused`; or run + send stop) | RunButton `繼續`; paused-reason row visible iff ticket.reason; ticket card opacity differentiates from running. |
| `pipeline.ready` | rail / focus-column / ready-banner / run-button | `mock-runner-success` (script all tickets PASS) | ReadyBanner variant `ready` mounted; `合併入 <base>` primary CTA; commit count accurate. |
| `pipeline.failed` | rail / focus-column / ticket / run-button | `mock-runner-failed-iter-limit` | RunButton `重試`; failed ticket card terminal styling; AuditTimeline shows transition. |
| `pipeline.merged` | rail / focus-column / ready-banner / overflow-menu | `mock-runner-merged` (script `finalState=merged`) | ReadyBanner variant `merged` (`已合併入 <base>`), RunButton disabled-empty `merged` variant; reveal worktree shows `已合併` hint. |
| `pipeline.create.idle` | create-card | `boot-empty` + click `+ 新 pipeline` | name field focused; submit disabled; baseBranch picker collapsed. |
| `pipeline.create.invalid_format` | create-card | type `1abc!` into name field | error msg `首字需英數`; submit disabled; aria-describedby wires error. |
| `pipeline.create.name_taken` | create-card | preset existing pipeline named `foo`, type `foo` | error `名稱已存在,請換一個`; counter hidden; submit disabled. |
| `pipeline.create.counter_near_limit` | create-card | type 50-char name | counter `is-near` visible; warns at 60. |
| `pipeline.create.base_picker_open` | create-card | click base picker | PickerSelect open list scrollable; escape closes picker only (doesn't cancel form). |
| `ticket.draft` | ticket / ticket-drawer | `mock-draft-ticket` | StatusPill `草稿`; opacity-low; drawer footer shows mode-toggle, iter-limit, AI split, delete. |
| `ticket.ready` | ticket / ticket-drawer | `mock-ready-ticket` | iter-limit field still editable; identical footer to draft. |
| `ticket.running.iter_doer` | ticket / iter-stages / focus-livelog | `mock-runner-iter` (mid-flight script with long workMs) | IterStages stage=`doer` with ▶; liveLog row aria-live polite; round number = current iter. |
| `ticket.running.iter_critic` | ticket / iter-stages | `mock-runner-iter` (round mid-critic) | IterStages stage=`critic`; preceding doer chip is checked. |
| `ticket.paused.with_reason` | ticket / ticket-drawer | `mock-runner-pause` with `ticket.reason` set in script | paused-reason chip readable + truncated; reset / delete in drawer. |
| `ticket.done.single_round` | ticket / iter-stages | `mock-runner-success` 1-round iter | `hideSummary` true; IterStages `✓ PASS`; drawer reorders outcome first. |
| `ticket.done.multi_round` | ticket / iter-stages / ticket-drawer | `mock-runner-iter` (3 rounds PASS at last) | summary `共 3 輪 · 總耗時 …`; per-round expanded in drawer; PASS/FAIL chips localized 通過/失敗. |
| `ticket.failed.permanent` | ticket / ticket-drawer | `mock-runner-failed` | `is-failed`, IterStages `✓ FAIL`; reset button visible. |
| `ticket.failed_iter_limit` | ticket / iter-stages / ticket-drawer | `mock-runner-failed-iter-limit` | in-progress round still rendered (shows which stage hit wall); reset → status=ready next run. |
| `ticket.failed_transient` | ticket / run-button | `mock-runner-failed-transient` | RunButton counts ticket as runnable; helper text not on the no-runnable-tickets branch. |
| `ticket.splitting` | ticket / ticket-drawer | open ticket-drawer + click `AI 拆分…` + 確認 (`mock-split` to control output) | card chip `AI 拆分中` with spinner; drawer footer swaps to `tdrw-actions-running`; status=role=status. |
| `ticket.mode_step` | ticket / ticket-drawer | `mock-draft-ticket` with mode=`step` | drawer header shows `單次任務` chip without iter suffix; iter-limit field hidden. |
| `ticket.mode_merge` | ticket | `mock-runner-success` → trigger merge | synthetic merge ticket: no chip, mode-toggle disabled, can't split / delete. |
| `ticket.mode_sync` | ticket | `mock-runner-success` + `mock-sync-success` | synthetic sync ticket; same lockdown as merge. |
| `ticket.drawer.spec_view_default_state` | ticket-drawer | open draft ticket | spec sections (目標/驗收/提示詞) in original order; CollapsiblePrompt expanded if short. |
| `ticket.drawer.outcome_first_done` | ticket-drawer | open done ticket | outcome sections (iter / commits / livelog / reason) above spec; prompt default-collapsed. |
| `ticket.drawer.iter_limit_invalid` | ticket-drawer | enter `9` into iter-limit field | invalid border + error text `請輸入 1-5 的整數,Esc 還原`; blur reverts. |
| `ticket.drawer.split_confirm_inline` | ticket-drawer | click `AI 拆分…` | footer replaced with confirm card (title + desc + cancel/confirm row); ESC and scrim-close collapse confirm, not drawer. |
| `ticket.drawer.commit_copied_flash` | ticket-drawer / commits | open done ticket with commits, click commit hash | floating `已複製` chip 1.4s; aria-live polite. |
| `ticket.drawer.prompt_collapsed` | ticket-drawer | open ticket with `>400`-char prompt | fade gradient visible; toggle reads `展開全部(共 N 字)`; tabindex on inner links = -1. |
| `qa-drawer.bootstrapping` | qa-drawer | click `+ 新增 ticket` on empty pipeline before backend responds | `啟動 QA session` + ThinkingDots; close keeps composer focus. |
| `qa-drawer.chat_empty` | qa-drawer | open fresh draft (`mock-qa` welcome) | welcome AI bubble + 3 quickreply chips inline; composer auto-grow textarea; sticky bottom. |
| `qa-drawer.chat_thinking` | qa-drawer | send a user turn (`mock-qa` delayed reply) | `助理思考中` row with ThinkingDots; composer disabled. |
| `qa-drawer.chat_progress` | qa-drawer | partial spec returned (e.g. 3/5) | progress row `規格 3/5 · 還差 [目標] [驗收]`; aria-live polite. |
| `qa-drawer.review` | qa-drawer | 5/5 spec + `complete=true` | SpecReview form mounted; 「繼續討論」 reverses viewOverride; `送出建立需求單` primary. |
| `qa-drawer.review_with_split` | qa-drawer | `mock-qa` reply with `splitInto.length>=2` | split proposal block visible; checkbox defaults checked; primary button label changes to `送出建立 N 張需求單`. |
| `qa-drawer.spec_ready_bar` | qa-drawer | spec 5/5 but viewOverride=`chat` | bar above composer: `規格已備齊…` + 「回最終預覽」button. |
| `qa-drawer.pending_close_unsent` | qa-drawer | type text → press ESC | inline alertdialog (continue editing vs discard) over drawer body. |
| `qa-drawer.checklist_expanded` | qa-drawer | click one of 5 chip in `SpecChecklist` | panel below chips shows current field value; aria-expanded toggled. |
| `qa-drawer.multi_select_options` | qa-drawer | AI turn with `optionsMode=multi` (`mock-qa`) | multi chips with check marks; bottom `送出已選 (N)` button; clearing on new turn. |
| `focus-column.empty_pipeline` | focus-column / empty-tickets | `mock-empty-pipeline` | empty card CTA `建第一張 ticket`; `+ ticket` button in header uses btn-primary. |
| `focus-column.has_active_draft` | focus-column / empty-tickets / qa-drawer | active draft exists, no committed tickets | both empty-tickets CTA and header button switch to `接續 QA`. |
| `focus-column.sync_active` | focus-column / sync-status-bar / run-button | `mock-sync` (state=`ai_running`) | RunButton disabled state explicit; sync chip animated dots; cancel reachable. |
| `focus-column.merge_banner_ready` | focus-column / ready-banner | `pipeline.ready` | ReadyBanner variant=`ready`; commit count matches tickets. |
| `focus-column.merge_banner_merging` | focus-column / ready-banner | merge ticket in `running` state | variant=`merging`; spinner icon; aria-busy true; button hidden. |
| `focus-column.merge_banner_failed` | focus-column / ready-banner | merge ticket `failed_*` or `paused` | variant=`failed`; alert role; retry button + alert aria-live=assertive. |
| `focus-column.merge_banner_merged` | focus-column / ready-banner | pipeline.state=`merged` | variant=`merged`; muted icon; no button; describedby commits + branch row. |
| `focus-column.with_diff_stat` | focus-column / focus-diff-chip | non-empty diffStat | chip shows `+A -D Nf`; opens DiffModal on click. |
| `focus-column.runs_chip` | focus-column | runs.length>0 (`mock-runner-success` leaves runs[]) | chip shows `N 次執行 · $X.XX`. |
| `sync.idle_behind` | sync-status-bar | base ahead but no syncJob (`mock-base-ahead`) | chip `落後 N · 同步`; click triggers merge; disabled if pipeline busy. |
| `sync.merging` | sync-status-bar | `mock-sync` state=merging | busy dots; tooltip lists `git merge` action. |
| `sync.conflict_await` | sync-status-bar / sync-conflict-modal | `mock-sync` state=conflict_await | modal opens centered; lists conflict files; cancel = abort; AI confirm = consume tokens. |
| `sync.ai_running` | sync-status-bar | state=ai_running | dots + MM:SS timer; cancel button visible. |
| `sync.failed` | sync-status-bar | state=failed with reason | reason chip + retry + dismiss; tooltip with short reason truncated 200 chars. |
| `sync.done` | sync-status-bar | state=done | `已同步` + dismiss; tooltip includes merge commit short hash. |
| `settings.opened_project` | settings-popover / project-tab | click gear icon | tab=`project` active; tab roving focus works; saved chip empty. |
| `settings.project.field_saving` | settings-popover / project-tab | edit max_parallel value + blur | per-field saving indicator visible briefly; on success `已儲存` chip 3s. |
| `settings.project.field_invalid` | settings-popover / project-tab | enter negative max_parallel | error border + field-level message; saved chip not fired. |
| `settings.project.base_picker_open` | settings-popover / project-tab | open base-branch picker | dropdown reachable by keyboard; selection persists; PickerSelect arrow chevron. |
| `settings.ai_tab` | settings-popover / ai-tab | switch to AI tab | 6 task-class rows (qa/split/runner/executor/critic/merge); model + effort pickers per row; provider switch swaps allowed lists. |
| `settings.notifications.permission_default` | settings-popover / notifications-tab | reset Notification permission to default | shows `啟用通知` button; not yet granted hint. |
| `settings.notifications.permission_granted` | settings-popover / notifications-tab | grant permission | 5 event toggles editable; FCM token field shown. |
| `settings.notifications.permission_denied` | settings-popover / notifications-tab | block in browser settings | inline guide to unblock; toggles disabled. |
| `settings.notifications.unsupported` | settings-popover / notifications-tab | open in unsupported browser | message + early return UI; BLOCKED — needs browser without Notification API (use Playwright `permissions` override). |
| `settings.update.idle_uptodate` | settings-popover / update-tab | mock `getSystemVersion` returns current==latest | shows current tag + `已是最新` state; check timestamp `剛剛 / N 分鐘前`. |
| `settings.update.idle_outdated` | settings-popover / update-tab | mock returns latest > current | `套用更新` primary visible. |
| `settings.update.starting` | settings-popover / update-tab | click apply | phase=`starting`; button busy. |
| `settings.update.polling_after_down` | settings-popover / update-tab | backend goes 503 mid-poll | hint `系統重啟中…`; spinner; aria-live polite. |
| `settings.update.done` | settings-popover / update-tab | backend returns with new tag | success state + new tag chip + `重新整理` advice (SwUpdateBanner will surface next). |
| `settings.update.error_timeout` | settings-popover / update-tab | poll 3-min timeout | error block + manual reload prompt. |
| `settings.security.sessions_loading` | settings-popover / security-tab | open security tab (sessions=null) | spinner / placeholder row; no revoke buttons. |
| `settings.security.sessions_list` | settings-popover / security-tab | API returns ≥1 session | per-row revoke (except current); `當前裝置` badge on own session. |
| `settings.security.add_device_loading` | add-device-dialog | open dialog (`setupInit` pending) | `載入中…` block; close button visible; primary label `關閉`. |
| `settings.security.add_device_ready` | add-device-dialog | `setupInit` succeeds | QR SVG rendered; manual-uri toggle hidden by default; primary label `完成`. |
| `settings.security.add_device_error` | add-device-dialog | `setupInit` rejects | error band + 重試 button; toast danger. |
| `settings.security.add_device_secret_visible` | add-device-dialog | click `無法掃描？顯示手動設定連結` | otpauth_url shown in mono code block + 複製 button; aria-expanded toggled. |
| `settings.security.reset_confirm` | settings-popover / security-tab / confirm-dialog | click TOTP reset | ConfirmDialog danger variant with warning block; cancel auto-focused. |
| `init.popup_with_git` | init-popup | open uninit project that already has `.git/` | git-toggle hidden; only `會建立` tree shown; primary `自動初始化`. |
| `init.popup_without_git` | init-popup | open uninit project without `.git/` | extra `會建立 .git/` row; checkbox `順便跑 git init` default on. |
| `init.popup_busy` | init-popup | click `自動初始化` | busy hint aria-live polite; cancel disabled; primary spinner; foot aria-busy. |
| `init.popup_error_toast` | init-popup | force backend error (`mock-api-error /api/project/<hash>/init`) | toast danger `初始化失敗:…`; popup remains open for retry. |
| `topbar.proj_switcher_empty` | topbar / proj-switcher | first run (no recents) | menu `還沒開過任何專案` + `選擇專案資料夾…` action + ⌘O/Ctrl+O shortcut chip. |
| `topbar.proj_switcher_has_recents` | topbar / proj-switcher | ≥1 project in recents | active item ticked; X (remove) disabled on active; meta `已初始化 / 未初始化`. |
| `topbar.browse_modal_loading` | topbar / browse-modal | open browse modal (load pending) | `(載入中…)` path; nav buttons disabled; focus falls to fallback then resolves to nav once data arrives. |
| `topbar.browse_modal_loaded` | topbar / browse-modal | normal load | entry list; current path mono; drives chip group on Windows. |
| `topbar.browse_modal_empty_folder` | topbar / browse-modal | navigate into empty folder | `(空資料夾)` placeholder; toolbar 仍可上層. |
| `topbar.browse_modal_error` | topbar / browse-modal | mock fs reject | inline error + retry path. |
| `topbar.parallel_chip_overload` | topbar / parallel-chip | run 2 pipelines then lower max_parallel | overload color (failed) + `!` suffix + tooltip. |
| `topbar.theme_toggle` | topbar | click moon/sun | swap icon; persists to localStorage; no flash on next reload. |
| `topbar.active_meta_localhost` | topbar | isLocalHost===true | reveal-folder chip visible alongside branch chip. |
| `topbar.active_meta_remote` | topbar | Tailscale / non-localhost | reveal chip hidden; branch chip still visible. |
| `rail.empty` | sidebar | project initialized but no pipelines | only `+ 新 pipeline` add row; section menu absent. |
| `rail.with_pipelines` | sidebar / pipeline-rail-item | ≥1 pipeline | per-item state dot + mini cells + secondary text; active item highlighted. |
| `rail.creating` | sidebar / create-card | click add row | row replaced by CreateCard; existing items go muted (`is-muted`). |
| `rail.qa_badge` | pipeline-rail-item | item with active draft | `QA` mono badge; aria-label includes `QA 進行中`. |
| `rail.section_menu_open` | sidebar | click ⋯ on PIPELINES header | menu open; items focusable; ESC closes. |
| `confirm-dialog.standard` | confirm-dialog | trigger non-danger confirm | Enter=confirm; primary button autofocus; kbd `↵` hint. |
| `confirm-dialog.danger` | confirm-dialog | trigger reset/delete | cancel autofocus; Enter does NOT confirm; warning block + danger button color; scrim no-close. |
| `confirm-dialog.tertiary` | confirm-dialog | trigger 3-button flow (rare) | 3 buttons in row; tertiary callable; BLOCKED — find usage; no current caller in source. |
| `confirm-dialog.rich_desc` | confirm-dialog | trigger pipeline reset (descriptionRich) | structured body (lists / mono detail); aria-describedby wired. |
| `diff-modal.loading` | diff-modal | open chip while diff still fetching | `載入中…` row aria-live polite. |
| `diff-modal.with_diff` | diff-modal | non-empty diff | file list + scrollable code view; scrollspy highlights active row; copy button. |
| `diff-modal.empty` | diff-modal | force getFullDiff to return empty files | `沒有改動。` placeholder. |
| `diff-modal.error` | diff-modal | mock-api-error on `/api/.../diff` | error band + 重新讀取 button; toast danger with humanized msg. |
| `diff-modal.copied_flash` | diff-modal | click 複製差異 | button label flips to `已複製` for 1.4s. |
| `history-drawer.empty` | history-drawer / run-history | open pipeline with 0 runs | `尚無執行紀錄` placeholder; AuditTimeline section collapsed. |
| `history-drawer.with_runs` | history-drawer / run-history | open pipeline post `mock-runner-success` | summary row (count / total time / cost) + RunCard list collapsed. |
| `history-drawer.run_expanded` | history-drawer / run-history | click a run row | detail region with stdout (preview + 展開), session id, optional stderr. |
| `history-drawer.run_codex_provider` | history-drawer / run-history | run with provider=codex (no cost / token data) | cost/turns/tokens columns hidden; provider chip shows `codex · gpt-5.4` etc. |
| `history-drawer.audit_open` | history-drawer / audit-timeline | expand AuditTimeline | reverse-chrono list; from→to mono chips; source labels localized. |
| `audit-timeline.empty` | audit-timeline | open ticket-drawer of fresh draft | `尚無紀錄`. |
| `audit-timeline.long_list` | audit-timeline | open ticket-drawer of pipeline after pause/resume/sync cycle | newest-on-top hint visible; scrollable; source labels mapped. |
| `inbox.collapsed_empty` | inbox-strip | `mock-notifs-empty` | only bell icon + 0 dots; aria says empty. |
| `inbox.collapsed_some` | inbox-strip | `mock-notifs-three` | 3 sev dots + bell with count. |
| `inbox.collapsed_overflow` | inbox-strip | `mock-notifs-twenty` | 12 dots + `+8` overflow indicator. |
| `inbox.strip_preview` | inbox-strip | hover a dot | preview popover (fixed-positioned via portal) shows title+sub; mouseleave hides. |
| `inbox.expanded_empty` | inbox-panel | mock empty + expand | InboxEmptyIcon + helper text. |
| `inbox.expanded_unread_filter` | inbox-panel | mock mixed read/unread, set filter=unread | filter chip active; list filtered; counts in header. |
| `inbox.item_unread` | inbox-panel | unread item visible | bold weight / sev dot tone; aria-label includes 「未讀」. |
| `inbox.item_marking_read` | inbox-panel | click an item | transient highlight 1.6s; mark-read fires; eventually unread style drops. |
| `sw-update-banner.visible` | sw-update-banner | inject `useSwUpdate.needRefresh=true` (BLOCKED in dev — vite-plugin-pwa SW not registered in dev mode per `.claude/rules/pwa-sw.md`; require prod build `bun run build && bun run server` on :3001 AND a forced needRefresh; or mark blocked with fixture instructions) | banner fades up; status role polite; 套用更新 + dismiss reachable. |
| `sw-update-banner.dismissed` | sw-update-banner | click X | banner unmounts; never re-renders for session. |
| `toast.success` | toast | dispatch `toast(msg, {variant:"success"})` via dev helper or any post-action callback | green tone; auto-dismiss timer; sr-only role=status. |
| `toast.danger` | toast | trigger any backend error in current path | red tone; longer linger; role=alert. |
| `toast.stack` | toast | dispatch 3 toasts within 1s | stacked offset visually; queue dismisses bottom-up. |
| `auth.setup.loading` | setup-screen | nav to `/setup` (initial) | spinner only. |
| `auth.setup.ready` | setup-screen | `setupInit` returns | QR + code input + submit. |
| `auth.setup.init_error` | setup-screen | mock-api-error `/api/auth/setup/init` | error card + 重試 button. |
| `auth.setup.code_error` | setup-screen | enter wrong code | error msg `驗證碼錯誤,請重試`; field cleared; refocus first digit. |
| `auth.setup.submitting` | setup-screen | press 登入/完成設定 | `驗證中…` label; disabled. |
| `auth.login.idle` | login-screen | nav to `/login` | input field autofocused; submit disabled until 6 digits. |
| `auth.login.submitting` | login-screen | press 登入 | spinner; disabled. |
| `auth.login.error` | login-screen | wrong code | red border + `驗證碼錯誤`; field cleared. |
| `board.no_project` | empty-project | clear active project hash | empty-project with `↑ 點上方「選擇專案」` arrow; topbar still reachable. |

## Project-specific units

Append these to the base unit-dictionary at Phase 2 (source=`extension`).

```yaml
- { name: pipeline-rail-item,   category: container,  aliases: [rail-item, pipeline-card], source: src/shell/Rail.tsx }
- { name: iter-stages,          category: state,      aliases: [stage-chips], source: src/features/pipeline/IterStages.tsx }
- { name: focus-livelog,        category: state,      aliases: [livelog-row], source: src/features/pipeline/TicketCard.tsx }
- { name: focus-diff-chip,      category: state,      aliases: [diff-chip], source: src/features/pipeline/FocusDiffChip.tsx }
- { name: focus-column,         category: container,  aliases: [focus, board-focus], source: src/features/pipeline/FocusColumn.tsx }
- { name: ticket,               category: container,  aliases: [ticket-card], source: src/features/pipeline/TicketCard.tsx }
- { name: ticket-drawer,        category: feedback,   aliases: [ticket-detail], source: src/features/pipeline/TicketDrawer.tsx }
- { name: qa-drawer,            category: feedback,   aliases: [qa-chat], source: src/features/qa/QADrawer.tsx }
- { name: ready-banner,         category: feedback,   aliases: [merge-banner], source: src/features/pipeline/ReadyBanner.tsx }
- { name: sync-status-bar,      category: state,      aliases: [sync-chip], source: src/features/pipeline/SyncStatusBar.tsx }
- { name: sync-conflict-modal,  category: feedback,   aliases: [sync-conflict], source: src/features/pipeline/SyncConflictModal.tsx }
- { name: audit-timeline,       category: state,      aliases: [state-history], source: src/features/pipeline/AuditTimeline.tsx }
- { name: run-history,          category: container,  aliases: [pipeline-runs], source: src/features/pipeline/RunHistory.tsx }
- { name: history-drawer,       category: feedback,   aliases: [pipeline-history-drawer], source: src/features/pipeline/PipelineHistoryDrawer.tsx }
- { name: diff-modal,           category: feedback,   aliases: [worktree-diff], source: src/features/pipeline/DiffModal.tsx }
- { name: run-button,           category: input,      aliases: [pipeline-run-btn], source: src/features/pipeline/RunButton.tsx }
- { name: overflow-menu,        category: navigation, aliases: [focus-overflow], source: src/features/pipeline/OverflowMenu.tsx }
- { name: create-card,          category: container,  aliases: [create-pipeline], source: src/features/pipelineCreate/CreateCard.tsx }
- { name: empty-tickets,        category: state,      aliases: [focus-empty], source: src/features/pipeline/EmptyTickets.tsx }
- { name: empty-project,        category: state,      aliases: [no-project], source: src/features/pipeline/EmptyProject.tsx }
- { name: init-popup,           category: feedback,   aliases: [init-card], source: src/features/init/InitPopup.tsx }
- { name: settings-popover,     category: feedback,   aliases: [settings-modal], source: src/features/settings/SettingsPopover.tsx }
- { name: project-tab,          category: input,      aliases: [settings-project], source: src/features/settings/ProjectTab.tsx }
- { name: ai-tab,               category: input,      aliases: [settings-ai], source: src/features/settings/AITab.tsx }
- { name: notifications-tab,    category: input,      aliases: [settings-notif], source: src/features/settings/NotificationsTab.tsx }
- { name: update-tab,           category: state,      aliases: [settings-update], source: src/features/settings/UpdateTab.tsx }
- { name: security-tab,         category: input,      aliases: [settings-security], source: src/features/auth/SecurityTab.tsx }
- { name: add-device-dialog,    category: feedback,   aliases: [totp-add], source: src/features/auth/AddDeviceDialog.tsx }
- { name: setup-screen,         category: navigation, aliases: [auth-setup], source: src/features/auth/SetupScreen.tsx }
- { name: login-screen,         category: navigation, aliases: [auth-login], source: src/features/auth/LoginScreen.tsx }
- { name: sw-update-banner,     category: feedback,   aliases: [pwa-update], source: src/features/system/SwUpdateBanner.tsx }
- { name: topbar,               category: navigation, aliases: [appbar], source: src/shell/TopBar.tsx }
- { name: proj-switcher,        category: navigation, aliases: [project-menu], source: src/shell/TopBar.tsx }
- { name: browse-modal,         category: feedback,   aliases: [folder-picker], source: src/shell/TopBar.tsx }
- { name: parallel-chip,        category: state,      aliases: [n-m-chip], source: src/shell/TopBar.tsx }
- { name: sidebar,              category: navigation, aliases: [rail], source: src/shell/Rail.tsx }
- { name: inbox-strip,          category: navigation, aliases: [notif-strip], source: src/features/notifications/InboxColumn.tsx }
- { name: inbox-panel,          category: container,  aliases: [notif-list], source: src/features/notifications/InboxColumn.tsx }
- { name: confirm-dialog,       category: feedback,   aliases: [confirm], source: src/ui/ConfirmDialog.tsx }
```

## Drive recipes — common fixtures / mocks

All recipes assume backend launched with `VP_TEST_MODE=mock` (per
`vibe-pipeline-e2e` SKILL). Recipes return a `prep_steps` JSON envelope
the codex driver can replay. Where a recipe is `BLOCKED`, attach the
`needs-fixture` reason verbatim to the (unit, state) pair in the run.

### `boot-empty`

Fresh state. POST `/api/__test/reset` → POST `/api/__test/register-project`
with `{path: "C:/tmp/vp-e2e-fixture", name: "fixture", hash: "fixture00"}`.
Navigate to `/board?project=fixture00`. No pipelines exist.

### `mock-empty-pipeline`

`boot-empty` + create pipeline `p1` via UI or API (POST
`/api/projects/fixture00/pipelines` body `{name: "p1", baseBranch: "main"}`).
Resulting state = `planning`, 0 tickets. Navigate to
`/board?project=fixture00&pipeline=<id>`.

### `mock-draft-ticket`

`mock-empty-pipeline` + POST `/api/__test/script/qa` with a single QAReply
`{complete: true, spec: {title:"draft-1", goal:"…", acceptance:["…"],
prompt:"…", mode:"step"}}` → walk QA drawer to finalize. Resulting ticket
status = `draft` (won't auto-start runner unless explicitly hit run).

### `mock-ready-ticket`

Same as `mock-draft-ticket` then call backend API to set status=`ready` (e.g.
the runner orchestrator's preflight does this transition; in mock mode hit
`/api/__test/runner-noop-promote` if added, else use `mock-runner-iter` and
catch state mid-flight). If no direct API, mark `BLOCKED — needs fixture:
backend endpoint to promote draft→ready without running`.

### `mock-runner-iter`

POST `/api/__test/script/runner` with:
```json
{"tickets":[{"beforeRunningMs":300,"iterRounds":[
  {"verdict":"FAIL","executorSummary":"round 1 attempt","criticFeedback":"missing X","durationMs":800},
  {"verdict":"PASS","executorSummary":"round 2 fix","durationMs":900}
],"finalStatus":"done","commitHash":"mock-abc1234","commitSubject":"feat: round 2"}],"finalState":"ready"}
```
Then POST `/api/projects/<hash>/pipelines/<id>/run`. Capture at known
sub-states by adjusting `durationMs`/`beforeRunningMs` and pausing
playwright between events. To freeze on `running.iter_doer`, raise
`durationMs` of first round to 5000ms and capture in first 1.5s.

### `mock-runner-success`

`mock-runner-iter` with single PASS round and `finalState=ready`. Used by
done / ready / merge-banner-ready / runs-chip pairs.

### `mock-runner-pause`

`mock-runner-iter` with `finalStatus=paused`. Or, run `mock-runner-iter` then
POST `/api/projects/<hash>/pipelines/<id>/stop`. State settles to
`pipeline.paused` with paused ticket carrying `reason`.

### `mock-runner-failed`

`mock-runner-iter` with `finalStatus="failed"` and `finalState="failed"`.

### `mock-runner-failed-iter-limit`

`mock-runner-iter` with N FAIL rounds equal to `iterLimit` (default 5), then
`finalStatus="failed_iter_limit"`, `finalState="paused"` (matches real
runner — paused so user can act).

### `mock-runner-failed-transient`

Same as `mock-runner-failed` but `finalStatus="failed_transient"`. Drives
the `ticket.failed_transient` and `run-button` runnable-fallback pair.

### `mock-runner-merged`

`mock-runner-success` + queue a merge ticket (orchestrator triggers when
`autoMerge=true` or user clicks `合併入`). Script the merge ticket with
`finalStatus="done"` and `finalState="merged"`.

### `mock-sync`

POST `/api/__test/sync-state` (BLOCKED if endpoint absent — `testMode.ts`
currently exposes qa / runner / split / fcm / push / auth scripts; sync
state injection looks unimplemented). Workaround: set up the fixture
project to truly fall behind base (one commit on base after pipeline
worktree created) then POST `/api/projects/<hash>/pipelines/<id>/sync`.
Mark sub-state recipes (`sync.conflict_await`, `sync.ai_running`) as
`BLOCKED — needs fixture: introduce conflicting commit on base` plus
mock-runner sync script.

### `mock-base-ahead`

git-side: add commit on base branch after pipeline created. Backend
recalculates `behind` count and `SyncStatusBar` shows the fallback chip.
For mock-only path, mark `BLOCKED — needs fixture: server-side `behind`
override endpoint`.

### `mock-qa`

POST `/api/__test/script/qa` with an array of `QAReply` objects. Use:
- 1 element with `complete:false` + `options:["A","B","C"]` for quickreply / single
- 1 element with `optionsMode:"multi"` for multi-select
- final element with `complete:true` + full spec for review
- `splitInto: [spec1, spec2, spec3]` on the complete element for split-proposal pair

### `mock-split`

POST `/api/__test/script/split` with an array of TicketSpec. Length 1 =
"no split"; ≥ 2 = real split. Drives `ticket.splitting` and qa-drawer split
proposal.

### `mock-queue-saturate`

Set project config `max_parallel=1` (via PATCH `/api/projects/<hash>/config`
or settings UI), then start two pipelines back-to-back. The second goes
`queued` with `queuePosition=1`.

### `mock-notifs-empty` / `mock-notifs-three` / `mock-notifs-twenty`

POST `/api/__test/reset` cleans notifs. To seed, run scripted runners that
emit notif events (orchestrator emits 25+ types) — `mock-runner-success`
emits `ticket_done` + `pipeline_ready_to_merge` automatically. For exact
counts, run N small scripts in sequence and dismiss between. Or mark
`BLOCKED — needs fixture: /api/__test/seed-notifs endpoint` if a direct
seed is preferred.

### `mock-api-error <endpoint>`

`testMode.ts` doesn't expose generic per-endpoint error injection. Use a
proxy intercept in Playwright (`page.route("**/api/...", route =>
route.fulfill({status:500,body:'{"ok":false,"error":...}'}))`) when the
unit test needs a specific endpoint to fail.

### `mock-sw-update` (PWA only)

Per `.claude/rules/pwa-sw.md`: SW only registers in production build on
:3001. In dev (:5173) `SwUpdateBanner` cannot fire. To force:
1. `bun run build && bun run server` (port 3001)
2. After load, manually call `window.dispatchEvent(new
   Event("vp-test-sw-needrefresh"))` if `swUpdate.ts` is instrumented, OR
3. Mark pair as `BLOCKED — needs fixture: SW needRefresh hook` and capture
   from a real release update.

### `mock-permission-denied` (Notification API)

Playwright: `browserContext.grantPermissions([], {origin})` or
`overridePermissions(origin, [])`. Reload page so
`NotificationsTab` re-reads `Notification.permission === "denied"`.

### `mock-codex-run`

Variant of `mock-runner-success` where the run-log writer sets
`provider="codex"` so RunHistory hides cost/turns/tokens. May need
`/api/__test/script/runner` to accept a `provider` hint per-run; if absent,
mark `BLOCKED — needs fixture: provider override in runner script`.

### Notes on real (non-mock) recipes

For pairs whose drive recipe specifies real git side effects
(`mock-base-ahead`, `mock-runner-merged` cleanup paths,
`topbar.active_meta_localhost`), prep a throwaway fixture repo under
`C:/tmp/vp-e2e-fixture` and reset it between runs. Real-mode coverage is
documented in `.claude/skills/vibe-pipeline-e2e/SKILL.md`.
