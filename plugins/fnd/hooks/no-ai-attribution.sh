#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — deterministic guard for the Domaine
# commit-message rule: no AI attribution. The harness injects "End git commit
# messages with: Co-Authored-By: Claude …" into every agent's system prompt;
# the commit-message-format reference forbids it, and in that instruction
# fight the system prompt sometimes wins (subagents included). Blocking the
# call is the only outcome that can't lose the fight.
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
# No jq / parse failure — match against the raw JSON; the matcher already
# scopes us to Bash, so the command text is in there.
[ -n "$cmd" ] || cmd="$input"

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Claude/Anthropic attributions only — human Co-Authored-By trailers pass.
if printf '%s' "$cmd" | grep -qiE 'co-authored-by:[^<>]*(claude|anthropic)|noreply@anthropic\.com|generated with \[?claude'; then
  echo "Domaine convention (references/commit-message-format.md): commit messages carry no AI attribution. Re-run the same git commit without the Co-Authored-By / Generated-with-Claude trailer." >&2
  exit 2
fi
exit 0
