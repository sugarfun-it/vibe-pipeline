# 2026-06-18 Code Orchestrator Outcome

Branch: `refactor/code-orchestrator`

## Changed Files

- `server/lib/runner/orchestrator/codeRunner.ts`: added backend TS ticket state machine for step, iter, merge, resume-by-stage, sub-agent dispatch, backend verification, transient handling, and ticket commits via `git commit -F`.
- `server/lib/runner/orchestrator/spawn.ts`: replaced main-agent spawn with backend async orchestrator while preserving queue slots, logs, ticketWatcher, final notifications, auto-merge, worktree cleanup, and dependency cleanup.
- `server/lib/runner/runnerPrompt.ts`: removed main-agent prose flow; kept role prompt builders for executor, critic, and merge sub-agents.
- `server/lib/cli/adapter.ts`, `claudeAdapter.ts`, `codexAdapter.ts`, `index.ts`: added direct `subagent` spawn kind with role-specific tool/sandbox constraints; removed runner spawn type from the public adapter surface.
- `server/lib/runner/syncJob/aiResolver.ts`: moved sync conflict AI to the merge sub-agent spawn path.
- `server/lib/runner/orchestrator/watchdog.ts`: sub-agent death now falls back to `failed_transient + paused`.
- `shared/types/user.ts`, `server/lib/domain/userConfig.ts`: removed `runner` task class and runner-provider cascade.
- `src/features/settings/AITab.tsx`, `src/features/settings/SettingsPopover/tab-content.css`: removed Main Agent row/copy.
- `cli/commands/config.ts`, `cli/vbpl.ts`: removed runner task-class help examples.
- Tests/smoke cleanup: updated settings/user config tests, updated merge codex smoke copy, deleted obsolete codex runner smoke/log outputs.

## Validation

- `bunx tsc --noEmit`: PASS.
- `bun run build`: PASS with `TMP/TEMP=D:\github\vibe-pipeline\.tmp`.
- `bun test server shared src/lib`: PASS with `TMP/TEMP=D:\github\vibe-pipeline\.tmp`.

Initial build/test attempts hit sandbox temp permissions (`C:\Users\Eric` and then `D:\tmp` for `mkdtemp`). Re-running with repo-local `.tmp` fixed the environment issue.

## Notes / Residual Risk

- Backend verification is intentionally conservative and mechanical: conflict markers, selected acceptance commands, critic verdict hints, git cleanliness for merge. It does not attempt semantic proof of arbitrary natural-language acceptance.
- Stop while a sub-agent is running is treated as user stop, not transient, by checking pipeline state before converting non-zero exit.
- `iterStopAtLimit=false` tickets are skipped after `failed_iter_limit` so the pipeline can continue to later tickets and eventually become ready.
