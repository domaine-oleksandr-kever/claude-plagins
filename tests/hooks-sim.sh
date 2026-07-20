#!/usr/bin/env bash
# Simulation harness for the fnd plugin's session-level hooks:
#   S cases — plugin.json SessionStart command: per-file tolerance (one broken
#             md must not discard the rest), FND_LEAN gate, always exit 0, and the
#             real plugin root emitting the json-slim whale-routing instruction
#   G cases — plugin.json UserPromptSubmit gate: FND_CTX_MONITOR semantics
#             (only literal "0" disables), node failure never fails the hook
#   C cases — hooks/context-stats.cjs against transcript fixtures: synthetic
#             (API-error) entries skipped, FND_CTX_WARN=0 honored, >100%
#             window-override hint
#   M cases — plugin.json PostToolUse gate (FND_MCP_SLIM) + hooks/mcp-slim.cjs:
#             big result compressed with a real full= spill, error/small results
#             and unrecognized shapes pass through, node never spawns when disabled;
#             M12–M16 the TTL sweep (stale pruned, fresh/foreign/debug-log kept,
#             FND_MCP_SLIM_TTL=0 + throttle-marker skip); M17–M23 the FND_MCP_SLIM_DEBUG
#             log (one JSONL line per invocation: compressed / size-gate / error-shape /
#             non-json / unrecognized reasons, no file when off, rotation at ~5 MB)
#   P cases — plugin.json UserPromptSubmit gate (FND_PROMPT_JSON) + hooks/
#             prompt-json-guard.cjs: a big prompt carrying a big JSON blob is blocked
#             with the blob spilled byte-exact, below-gate / no-json / small prompts
#             pass through, string-aware + conservative extraction, workspace placement,
#             spill-failure never blocks, node never spawns when disabled
#   T cases — hooks/subagent-conventions.sh: code-writing / unknown agents get the
#             conventions, read-only readers AND jira-writer are skipped, FND_LEAN=0
#             drops lean-code, the hook always exits 0
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
for f in comment-discipline plugin-feedback store-access task-workspace lean-code mcp-whale; do
  echo "MARK-$f" > "$fake/hooks/$f.md"
done
# store-access is gated on store files in the cwd — run each case from a controlled dir
SS_STORE="$TMP/ss-store"; mkdir -p "$SS_STORE"; : > "$SS_STORE/shopify.theme.toml"
SS_ENV="$TMP/ss-env";     mkdir -p "$SS_ENV";   : > "$SS_ENV/.env"
SS_PLAIN="$TMP/ss-plain"; mkdir -p "$SS_PLAIN"

out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S1-all-present-exit "$ec" 0
for f in comment-discipline plugin-feedback store-access task-workspace lean-code mcp-whale; do
  assert_contains "S1-$f" "$out" "MARK-$f"
done

rm "$fake/hooks/plugin-feedback.md"
out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S2-missing-file-exit "$ec" 0
for f in comment-discipline store-access task-workspace lean-code mcp-whale; do
  assert_contains "S2-$f" "$out" "MARK-$f"
done

out="$(cd "$SS_STORE" && CLAUDE_PLUGIN_ROOT="$fake" FND_LEAN=0 bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S3-lean-off-exit "$ec" 0
assert_absent S3-no-lean "$out" "MARK-lean-code"

# S4: no store files in the cwd → store-access.md is NOT injected, the rest is
out="$(cd "$SS_PLAIN" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S4-no-store-exit "$ec" 0
assert_absent S4-no-store-access "$out" "MARK-store-access"
for f in comment-discipline task-workspace lean-code mcp-whale; do
  assert_contains "S4-$f" "$out" "MARK-$f"
done

# S5: a .env alone is enough to inject store-access.md
out="$(cd "$SS_ENV" && CLAUDE_PLUGIN_ROOT="$fake" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq S5-env-exit "$ec" 0
assert_contains S5-env-store-access "$out" "MARK-store-access"

# S6: the REAL plugin root emits the deterministic json-slim whale-routing instruction
realroot="$ROOT/plugins/fnd"
out="$(cd "$SS_PLAIN" && CLAUDE_PLUGIN_ROOT="$realroot" bash -c "$SS_CMD" 2>/dev/null)"; ec=$?
assert_eq       S6-real-root-exit  "$ec" 0
assert_contains S6-whale-conv      "$out" "oversized MCP results"
assert_contains S6-whale-json-slim "$out" "json-slim.cjs"

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

# ── M12–M16: spill-file hygiene (TTL sweep, M5) ──────────────────────────────
# The hook calls sweepSpills() AFTER emitting; a dedicated spill dir per scenario keeps the
# throttle-marker state controlled (M1–M11's $MSD already carries a fresh marker). `touch -t`
# ages a seeded spill past the 24 h TTL. `msin` = the M1 content-array input for a real spill.
msin="$(jq -n --rawfile t "$JIRA" \
  '{tool_name:"mcp__plugin_fnd_atlassian__getJiraIssue",tool_response:{content:[{type:"text",text:$t}]}}')"
sweep_body() { printf '%s' "$1" | jq -r '.hookSpecificOutput.updatedToolOutput.content[0].text' 2>/dev/null | sed 's/<<full=[^>]*>>//g'; }

# M12: a hook run seeds its own FRESH spill and sweeps a pre-seeded STALE one — stale gone,
# fresh kept, the hook's own new spill present, and the emitted body identical to a TTL=0 run.
SWD="$TMP/sweep-m12"; mkdir -p "$SWD"
stale="$SWD/fnd-crush-STALE.json"; : > "$stale"; touch -t 200001010000 "$stale"
fresh="$SWD/fnd-mcp-slim-FRESH.json"; : > "$fresh"   # mtime now → must survive
outS="$(printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" node "$SLIM" 2>/dev/null)"
if [ ! -f "$stale" ]; then ok; else bad M12-stale-swept "stale spill survived the sweep"; fi
if [ -f "$fresh" ]; then ok; else bad M12-fresh-kept "fresh spill was swept"; fi
np="$(printf '%s' "$outS" | jq -r '.hookSpecificOutput.updatedToolOutput.content[0].text' 2>/dev/null | grep -o 'full=[^ >]*' | tail -1 | sed 's/^full=//')"
if [ -n "$np" ] && [ -f "$np" ]; then ok; else bad M12-newspill "hook's own spill missing (np='$np')"; fi
SWD0="$TMP/sweep-m12-nosweep"; mkdir -p "$SWD0"
outN="$(printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD0" FND_MCP_SLIM_TTL=0 node "$SLIM" 2>/dev/null)"
assert_eq M12-body-identical "$(sweep_body "$outS")" "$(sweep_body "$outN")"

# M13: FND_MCP_SLIM_TTL=0 disables the sweep → a stale spill survives
SWD="$TMP/sweep-m13"; mkdir -p "$SWD"
stale="$SWD/fnd-mcp-slim-STALE.json"; : > "$stale"; touch -t 200001010000 "$stale"
printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" FND_MCP_SLIM_TTL=0 node "$SLIM" >/dev/null 2>&1
if [ -f "$stale" ]; then ok; else bad M13-ttl0-keeps-stale "TTL=0 still swept a stale spill"; fi

# M14: a stale FOREIGN-named file (not our prefix) survives; our stale one is swept
SWD="$TMP/sweep-m14"; mkdir -p "$SWD"
foreign="$SWD/other-tool-STALE.json"; : > "$foreign"; touch -t 200001010000 "$foreign"
ourstale="$SWD/fnd-crush-STALE.json"; : > "$ourstale"; touch -t 200001010000 "$ourstale"
printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" node "$SLIM" >/dev/null 2>&1
if [ -f "$foreign" ]; then ok; else bad M14-foreign-kept "sweep deleted a foreign-named file"; fi
if [ ! -f "$ourstale" ]; then ok; else bad M14-ours-swept "sweep missed our stale file"; fi

# M15: throttle — run 1 leaves a fresh marker; a stale spill seeded AFTER it survives run 2
SWD="$TMP/sweep-m15"; mkdir -p "$SWD"
printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" node "$SLIM" >/dev/null 2>&1
if [ -f "$SWD/.fnd-mcp-slim-sweep" ]; then ok; else bad M15-marker "run 1 did not create the sweep marker"; fi
stale="$SWD/fnd-crush-STALE.json"; : > "$stale"; touch -t 200001010000 "$stale"
printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" node "$SLIM" >/dev/null 2>&1
if [ -f "$stale" ]; then ok; else bad M15-throttled "throttle failed: stale swept despite a fresh marker"; fi

# M16: the M6 debug log + its rotation are excluded by exact name even when stale (a real spill
# alongside them is still swept, proving the exclusion is name-based, not a blanket skip)
SWD="$TMP/sweep-m16"; mkdir -p "$SWD"
dbg="$SWD/fnd-mcp-slim-debug.log"; : > "$dbg"; touch -t 200001010000 "$dbg"
dbg1="$SWD/fnd-mcp-slim-debug.log.1"; : > "$dbg1"; touch -t 200001010000 "$dbg1"
stale="$SWD/fnd-mcp-slim-STALE.json"; : > "$stale"; touch -t 200001010000 "$stale"
printf '%s' "$msin" | env FND_MCP_SLIM_DIR="$SWD" node "$SLIM" >/dev/null 2>&1
if [ -f "$dbg" ] && [ -f "$dbg1" ]; then ok; else bad M16-debug-kept "sweep deleted the debug log"; fi
if [ ! -f "$stale" ]; then ok; else bad M16-stale-swept "sweep missed a stale spill next to the debug log"; fi

# ── M17–M23: FND_MCP_SLIM_DEBUG log (M6) ─────────────────────────────────────
# One JSONL metadata line per invocation → <FND_MCP_SLIM_DIR>/fnd-mcp-slim-debug.log; opt-in, never
# any payload content. Each case uses a dedicated dir so the single line is unambiguous.
DBGLOG="fnd-mcp-slim-debug.log"
run_dbg() { printf '%s' "$2" | env FND_MCP_SLIM_DIR="$1" FND_MCP_SLIM_DEBUG=1 node "$SLIM" 2>/dev/null; }

# M17: DEBUG on + big result → exactly one line, decision compressed, sane bytes/pct, spill exists,
# AND the emitted body is byte-identical to a DEBUG-off run (logging never alters the result).
DBG="$TMP/dbg-m17"; mkdir -p "$DBG"
outD="$(run_dbg "$DBG" "$msin")"; LOG="$DBG/$DBGLOG"
assert_eq M17-one-line  "$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')" 1
assert_eq M17-entry     "$(jq -r '.entry'    "$LOG" 2>/dev/null)" "hook"
assert_eq M17-decision  "$(jq -r '.decision' "$LOG" 2>/dev/null)" "compressed"
bi="$(jq -r '.bytes_in' "$LOG" 2>/dev/null)"; bo="$(jq -r '.bytes_out' "$LOG" 2>/dev/null)"
if [ "$bo" -lt "$bi" ]; then ok; else bad M17-bytes "bytes_out $bo not < bytes_in $bi"; fi
if jq -e '.pct > 0' "$LOG" >/dev/null 2>&1; then ok; else bad M17-pct "pct not > 0"; fi
sp="$(jq -r '.spill' "$LOG" 2>/dev/null)"
if [ -n "$sp" ] && [ -f "$sp" ]; then ok; else bad M17-spill "spill file missing (sp='$sp')"; fi
DBG0="$TMP/dbg-m17-off"; mkdir -p "$DBG0"
outN="$(printf '%s' "$msin" | env -u FND_MCP_SLIM_DEBUG FND_MCP_SLIM_DIR="$DBG0" node "$SLIM" 2>/dev/null)"
assert_eq M17-body-identical "$(sweep_body "$outD")" "$(sweep_body "$outN")"

# M18: MCP error result (isError:true) → passthrough logged as error-shape (still no stdout)
DBG="$TMP/dbg-m18"; mkdir -p "$DBG"
in="$(jq -n --rawfile t "$JIRA" '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$t}],isError:true}}')"
assert_eq M18-passthrough "$(run_dbg "$DBG" "$in")" ""
assert_eq M18-decision "$(jq -r '.decision' "$DBG/$DBGLOG" 2>/dev/null)" "passthrough"
assert_eq M18-reason   "$(jq -r '.reason'   "$DBG/$DBGLOG" 2>/dev/null)" "error-shape"

# M19: small result → passthrough logged as size-gate
DBG="$TMP/dbg-m19"; mkdir -p "$DBG"
run_dbg "$DBG" '{"tool_name":"mcp__x__y","tool_response":{"content":[{"type":"text","text":"{\"a\":1,\"b\":2}"}]}}' >/dev/null
assert_eq M19-reason "$(jq -r '.reason' "$DBG/$DBGLOG" 2>/dev/null)" "size-gate"

# M20: DEBUG unset → no log file created at all (zero side effects).
# env -u clears any ambient FND_MCP_SLIM_DEBUG (a developer may export it to observe the log live).
DBG="$TMP/dbg-m20"; mkdir -p "$DBG"
printf '%s' "$msin" | env -u FND_MCP_SLIM_DEBUG FND_MCP_SLIM_DIR="$DBG" node "$SLIM" >/dev/null 2>&1
if [ ! -f "$DBG/$DBGLOG" ]; then ok; else bad M20-no-log "debug log written with FND_MCP_SLIM_DEBUG unset"; fi

# M21: rotation — a >5 MB log is renamed to .log.1 before the fresh line lands in a new .log
DBG="$TMP/dbg-m21"; mkdir -p "$DBG"
dd if=/dev/zero of="$DBG/$DBGLOG" bs=1024 count=5121 >/dev/null 2>&1   # ~5.001 MB, over the cap
run_dbg "$DBG" "$msin" >/dev/null
if [ -f "$DBG/$DBGLOG.1" ]; then ok; else bad M21-rotated "log > 5 MB not rotated to .log.1"; fi
assert_eq M21-fresh-line "$(wc -l < "$DBG/$DBGLOG" 2>/dev/null | tr -d ' ')" 1

# M22: big non-JSON text → passthrough logged as non-json
DBG="$TMP/dbg-m22"; mkdir -p "$DBG"
bignon="$(printf 'x%.0s' $(seq 1 5000))"
in="$(jq -n --arg t "$bignon" '{tool_name:"mcp__x__y",tool_response:{content:[{type:"text",text:$t}]}}')"
run_dbg "$DBG" "$in" >/dev/null
assert_eq M22-reason "$(jq -r '.reason' "$DBG/$DBGLOG" 2>/dev/null)" "non-json"

# M23: unrecognized object shape (no text/content) → passthrough logged as unrecognized-shape
DBG="$TMP/dbg-m23"; mkdir -p "$DBG"
in="$(jq -cn '{tool_name:"mcp__x__y",tool_response:{stuff:[range(0;600)|{id:.,v:"padpadpadpad"}]}}')"
run_dbg "$DBG" "$in" >/dev/null
assert_eq M23-reason "$(jq -r '.reason' "$DBG/$DBGLOG" 2>/dev/null)" "unrecognized-shape"

# ═══ P — UserPromptSubmit prompt-json-guard ═════════════════════════════════
# Gate (FND_PROMPT_JSON) via the extracted plugin.json command[1]; behavior by piping
# UserPromptSubmit-shaped input to the hook. $shim/$fake come from the G/M scaffolding.
GUARD="$ROOT/plugins/fnd/hooks/prompt-json-guard.cjs"
PJ_GATE="$(jq -r '.hooks.UserPromptSubmit[0].hooks[1].command' "$MANIFEST")"
PJD="$TMP/pj-spill"; mkdir -p "$PJD"

# Build a UserPromptSubmit input: a JSON blob of ~blobBytes wrapped in prose padded so the
# whole prompt is ~promptBytes. Writes the canonical blob to $4 for byte-exact comparison.
mk() { # blobBytes promptBytes cwd blobfile
  node -e '
    const fs=require("fs");
    const tb=+process.argv[1], tp=+process.argv[2], cwd=process.argv[3], bf=process.argv[4];
    let items=[],blob;
    do{items.push({id:items.length,pad:"x".repeat(40)});blob=JSON.stringify({items});}while(blob.length<tb);
    fs.writeFileSync(bf,blob);
    const need=Math.max(0, tp-blob.length-2);
    const prompt=(need?"z".repeat(need)+"\n":"")+blob;
    process.stdout.write(JSON.stringify({prompt,cwd}));
  ' "$1" "$2" "$3" "$4"
}
run_guard() { printf '%s' "$1" | env TMPDIR="$PJD" "${@:2}" node "$GUARD" 2>/dev/null; }
reason_path() { printf '%s' "$1" | jq -r '.reason' 2>/dev/null \
  | grep -oE '/[^[:space:]]+fnd-prompt-json-[^[:space:]]+\.json' | head -1; }

# P1: big prompt + big JSON blob → block; reason names an existing file holding the blob byte-exact
EXP="$PJD/p1.json"
in="$(mk 20000 25000 "$PJD" "$EXP")"
out="$(run_guard "$in")"
assert_contains P1-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP"; then ok; else bad P1-byteexact "saved blob missing or != prompt blob (p='$p')"; fi
assert_contains P1-offswitch "$out" "FND_PROMPT_JSON=0"

# P2: big prompt but the JSON blob is below the 8 KB gate → passthrough
in="$(mk 4000 15000 "$PJD" "$PJD/p2.json")"
assert_eq P2-blob-below-gate "$(run_guard "$in")" ""

# P3: blob is over the gate but the whole prompt is under the 10 KB gate → passthrough
in="$(mk 8500 9000 "$PJD" "$PJD/p3.json")"
assert_eq P3-prompt-below-gate "$(run_guard "$in")" ""

# P4: big prose, no parseable JSON (a stray unbalanced brace) → passthrough
big="$(printf 'z%.0s' $(seq 1 12000)) and a { broken [ json"
in="$(jq -n --arg p "$big" --arg c "$PJD" '{prompt:$p,cwd:$c}')"
assert_eq P4-no-json "$(run_guard "$in")" ""

# P5: FND_PROMPT_JSON gate — 0 means node never spawns; unset means it runs
run_pj_gate() { : > "$TMP/node.log"; env "$@" NODE_LOG="$TMP/node.log" PATH="$shim:$PATH" \
  CLAUDE_PLUGIN_ROOT="$fake" bash -c "$PJ_GATE" >/dev/null 2>&1; }
run_pj_gate FND_PROMPT_JSON=0; ec=$?
assert_eq P5-off-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then bad P5-off "node ran with FND_PROMPT_JSON=0"; else ok; fi
run_pj_gate; ec=$?
assert_eq P5-default-exit "$ec" 0
if [ -s "$TMP/node.log" ]; then ok; else bad P5-default "node did not run by default"; fi

# P6: braces / brackets / escaped quotes INSIDE string values must not break extraction
EXP6="$PJD/p6.json"
in="$(node -e '
  const fs=require("fs");
  const items=Array.from({length:250},(_,i)=>({id:i,s:"has {curly} and [square] and \"quoted\" and \\slash"}));
  const blob=JSON.stringify({items}); fs.writeFileSync(process.argv[1],blob);
  process.stdout.write(JSON.stringify({prompt:"Analyze this tricky payload:\n\n"+blob+"\n\nDone.",cwd:process.argv[2]}));
' "$EXP6" "$PJD")"
out="$(run_guard "$in")"
assert_contains P6-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP6"; then ok; else bad P6-byteexact "string-brace blob mis-extracted (p='$p')"; fi

# P7: spill write failure (read-only tmpdir, no workspace) → NEVER block (don't lose the paste)
if [ "$(id -u)" = 0 ]; then ok; else   # root ignores 000 perms — skip there
  RO="$TMP/pj-ro"; mkdir -p "$RO"; chmod 000 "$RO"
  in="$(mk 20000 25000 "$RO/nope" "$PJD/p7.json")"   # cwd under RO → no .claude/fnd, unwritable
  assert_eq P7-spill-fail-passthrough "$(run_guard "$in" TMPDIR="$RO")" ""
  chmod 755 "$RO"
fi

# P8: TWO offloadable blobs (both ≥ gate) → BOTH saved. A block erases the whole prompt,
# so nothing offloadable may be dropped; the reason lists two paths, each byte-exact.
EXP8A="$PJD/p8a.json"; EXP8B="$PJD/p8b.json"
in="$(node -e '
  const fs=require("fs");
  const a=JSON.stringify({a:Array.from({length:400},(_,i)=>({id:i,pad:"x".repeat(40)}))});
  const b=JSON.stringify({b:Array.from({length:600},(_,i)=>({id:i,pad:"y".repeat(40)}))});
  fs.writeFileSync(process.argv[1],a); fs.writeFileSync(process.argv[2],b);
  process.stdout.write(JSON.stringify({prompt:"two responses: "+a+" and "+b+" end",cwd:process.argv[3]}));
' "$EXP8A" "$EXP8B" "$PJD")"
out="$(run_guard "$in")"
assert_contains P8-block "$out" '"decision":"block"'
paths="$(printf '%s' "$out" | jq -r '.reason' 2>/dev/null | grep -oE '/[^[:space:]]+fnd-prompt-json-[^[:space:]]+\.json')"
n=$(printf '%s\n' "$paths" | grep -c .)
assert_eq P8-two-paths "$n" 2
for exp in "$EXP8A" "$EXP8B"; do
  hit=no; for sp in $paths; do cmp -s "$sp" "$exp" && hit=yes; done
  if [ "$hit" = yes ]; then ok; else bad "P8-saved-$(basename "$exp")" "blob not saved byte-exact"; fi
done

# P9: an active task workspace → blob spilled under .claude/fnd/<id>/tmp/, not the tmpdir
WS="$PJD/ws"; mkdir -p "$WS/.claude/fnd/ELC-999"
in="$(mk 20000 25000 "$WS" "$PJD/p9.json")"
out="$(run_guard "$in")"
p="$(reason_path "$out")"
assert_contains P9-block "$out" '"decision":"block"'
case "$p" in *"/.claude/fnd/ELC-999/tmp/"*) ok ;; *) bad P9-workspace "blob not in workspace tmp (p='$p')" ;; esac

# P10: a multibyte JSON blob survives stdin decoding — saved byte-exact, no U+FFFD
EXP10="$PJD/p10.json"
in="$(node -e '
  const fs=require("fs");
  const items=Array.from({length:500},(_,i)=>({id:i,note:"がぎぐげご漢字テスト日本語",emoji:"🍣🎏🍜"}));
  const blob=JSON.stringify({items}); fs.writeFileSync(process.argv[1],blob);
  process.stdout.write(JSON.stringify({prompt:"分析してください:\n\n"+blob+"\n\n以上",cwd:process.argv[2]}));
' "$EXP10" "$PJD")"
out="$(run_guard "$in")"
assert_contains P10-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP10" \
   && node -e 'const fs=require("fs");process.exit(/�/.test(fs.readFileSync(process.argv[1],"utf8"))?1:0)' "$p"; then ok; else bad P10-multibyte "multibyte blob corrupted (p='$p')"; fi

# P11: a top-level ARRAY blob (not object) over the gate → block
EXP11="$PJD/p11.json"
in="$(node -e '
  const fs=require("fs");
  const arr=JSON.stringify(Array.from({length:600},(_,i)=>({id:i,pad:"z".repeat(40)})));
  fs.writeFileSync(process.argv[1],arr);
  process.stdout.write(JSON.stringify({prompt:"Here is the list:\n\n"+arr+"\n\nsummarize",cwd:process.argv[2]}));
' "$EXP11" "$PJD")"
out="$(run_guard "$in")"
assert_contains P11-array-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP11"; then ok; else bad P11-array "array blob mis-extracted (p='$p')"; fi

# P12: a stray unbalanced brace in prose BEFORE the blob → conservative passthrough (no false block)
in="$(node -e '
  const big=JSON.stringify({b:Array.from({length:600},(_,i)=>({id:i,pad:"y".repeat(40)}))});
  process.stdout.write(JSON.stringify({prompt:"prose with a stray { brace then "+big+" end",cwd:process.argv[1]}));
' "$PJD")"
assert_eq P12-conservative-passthrough "$(run_guard "$in")" ""

# P13: malformed stdin → passthrough, exit 0 (never break the prompt)
out="$(printf 'not json at all' | env TMPDIR="$PJD" node "$GUARD" 2>/dev/null)"; ec=$?
assert_eq P13-malformed-out "$out" ""
assert_eq P13-malformed-exit "$ec" 0

# P14: TWO active work-id dirs (ambiguous) → fall back to tmpdir, never an arbitrary ticket dir
WS2="$PJD/ws2"; mkdir -p "$WS2/.claude/fnd/ELC-999" "$WS2/.claude/fnd/ELC-1000"
in="$(mk 20000 25000 "$WS2" "$PJD/p14.json")"
out="$(run_guard "$in")"
assert_contains P14-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
case "$p" in
  *"/.claude/fnd/"*) bad P14-ambiguous "ambiguous workspaces spilled into a ticket dir (p='$p')" ;;
  "$PJD"/*)         ok ;;
  *)                bad P14-ambiguous "unexpected spill path (p='$p')" ;;
esac

# P15: a balanced-but-INVALID JSON span (unquoted keys) ≥ gate BEFORE a valid blob → the
# invalid span is skipped (JSON.parse catch), the valid blob still blocks and is saved
EXP15="$PJD/p15.json"
in="$(node -e '
  const fs=require("fs");
  let bad="{"; for(let i=0;i<1200;i++) bad+="unquotedkey"+i+":"+i+","; bad+="last:1}";  // ~18 KB, invalid
  const good=JSON.stringify({items:Array.from({length:600},(_,i)=>({id:i,pad:"z".repeat(40)}))});
  fs.writeFileSync(process.argv[1],good);
  process.stdout.write(JSON.stringify({prompt:"invalid "+bad+" then valid "+good+" end",cwd:process.argv[2]}));
' "$EXP15" "$PJD")"
out="$(run_guard "$in")"
assert_contains P15-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP15"; then ok; else bad P15-skip-invalid "valid blob after an invalid span not saved (p='$p')"; fi

# P16: a stray closer '}' at depth 0 in prose before a FLAT-array blob → the depth-0
# stray-closer guard keeps the scan armed so the array is still extracted and blocked
EXP16="$PJD/p16.json"
in="$(node -e '
  const fs=require("fs");
  const arr=JSON.stringify(Array.from({length:600},(_,i)=>({id:i,pad:"z".repeat(40)})));
  fs.writeFileSync(process.argv[1],arr);
  process.stdout.write(JSON.stringify({prompt:"result } was "+arr+" end",cwd:process.argv[2]}));
' "$EXP16" "$PJD")"
out="$(run_guard "$in")"
assert_contains P16-block "$out" '"decision":"block"'
p="$(reason_path "$out")"
if [ -n "$p" ] && [ -f "$p" ] && cmp -s "$p" "$EXP16"; then ok; else bad P16-stray-closer "flat array after a stray closer not blocked/saved (p='$p')"; fi

# ═══ T — SubagentStart subagent-conventions (code-convention injection) ══════
# Reuses $fake (CLAUDE_PLUGIN_ROOT with hooks/comment-discipline.md + lean-code.md
# holding MARK-… sentinels) from the S scaffolding.
SUBC="$ROOT/plugins/fnd/hooks/subagent-conventions.sh"
run_subc() { printf '%s' "$1" | env CLAUDE_PLUGIN_ROOT="$fake" "${@:2}" bash "$SUBC" 2>/dev/null; }

# T1: a code-writing agent gets both conventions
out="$(run_subc '{"agent_type":"general-purpose"}')"
assert_contains T1-comment "$out" "MARK-comment-discipline"
assert_contains T1-lean    "$out" "MARK-lean-code"

# T2: unknown / unparsable type errs toward injecting (a code agent without them is the costly miss)
assert_contains T2-unknown   "$(run_subc '{"agent_type":"some-new-writer"}')" "MARK-comment-discipline"
assert_contains T2-malformed "$(run_subc 'not json')"                          "MARK-comment-discipline"

# T3: non-code agents are skipped (no conventions) — jira-writer joins the readers/reviewers
for a in jira-reader jira-writer bug-hunter change-reviewer figma-reader theme-explorer; do
  assert_eq "T3-$a-skip" "$(run_subc "{\"agent_type\":\"$a\"}")" ""
done
# a scoped plugin agent_type (e.g. fnd:jira-writer) is still matched by the *…* globs
assert_eq T4-scoped-writer-skip "$(run_subc '{"agent_type":"fnd:jira-writer"}')" ""

# T5: FND_LEAN=0 drops lean-code, keeps comment-discipline
out="$(run_subc '{"agent_type":"general-purpose"}' FND_LEAN=0)"
assert_contains T5-comment "$out" "MARK-comment-discipline"
assert_absent   T5-no-lean "$out" "MARK-lean-code"

# T6: the hook always exits 0 (a hook failure must never block an agent start)
run_subc '{"agent_type":"jira-writer"}'    >/dev/null 2>&1; assert_eq T6-skip-exit   "$?" 0
run_subc '{"agent_type":"general-purpose"}' >/dev/null 2>&1; assert_eq T6-inject-exit "$?" 0

echo "hooks sim: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  printf '%s' "$failures"
  exit 1
fi
