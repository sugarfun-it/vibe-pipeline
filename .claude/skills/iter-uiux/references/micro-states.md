# Per-component micro states

Components whose internal state visibly changes UI. Look up named hooks in source (symbols, not line numbers — they drift). These are the inputs the (unit, state) pair catalog enumerates from.

## `BoardScreen`
`activeId` (URL `?pipeline=`); `activeTab: rail | focus` (mobile); `creating`; `openTicket`; `splittingTicketId`; `inboxState: hidden | collapsed | expanded`; `filter: InboxFilter` (`all | unread | mine`); `highlightId` (1.6s flash); `loadError / actionError`; `popupDismissed`.

## `FocusColumn` / `FocusHeader`
`historyOpen` (mounts `PipelineHistoryDrawer`); meta-row chip set combinatorial on `diffStat`, `runs.length`, `behind`, `pipeline.syncJob`, `showMergeBanner`, `lockedByState`, `syncActive`.

## `TicketCard`
Stateless; render split by: `status` (8) × `mode` (4) × `isSplitting` (~20 meaningful combos); `hideSummary` (terminal single-round); `inProgress` rendering when `failed_*` with incomplete round; liveLog row only on `running && ticket.liveLog`; paused-reason row only on `paused && ticket.reason`.

## `TicketDrawer`
`splitPending` (inline AI-split confirm card); `resetPending` / `deletePending` (useAsyncAction → aria-busy); `isSplitting` prop; `IterLimitField.draft` + `invalid`; `CollapsiblePrompt.expanded`; `Commits.copiedHash` (1.5s per-row flash); `AuditTimeline.open` + `entries=null` (loading) / `[]` (empty) / non-empty.

## `QADrawer`
`viewOverride: chat | review | null` (overrides auto chat/review switch); `pendingClose` (inline alertdialog when composer has unsent text); `SpecChecklist.expanded: keyof TicketSpec | null`; `Composer.text` / `picked: Set<number>`; thinking implied by `busy || lastTurn.role==="user"`; empty-starter quickreply chips (`emptyTurns` branch); spec-ready bar (spec 5/5 but viewOverride=`chat` or backend complete=false); `SpecReview.edited` / `useSplit`.

## `SettingsPopover` + tabs
`activeTab: project | ai | notifications | update` (4 fixed panels after auth removed); `savedVisible` + `savedFading` (`已儲存` chip 3s lifecycle); `ProjectTab.savingFields` (per-field record); `ProjectTab.fieldErrors` (`max_parallel`, `cost_limit_usd`, `default_base_branch`); `ProjectTab.basePickerOpen`; `UpdateTab.phase` (discriminated union: `idle | starting | polling{afterDown} | done{newTag} | error{reason}` — 5 lifecycle states); `UpdateTab.lastCheckedAt`; `NotificationsTab.permission` (`default | granted | denied`), `supported: boolean | null`, `token`.

## `InitPopup`
`alsoGitInit` (checkbox shown only when `!project.hasGit`); `autoInit.pending` (busy hint + spinner + aria-busy); error → toast `初始化失敗:<msg>`.

## `CreateCard`
`name` (validation `taken | format_invalid | ok`); `baseBranch` + `baseOpen` picker; `autoMerge` toggle; counter `is-near` near 60-char limit; `hasError` → TextField `is-error`.

## `RunButton`
Authoritative variant table at top of file. Variants: `running` → `停止` (btn-danger); `queued` → `順位 N · 取消` (btn-queued); `syncActive` → `同步中` (aria-disabled + sr-only status); `spawning` → `啟動中` (aria-disabled); `planning/paused/failed/ready/merged` with no runnable ticket → `無可執行 ticket` (aria-disabled, two-label desktop/mobile); `planning/ready/merged` → `執行`; `paused` → `繼續`; `failed` → `重試`.

## `OverflowMenu`
`open` (popover); conditional sections: safe (auto-merge, history, reveal worktree) vs danger (reset, delete); `isLocalHost()` gates reveal worktree; `pipeline.hasWorktree` derives reveal hint (`未建立 / 已合併 / 已清除`); `lockedByState` disables with `執行中無法操作`; per-action `useConfirm` dialog (reset / delete) with `descriptionRich`.

## `SyncConflictModal`
Mounts iff `pipeline.syncJob?.state === "conflict_await"`. No own internal state.

## `RunHistory`
`runs: null` (loading) / `[]` (empty) / list; per `RunCard.open` + `detail / detailFailed / detailLoading`; `StdoutBlock.expanded` (preview / full); `CopyableBlock` copy flash.

## `DiffModal`
`diff: null` (loading) / `loadFailed` / non-empty / `files.length===0` (empty); `activeFile` + IntersectionObserver scrollspy; copy-diff flash.

## `TopBar`
`open` (project switcher popover); `browseOpen` + `browseData / browseLoading / error` (modal lifecycle: loading / loaded / empty-folder / error / browsing path stack); recent-list: empty / has-recents / active+others / removable hover / removing; `selectPending / removePending / openByPathPending`; `isDark` toggle persistence; `ParallelChip` variants 0/M, N/M (<M), N=M (queued color), N>M overload; `topbar-active-meta` chips only when project active.

## `Rail` + `RailItem` + `RailSectionMenu`
`creating` flag swaps add-button for `createSlot`; per `RailItem` per-state secondary text (`railSecondary`) and `rail-mini` cells; `hasDraft` adds `QA` badge; `RailSectionMenu.open`.

## `SwUpdateBanner`
`needRefresh && !dismissed` only; `dismissed: boolean` — once true never re-renders for session.

## `Toast`
Per `ToastItem`: variant (`success | info | warn | danger`), duration timer, enter/exit animation; queue: 0 / 1 / many; stacked appearance.

## `ConfirmDialog`
Mounted iff `state != null`; variants: `danger=true` (red btn, default focus = cancel, scrim no-close) vs `danger=false` (primary btn, Enter = confirm); `warning` block optional; `descriptionRich` slot vs `description` string; optional `tertiaryLabel` (3-button).

## `InboxColumn`
`state: hidden | collapsed | expanded`; collapsed strip: dots (≤12) + overflow `+N`, hover preview popover (`previewIdx`); expanded panel: filter pill row + scrollable list + bulk actions; per row: unread/read flash, dismissing animation; empty-state (`InboxEmptyIcon`) when 0 items.

## `BoardOverlays` / `EmptyTickets` / `EmptyProject`
Stateless. `EmptyTickets` branches on `hasActiveDraft`; `EmptyProject` covers "no project picked" surface with `pointToTopBar` arrow + optional `action` slot.
