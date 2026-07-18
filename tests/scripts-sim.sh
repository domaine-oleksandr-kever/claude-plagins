#!/usr/bin/env bash
# Simulation harness for the bundled shell/node scripts (2026-07 audit, batch C).
# No network, no store: theme-json runs against a stub runner; shopify-admin-gql runs
# against PATH shims of `shopify` and `curl`. Exit 0 = all green.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GQL="$ROOT/plugins/fnd/scripts/shopify-admin-gql.sh"
TJ="$ROOT/plugins/fnd/scripts/theme-json.sh"
CPT="$ROOT/plugins/fnd/scripts/create-preview-theme.sh"
FBC="$ROOT/plugins/fnd/skills/fix-breaking-changes/scripts/fix-breaking-changes.template.js"
BASH_BIN="$(command -v bash)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; failures=""
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); failures="${failures}  [$1] $2
"; }
# assert <label> <want-rc> <got-rc> <stderr-file> [required-stderr-substring]
assert() {
  local label="$1" want="$2" got="$3" errf="$4" substr="${5-}"
  if [ "$got" -ne "$want" ]; then
    bad "$label" "exit $got, want $want :: $(head -c 200 "$errf" | tr '\n' ' ')"; return
  fi
  if [ -n "$substr" ] && ! grep -q "$substr" "$errf"; then
    bad "$label" "stderr missing '$substr' :: $(head -c 200 "$errf" | tr '\n' ' ')"; return
  fi
  ok
}

# ---------------------------------------------- theme-json.sh against a stub runner --
TJDIR="$TMP/tj"; mkdir -p "$TJDIR"
cp "$TJ" "$TJDIR/theme-json.sh"
cat > "$TJDIR/shopify-admin-gql.sh" <<'STUB'
#!/usr/bin/env bash
# stub runner — answers by query content; FAKE_ROLE controls the theme role,
# FAKE_RUNNER_MODE simulates the runner's exit-3 stderr contracts
set -u
case "${FAKE_RUNNER_MODE:-ok}" in
  mutfail) echo "error=store_execute_failed_mutation (stub)" >&2; exit 3 ;;
  nocreds) echo "error=no_admin_token" >&2; exit 3 ;;
esac
Q=""
while [ $# -gt 0 ]; do case "$1" in --query) Q="$2"; shift 2 ;; *) shift ;; esac; done
role="${FAKE_ROLE:-DEVELOPMENT}"
if grep -q FndThemesList "$Q"; then
  printf '{"data":{"themes":{"nodes":[{"id":"gid://shopify/OnlineStoreTheme/1","name":"Live","role":"MAIN"},{"id":"gid://shopify/OnlineStoreTheme/2","name":"Dev","role":"DEVELOPMENT"}]}}}\n'
elif grep -q FndThemeFileGet "$Q"; then
  printf '{"data":{"theme":{"id":"gid://shopify/OnlineStoreTheme/2","name":"Dev","role":"%s","files":{"nodes":[{"filename":"templates/product.json","updatedAt":"now","body":{"content":"{\\"a\\":1}"}}],"userErrors":[]}}}}\n' "$role"
elif grep -q FndThemeMeta "$Q"; then
  printf '{"data":{"theme":{"id":"gid://shopify/OnlineStoreTheme/2","name":"Dev","role":"%s"}}}\n' "$role"
elif grep -q FndThemeFileSet "$Q"; then
  printf '{"data":{"themeFilesUpsert":{"upsertedThemeFiles":[{"filename":"templates/product.json"}],"userErrors":[]}}}\n'
else
  echo "error=stub_unknown_query" >&2; exit 5
fi
STUB
chmod +x "$TJDIR/theme-json.sh" "$TJDIR/shopify-admin-gql.sh"

E="$TMP/err"; O="$TMP/out"

# T1 (bug): a failed --out write is a hard stop, not ok=saved
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" get --theme 2 --file templates/product.json \
  --out "$TMP/no/such/dir/x.json" >"$O" 2>"$E" || rc=$?
assert T1-out-write-failed 5 "$rc" "$E" "error=out_write_failed"

# T2: a good --out still works and lands the exact body
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" get --theme 2 --file templates/product.json \
  --out "$TMP/snap.json" >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$TMP/snap.json")" = '{"a":1}' ]; then ok; else bad T2-out-ok "rc=$rc body=$(cat "$TMP/snap.json" 2>/dev/null)"; fi

# T3 (bug): an invalid --role is a usage error, not a silent empty list
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" themes --role dev >"$O" 2>"$E" || rc=$?
assert T3-invalid-role 2 "$rc" "$E" "error=invalid_role"

# T4: a valid --role filters
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" themes --role development >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && [ "$(grep -c Dev "$O")" = 1 ] && ! grep -q Live "$O"; then ok; else bad T4-role-filter "rc=$rc out=$(cat "$O")"; fi

# T5: live-theme write still refused (regression)
rc=0; FAKE_ROLE=MAIN "$BASH_BIN" "$TJDIR/theme-json.sh" set --theme 2 --file templates/product.json \
  --from "$TMP/snap.json" >"$O" 2>"$E" || rc=$?
assert T5-live-refused 4 "$rc" "$E" "live_theme_write_refused"

# T6: dev-theme write goes through the stub (regression)
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" set --theme 2 --file templates/product.json \
  --from "$TMP/snap.json" >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && grep -q '"ok":"upserted"' "$O"; then ok; else bad T6-set-ok "rc=$rc out=$(cat "$O")"; fi

# T7 (bug): themes list no longer truncates at 50
if grep -q 'first: 250' "$TJDIR/theme-json.sh"; then ok; else bad T7-first-250 "themes query still first: 50"; fi

# T8 (pin): --role live maps to the GraphQL enum MAIN at dispatch (theme-json.sh:328) —
# subtle enough that a review already misread it as broken once
rc=0; "$BASH_BIN" "$TJDIR/theme-json.sh" themes --role live >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && grep -q Live "$O" && ! grep -q Dev "$O"; then ok; else bad T8-role-live "rc=$rc out=$(cat "$O")"; fi

# themecli shim for the auto-fallback cases — records every invocation
TJSHIM="$TMP/tjshim"; mkdir -p "$TJSHIM"
cat > "$TJSHIM/shopify" <<'FAKE'
#!/usr/bin/env bash
touch "${TJ_CLI_MARKER:-/dev/null}"
case "$*" in
  *"theme list"*) printf '[{"id":2,"name":"Dev","role":"development"}]\n' ;;
  *"theme push"*) printf '{}\n' ;;
esac
exit 0
FAKE
chmod +x "$TJSHIM/shopify"

# T9 (bug): runner exit 3 for an ATTEMPTED mutation must NOT fall back to themecli
# (a re-push could double-apply); the runner's stderr propagates instead
rc=0; M9="$TMP/tj9"; TJ_CLI_MARKER="$M9" FAKE_RUNNER_MODE=mutfail SHOPIFY_CLI_THEME_TOKEN=fake \
  PATH="$TJSHIM:$PATH" "$BASH_BIN" "$TJDIR/theme-json.sh" set --theme 2 --file templates/product.json \
  --from "$TMP/snap.json" --store test.myshopify.com >"$O" 2>"$E" || rc=$?
assert T9-mutfail-no-cli-fallback 3 "$rc" "$E" "store_execute_failed_mutation"
if [ ! -f "$M9" ]; then ok; else bad T9b-cli-untouched "themecli invoked after an attempted mutation"; fi

# T10: runner exit 3 for MISSING credentials still falls back to themecli
rc=0; M10="$TMP/tj10"; TJ_CLI_MARKER="$M10" FAKE_RUNNER_MODE=nocreds SHOPIFY_CLI_THEME_TOKEN=fake \
  PATH="$TJSHIM:$PATH" "$BASH_BIN" "$TJDIR/theme-json.sh" set --theme 2 --file templates/product.json \
  --from "$TMP/snap.json" --store test.myshopify.com >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && [ -f "$M10" ] && grep -q themecli "$O"; then ok; else bad T10-nocreds-fallback "rc=$rc out=$(cat "$O") err=$(head -c 150 "$E" | tr '\n' ' ')"; fi

# ------------------------------------- shopify-admin-gql.sh against PATH shims --
SHIM="$TMP/shim"; mkdir -p "$SHIM"
GQLDIR="$TMP/gqlwork"; mkdir -p "$GQLDIR"
printf 'mutation FndX { thingCreate { id } }\n' > "$GQLDIR/mutation.graphql"
printf 'query FndY { shop { name } }\n' > "$GQLDIR/query.graphql"
printf '{"k":"v"}\n' > "$GQLDIR/vars.json"

cat > "$SHIM/shopify" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "version" ]; then echo "4.5.2"; exit 0; fi
case "${FAKE_EXEC_MODE:-garbage}" in
  garbage) echo "unexpected CLI crash output" >&2; exit 1 ;;
  noauth)  echo "No stored app authentication found" >&2; exit 1 ;;
  ok)      echo '{"ok":true}'; exit 0 ;;
esac
FAKE
cat > "$SHIM/curl" <<'FAKE'
#!/usr/bin/env bash
# emulates the exact flags the runner uses: -o <file>, -w '%{http_code}', --data @file
touch "${CURL_MARKER:-/dev/null}"
out=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -K|-H|-X) shift 2 ;;
    *) shift ;;
  esac
done
case "$data" in @*) cp "${data#@}" "${CURL_MARKER:-/dev/null}.body" 2>/dev/null || true ;; esac
body="${FAKE_HTTP_BODY:-}"; [ -n "$body" ] || body='{"data":{"ok":true}}'
printf '%s' "$body" > "${out:-/dev/null}"
printf '%s' "${FAKE_HTTP:-200}"
FAKE
chmod +x "$SHIM/shopify" "$SHIM/curl"

run_gql() { # runs the real script with shims; args pass through
  (cd "$GQLDIR" && PATH="$SHIM:$PATH" SHOPIFY_ADMIN_TOKEN=test-token "$BASH_BIN" "$GQL" --store test-store "$@")
}

# G1 (bug): a mutation whose execute was attempted and failed must NOT fall back
rc=0; M="$TMP/m1"; CURL_MARKER="$M" FAKE_EXEC_MODE=garbage \
  run_gql --query mutation.graphql >"$O" 2>"$E" || rc=$?
assert G1-mutation-no-fallback 3 "$rc" "$E" "store_execute_failed_mutation"
if [ ! -f "$M" ]; then ok; else bad G1b-curl-untouched "token engine WAS invoked after a failed mutation execute"; fi

# G2: a query in the same situation still falls back (availability failure)
rc=0; M="$TMP/m2"; CURL_MARKER="$M" FAKE_EXEC_MODE=garbage \
  run_gql --query query.graphql >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && grep -q '"ok":true' "$O" && [ -f "$M" ]; then ok; else bad G2-query-fallback "rc=$rc out=$(cat "$O")"; fi

# G3 (bug): non-2xx HTTP exits non-zero with error=http_<code>, body off stdout
rc=0; M="$TMP/m3"; CURL_MARKER="$M" FAKE_HTTP=401 FAKE_HTTP_BODY='<html>unauthorized</html>' \
  run_gql --engine token --query query.graphql >"$O" 2>"$E" || rc=$?
assert G3-http-401 5 "$rc" "$E" "error=http_401"
if [ ! -s "$O" ]; then ok; else bad G3b-stdout-clean "HTML body leaked to stdout: $(cat "$O")"; fi

# G4: auth-missing is a PRE-execution failure — mutations may still fall back
rc=0; M="$TMP/m4"; CURL_MARKER="$M" FAKE_EXEC_MODE=noauth \
  run_gql --query mutation.graphql >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && grep -q '"ok":true' "$O" && [ -f "$M" ]; then ok; else bad G4-noauth-fallback "rc=$rc out=$(cat "$O")"; fi

# G5 (bug): --variables-file reaches the request body
rc=0; M="$TMP/m5"; CURL_MARKER="$M" \
  run_gql --engine token --query query.graphql --variables-file vars.json >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && grep -q '"variables":{"k":"v"}' "$M.body"; then ok; else bad G5-variables-file "rc=$rc body=$(cat "$M.body" 2>/dev/null)"; fi

# G6: --variables and --variables-file together are refused
rc=0; run_gql --query query.graphql --variables '{}' --variables-file vars.json >"$O" 2>"$E" || rc=$?
assert G6-conflicting-flags 2 "$rc" "$E" "error=conflicting_flags"

# ---------------------------------------- create-preview-theme.sh cap classifier --
CAP_RE='theme limit|maximum number of themes|too many themes'
if grep -qF "$CAP_RE" "$CPT"; then ok; else bad C1-pattern-in-script "cap regex in the test drifted from the script"; fi
if printf 'You have reached your theme limit.\n' | grep -qiE "$CAP_RE"; then ok; else bad C2-real-cap "true cap message not classified"; fi
if printf 'The maximum number of themes has been reached\n' | grep -qiE "$CAP_RE"; then ok; else bad C3-real-cap2 "true cap message not classified"; fi
if printf 'Error pushing theme: rate limit exceeded, too many requests\n' | grep -qiE "$CAP_RE"; then
  bad C4-rate-limit-fp "rate-limit stderr still classified as theme cap"
else ok; fi

# ------------------------------------------- fix-breaking-changes banner handling --
FB="$TMP/fb"; mkdir -p "$FB/templates/customers" "$FB/config" "$FB/scripts"
printf '/* banner\n * auto-generated by Shopify\n*/\n{"current":{"x":1}}\n' > "$FB/config/settings_data.json"
printf '{"sections":{}}\n' > "$FB/templates/index.json"
printf '{"sections":{}}\n' > "$FB/templates/customers/account.json"
cp "$FBC" "$FB/scripts/fix-breaking-changes.js"
rc=0; (cd "$FB" && node scripts/fix-breaking-changes.js) >"$O" 2>"$E" || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q 'Error processing' "$O" "$E"; then ok; else bad F1-banner-config "rc=$rc :: $(grep 'Error processing' "$O" "$E" | head -2)"; fi
if head -1 "$FB/config/settings_data.json" | grep -q '/\* banner'; then ok; else bad F2-banner-preserved "banner lost: $(head -1 "$FB/config/settings_data.json")"; fi

echo "scripts-sim: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then printf '%s' "$failures"; exit 1; fi
