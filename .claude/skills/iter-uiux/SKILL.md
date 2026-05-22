---
name: iter-uiux
description: Project-local override of global iter-uiux. Phase 3 fans out to parallel subagents (one per unit) with strict file-ownership boundaries; Phase 4 stays serial. Same lifecycle, same codex-driven convergence; main agent orchestrates + serializes CHANGELOG.
---

# iter-uiux (vibe-pipeline local)

Inherits the global skill at `~/.claude/skills/iter-uiux/`. Read the global SKILL.md + its `references/*` for canonical lifecycle, screenshot protocol, codex prompts, CHANGELOG format, and failure recovery — **all still apply**. This local override adds one section.

## Phase 3 — parallel subagent fan-out

Replaces the global "Per-unit iteration (sequential)" execution model. Lifecycle, output format, and convergence rules are unchanged.

See `references/parallel-subagents.md` for:
- File-ownership map (which unit owns which files; shared files are off-limits in Phase 3)
- Subagent contract (input, runbook, output)
- Concurrency cap + batching policy
- Aggregation: per-unit changelog files → CHANGELOG.md (main agent serializes)

Phase 4 (global consistency) stays sequential — it's where shared/token-level edits happen.

## Project-specific notes

- App is React + Vite + Bun backend. Dev mode: `bun run server` (backend) + `bunx vite` (5173). SW only in production build — Phase 3 / 4 do NOT touch `public/firebase-messaging-sw.js` or `vite.config.ts` PWA block; flag any such finding as design-system / Phase 4 candidate.
- Project navigation uses `?project=<hash>` URL param. Vibe-pipeline's own hash is `b2dda010` (use for any unit that needs a project selected).
- Off-limits to ALL subagents (always shared / cross-cutting):
  - `src/styles/tokens.css` and any other global token file
  - `src/main.tsx`, `src/App.tsx` (routing / bootstrap)
  - `vite.config.ts`, `tsconfig.json`, `package.json`, `bun.lock`
  - `public/firebase-messaging-sw.js`
  - `server/**` (UI-only iteration)
  - Anything outside `src/` except `.iter-uiux/**`
