# (unit, state) pair catalog

Stable id format: `<unit>.<state>`. Drive recipe column points at a recipe in `drive-recipes.md` (lowercased token in backticks). Acceptance hint = what the codex advisor should weigh extra in this state.

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
| `ticket.running.iter_critic` | ticket / iter-stages | `mock-runner-iter` (round mid-critic) | IterStages stage=`critic`; preceding doer chip checked. |
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
| `settings.ai_tab` | settings-popover / ai-tab | switch to AI tab | 5 task-class rows (qa/split/executor/critic/merge; primary qa/split, secondary executor/critic/merge); model + effort pickers per row; provider switch swaps allowed lists. |
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
| `board.no_project` | empty-project | clear active project hash | empty-project with `↑ 點上方「選擇專案」` arrow; topbar still reachable. |
