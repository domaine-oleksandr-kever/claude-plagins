#!/usr/bin/env bash
# shopify-admin-gql.sh — run an Admin GraphQL query/mutation without exposing the admin token.
#
# Mirrors the create-preview-theme.sh token discipline: the Admin API access token
# (shpat_…, scopes like write_metaobjects / write_products) is read straight from the repo's
# gitignored .env into this subprocess and used ONLY in the request header — it is NEVER printed
# and NEVER returned to the caller. Skills must therefore call THIS script and must NOT `Read`
# the .env file themselves (that would pull the secret into context).
#
# The store domain comes from shopify.theme.toml's uncommented `store=` line (same as the preview
# script) unless overridden. The Theme Access token (shptka_) in shopify.theme.toml is NOT an admin
# token and is intentionally not used here.
#
# Usage:
#   shopify-admin-gql.sh --query <file.graphql> [--operation <name>] [--variables <json>] \
#                        [--env <path>] [--store <name|domain>] [--api-version <ver>]
#
#   --query        path to a .graphql file (may hold multiple named operations)
#   --operation    operationName to run when the file has more than one operation
#   --variables    JSON string of GraphQL variables (optional)
#   --env          path to the dotenv file holding the token (default: ./.env)
#   --store        store subdomain or full *.myshopify.com (default: from shopify.theme.toml)
#   --api-version  Admin API version (default: 2026-04, or $SHOPIFY_ADMIN_API_VERSION)
#
# The token is read from $SHOPIFY_ADMIN_TOKEN (already exported), else from the --env file's
# SHOPIFY_ADMIN_TOKEN= line. Prints the raw JSON response to stdout. Exit non-zero on setup error.
set -euo pipefail

QUERY_FILE=""; OPERATION=""; VARIABLES=""; ENV_FILE=".env"; STORE=""
API_VERSION="${SHOPIFY_ADMIN_API_VERSION:-2026-04}"

while [ $# -gt 0 ]; do
  case "$1" in
    --query)        QUERY_FILE="${2:-}"; shift 2 ;;
    --operation)    OPERATION="${2:-}"; shift 2 ;;
    --variables)    VARIABLES="${2:-}"; shift 2 ;;
    --env)          ENV_FILE="${2:-}"; shift 2 ;;
    --store)        STORE="${2:-}"; shift 2 ;;
    --api-version)  API_VERSION="${2:-}"; shift 2 ;;
    *) echo "error=unknown_arg arg=$1" >&2; exit 2 ;;
  esac
done

[ -n "$QUERY_FILE" ] || { echo "error=missing_query (pass --query <file.graphql>)" >&2; exit 2; }
[ -f "$QUERY_FILE" ] || { echo "error=query_file_not_found file=$QUERY_FILE" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "error=curl_not_found" >&2; exit 2; }
command -v jq   >/dev/null 2>&1 || { echo "error=jq_not_found" >&2; exit 2; }

# --- token: env var wins, else read just the one line from the dotenv file (never echo it) ---
TOKEN="${SHOPIFY_ADMIN_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  if [ -f "$ENV_FILE" ]; then
    TOKEN="$(grep -E '^[[:space:]]*SHOPIFY_ADMIN_TOKEN[[:space:]]*=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')" || true
  fi
fi
if [ -z "$TOKEN" ]; then
  echo "error=no_admin_token" >&2
  echo "hint=Set SHOPIFY_ADMIN_TOKEN in $ENV_FILE (Admin API access token, shpat_…) — see metafield-metaobject-setup.md" >&2
  exit 3
fi

# --- store domain: --store, else $SHOPIFY_STORE, else uncommented store= in shopify.theme.toml ---
if [ -z "$STORE" ]; then STORE="${SHOPIFY_STORE:-}"; fi
if [ -z "$STORE" ] && [ -f "shopify.theme.toml" ]; then
  STORE="$(grep -E '^[[:space:]]*store[[:space:]]*=' shopify.theme.toml | grep -v '^[[:space:]]*#' | tail -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*#.*$//; s/^"//; s/"$//' )" || true
fi
[ -n "$STORE" ] || { echo "error=no_store (pass --store or set store= in shopify.theme.toml)" >&2; exit 2; }
case "$STORE" in *.myshopify.com) DOMAIN="$STORE" ;; *) DOMAIN="${STORE}.myshopify.com" ;; esac

URL="https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json"

# Build the JSON body safely with jq (handles quoting/newlines in the query).
BODY="$(jq -n \
  --arg q "$(cat "$QUERY_FILE")" \
  --arg op "$OPERATION" \
  --argjson vars "${VARIABLES:-null}" \
  '{query: $q}
   + (if $op  != ""   then {operationName: $op}   else {} end)
   + (if $vars != null then {variables: $vars}     else {} end)')"

# Token only ever appears in the header below; never in stdout/stderr.
curl -sS -X POST "$URL" \
  -H "X-Shopify-Access-Token: ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$BODY"
