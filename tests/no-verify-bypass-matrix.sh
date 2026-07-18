#!/usr/bin/env bash
# FP/FN contract for the PreToolUse commit-guard hooks:
#   plugins/fnd/hooks/no-verify-bypass.sh   (B/A/R/J cases)
#   plugins/fnd/hooks/no-ai-attribution.sh  (N/M/NJ cases)
# Every regex change to either hook re-runs this matrix: `block` rows are the
# bypasses that must stay closed (false negatives), `allow` rows are the
# legitimate commands that must stay unblocked (false positives).
# Exit 0 = matrix green.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/plugins/fnd/hooks/no-verify-bypass.sh"
HOOK_ATTR="$ROOT/plugins/fnd/hooks/no-ai-attribution.sh"
CUR_HOOK="$HOOK"
BASH_BIN="$(command -v bash)"

pass=0
fail=0
failures=""

check() { # $1 block|allow  $2 label  $3 command string
  local expect="$1" label="$2" cmd="$3" ec=0 want=0
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$BASH_BIN" "$CUR_HOOK" >/dev/null 2>&1 || ec=$?
  [ "$expect" = block ] && want=2
  if [ "$ec" -eq "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failures="${failures}  [$label] expected $expect (exit $want), got exit $ec :: $cmd
"
  fi
}

raw() { # $1 block|allow  $2 label  $3 raw stdin  [$4 PATH override]
  local expect="$1" label="$2" input="$3" path="${4-}" ec=0 want=0
  if [ -n "$path" ]; then
    printf '%s' "$input" | PATH="$path" "$BASH_BIN" "$CUR_HOOK" >/dev/null 2>&1 || ec=$?
  else
    printf '%s' "$input" | "$BASH_BIN" "$CUR_HOOK" >/dev/null 2>&1 || ec=$?
  fi
  [ "$expect" = block ] && want=2
  if [ "$ec" -eq "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failures="${failures}  [$label] expected $expect (exit $want), got exit $ec :: $input
"
  fi
}

# --- must BLOCK (closed bypasses) ------------------------------------------
check block B01-plain-long        'git commit --no-verify -m "x"'
check block B02-plain-short       'git commit -n -m "x"'
check block B03-bundled           'git commit -anm "wip"'
check block B04-quoted-flag       'git commit "-n" -m "x"'
check block B05-quote-split-flag  "git commit --no-'verify' -m x"
check block B06-quoted-C-arg      'git -C "." commit -n'
check block B07-hooksPath-c       'git -c core.hooksPath=/dev/null commit -m x'
check block B08-hooksPath-env     'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'
check block B09-sh-wrap           'sh -c "git commit -n -m x"'
check block B10-line-continuation $'git commit \\\n  --no-verify -m x'
check block B11-prefix-verif      'git commit --no-verif -m x'
check block B12-prefix-veri       'git commit --no-veri -m x'
check block B13-hooksPath-config  'git config core.hooksPath /dev/null && git commit -m x'
check block B14-amend             'cd repo && git commit --amend -n'
check block B15-c-option-run      'git -c commit.gpgsign=false commit -n'
check block B16-git-dir           'git --git-dir=.git commit --no-verify'
check block B17-env-prefix        'env git commit -n -m wip'
check block B18-flag-after-msg    'git commit -m "real msg" -n'
check block B19-compound          'git stash && git commit -n -m wip'
check block B20-bare-global-opt   'git -p commit -n'
check block B21-cmd-subst         'echo "$(git commit -n)"'
# Documented residual FP, asserted so a fix is a conscious matrix update:
check block B22-residual-prose-fp 'echo git commit -n is banned'

# --- must ALLOW (no false positives) ---------------------------------------
check allow A01-plain             'git commit -m "safe change"'
check allow A02-flag-in-msg       'git commit -m "do not use --no-verify"'
check allow A03-escaped-quotes    'git commit -m "block \"--no-verify\" bypass"'
check allow A04-bundled-msg       "git commit -am 'fix: ban --no-verify in docs'"
check allow A05-no-edit           'git commit --amend --no-edit'
check allow A06-no-gpg-sign       'git commit --no-gpg-sign -m x'
check allow A07-log-n             'git log -n 5'
check allow A08-cherry-pick-n     'git cherry-pick -n abc123'
check allow A09-push              'git push origin main'
check allow A10-legit-c           'git -c user.email=a@b.c commit -m x'
check allow A11-hooksPath-alone   'git config core.hooksPath .husky'
check allow A12-hooksPath-in-msg  "git commit -m 'note: core.hooksPath stays .husky'"
check allow A13-message-eq        'git commit --message="mentions --no-verify"'
check allow A14-file-arg          'git commit -F notes.txt'
check allow A15-revert-no-commit  'git revert --no-commit HEAD'
check allow A16-bare-commit       'git commit'
check allow A17-reuse-msg-C       'git commit --amend -C HEAD'
check allow A18-cmd-subst-msg     'git commit -m "$(date)"'
check allow A19-non-git           'npm run commit'
check allow A20-signed            'git commit -s -S -m x'
check allow A21-multiline-msg     $'git commit -m "note:\n--no-verify is banned"'
check allow A22-multiline-hookspath-msg $'git commit -m "docs:\nwhy core.hooksPath stays .husky"'

# --- malformed / degraded input --------------------------------------------
raw allow R01-no-command-field '{"tool_name":"Bash","tool_input":{}}'
raw allow R02-empty-stdin ''

# No jq on PATH → sed fallback must still guard (and still not FP).
shim="$(mktemp -d)"
trap 'rm -rf "$shim"' EXIT
for t in cat tr sed grep awk; do ln -s "$(command -v "$t")" "$shim/$t"; done
raw block J01-nojq-long  '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m \"x\""}}' "$shim"
raw block J02-nojq-short '{"tool_name":"Bash","tool_input":{"command":"git commit -n"}}' "$shim"
raw allow J03-nojq-clean '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"safe\""}}' "$shim"
raw allow J04-nojq-msg   '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"do not use --no-verify\""}}' "$shim"

# ═══ no-ai-attribution.sh ═══════════════════════════════════════════════════
CUR_HOOK="$HOOK_ATTR"

# --- must BLOCK (attribution in a commit segment) ---------------------------
check block N01-trailer-multiline $'git commit -m "feat: x\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>"'
check block N02-anthropic-email   'git commit -m "fix" -m "Co-Authored-By: Bot <noreply@anthropic.com>"'
check block N03-generated-with    $'git commit -m "x\n\n🤖 Generated with [Claude Code]"'
check block N04-generated-bare    'git commit -m "Generated with Claude"'
check block N05-C-option-gate     'git -C . commit -m "x Co-Authored-By: Claude <noreply@anthropic.com>"'
check block N06-double-space-gate 'git  commit -m "x Co-Authored-By: Claude <noreply@anthropic.com>"'
check block N07-heredoc-F         $'git commit -F - <<\'EOF\'\nmsg\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF'
check block N08-sh-wrap           'sh -c "git commit -m \"x Co-Authored-By: Claude <noreply@anthropic.com>\""'
check block N09-amend-chain       $'git add -A && git commit --amend -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'
check block N10-semicolon-in-msg  $'git commit -m "fix: a; b\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'
# Documented residual FPs, asserted so a fix is a conscious matrix update:
check block N11-residual-mention-fp "git commit -m 'docs: forbid Co-Authored-By: Claude trailers'"
check block N12-residual-postcmd-fp 'git commit -m "ok"; git log --grep "Co-Authored-By: Claude"'

# --- must ALLOW (no false positives) ---------------------------------------
check allow M01-plain             'git commit -m "safe change"'
check allow M02-human-coauthor    $'git commit -m "pair work\n\nCo-Authored-By: Jane Doe <jane@corp.example>"'
check allow M03-grep-before       'grep -r "Co-Authored-By: Claude" plugins ; git commit -m "ok"'
check allow M04-echo-before       'echo "Co-Authored-By: Claude" > docs/note.md && git commit -m "ok"'
check allow M05-heredoc-before    $'cat <<EOF > note.md\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\ngit commit -m "ok"'
check allow M06-log-grep          'git log --grep "Co-Authored-By: Claude"'
check allow M07-claude-mention    'git commit -m "explain claude workflow"'
check allow M08-prose-no-commit   'echo Co-Authored-By: Claude is banned in commits'
check allow M09-postcmd-and-chain 'git commit -m "ok" && git log --grep "Co-Authored-By: Claude"'

# --- malformed / degraded input --------------------------------------------
raw allow MR1-no-command-field '{"tool_name":"Bash","tool_input":{}}'
raw allow MR2-empty-stdin ''
raw block NJ1-nojq-trailer '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"x\\n\\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}' "$shim"
raw allow NJ2-nojq-clean   '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"safe\""}}' "$shim"

echo "commit-guard hooks matrix: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  printf '%s' "$failures"
  exit 1
fi
