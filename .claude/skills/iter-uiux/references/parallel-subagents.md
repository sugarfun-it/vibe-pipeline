# Parallel subagent execution for Phase 3

## Rationale

A single-agent run over N units takes N × (rounds × codex latency + edit + capture). Units are mostly independent at the file level — each "operation unit" maps to a small set of feature files. Phase 3 can fan out by unit; Phase 4 (cross-unit consistency, which touches shared tokens / shared components) stays serial.

## Concurrency policy

- **Batch size**: up to 4 subagents in parallel (1 message with 4 Agent calls).
- **Codex rate-limit**: failure-recovery.md's exponential backoff serializes when hit; cap of 4 is a soft ceiling that respects this.
- **Browser swarm**: each subagent's `capture.mjs` launches an isolated headless chromium; 4 concurrent is fine.

## File-ownership map

Each unit declares `owned_files` (whitelist for edits). Edits outside are forbidden. Cross-unit / shared files raised by codex go into Phase 4's queue instead.

| unit | owned_files | navigation |
|---|---|---|
| topbar | `src/shell/TopBar.tsx`, `src/shell/topbar.css` | `/board?project=<hash>` (default state) |
| sidebar | `src/shell/Rail.tsx`, `src/shell/rail.css` (if exists) | `/board?project=<hash>` |
| empty-project | `src/features/pipeline/EmptyProject.tsx` | `/board` (no project param) |
| empty-tickets | `src/features/pipeline/EmptyTickets.tsx` | `/board?project=<hash>` + remove any pipeline state if needed |
| ticket | `src/features/pipeline/TicketCard.tsx`, `src/features/pipeline/ticketCard.css` (if exists) | `/board?project=<hash>` → focus column |
| ticket-drawer | `src/features/pipeline/TicketDrawer.tsx`, `src/features/pipeline/ticketDrawer.css` | click a ticket on board |
| qa-drawer | `src/features/qa/QADrawer.tsx` | open a ticket with QA |
| history-drawer | `src/features/pipeline/PipelineHistoryDrawer.tsx` | board → history button |
| settings-popover | `src/features/settings/SettingsPopover.tsx`, plus its tab files (`AITab.tsx`, `ProjectTab.tsx`, `NotificationsTab.tsx`, `UpdateTab.tsx`) | click gear icon |
| ready-banner | `src/features/pipeline/ReadyBanner.tsx` | board with ready pipeline |
| sw-update-banner | `src/features/system/SwUpdateBanner.tsx` | normally hidden; force-render via dev mock if possible, else mark blocked |
| diff-modal | `src/features/pipeline/DiffModal.tsx` | open from ticket drawer |
| sync-conflict-modal | `src/features/pipeline/SyncConflictModal.tsx` | normally hidden; mark blocked if no fixture |
| init-popup | `src/features/init/InitPopup.tsx` | shown on uninitialized project |
| add-device-dialog | `src/features/auth/AddDeviceDialog.tsx` | settings → security |
| confirm-dialog | `src/ui/ConfirmDialog.tsx` | global, triggered by destructive actions |
| run-button | `src/features/pipeline/RunButton.tsx` | focus column |
| run-history | `src/features/pipeline/RunHistory.tsx` | focus column → run history |
| create-card | `src/features/pipelineCreate/CreateCard.tsx` | rail → "新 pipeline" |
| focus-column | `src/features/pipeline/FocusColumn.tsx`, `src/features/pipeline/FocusHeader.tsx`, `src/features/pipeline/FocusTitle.tsx`, `src/features/pipeline/FocusDiffChip.tsx`, `src/features/pipeline/FocusTicketList.tsx`, `src/features/pipeline/IterStages.tsx`, `src/features/pipeline/OverflowMenu.tsx` | the main focus column on board |

Notes:
- `TopBar.tsx` contains the browse-folder modal inline → the topbar subagent owns that too. No separate "browse-dialog" unit.
- Settings popover and its tabs are one logical unit; one subagent owns the whole settings surface.
- Focus column subcomponents are grouped to avoid intra-board edit collisions.

## Always-shared (off-limits in Phase 3)

Any of these → flag as Phase 4 candidate, do NOT edit:

- `src/styles/**` (all global CSS / tokens)
- `src/main.tsx`, `src/App.tsx`
- `src/ui/icons.tsx`
- `src/ui/PickerSelect.tsx`
- `src/ui/Logo.tsx`
- `src/shell/AppShell.tsx` (layout shell)
- `vite.config.ts`, `tsconfig*.json`, `package.json`, `bun.lock`, `biome.json`
- `public/**` (PWA assets / SW)
- `server/**`, `cli/**`, `shared/**` (not UI)

## Subagent contract

### Inputs (passed in prompt)

- `unit`: name (e.g., `topbar`)
- `raw_label`: source token (e.g., `TopBar`)
- `nav_url`: full URL the screenshot script should `goto`
- `prep_steps`: JSON array passed to `capture.mjs` to bring the app to the unit's entry state (clicks, fills, evals)
- `related_states`: comma list of state labels (default, pressed, with_long_copy, etc.)
- `owned_files`: absolute paths the subagent MAY Edit
- `run_ts`: e.g., `2026-05-22T1544Z`
- `screenshots_dir`: `.iter-uiux/screenshots/<run_ts>/<unit>/`
- `changelog_out`: `.iter-uiux/units/<unit>.md`
- `codex_image_flag`: `-i`
- `skill_root`: `C:/Users/Eric/.claude/skills/iter-uiux`

### Runbook (subagent executes)

1. Capture default-state screenshot via `node .iter-uiux/capture.mjs <nav_url> <screenshots_dir>/round1-default.png 1440x900 '<prep_steps>'`.
2. If screenshot is blank: retry once with 500ms extra wait. Still blank → write blocker stub to `changelog_out`, return `status: blocked`.
3. Read every owned file fully.
4. Build advisor prompt (see global `references/codex-prompt.md` § Advisor mode). Save to `.iter-uiux/units/<unit>.r1.prompt.txt`.
5. Run codex:
   ```
   codex exec --sandbox read-only -i <screenshots_dir>/round1-default.png -- "$(cat .iter-uiux/units/<unit>.r1.prompt.txt)" > .iter-uiux/units/<unit>.r1.out.json 2>&1
   ```
6. Parse JSON. On failure → one corrective re-prompt; still fail → blocked.
7. If `done: true`: write changelog, exit `converged`.
8. Otherwise apply fixes (round N action):
   - For each issue with `suggested_fix`: if its touched files ⊆ `owned_files` → Edit. Otherwise record in `mapping_notes` as `deferred_phase4: <files>` and skip the edit.
   - For each `need_more` of kind `screenshot`/`state`: capture additional screenshot(s).
   - For each `need_more` of kind `source`/`flow`: include the requested content in next prompt as `extra_data`.
9. Compute `git diff -- <owned_files>` → save to `.iter-uiux/units/<unit>.rN.diff`.
10. Recapture all tracked states for round N.
11. Build reviewer prompt (see global codex-prompt.md § Reviewer mode). Embed prior JSON, diff, mapping_notes, extra_data. Save to `.iter-uiux/units/<unit>.rN.prompt.txt`.
12. Run codex with all relevant screenshots attached via repeated `-i`.
13. Parse. If `done: true` → write changelog, exit `converged`.
14. **Anti-loop**: after each reviewer round ≥ 2, sort current `issues[]` by `id`, JSON-stringify; compare with previous reviewer's. Byte-identical → write "Forced convergence" line, exit `forced`.
15. **Hard cap**: round 5 reviewer not done → write "Stopped at round 5 (diverged)", exit `diverged`.

### Outputs (subagent writes)

- `.iter-uiux/units/<unit>.md` — the unit's changelog section per global `references/changelog-format.md` § Unit section. Main agent concatenates these into CHANGELOG.md in dictionary order.
- All screenshots under `.iter-uiux/screenshots/<run_ts>/<unit>/`.
- Code edits within `owned_files`.

### Return summary

Last text message must be three short lines:
```
status: converged|forced|diverged|blocked
rounds: <N>
files: <comma-separated paths>
```

## Main agent (orchestrator)

1. Resolve unit list + ownership (this doc's table).
2. Append "Detected Units" table to CHANGELOG.md.
3. Dispatch units in batches of 4 via Agent tool (one message, multiple Agent calls).
4. After each batch returns, read each subagent's `<unit>.md` and append to CHANGELOG.md in dictionary order.
5. After all batches: continue with global Phase 4 (sequential, per global skill).
6. Phase 5: summary.

If any subagent returns `blocked` or `diverged`, record in Summary but do not halt.

## Codex sandbox flag

Use `--sandbox read-only` for codex calls — we want codex to produce JSON, not modify files. Claude (subagent) applies edits via the Edit tool.

## Hard rule: no skill-level destructive ops

Subagent NEVER: git commit/push, rm/mv files, install deps, modify package.json, run server scripts, kill processes. Read + Edit + Bash (codex + node) only.
