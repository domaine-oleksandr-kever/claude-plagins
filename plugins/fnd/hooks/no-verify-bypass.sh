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
#
# Best-effort by design — tests/no-verify-bypass-matrix.sh is the FP/FN
# contract; run it after any regex change. Known residual FPs: bare prose
# containing `git commit -n` outside quotes (echo args, heredoc bodies).
# Known residual FNs: flags smuggled via variable expansion ($FLAG), and
# hook config rewritten in an earlier, separate Bash call.
set -u

input="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
if [ -z "$cmd" ]; then
  # No (working) jq: pull the "command" JSON value with sed and unescape
  # just enough to scan. Approximate, but far better than fail-open.
  cmd="$(printf '%s' "$input" | tr '\n' ' ' \
    | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)".*/\1/p' \
    | sed -E 's/\\n/ /g; s/\\t/ /g; s/\\"/"/g; s/\\\\/\\/g' || true)"
fi
[ -n "$cmd" ] || exit 0

# Normalize before matching:
# 1. join backslash-newline continuations (a flag split across lines still counts);
# 2. drop -m/-F/--message/--file argument spans, KEEPING the flag token itself
#    (so a bundled `-nm "msg"` keeps its -n) — commit messages may legitimately
#    mention the banned flags;
# 3. drop the remaining quote characters, so quoted forms ("-n", --no-'verify',
#    sh -c "git commit -n") reassemble into scannable flags.
strip_msg_spans() {
  sed -E \
    -e "s/(^|[[:space:]])(-[a-zA-Z]*[mF]|--message|--file)(=|[[:space:]]+)'[^']*'/\1\2/g" \
    -e 's/(^|[[:space:]])(-[a-zA-Z]*[mF]|--message|--file)(=|[[:space:]]+)"(\\.|[^"\\])*"/\1\2/g' \
    -e 's/(^|[[:space:]])(-[a-zA-Z]*[mF]|--message|--file)(=|[[:space:]]+)[^-[:space:]][^[:space:]]*/\1\2/g' \
    -e "s/['\"]//g"
}
scan="$(printf '%s\n' "$cmd" \
  | awk '{ if (sub(/\\$/, "")) printf "%s ", $0; else print }' \
  | strip_msg_spans)"

# Isolate each `git … commit …` segment. Any run of global options may sit
# between git and commit — each a dash token plus at most one value token
# (-C <path>, -c <k>=<v>, --git-dir=…). grep -o is per-line, so heredoc
# bodies on later lines never match; the leading boundary keeps `legit
# commit` out while allowing /usr/bin/git, `\git`, `$(git …)`.
segs="$(printf '%s' "$scan" \
  | grep -oE '(^|[^[:alnum:]_.-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit[^|&;]*' || true)"
[ -n "$segs" ] || exit 0

# --no-verify — including the unique prefixes git accepts (--no-veri…) — or
# -n in any short-flag bundle (-n / -an / -anm — for `git commit`, -n IS
# --no-verify). Double-dash options never match the bundle pattern.
if printf '%s' "$segs" | grep -qE -- '--no-veri(fy|f)?([^[:alnum:]-]|$)|(^|[[:space:]])-[a-zA-Z]*n[a-zA-Z]*([^[:alnum:]-]|$)'; then
  echo "Domaine convention (references/commit-message-format.md): git hooks are quality gates — never commit with --no-verify/-n, in any flow. Re-run the same git commit and let the hooks run. If a hook fails on a pre-existing repo defect your change didn't touch, report it to the developer (in auto flows: ESCALATE) instead of bypassing — only the developer may bypass, by hand." >&2
  exit 2
fi

# Redirecting hooks away (core.hooksPath via -c / git config / GIT_CONFIG_*
# env; config keys are case-insensitive) disables them outright — same rule,
# stronger form. Checked against the whole command, not per segment, so
# `git config core.hooksPath … && git commit` can't slip through the split —
# but on a newline-JOINED re-strip: the per-line strip above can't reach a
# quoted message spanning lines, and a multi-line commit body legitimately
# mentioning core.hooksPath must not trip this.
if printf '%s' "$cmd" | tr '\n' ' ' | strip_msg_spans | grep -qiE 'core\.hookspath'; then
  echo "Domaine convention (references/commit-message-format.md): git hooks are quality gates — never disable or redirect them (core.hooksPath / GIT_CONFIG_* overrides) to get a commit through. Re-run the plain git commit and let the hooks run. If a hook fails on a pre-existing repo defect your change didn't touch, report it to the developer (in auto flows: ESCALATE) — only the developer may bypass, by hand." >&2
  exit 2
fi
exit 0
