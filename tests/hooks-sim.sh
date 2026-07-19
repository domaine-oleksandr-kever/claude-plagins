#!/usr/bin/env bash
# Simulation harness for the fnd plugin's session-level hooks:
#   S cases — plugin.json SessionStart command: per-file tolerance (one broken
#             md must not discard the rest), FND_LEAN gate, always exit 0
#   G cases — plugin.json UserPromptSubmit gate: FND_CTX_MONITOR semantics
#             (only literal "0" disables), node failure never fails the hook
#   C cases — hooks/context-stats.cjs against transcript fixtures: synthetic
#             (API-error) entries skipped, FND_CTX_WARN=0 honored, >100%
#             window-override hint
#   M cases — plugin.json PostToolUse gate (FND_MCP_SLIM) + hooks/mcp-slim.cjs:
#             big result compressed with a real full= spill, error/small results
#             and unrecognized shapes pass through, node never spawns when disabled
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

# ═══ M — PostToolUse mcp-slim (result compressor) ═══════════════════════════
# Gate (FND_MCP_SLIM) tested via the extracted plugin.json command + node shim;
# hook behavior tested by invoking mcp-slim.cjs directly on PostToolUse-shaped input.
SLIM="$ROOT/plugins/fnd/hooks/mcp-slim.cjs"
FIX="$ROOT/tests/fixtures"
JIRA="$FIX/jira-issue-ELC-104.json"
PTU_CMD="$(jq -r '.hooks.PostToolUse[0].hooks[0].command' "$MANIFEST")"
MSD="$TMP/slim-spill"; mkdir -p "$MSD"

run_slim() { # input-json [VAR=val…] — pipe input to the hook, echo its stdout
  local in="$1"; shift
  printf '%s' "$in" | env FND_MCP_SLIM_DIR="$MSD" "$@" node "$SLIM" 2>/dev/null
}

# M1: big MCP result (content-array shape) → updatedToolOutput + a full= spill that exists
in="$(jq -n --rawfile t "$JIRA" \
  '{tool_name:"mcp__plugin_fnd_atlassian__getJiraIssue",tool_response:{content:[{type:"text",text:$t}]}}')"
out="$(run_slim "$in")"
assert_contains M1-updated   "$out" "updatedToolOutput"
assert_contains M1-hookevent "$out" "PostToolUse"
text="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.content[0].text' 2>/dev/null)"
p="$(printf '%s' "$text" | grep -o 'full=[^ >]*' | head -1 | sed 's/^full=//')"
if [ -n "$p" ] && [ -f "$p" ]; then ok; else bad M1-fullfile "no existing full= file (p='$p')"; fi
inb=$(printf '%s' "$in" | wc -c); outb=$(printf '%s' "$out" | wc -c)
if [ "$outb" -lt "$inb" ]; then ok; else bad M1-smaller "output $outb not < input $inb"; fi

# M2: MCP error result (isError:true) → untouched, even when big
in="$(jq -n --rawfile t "$JIRA" \
  '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$t}],isError:true}}')"
assert_eq M2-iserror-passthrough "$(run_slim "$in")" ""

# M3: error envelope in the text (errors:[…]) → untouched (write-gating reads it verbatim)
err="$(jq -cn '{errors:[{message:"boom"}],filler:[range(0;600)|{id:.,note:"padding-padding-padding"}]}')"
in="$(jq -n --arg t "$err" '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$t}]}}')"
assert_eq M3-errenvelope-passthrough "$(run_slim "$in")" ""

# M4: small result (≤ 4 KB gate) → untouched
in='{"tool_name":"mcp__x__y","tool_response":{"content":[{"type":"text","text":"{\"a\":1,\"b\":2}"}]}}'
assert_eq M4-small-passthrough "$(run_slim "$in")" ""

# M5: transform crash / non-JSON → passthrough (outer try, then slim's parse guard)
assert_eq M5a-malformed-input "$(run_slim 'not json at all')" ""
bignon="$(printf 'x%.0s' $(seq 1 5000))"   # 5000 non-JSON chars, over the size gate
in="$(jq -n --arg t "$bignon" '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$t}]}}')"
assert_eq M5b-big-nonjson "$(run_slim "$in")" ""

# M6: FND_MCP_SLIM gate — 0 means node never spawns; unset means it runs ($shim/$fake from G/S)
run_ptu_gate() { : > "$TMP/node.log"; env "$@" NODE_LOG="$TMP/node.log" PATH="$shim:$PATH" \
  CLAUDE_PLUGIN_ROOT="$fake" bash -c "$PTU_CMD" >/dev/null 2>&1; }
run_ptu_gate FND_MCP_SLIM=0; ec=$?
assert_eq M6-off-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then bad M6-off "node ran with FND_MCP_SLIM=0"; else ok; fi
run_ptu_gate; ec=$?
assert_eq M6-default-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then ok; else bad M6-default "node did not run by default"; fi

# M7: raw-string result shape → compressed string (mirrors input shape, carries full=)
in="$(jq -n --rawfile t "$JIRA" '{tool_name:"mcp__x__y",tool_response:$t}')"
out="$(run_slim "$in")"
assert_contains M7-rawstring-updated "$out" "updatedToolOutput"
assert_contains M7-rawstring-full    "$out" "full="

# M8: docs-variant input field name (tool_output) is honored like tool_response
in="$(jq -n --rawfile t "$JIRA" '{tool_name:"mcp__x__y",tool_output:{content:[{type:"text",text:$t}]}}')"
assert_contains M8-tooloutput-updated "$(run_slim "$in")" "updatedToolOutput"

# M9: unrecognized result shape (object, no text/content) → passthrough (scope boundary)
in="$(jq -cn '{tool_name:"mcp__x__y",tool_response:{stuff:[range(0;600)|{id:.,v:"padpadpadpad"}]}}')"
assert_eq M9-unrecognized-passthrough "$(run_slim "$in")" ""

# M10: mixed content [compressible, TRAILING error envelope] — the recovery handle rides
# the compressed block; the verbatim error block stays byte-identical & JSON-parseable
comp="$(jq -cn '{rows:[range(0;600)|{id:.,note:"padding-padding-padding"}]}')"
errb='{"errors":[{"message":"insufficient permissions"}]}'
in="$(jq -n --arg c "$comp" --arg e "$errb" \
  '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$c},{type:"text",text:$e}]}}')"
out="$(run_slim "$in")"
assert_contains M10-updated "$out" "updatedToolOutput"
b0="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.content[0].text' 2>/dev/null)"
b1="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.content[1].text' 2>/dev/null)"
assert_contains M10-marker-on-block0 "$b0" "full="
assert_eq       M10-errblock-verbatim "$b1" "$errb"
if printf '%s' "$b1" | jq -e . >/dev/null 2>&1; then ok; else bad M10-errblock-json "error block no longer parses"; fi

# M11: large multibyte payload survives stdin chunking — no U+FFFD in the emitted result
# OR the recovery spill (regression for per-Buffer-chunk decoding across a read boundary)
node -e '
  const rows = Array.from({length:4000},(_,i)=>({id:i,note:"がぎぐげご漢字テスト日本語サンプル",emoji:"🍣🎏🍜"}));
  const tr = {content:[{type:"text",text:JSON.stringify({items:rows})}]};
  process.stdout.write(JSON.stringify({tool_name:"mcp__x__y",tool_response:tr}));
' > "$TMP/utf8-in.json"
out="$(FND_MCP_SLIM_DIR="$MSD" node "$SLIM" < "$TMP/utf8-in.json" 2>/dev/null)"
assert_contains M11-updated "$out" "updatedToolOutput"
if printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.exit(/�/.test(s)?1:0))'; then ok; else bad M11-no-fffd-out "U+FFFD in emitted result"; fi
sp="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.content[0].text' 2>/dev/null | grep -o 'full=[^ >]*' | head -1 | sed 's/^full=//')"
if [ -n "$sp" ] && node -e 'const fs=require("fs");process.exit(/�/.test(fs.readFileSync(process.argv[1],"utf8"))?1:0)' "$sp"; then ok; else bad M11-no-fffd-spill "U+FFFD in recovery spill (sp='$sp')"; fi

echo "hooks sim: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  printf '%s' "$failures"
  exit 1
fi
