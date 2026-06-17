# 2026-06-18 Code Orchestrator Plan

## Scope

Replace the LLM main runner with a backend TypeScript orchestrator while preserving the durable shell:

- Keep `pipeline.json` as the persistent state machine source.
- Keep worktree isolation via `server/lib/io/git/worktree`.
- Keep queue/slot behavior, `running` map, stop/watchdog/recover semantics, run logs, `ticketWatcher`, notifications, and auto-merge handoff.
- Remove the `runner` task class because backend code no longer needs a main-agent model.

## Files To Change

Backend runner:

- `server/lib/runner/orchestrator/spawn.ts`: stop spawning `kind=runner`; start backend async orchestration, register/clear active sub-agent processes, write logs, emit final notifications, run auto-merge/queue dispatch.
- New `server/lib/runner/orchestrator/codeRunner.ts`: ticket selection loop, resume-by-stage, step/iter/merge state transitions, sub-agent dispatch, ground-truth checks, ticket commit.
- `server/lib/runner/runnerPrompt.ts`: delete main-agent prose flow; keep only prompt builders for executor/critic/merge sub-agents.
- `server/lib/cli/adapter.ts`, `claudeAdapter.ts`, `codexAdapter.ts`, `index.ts`: add direct top-level sub-agent spawn kind with role-specific sandbox/tool constraints. Keep `runner` spawn kind only if still needed by sync conflict AI, or replace sync with sub-agent kind.
- `server/lib/runner/syncJob/aiResolver.ts`: use the merge sub-agent spawn path instead of `kind=runner` if adapter runner kind is removed.
- `server/lib/runner/orchestrator/watchdog.ts` and `recovery.ts` if needed: ensure sub-agent process crash is recovered as `failed_transient + paused` for ticket runner.

Config / frontend / CLI:

- `shared/types/user.ts`: remove `runner` from `TaskClass`, `TASK_CLASSES`, labels, hints, and default config.
- `server/lib/domain/userConfig.ts`: remove runner validation and provider cascade. Keep executor/critic/merge independently configurable; migration drops legacy `runner` key by ignoring it.
- `src/features/settings/AITab.tsx`: render QA/Split as primary rows; Executor/Critic/Merge as execution rows. Remove Main Agent copy.
- `src/features/settings/useUserConfig.ts` should continue to derive rows from `TASK_CLASSES`; verify no runner-specific assumptions.
- `cli/commands/config.ts`, `cli/vbpl.ts`: update help text and valid task-class copy.
- `catalog/models.json`, tests/e2e, codex smoke tests: remove or update any hard-coded `runner` task class usage.

Tests may be added or updated under `server/lib/runner/orchestrator/*.test.ts` if a focused state-machine test is practical within current test patterns.

## New State-Machine Interface

`runCodeOrchestrator(opts)` will be the backend long-running task called by `spawnDirect` after worktree ensure and pipeline state is set to `running`.

Internal helpers:

- `selectNextTicket(pipeline)` returns one of:
  - `done`: all tickets done, mark pipeline `ready`.
  - `blocked`: a failed ticket exists, mark pipeline `paused` and stop.
  - `ticket`: next ticket with `draft | ready | paused | running`.
- `runTicket(ctx, ticket)` dispatches by `ticket.mode`:
  - `step`: one executor run, backend verification, done or failed.
  - `iter`: executor/critic loop, resume by `iter.stage`, backend verification, `failed_iter_limit` handling.
  - `merge`: merge sub-agent loop, backend git verification, `merged` or `failed_iter_limit + paused`.
- All writes use `mutatePipeline`/`writePipeline` from backend code, not AI edits.
- Before spawning executor/merge for a ticket, backend deterministically writes `ticket.status=running` and `pipeline.state=running`.
- `running` map entry has `proc=null` while backend is between sub-agent processes, and is updated to the live sub-agent process while a process is active. Stop/watchdog therefore still target the currently active AI process tree.

## Sub-Agent Spawn And Tool/Sandbox Enforcement

Add adapter spawn opts for `kind: "subagent"`:

- Common opts: `role: "executor" | "critic" | "merge"`, `cwd`, `prompt`, `systemPrompt`, `model`, `effort`.
- Executor:
  - Claude: allow write tools, disallow `Task`, system prompt forbids `.vibe-pipeline/pipelines/*.json` and metadata writes.
  - Codex: `-s workspace-write`, no approval bypass unless existing runner-equivalent behavior requires it; prompt/system forbids pipeline metadata writes.
- Critic:
  - Claude: enforce read-only with disallowed `Edit Write Task` and prompt says PASS/FAIL/PARTIAL only after inspection.
  - Codex: `-s read-only`.
- Merge:
  - Claude/Codex use workspace-write because it operates on the main repo through explicit `git -C <projectPath>` commands. Prompt forbids push/fetch/reset/rebase and direct worktree-source assumptions.

The backend will parse stdout through adapter `parseResult("subagent", stdout)` and treat any non-zero exit or parse/read failure as transient crash.

## Non-Happy Paths

1. Step mode: spawn executor once, do not run critic. Backend checks worktree diff and any mechanically verifiable acceptance before marking done. If not accepted, mark `failed` and pause.
2. Merge mode: spawn one merge sub-agent per round; it handles full merge. Backend verifies main repo git ground truth and never runs ticket commit for merge tickets. Worktree cleanup remains in existing finalization path when pipeline state is `merged`.
3. Resume by stage:
   - `stage=doer`: re-dispatch executor for current round, preserving existing iter state.
   - `stage=critic`: do not re-dispatch executor; dispatch critic directly against current worktree diff and acceptance, with executor summary indicating resume.
   - `stage=done`: finalize ticket as done and commit if needed.
4. `iterStopAtLimit` fork:
   - true/default: ticket `failed_iter_limit`, pipeline `paused`, stop loop.
   - false: ticket `failed_iter_limit`, pipeline remains running and loop continues to next runnable ticket.
5. Ground-truth acceptance: critic verdict is only a hint. Backend verifies git/filesystem state:
   - step/iter success requires no obvious conflict markers and a non-empty diff or commits when acceptance implies code changes; acceptance bullets with mechanical commands such as `bunx tsc --noEmit`, `bun run build`, `bun test ...`, or `git ...` are run and must pass.
   - merge success requires no `MERGE_HEAD`, no conflict markers, clean main repo working tree, and merge commit/hash evidence on base.
6. Ticket commit: for step/iter done tickets, backend writes a real temp file and runs `git -C <worktree> commit -F <tmpfile>`, never `-m` with literal `\n`.
7. Crash resilience: any sub-agent process non-zero exit, parse failure, or thrown dispatch error marks current ticket `failed_transient`, pipeline `paused`, emits notification via existing watcher/finalization path, and preserves worktree changes. The ticket is marked `running` before spawning executor/merge so a crash cannot leave board as ready while diff exists.

## Runner Task-Class Removal Checklist

- Remove from `shared/types/user.ts` and all imported labels/hints/defaults.
- Update config coercion/patching in `server/lib/domain/userConfig.ts`.
- Update Settings AI tab row grouping and copy.
- Update CLI config help in `cli/commands/config.ts` and `cli/vbpl.ts`.
- Update codex smoke tests or remove obsolete runner spawn smoke.
- Grep for `defaults.runner`, `runner.model`, `TaskClass = ... runner`, `Main Agent`, `TASK_CLASSES.slice(0, 3)`, and hard-coded settings tests.

## Validation Gates

Do not start or restart backend. Final gates:

- `bunx tsc --noEmit`
- `bun run build`
- `bun test server shared src/lib`

Record results and any residual risk in final response and in an output note file under `docs/superpowers/plans/2026-06-18-code-orchestrator-o.md`.
