#!/usr/bin/env bash
# /prod — switch backend to enduser install stack (~/.vibe-pipeline/current).
# 真實邏輯在 stack.ts(Bun,跨 maintainer 機器,不依賴 host python)。
set -e
cd "$(git rev-parse --show-toplevel)"
exec bun run .claude/commands/stack.ts prod
