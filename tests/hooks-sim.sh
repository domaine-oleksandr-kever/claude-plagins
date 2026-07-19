#!/usr/bin/env bash
# Simulation harness for the fnd plugin's session-level hooks:
#   S cases — plugin.json SessionStart command: per-file tolerance (one broken
#             md must not discard the rest), FND_LEAN gate, always exit 0
#   G cases — plugin.json UserPromptSubmit gate: FND_CTX_MONITOR semantics
#             (only literal "0" disables), node failure never fails the hook
#   C cases — hooks/context-stats.cjs against transcript fixtures: synthetic
#             (API-error) entries skipped, FND_CTX_WARN=0 honored, >100%
#             window-override hint
# Commands under test are extracted from plugin.json, not duplicated here.
# Exit 0 = all green.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/plugins/fnd/.claude-plugin/plugin.json"
CTX="$ROOT/plugins/fnd/hooks/context-stats.cjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; failures=""
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); failures="${failures}  [$1] $2
"; }
assert_contains() { case "$2" in *"$3"*) ok ;; *) bad "$1" "missing: $3" ;; esac; }
assert_absent()   { case "$2" in *"$3"*) bad "$1" "unexpected: $3" ;; *) ok ;; esac; }
assert_eq()       { if [ "$2" = "$3" ]; then ok; else bad "$1" "got '$2', want '$3'"; fi; }

# ═══ S — SessionStart per-file tolerance + store-access gating ══════════════
SS_CMD="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$MANIFEST")"
fake="$TMP/plugroot"; mkdir -p "$fake/hooks"
for f in comment-discipline plugin-feedback store-access task-workspace lean-code; do
  echo "MARK-$f" > "$fake/hooks/$f.md"
done
# store-access is gated on store files in the cwd — run each case from a controlled dir
SS_STORE="$TMP/ss-store"; mkdir -p "$SS_STORE"; : > "$SS_STORE/shopify.theme.toml"
SS_ENV="$TMP/ss-env";     mkdir -p "$SS_ENV";   : > "$SS_ENV/.env"
SS_PLAIN="$TMP/ss-plain"; mkdir -p "$SS_PLAIN"

out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S1-all-present-exit "$ec" 0
for f in comment-discipline plugin-feedback store-access task-workspace lean-code; do
  assert_contains "S1-$f" "$out" "MARK-$f"
done

rm "$fake/hooks/plugin-feedback.md"
out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S2-missing-file-exit "$ec" 0
for f in comment-discipline store-access task-workspace lean-code; do
  assert_contains "S2-$f" "$out" "MARK-$f"
done

out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" FND_LEAN=0 bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S3-lean-off-exit "$ec" 0
assert_absent S3-no-lean "$out" "MARK-lean-code"

# S4: no store files in the cwd → store-access.md is NOT injected, the rest is
out="$(cd "$SS_PLAIN" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S4-no-store-exit "$ec" 0
assert_absent S4-no-store-access "$out" "MARK-store-access"
for f in comment-discipline task-workspace lean-code; do
  assert_contains "S4-$f" "$out" "MARK-$f"
done

# S5: a .env alone is enough to inject store-access.md
out="$(cd "$SS_ENV" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S5-env-exit "$ec" 0
assert_contains S5-env-store-access "$out" "MARK-store-access"

# ═══ G — UserPromptSubmit FND_CTX_MONITOR gate ══════════════════════════════
UPS_CMD="$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$MANIFEST")"
shim="$TMP/shim"; mkdir -p "$shim"
cat > "$shim/node" <<'SH'
#!/usr/bin/env bash
echo run >> "$NODE_LOG"
exit "${NODE_EC:-0}"
SH
chmod +x "$shim/node"

run_gate() { # [VAR=val…] — extra env for the gate command
  : > "$TMP/node.log"
  env "$@" NODE_LOG="$TMP/node.log" PATH="$shim:$PATH" CLAUDE_PLUGIN_ROOT="$fake" \
    bash -c "$UPS_CMD" >/dev/null 2>&1
}

run_gate FND_CTX_MONITOR=0; ec=$?
assert_eq G1-off-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then bad G1-off "node ran with FND_CTX_MONITOR=0"; else ok; fi

run_gate; ec=$?
assert_eq G2-default-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then ok; else bad G2-default "node did not run by default"; fi

run_gate FND_CTX_MONITOR=1
if [ -s "$TMP/node.log" ]; then ok; else bad G3-one "node did not run with FND_CTX_MONITOR=1"; fi

# Docs say "0 disables" — any other value must keep the monitor on.
run_gate FND_CTX_MONITOR=true
if [ -s "$TMP/node.log" ]; then ok; else bad G4-true "node did not run with FND_CTX_MONITOR=true"; fi

run_gate FND_CTX_MONITOR=2
if [ -s "$TMP/node.log" ]; then ok; else bad G5-two "node did not run with FND_CTX_MONITOR=2"; fi

run_gate NODE_EC=1; ec=$?
assert_eq G6-node-failure-exit "$ec" 0

# ═══ C — context-stats.cjs transcript fixtures ══════════════════════════════
REAL='{"message":{"model":"claude-fable-5","usage":{"input_tokens":50000,"cache_read_input_tokens":100000,"output_tokens":1000}},"isSidechain":false}'
SYN='{"message":{"model":"<synthetic>","usage":{"input_tokens":0,"output_tokens":0}},"isSidechain":false}'
BIG='{"message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":450000,"cache_read_input_tokens":50000,"output_tokens":0}},"isSidechain":false}'

run_ctx() { # transcript-file session-id [VAR=val…] — unique sid per case: the band
  local t="$1" sid="$2"; shift 2   # state file persists in tmpdir across sim runs
  printf '{"transcript_path":"%s","session_id":"%s","effort":{"level":"high"}}' "$t" "$sid" \
    | env "$@" node "$CTX" 2>/dev/null
}

printf '%s\n' "$REAL" > "$TMP/t0.jsonl"
out="$(run_ctx "$TMP/t0.jsonl" "c0-$$")"
assert_contains C0-usage  "$out" "151.0k/1M (15%)"
assert_contains C0-model  "$out" "claude-fable-5"
assert_contains C0-effort "$out" "effort high"

# API-error tail: usage must come from the real entry, not the synthetic zero.
printf '%s\n' "$REAL" "$SYN" > "$TMP/t1.jsonl"
out="$(run_ctx "$TMP/t1.jsonl" "c1-$$")"
assert_contains C1-real-usage "$out" "151.0k"
assert_absent   C1-not-zero   "$out" "0.0k"

out="$(run_ctx "$TMP/t0.jsonl" "c2-$$" FND_CTX_WARN=0)"
assert_contains C2-warn0-cta "$out" "/compact"
assert_contains C2-warn0-ctx "$out" "additionalContext"

out="$(run_ctx "$TMP/t0.jsonl" "c3-$$" FND_CTX_WARN=abc)"
assert_absent C3-warn-nan "$out" "/compact"

# 200k guess on a 1M session → impossible pct → override hint.
printf '%s\n' "$BIG" > "$TMP/t2.jsonl"
out="$(run_ctx "$TMP/t2.jsonl" "c4-$$")"
assert_contains C4-over100 "$out" "500.0k/200k (250%)"
assert_contains C4-hint    "$out" "FND_CTX_WINDOW"

out="$(run_ctx "$TMP/t2.jsonl" "c5-$$" FND_CTX_WINDOW=1000000)"
assert_contains C5-override "$out" "500.0k/1M (50%)"
assert_absent   C5-no-hint  "$out" "FND_CTX_WINDOW"

# ── band transitions (2026-07 token audit): additionalContext only on change ──
# C6: same band twice — the CTA stays on every prompt, the context flag fires once
out="$(run_ctx "$TMP/t0.jsonl" "c6-$$" FND_CTX_WARN=10)"
assert_contains C6-first-ctx "$out" "additionalContext"
out="$(run_ctx "$TMP/t0.jsonl" "c6-$$" FND_CTX_WARN=10)"
assert_contains C6-second-cta "$out" "/compact"
assert_absent   C6-second-no-ctx "$out" "additionalContext"

# C7: band escalation (warn → crit) re-emits the flag in the same session — with a
# silent same-band prompt in between, so the case fails if emission is unconditional
out="$(run_ctx "$TMP/t0.jsonl" "c7-$$" FND_CTX_WARN=10)"
assert_contains C7-warn-ctx "$out" "additionalContext"
out="$(run_ctx "$TMP/t0.jsonl" "c7-$$" FND_CTX_WARN=10)"
assert_absent   C7-same-band-silent "$out" "additionalContext"
out="$(run_ctx "$TMP/t2.jsonl" "c7-$$" FND_CTX_WARN=10)"
assert_contains C7-crit-ctx "$out" "additionalContext"

# C8: dropping back under the threshold emits nothing; re-entering warn re-emits
out="$(run_ctx "$TMP/t0.jsonl" "c8-$$" FND_CTX_WARN=10)"
assert_contains C8-enter-ctx "$out" "additionalContext"
out="$(run_ctx "$TMP/t0.jsonl" "c8-$$" FND_CTX_WARN=90)"
assert_absent   C8-ok-no-ctx "$out" "additionalContext"
out="$(run_ctx "$TMP/t0.jsonl" "c8-$$" FND_CTX_WARN=10)"
assert_contains C8-reenter-ctx "$out" "additionalContext"

# C9: WARN_AT inside the 75/90 tiers — a sub-threshold prompt must stay band 0 (not
# pre-record band 2 and swallow the warn-entry emission when the threshold is crossed)
MID='{"message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":154000,"output_tokens":0}},"isSidechain":false}'
HI='{"message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":170000,"output_tokens":0}},"isSidechain":false}'
printf '%s\n' "$MID" > "$TMP/t3.jsonl"
printf '%s\n' "$HI"  > "$TMP/t4.jsonl"
out="$(run_ctx "$TMP/t3.jsonl" "c9-$$" FND_CTX_WARN=80)"   # 77% < 80 → silent
assert_absent   C9-below-warn "$out" "additionalContext"
out="$(run_ctx "$TMP/t4.jsonl" "c9-$$" FND_CTX_WARN=80)"   # 85% ≥ 80 → warn entry emits
assert_contains C9-warn-entry "$out" "additionalContext"

echo "hooks sim: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  printf '%s' "$failures"
  exit 1
fi
