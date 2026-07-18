#!/usr/bin/env bash
# shopify-admin-gql.sh — run an Admin GraphQL query/mutation without exposing secrets.
#
# TWO ENGINES, auto-selected (override with --engine):
#
#   store — Shopify CLI ≥ 4.x `shopify store execute`, using stored `shopify store auth`
#     credentials (a Shopify-managed OAuth app on the store; NO token in the repo at all).
#     Preferred when available. The one-time setup is a MANUAL developer step — it opens a
#     browser and requires the "install apps" permission on the store, which client stores
#     often deny:
#         shopify store auth --store <domain>.myshopify.com --scopes <comma-separated>
#     The stored token is ONLINE and expires — re-run `store auth` when execute reports the
#     auth missing/expired. This script NEVER runs `store auth` itself (it is interactive and
#     would hang a non-TTY run). Mutations: `store execute` refuses them unless
#     --allow-mutations is passed; the script detects a mutation operation and opts in
#     automatically. --operation is supported by extracting that named operation (plus all
#     fragments) into a temp file, because `store execute` has no operationName flag.
#
#   token — classic Admin API access token via curl. Mirrors the create-preview-theme.sh
#     token discipline: the token (shpat_…, scopes like write_metaobjects / write_products) is
#     read straight from the repo's gitignored .env into this subprocess and used ONLY in the
#     request header — it is NEVER printed, NEVER returned to the caller, and never on the
#     curl argv (it goes through a private 0600 curl config file that is removed on exit).
#     Skills must therefore call THIS script and must NOT `Read` the .env file themselves.
#
# Selection (--engine auto, the default): shopify CLI present AND major version ≥ 4 → try
# `store execute`; on PRE-execution failures (CLI missing/old, no stored auth, oversized
# variables) fall back to the token engine with a note on stderr. After an actually
# attempted execute, queries still fall back — MUTATIONS never do: the mutation may have
# been applied server-side before the CLI failed, and re-sending it through the token
# engine would execute it twice. `--engine store` / `--engine token` forces one.
#
# The store domain comes from shopify.theme.toml's FIRST uncommented `store=` line — the same
# pick as create-preview-theme.sh, which matters when a multi-environment toml lists several —
# unless overridden. The Theme Access token (shptka_) in shopify.theme.toml is NOT an admin
# token and is intentionally not used here.
#
# Usage:
#   shopify-admin-gql.sh --query <file.graphql> [--operation <name>] [--variables <json>] \
#                        [--variables-file <file.json>] \
#                        [--env <path>] [--store <name|domain>] [--api-version <ver>] \
#                        [--engine auto|store|token]
#
#   --query          path to a .graphql file (may hold multiple named operations)
#   --operation      operationName to run when the file has more than one operation
#   --variables      JSON string of GraphQL variables (optional)
#   --variables-file file holding the variables JSON — use for large payloads (whole
#                    theme-file bodies): argv has a per-argument kernel limit
#   --env            path to the dotenv file holding the token (default: ./.env; token engine only)
#   --store          store subdomain or full *.myshopify.com (default: from shopify.theme.toml)
#   --api-version    Admin API version (default: 2026-04, or $SHOPIFY_ADMIN_API_VERSION)
#   --engine         auto (default) | store | token
#
# For the token engine the token is read from $SHOPIFY_ADMIN_TOKEN (already exported), else
# from the --env file's SHOPIFY_ADMIN_TOKEN= line.
#
# Output contract (BOTH engines): stdout is the classic GraphQL envelope — {"data":…} on
# success, {"errors":…} on a GraphQL-level failure — with exit 0 in both cases (mirrors the
# Admin API's HTTP 200 + errors object). `store execute` natively prints BARE data and boxes
# errors on stderr; the runner wraps/unboxes to keep one contract. Setup/transport errors
# exit non-zero with error=… on stderr. GraphQL errors never trigger the token fallback —
# re-running a mutation elsewhere could execute it twice.
set -euo pipefail

QUERY_FILE=""; OPERATION=""; VARIABLES=""; VARIABLES_FILE=""; ENV_FILE=".env"; STORE=""; ENGINE="auto"
API_VERSION="${SHOPIFY_ADMIN_API_VERSION:-2026-04}"

# a value flag must not be the last arg — a bare `shift 2` would exit silently under set -e
need_val() { [ "$1" -ge 2 ] || { echo "error=missing_value flag=$2" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --query)        need_val $# "$1"; QUERY_FILE="$2"; shift 2 ;;
    --operation)    need_val $# "$1"; OPERATION="$2"; shift 2 ;;
    --variables)    need_val $# "$1"; VARIABLES="$2"; shift 2 ;;
    --variables-file) need_val $# "$1"; VARIABLES_FILE="$2"; shift 2 ;;
    --env)          need_val $# "$1"; ENV_FILE="$2"; shift 2 ;;
    --store)        need_val $# "$1"; STORE="$2"; shift 2 ;;
    --api-version)  need_val $# "$1"; API_VERSION="$2"; shift 2 ;;
    --engine)       need_val $# "$1"; ENGINE="$2"; shift 2 ;;
    *) echo "error=unknown_arg arg=$1" >&2; exit 2 ;;
  esac
done

case "$ENGINE" in auto|store|token) ;; *) echo "error=invalid_engine engine=$ENGINE (use auto|store|token)" >&2; exit 2 ;; esac
[ -n "$QUERY_FILE" ] || { echo "error=missing_query (pass --query <file.graphql>)" >&2; exit 2; }
[ -f "$QUERY_FILE" ] || { echo "error=query_file_not_found file=$QUERY_FILE" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "error=jq_not_found" >&2; exit 2; }

if [ -n "$VARIABLES" ] && ! printf '%s' "$VARIABLES" | jq empty >/dev/null 2>&1; then
  echo "error=invalid_variables_json (--variables must be valid JSON)" >&2
  exit 2
fi
if [ -n "$VARIABLES_FILE" ]; then
  [ -z "$VARIABLES" ] || { echo "error=conflicting_flags (--variables and --variables-file are mutually exclusive)" >&2; exit 2; }
  [ -f "$VARIABLES_FILE" ] || { echo "error=variables_file_not_found file=$VARIABLES_FILE" >&2; exit 2; }
  jq empty "$VARIABLES_FILE" >/dev/null 2>&1 || { echo "error=invalid_variables_json (--variables-file must hold valid JSON)" >&2; exit 2; }
  # the CLI engine can only take variables on argv — read them in; the oversize guard
  # in try_store_execute routes huge payloads to the curl engine (body via file)
  VARIABLES="$(cat "$VARIABLES_FILE")"
fi

# --- store domain: --store, else $SHOPIFY_STORE, else uncommented store= in shopify.theme.toml ---
if [ -z "$STORE" ]; then STORE="${SHOPIFY_STORE:-}"; fi
if [ -z "$STORE" ] && [ -f "shopify.theme.toml" ]; then
  # head -1 = FIRST uncommented store= line, matching create-preview-theme.sh's toml_value
  STORE="$(grep -E '^[[:space:]]*store[[:space:]]*=' shopify.theme.toml | grep -v '^[[:space:]]*#' | head -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*#.*$//; s/^"//; s/"$//' )" || true
fi
[ -n "$STORE" ] || { echo "error=no_store (pass --store or set store= in shopify.theme.toml)" >&2; exit 2; }
case "$STORE" in *.myshopify.com) DOMAIN="$STORE" ;; *) DOMAIN="${STORE}.myshopify.com" ;; esac

# --- engine 1: shopify store execute (CLI ≥ 4.x + stored store auth) --------------------------
SKIP_REASON=""

# print only the named operation's block plus every fragment — `store execute` has no
# operationName flag, so a multi-operation file must be narrowed before sending
extract_operation() {
  awk -v op="$1" '
    /^[[:space:]]*(query|mutation|subscription)([[:space:]]|[({]|$)/ {
      line = $0
      sub(/^[[:space:]]*(query|mutation|subscription)[[:space:]]*/, "", line)
      name = line; sub(/[^A-Za-z0-9_].*$/, "", name)
      keep = (name == op)
    }
    /^[[:space:]]*fragment([[:space:]]|$)/ { keep = 1 }
    {
      if (keep) print
      d += gsub(/{/, "{") - gsub(/}/, "}")
      if (keep && d <= 0 && /}/) keep = 0
    }
  '
}

try_store_execute() {
  command -v shopify >/dev/null 2>&1 || { SKIP_REASON="shopify CLI not found"; return 1; }
  local ver major
  ver="$(shopify version 2>/dev/null | head -1 || true)"
  major="${ver%%.*}"
  case "$major" in ''|*[!0-9]*) SKIP_REASON="unparseable shopify CLI version '$ver'"; return 1 ;; esac
  [ "$major" -ge 4 ] || { SKIP_REASON="shopify CLI $ver has no \`store execute\` (needs >= 4.x)"; return 1; }
  # pre-execution guard: the CLI takes variables on argv, which has a per-argument kernel
  # limit — route oversized payloads to the curl engine (body goes via file there)
  if [ "${#VARIABLES}" -gt 100000 ]; then
    SKIP_REASON="variables too large for the CLI argv (${#VARIABLES} bytes)"
    return 1
  fi

  local qfile="$QUERY_FILE" tmpq=""
  if [ -n "$OPERATION" ]; then
    tmpq="$(mktemp)"
    extract_operation "$OPERATION" < "$QUERY_FILE" > "$tmpq"
    if ! [ -s "$tmpq" ] || ! grep -q "$OPERATION" "$tmpq"; then
      rm -f "$tmpq"
      SKIP_REASON="could not extract operation '$OPERATION' from $QUERY_FILE"
      return 1
    fi
    qfile="$tmpq"
  fi

  local args=(store execute --store "$DOMAIN" --query-file "$qfile" --json --no-color --version "$API_VERSION")
  [ -n "$VARIABLES" ] && args+=(--variables "$VARIABLES")
  # the CLI refuses mutations unless explicitly opted in
  local is_mutation=0
  if grep -qE '^[[:space:]]*mutation([[:space:]]|[({]|$)' "$qfile"; then is_mutation=1; args+=(--allow-mutations); fi

  local out err rc=0
  out="$(mktemp)"; err="$(mktemp)"
  shopify "${args[@]}" >"$out" 2>"$err" || rc=$?
  [ -n "$tmpq" ] && rm -f "$tmpq"
  if [ "$rc" -eq 0 ]; then
    # `store execute --json` prints BARE data (no {"data":…} envelope, unlike the Admin API
    # itself) — wrap it so both engines return the classic envelope
    jq -c '{data: .}' "$out" 2>/dev/null || cat "$out"
    rm -f "$out" "$err"
    return 0
  fi
  local safe_fallback=0
  if grep -q 'No stored app authentication found' "$err"; then
    # the CLI failed before sending anything — nothing executed server-side
    safe_fallback=1
    SKIP_REASON="no stored store auth for $DOMAIN — one-time manual fix: shopify store auth --store $DOMAIN --scopes <comma-separated-scopes>"
  elif grep -q 'GraphQL operation failed' "$err"; then
    # a definitive GraphQL error, not an availability problem — do NOT fall back to the token
    # engine (pointless for queries, double-execution risk for mutations). The CLI boxes the
    # {"errors":…} JSON on stderr; unbox it and return the classic envelope on stdout with
    # exit 0 — the same contract as the curl engine (HTTP 200 + errors object).
    local unboxed
    unboxed="$(jq -Rs -c 'gsub("[│\\n\\r]"; "") | match("\\{.*\\}").string | fromjson' "$err" 2>/dev/null || true)"
    if [ -n "$unboxed" ]; then
      printf '%s\n' "$unboxed"
      rm -f "$out" "$err"
      return 0
    fi
    SKIP_REASON="store execute: GraphQL operation failed, and the boxed error JSON could not be parsed: $(tr '\n' ' ' < "$err" | cut -c1-300)"
  else
    SKIP_REASON="store execute failed: $(tr '\n' ' ' < "$err" | sed -E 's/[[:space:]]+/ /g' | cut -c1-300)"
  fi
  rm -f "$out" "$err"
  # an execute was actually attempted and failed for an unknown reason — for a mutation
  # that could mean "applied server-side, then the CLI died": re-sending it through the
  # token engine risks double execution, so never fall back here
  if [ "$is_mutation" -eq 1 ] && [ "$safe_fallback" -ne 1 ]; then
    echo "error=store_execute_failed_mutation ($SKIP_REASON)" >&2
    echo "hint=NOT falling back to the token engine — the mutation may already have been applied. Verify the store state first; re-run only if the change is absent." >&2
    exit 3
  fi
  return 1
}

if [ "$ENGINE" != "token" ]; then
  if try_store_execute; then exit 0; fi
  if [ "$ENGINE" = "store" ]; then
    echo "error=store_execute_failed ($SKIP_REASON)" >&2
    exit 3
  fi
  echo "note=store_execute unavailable — falling back to the admin-token engine ($SKIP_REASON)" >&2
fi

# --- engine 2: admin token + curl -------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "error=curl_not_found" >&2; exit 2; }

# token: env var wins, else read just the one line from the dotenv file (never echo it)
TOKEN="${SHOPIFY_ADMIN_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  if [ -f "$ENV_FILE" ]; then
    TOKEN="$(grep -E '^[[:space:]]*SHOPIFY_ADMIN_TOKEN[[:space:]]*=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')" || true
  fi
fi
if [ -z "$TOKEN" ]; then
  echo "error=no_admin_token" >&2
  echo "hint=Set SHOPIFY_ADMIN_TOKEN in $ENV_FILE (Admin API access token, shpat_…) — see metafield-metaobject-setup.md — OR use the store engine: Shopify CLI >= 4.x + one-time \`shopify store auth --store $DOMAIN --scopes <scopes>\`" >&2
  exit 3
fi

URL="https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json"

# Build the JSON body with jq, straight into a file — the query and variables never ride
# any argv (per-argument kernel limit) and the body goes to curl via @file for the same
# reason: --rawfile/--slurpfile keep both off the jq command line.
BODYF="$(mktemp)"; RESPF="$(mktemp)"; HDR_CFG="$(mktemp)"; VARSF_TMP="$(mktemp)"
trap 'rm -f "$HDR_CFG" "$BODYF" "$RESPF" "$VARSF_TMP"' EXIT
VARSF=""
if [ -n "$VARIABLES_FILE" ]; then
  VARSF="$VARIABLES_FILE"
elif [ -n "$VARIABLES" ]; then
  printf '%s' "$VARIABLES" > "$VARSF_TMP"   # printf is a builtin — no argv limit
  VARSF="$VARSF_TMP"
fi
if [ -n "$VARSF" ]; then
  jq -c -n \
    --rawfile q "$QUERY_FILE" \
    --arg op "$OPERATION" \
    --slurpfile vars "$VARSF" \
    '{query: $q}
     + (if $op != "" then {operationName: $op} else {} end)
     + {variables: $vars[0]}' > "$BODYF"
else
  jq -c -n \
    --rawfile q "$QUERY_FILE" \
    --arg op "$OPERATION" \
    '{query: $q}
     + (if $op != "" then {operationName: $op} else {} end)' > "$BODYF"
fi

# The token goes into a private curl config file (mktemp = 0600, removed on exit) instead of
# the argv, so it never shows in `ps` and never reaches stdout/stderr.
printf 'header = "X-Shopify-Access-Token: %s"\n' "$TOKEN" > "$HDR_CFG"

# Capture the HTTP status: a 401/404/429/5xx body is HTML/JSON garbage, not a GraphQL
# envelope — it must exit non-zero with error=http_<code>, never reach stdout as data.
HTTP_CODE="$(curl -sS -X POST "$URL" \
  -K "$HDR_CFG" \
  -H "Content-Type: application/json" \
  --data @"$BODYF" \
  -o "$RESPF" -w '%{http_code}')" \
  || { echo "error=curl_transport_failed" >&2; exit 5; }
case "$HTTP_CODE" in
  2*) cat "$RESPF" ;;
  *)
    echo "error=http_${HTTP_CODE} url=$URL" >&2
    head -c 600 "$RESPF" | tr '\n' ' ' >&2; echo >&2
    exit 5 ;;
esac
