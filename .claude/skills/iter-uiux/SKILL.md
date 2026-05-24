---
name: iter-uiux-vibe-pipeline
description: |
  iter-uiux project extension for vibe-pipeline. Encodes the (unit, state) catalog
  the base scan cannot infer: pipeline / ticket / syncJob / notif lifecycle stages,
  drawer + modal + popover dynamic surfaces, form async substates, per-row item
  flags, and the project-specific units (pipeline-rail-item, iter-stages,
  focus-diff-chip, audit-timeline, sync-conflict-modal, ready-banner, browse-modal,
  inbox-strip, update-tab phase machine, ...) the base unit-dictionary does not
  cover. Drive recipes use the `VP_TEST_MODE=mock` channel
  (`/api/__test/script/{qa,runner,split}`) and fixture pipelines wherever no real
  fs/git side effect is wanted.
---

# iter-uiux extension for vibe-pipeline

Knowledge-only extension. Mechanics (Phase 0–5 lifecycle, advisor/reviewer loop, screenshot protocol, codex prompts, convergence rules, failure recovery) stay in the global base SKILL at `~/.claude/skills/iter-uiux/`. Base never grows project knowledge; this extension never forks base mechanics. Authoring contract — what an extension MUST contain, micro-substate decomposition checklist, layout principles — in base `references/extension-authoring.md`. Term disambiguation (unit / state / pair / surface; macro / micro / lifecycle stage are aliases of `state`) in base `references/terminology.md`.

## How this extension is loaded

Base SKILL Phase 0 globs `<project>/.claude/skills/iter-uiux*/SKILL.md` (matches `iter-uiux/` and `iter-uiux-<name>/`). This file at `<project>/.claude/skills/iter-uiux/SKILL.md` matches; base persists `project_extension` under `.iter-uiux/.runtime-state.json`.

- **Macro state inventory** below feeds Phase 2's unit list (extension units joined with base detected units).
- **(unit, state) pair catalog** in `references/pair-catalog.md` drives Phase 3 — each row is a separate advisor/reviewer loop. Drive recipe runs before round 1; drive fails → pair marked `blocked` with recipe's `BLOCKED — needs <X>` note.
- **Project-specific units** in `references/project-units.md` join the detected-units table (source=`extension`).
- **Drive recipes** in `references/drive-recipes.md` centralize prep_steps reused by multiple pairs so each catalog row stays compact.
- **Per-component micro states** in `references/micro-states.md` document the hook-level state the pair catalog enumerates from.

## Reference map

| When you are doing… | Read |
|---|---|
| picking a pair to iterate (the (unit, state) table) | `references/pair-catalog.md` |
| executing a drive recipe (`mock-*` token) before capture | `references/drive-recipes.md` |
| Phase 2 — appending project-specific units | `references/project-units.md` |
| understanding what hook-level state drives a pair's existence | `references/micro-states.md` |

## Source-of-truth references

Canonical source files. Look up symbols by name within the file; do not chase line numbers (they drift).

- **State enums** — `shared/types.ts`: `PipelineState`, `TicketStatus`, `TicketMode`, `Verdict`, `SyncJobState`, `NotifEventType`, `NotifSeverity`, `NOTIF_EVENTS`, `Project.hasInit`, `Project.hasGit`.
- **Routes** — `src/App.tsx`: only `/board` (single SPA surface; auth flow 已拔除).
- **Pipeline state transitions + notif emit sites** — `server/lib/runner/orchestrator.ts`: state transitions to `queued` / `running` / `paused` / `failed`, conflict_await / ai_running handlers, ~25 notif emit sites.
- **Notification consumer** — `server/lib/notifs/store.ts` plus frontend `frontend_action_*` types from `src/features/pipeline/BoardScreen.tsx` (notifyError / notifyWarn / notifyInfo helpers).
- **Mock channel** — `server/lib/testMode.ts` + `server/index.ts`: `/api/__test/{register-project,script/qa,script/runner,script/split,reset,fcm/calls,fcm/reset,push/file-content}`. Requires `VP_TEST_MODE=mock` env on backend.

## Macro state inventory

### Routes (top-level surfaces)

| Route | Component | Default state | Notable non-default states |
|---|---|---|---|
| `/board` | `BoardScreen` | active project + ≥1 pipeline + focus on most recent | no project / no pipelines / project not initialized / pipeline focus = creating |
| `/board?pipeline=<id>` | `BoardScreen` w/ pinned pipeline | focus column on `<id>` | pipeline running / paused / failed / ready / merged / sync mid-flow |
| `/board?creating=1` | `BoardScreen` + `CreateCard` overlay | create form open | invalid name / duplicate name / mid-submit |

### Pipeline lifecycle (`PipelineState`)

| State | Where surfaced | Notes |
|---|---|---|
| `planning` | RailItem dot, FocusHeader chip, RunButton = `執行` | Default after pipeline created; worktree may or may not exist. |
| `queued` | RailItem dot, RunButton = `順位 N · 取消` | Set when `max_parallel` reached at run-attempt. `queuePosition` prop drives label. |
| `running` | RailItem dot pulses, FocusHeader chip + pulse dot, RunButton = `停止` (btn-danger), running ticket card pulses | At most one running ticket per pipeline; sync chip / spawn chip may overlay. |
| `paused` | RailItem dot, FocusHeader, RunButton = `繼續`, paused ticket shows `paused-reason` row | Result of stop / server restart / iter-stop-at-limit / runtime crash. |
| `ready` | RailItem dot, FocusHeader, RunButton = `執行`, `ReadyBanner` (variant=`ready`) mounted in FocusHeader | All real tickets done, no merge ticket yet (or merge ticket waiting). |
| `failed` | RailItem dot, FocusHeader, RunButton = `重試` | Permanent terminal failure. |
| `merged` | RailItem dot, FocusHeader, RunButton may render disabled-empty `無可執行 ticket`, `ReadyBanner` (variant=`merged`) | Merge ticket succeeded. hasWorktree may flip to false (cleanup). |

Plus legacy/transient `stopping` accepted but unused by current frontend.

### Ticket lifecycle (`TicketStatus`)

`TicketMode` ∈ `step | iter | merge | sync`.

| State | Card visual | Drawer footer actions |
|---|---|---|
| `draft` | `is-draft` (opacity-low), `StatusPill = 草稿` | mode-toggle, iter-limit edit, AI split, delete |
| `ready` | `is-draft` style, `StatusPill = 就緒` | mode-toggle, iter-limit edit, AI split, delete |
| `running` | `is-running` (pulse), liveLog row visible (aria-live polite), IterStages stage=`doer`/`critic` | delete disabled |
| `paused` | `is-paused`, `paused-reason` row, IterStages stage frozen | reset, delete |
| `done` | `is-done`, summary `共 N 輪 · 總耗時`, IterStages `✓ PASS` | reset, delete; drawer reorders (outcome first, spec collapsed) |
| `failed` | `is-failed`, IterStages `✓ FAIL` (terminal styled), summary `共 N 輪` | reset, delete |
| `failed_iter_limit` | `is-failed`, in-progress round still rendered (shows which stage hit the wall) | reset, delete |
| `failed_transient` | `is-failed`, but RunButton counts it as runnable (auto-reset to paused on next run) | reset, delete |

Transient virtual state `splitting` (`isSplitting` prop on `TicketCard`, `splittingTicketId` on `BoardScreen` / `TicketDrawer`): card chip `AI 拆分中` with spinner; drawer footer swaps to `tdrw-actions-running` busy block.

### Sync job (`SyncJobState`)

Lives at `pipeline.syncJob.state`; undefined = idle.

| State | SyncStatusBar chip | SyncConflictModal | RunButton lock |
|---|---|---|---|
| (no syncJob, behind>0) | `落後 N · 同步` button | hidden | not locked |
| `merging` | `同步中… git merge` (busy) | hidden | RunButton = `同步中` disabled |
| `conflict_await` | `遇衝突 (N 檔)` + ✓ ✕ buttons inline | **modal open** as alertdialog | RunButton = `同步中` disabled |
| `ai_running` | `AI 解衝突 · MM:SS` (busy) + cancel ✕ | hidden | RunButton = `同步中` disabled |
| `failed` | `同步失敗` + 重試 + 關 buttons | hidden | RunButton not locked |
| `done` | `已同步` + 關 button | hidden | RunButton not locked |

### Notification surfaces

`NotifEventType` (~43 types) drives both `InboxColumn` items and FCM push. Severities `block | info | muted` map to dot color in strip / panel; per-row state = `unread | read` and `pending dismiss`.

| Where | What | State variations to cover |
|---|---|---|
| `InboxColumn` strip (collapsed) | dot row + bell badge | empty / 1-3 dots / overflow `+N` / hover preview popover |
| `InboxColumn` panel (expanded) | filter chips (`all / unread / mine`) + list | empty / scrolled / item-hovered / item dismissing / filter active |
| Notif item row | sev dot + title + sub + ts | unread vs read, highlight-flash 1.6s (`highlightId`), pending dismiss |
| `SwUpdateBanner` | new SW available | `needRefresh && !dismissed` only — BLOCKED without injected SW state |
| `ReadyBanner` | merge ready/merging/merged/failed | 4 variants in `references/micro-states.md` |
| `ToastStage` | dispatched via `useToast` | `success / info / warn / danger`; auto-dismiss timer; enter / exit animation |

## Drive recipes — Project election

Per base `references/screenshot-protocol.md` § Drive recipe priority (Exception clause), vibe-pipeline **elects backend mock channel (`VP_TEST_MODE=mock` + `/api/__test/*`) as the primary drive strategy** for this extension's catalog. Rationale:

- Product is itself a backend-driven orchestrator (runner / QA / split / sync emit ~25 notif types + stateful pipeline transitions). Route-mocking would require re-implementing the orchestrator's full state machine at the browser layer per recipe, drifting from the real contract every commit.
- Same mock channel already powers `vibe-pipeline-e2e` SKILL's Playwright suite (`server/lib/testMode.ts`), so recipes here reuse battle-tested seeding endpoints rather than inventing parallel route-mock fixtures.
- Real backend driving still respects base invariants: no real git mutations (fixture project under `C:/tmp/vp-e2e-fixture`), no real AI cost (mock channel returns scripted replies), no destructive fs writes outside the fixture.

Route-mock fallback per-pair still allowed when the backend mock channel cannot synthesize a state (e.g. a Service Worker lifecycle purely browser-layer). Recipe MUST say so explicitly. Recipe definitions in `references/drive-recipes.md`.

## Project iteration scope (UI-only)

These files are cross-cutting / non-UI; never edit during this skill's iteration regardless of how Phase 3 is executed. **Supplements** base `SKILL.md` § Red lines — does not replace. Codex's `suggested_fix` targets one of these → mark issue `blocked: needs <out-of-scope edit>` and leave for user to triage:

- `src/styles/tokens.css` and other global token files → `blocked: needs token edit`
- `src/main.tsx`, `src/App.tsx` (routing / bootstrap)
- `vite.config.ts`, `tsconfig.json`, `package.json`, `bun.lock`
- `public/firebase-messaging-sw.js`
- `server/**` (UI-only iteration) → `blocked: needs server fixture` when a recipe asks for missing test-mode endpoint
- Anything outside `src/` except `.iter-uiux/**`

Project navigation uses `?project=<hash>` URL param. Vibe-pipeline's own hash is `b2dda010` (use for any unit needing a real project selected outside the `fixture00` mock fixture).
