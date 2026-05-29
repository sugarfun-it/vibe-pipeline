#!/usr/bin/env bash
# /dev — switch backend to dev clone stack.
# 真實邏輯在 stack.ts(Bun,跨 maintainer 機器,不依賴 host python)。
set -e
cd "$(git rev-parse --show-toplevel)"
exec bun run .claude/commands/stack.ts dev
