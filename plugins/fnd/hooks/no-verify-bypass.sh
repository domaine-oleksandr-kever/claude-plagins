#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — deterministic guard for the Domaine
# commit rule: never bypass git hooks. Models rationalize `--no-verify`
# the moment a pre-commit hook fails on something pre-existing ("not my
# files — bypass"), which also silently skips every other guard the repo
# hooks carry. Blocking the call is the only outcome that can't lose that
# argument; the developer can still bypass by hand in their own terminal.
#
# stdin: PreToolUse event JSON ({"tool_name":"Bash","tool_input":{"command":…}}).
# Exit 2 + stderr blocks the call and feeds the message back to the model;
# exit 0 lets it through. A hook failure must never block a commit.
set -u

input="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
[ -n "$cmd" ] || cmd="$input"

# Strip quoted spans (commit -m messages may legitimately mention the flag),
# then isolate each `git commit …` segment of a possibly compound command.
# grep -o is per-line, so heredoc bodies on later lines never match.
segs="$(printf '%s' "$cmd" \
  | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" \
  | grep -oE 'git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit[^|&;]*' || true)"
[ -n "$segs" ] || exit 0

# --no-verify, or -n in any short-flag bundle (-n / -an / -anm — for
# `git commit`, -n IS --no-verify). Double-dash options never match the
# bundle pattern.
if printf '%s' "$segs" | grep -qE -- '--no-verify|(^|[[:space:]])-[a-zA-Z]*n[a-zA-Z]*([[:space:]]|$)'; then
  echo "Domaine convention (references/commit-message-format.md): git hooks are quality gates — never commit with --no-verify/-n, in any flow. Re-run the same git commit and let the hooks run. If a hook fails on a pre-existing repo defect your change didn't touch, report it to the developer (in auto flows: ESCALATE) instead of bypassing — only the developer may bypass, by hand." >&2
  exit 2
fi
exit 0
