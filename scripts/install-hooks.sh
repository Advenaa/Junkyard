#!/usr/bin/env bash
# Install the Clankerism git hooks into this repo's .git/hooks directory.
# Idempotent — safe to run as a postinstall step on every `npm ci`.
set -euo pipefail

# Find the repo root no matter where this script is invoked from
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "install-hooks.sh: not inside a git repo — skipping"
  exit 0
fi

HOOK_SRC="$REPO_ROOT/scripts/hooks/pre-push"
HOOK_DEST="$REPO_ROOT/.git/hooks/pre-push"

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "install-hooks.sh: source hook not found at $HOOK_SRC — skipping"
  exit 0
fi

# Ensure .git/hooks exists (it should, but be defensive for worktrees)
mkdir -p "$(dirname "$HOOK_DEST")"

# If an existing hook is already our hook (by content), nothing to do.
if [[ -f "$HOOK_DEST" ]] && cmp -s "$HOOK_SRC" "$HOOK_DEST"; then
  exit 0
fi

# If an existing hook exists and is different, back it up once.
if [[ -f "$HOOK_DEST" ]] && [[ ! -f "$HOOK_DEST.clankerism-backup" ]]; then
  cp "$HOOK_DEST" "$HOOK_DEST.clankerism-backup"
  echo "install-hooks.sh: backed up previous pre-push to $HOOK_DEST.clankerism-backup"
fi

cp "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "install-hooks.sh: installed pre-push hook"
