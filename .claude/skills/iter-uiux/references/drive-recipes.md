# Drive recipes — common fixtures / mocks

All recipes assume backend launched with `VP_TEST_MODE=mock` (per `vibe-pipeline-e2e` SKILL). Recipes return a `prep_steps` JSON envelope the codex driver can replay. Election rationale (why this extension uses backend mock channel as primary drive strategy instead of route-mock) in `../SKILL.md` § Drive recipes — Project election. Recipe is `BLOCKED` → attach `needs-fixture` reason verbatim to the (unit, state) pair in the run.

## Recipe status tag

Every recipe carries a status tag in its heading:

- `runnable` — executes today with the recipe steps as written, no additional backend / fixture work required.
- `needs_fixture` — current backend / e2e infra does not expose the exact endpoint or hook; recipe documents a concrete real-mode workaround (e.g. git-side fixture commit, prod build + SW dispatch) AND specifies the missing fixture so e2e infra can grow into it. Pairs using a `needs_fixture` recipe MAY still drive, but MUST attach the `BLOCKED — needs fixture: <reason>` note verbatim.

No `wishlist` entries: every recipe here has at least a real-mode fallback. Recipes that would be pure "future fixture wish" with no executable path are not listed.

---

## `boot-empty` — runnable

Fresh state. POST `/api/__test/reset` → POST `/api/__test/register-project` with `{path: "C:/tmp/vp-e2e-fixture", name: "fixture", hash: "fixture00"}`. Navigate to `/board?project=fixture00`. No pipelines exist.

## `mock-empty-pipeline` — runnable

`boot-empty` + create pipeline `p1` via UI or API (POST `/api/projects/fixture00/pipelines` body `{name: "p1", baseBranch: "main"}`). Resulting state = `planning`, 0 tickets. Navigate to `/board?project=fixture00&pipeline=<id>`.

## `mock-draft-ticket` — runnable

`mock-empty-pipeline` + POST `/api/__test/script/qa` with a single QAReply `{complete: true, spec: {title:"draft-1", goal:"…", acceptance:["…"], prompt:"…", mode:"step"}}` → walk QA drawer to finalize. Ticket status = `draft` (won't auto-start runner unless explicitly hit run).

## `mock-ready-ticket` — needs_fixture

Same as `mock-draft-ticket` then call backend API to set status=`ready` (e.g. runner orchestrator's preflight does this transition; in mock mode hit `/api/__test/runner-noop-promote` if added, else use `mock-runner-iter` and catch state mid-flight).

- **Missing fixture**: backend endpoint to promote draft→ready without running. Attach `BLOCKED — needs fixture: backend endpoint to promote draft→ready without running` to affected pairs.
- **Real-mode workaround**: use `mock-runner-iter` with `beforeRunningMs` raised so playwright can capture the brief `ready` window before the runner picks up the ticket.

## `mock-runner-iter` — runnable

POST `/api/__test/script/runner` with:
```json
{"tickets":[{"beforeRunningMs":300,"iterRounds":[
  {"verdict":"FAIL","executorSummary":"round 1 attempt","criticFeedback":"missing X","durationMs":800},
  {"verdict":"PASS","executorSummary":"round 2 fix","durationMs":900}
],"finalStatus":"done","commitHash":"mock-abc1234","commitSubject":"feat: round 2"}],"finalState":"ready"}
```
Then POST `/api/projects/<hash>/pipelines/<id>/run`. Capture at known sub-states by adjusting `durationMs`/`beforeRunningMs` and pausing playwright between events. Freeze on `running.iter_doer`: raise `durationMs` of first round to 5000ms and capture in first 1.5s.

## `mock-runner-success` — runnable

`mock-runner-iter` with single PASS round and `finalState=ready`. Used by done / ready / merge-banner-ready / runs-chip pairs.

## `mock-runner-pause` — runnable

`mock-runner-iter` with `finalStatus=paused`. Or, run `mock-runner-iter` then POST `/api/projects/<hash>/pipelines/<id>/stop`. State settles to `pipeline.paused` with paused ticket carrying `reason`.

## `mock-runner-failed` — runnable

`mock-runner-iter` with `finalStatus="failed"` and `finalState="failed"`.

## `mock-runner-failed-iter-limit` — runnable

`mock-runner-iter` with N FAIL rounds equal to `iterLimit` (default 5), then `finalStatus="failed_iter_limit"`, `finalState="paused"` (matches real runner — paused so user can act).

## `mock-runner-failed-transient` — runnable

Same as `mock-runner-failed` but `finalStatus="failed_transient"`. Drives the `ticket.failed_transient` and `run-button` runnable-fallback pair.

## `mock-runner-merged` — runnable

`mock-runner-success` + queue a merge ticket (orchestrator triggers when `autoMerge=true` or user clicks `合併入`). Script the merge ticket with `finalStatus="done"` and `finalState="merged"`.

## `mock-sync` — needs_fixture

Goal: drive `pipeline.syncJob.state` through `merging | conflict_await | ai_running | failed | done`.

- **Missing fixture**: `/api/__test/sync-state` endpoint (`testMode.ts` currently exposes qa / runner / split / fcm / push / auth scripts; sync state injection is unimplemented). Attach `BLOCKED — needs fixture: sync state injection endpoint` to affected pairs.
- **Real-mode workaround**: set up the fixture project to truly fall behind base (one commit on base after pipeline worktree created) then POST `/api/projects/<hash>/pipelines/<id>/sync`. Sub-states `sync.conflict_await` / `sync.ai_running` further require introducing a conflicting commit on base plus a scripted mock-runner sync reply.

## `mock-base-ahead` — needs_fixture

Goal: surface the `落後 N · 同步` chip without a real git commit.

- **Missing fixture**: server-side `behind` override endpoint. Attach `BLOCKED — needs fixture: server-side behind override endpoint`.
- **Real-mode workaround**: git-side — add commit on base branch after pipeline created. Backend recalculates `behind` count and `SyncStatusBar` shows the fallback chip.

## `mock-qa` — runnable

POST `/api/__test/script/qa` with an array of `QAReply` objects. Use:
- 1 element with `complete:false` + `options:["A","B","C"]` for quickreply / single
- 1 element with `optionsMode:"multi"` for multi-select
- final element with `complete:true` + full spec for review
- `splitInto: [spec1, spec2, spec3]` on the complete element for split-proposal pair

## `mock-split` — runnable

POST `/api/__test/script/split` with an array of TicketSpec. Length 1 = "no split"; ≥ 2 = real split. Drives `ticket.splitting` and qa-drawer split proposal.

## `mock-queue-saturate` — runnable

Set project config `max_parallel=1` (via PATCH `/api/projects/<hash>/config` or settings UI), then start two pipelines back-to-back. Second goes `queued` with `queuePosition=1`.

## `mock-notifs-empty` / `mock-notifs-three` / `mock-notifs-twenty` — needs_fixture

Goal: seed exact notif counts (0 / 3 / 12+ overflow).

- **Missing fixture**: `/api/__test/seed-notifs` endpoint for precise per-count seeding. Attach `BLOCKED — needs fixture: /api/__test/seed-notifs endpoint` when exact count matters.
- **Real-mode workaround**: POST `/api/__test/reset` then run scripted runners that emit notif events (orchestrator emits 25+ types — `mock-runner-success` emits `ticket_done` + `pipeline_ready_to_merge` automatically). For exact counts, run N small scripts in sequence and dismiss between.

## `mock-api-error <endpoint>` — runnable

`testMode.ts` doesn't expose generic per-endpoint error injection. Use a Playwright proxy intercept (`page.route("**/api/...", route => route.fulfill({status:500,body:'{"ok":false,"error":...}'}))`) when a unit test needs a specific endpoint to fail. Route-mock fallback per `screenshot-protocol.md` § Drive recipe priority Exception clause.

## `mock-sw-update` (PWA only) — needs_fixture

SW only registers in production build on :3001. In dev (:5173) `SwUpdateBanner` cannot fire (per `.claude/rules/pwa-sw.md`).

- **Missing fixture**: SW `needRefresh` hook callable from test context. Attach `BLOCKED — needs fixture: SW needRefresh hook`.
- **Real-mode workaround**:
  1. `bun run build && bun run server` (port 3001)
  2. After load, manually call `window.dispatchEvent(new Event("vp-test-sw-needrefresh"))` if `swUpdate.ts` is instrumented, OR capture from a real release update.

## `mock-permission-denied` (Notification API) — runnable

Playwright: `browserContext.grantPermissions([], {origin})` or `overridePermissions(origin, [])`. Reload page so `NotificationsTab` re-reads `Notification.permission === "denied"`.

## `mock-codex-run` — needs_fixture

Goal: drive RunHistory `provider=codex` branch (hides cost/turns/tokens).

- **Missing fixture**: `/api/__test/script/runner` accepting a `provider` hint per-run. Attach `BLOCKED — needs fixture: provider override in runner script`.
- **Real-mode workaround**: configure the AI tab settings to `codex` provider before running `mock-runner-success`; backend writes the actual provider into the run record.

## Notes on real (non-mock) recipes

Pairs whose drive recipe specifies real git side effects (`mock-base-ahead`, `mock-runner-merged` cleanup paths, `topbar.active_meta_localhost`) → prep a throwaway fixture repo under `C:/tmp/vp-e2e-fixture` and reset it between runs. Real-mode coverage documented in `.claude/skills/vibe-pipeline-e2e/SKILL.md`.
