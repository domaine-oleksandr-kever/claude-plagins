#!/usr/bin/env bash
# theme-json.sh — read/write a theme's customizer state (the JSON content layer).
#
# What the customizer edits is not code — it's theme JSON: templates/*.json (which sections a
# page has, their order, blocks, per-section settings), sections/*.json (header/footer groups)
# and config/settings_data.json (global theme settings). Foundation repos exclude those paths
# from ALL Shopify CLI sync (.shopifyignore): they are store-owned runtime state, and
# `theme dev`'s watcher will neither upload nor hot-reload them. This script edits that state
# DIRECTLY ON A THEME, so nothing routes through the project working tree and no secret is
# ever exposed.
#
# THREE ENGINES (--engine auto|store|token|themecli):
#   gql      — Admin GraphQL via shopify-admin-gql.sh (which itself picks `shopify store
#              execute` or SHOPIFY_ADMIN_TOKEN). Needs read_themes (+ write_themes for `set`).
#              `--engine store` / `--engine token` force that sub-engine, no CLI fallback.
#   themecli — `shopify theme pull/push --only <file> --nodelete` from a private temp dir,
#              authenticated by the Theme Access token (SHOPIFY_CLI_THEME_TOKEN env, else
#              password= / first shp*_… in shopify.theme.toml — read internally, NEVER printed).
#              This is the token every Foundation project already has for `theme dev`, so the
#              flow works even with no Admin API access at all.
#   auto (default) — gql first; if its credentials are missing (runner exit 3) or lack the
#              theme scopes (ACCESS_DENIED), falls back to themecli when a Theme Access token
#              is available, with a note on stderr.
#
# SAFETY: `set` hard-refuses the live theme (role MAIN / live) on every engine — that is
# merchant-owned content; a human changes it in the customizer. Write only to development/
# unpublished themes, and follow the snapshot protocol (files in a temp dir, never the repo):
#   1. get  --out snapshot.json          # pristine copy (raw — restores byte-exact)
#   2. edit a working copy               # get --strip-comments first; then jq
#   3. set  --from working.json          # verify on the storefront after reload
#   4. set  --from snapshot.json         # restore
#
# Usage:
#   theme-json.sh themes [--role main|development|unpublished|live]
#   theme-json.sh get  --theme <id|gid> --file <path/in/theme.json> [--out <file>] [--strip-comments]
#   theme-json.sh set  --theme <id|gid> --file <path/in/theme.json> --from <file>
# Common: [--store <name|domain>] [--engine auto|store|token|themecli] [--env <path>]
#          [--api-version <v>]   (store domain defaults from shopify.theme.toml)
#
# --strip-comments removes /*…*/ blocks (Shopify's auto-generated banner) so the result is plain
# JSON a jq edit can consume; lossless — Shopify re-stamps the banner on every write. Snapshot
# WITHOUT it (raw bytes restore byte-exact); strip only the working base you'll edit.
#
# Output: `themes` prints one {"id","name","role"} JSON per line (gid + UPPERCASE role on every
# engine); `get` prints the raw file body (--out preserves exact bytes); `set` prints a one-line
# result incl. the engine used. GraphQL errors surface as the {"errors":…} envelope on stdout
# with exit 5 (plus a scope hint when it looks like a missing read_themes/write_themes grant).
# Exit: 0 ok · 2 usage · 4 live-theme write refused · 5 GraphQL/user/CLI errors · 3 no engine
# credentials at all (hints name every remedy).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/shopify-admin-gql.sh"
[ -x "$RUNNER" ] || { echo "error=runner_not_found path=$RUNNER" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "error=jq_not_found" >&2; exit 2; }

CMD="${1:-}"; [ $# -gt 0 ] && shift
case "$CMD" in themes|get|set) ;; *) echo "error=unknown_command cmd='$CMD' (use themes|get|set)" >&2; exit 2 ;; esac

THEME=""; FILE=""; OUT=""; FROM=""; ROLE_FILTER=""; STRIP=0
ENGINE="auto"; STORE_ARG=""; ENV_ARG=""; APIV_ARG=""
TOML="${TOML_PATH:-shopify.theme.toml}"

need_val() { [ "$1" -ge 2 ] || { echo "error=missing_value flag=$2" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --theme) need_val $# "$1"; THEME="$2"; shift 2 ;;
    --file)  need_val $# "$1"; FILE="$2"; shift 2 ;;
    --out)   need_val $# "$1"; OUT="$2"; shift 2 ;;
    --from)  need_val $# "$1"; FROM="$2"; shift 2 ;;
    --role)  need_val $# "$1"; ROLE_FILTER="$2"; shift 2 ;;
    --strip-comments) STRIP=1; shift ;;
    --engine) need_val $# "$1"; ENGINE="$2"; shift 2 ;;
    --store)  need_val $# "$1"; STORE_ARG="$2"; shift 2 ;;
    --env)    need_val $# "$1"; ENV_ARG="$2"; shift 2 ;;
    --api-version) need_val $# "$1"; APIV_ARG="$2"; shift 2 ;;
    *) echo "error=unknown_arg arg=$1" >&2; exit 2 ;;
  esac
done
case "$ENGINE" in auto|store|token|themecli) ;; *) echo "error=invalid_engine engine=$ENGINE (use auto|store|token|themecli)" >&2; exit 2 ;; esac

RUNNER_ARGS=()
[ -n "$STORE_ARG" ] && RUNNER_ARGS+=(--store "$STORE_ARG")
[ -n "$ENV_ARG" ]   && RUNNER_ARGS+=(--env "$ENV_ARG")
[ -n "$APIV_ARG" ]  && RUNNER_ARGS+=(--api-version "$APIV_ARG")
case "$ENGINE" in store|token) RUNNER_ARGS+=(--engine "$ENGINE") ;; esac

CLEAN=()
cleanup() { for d in ${CLEAN[@]+"${CLEAN[@]}"}; do rm -rf "$d"; done; }
trap cleanup EXIT

gid_of() {
  case "$1" in
    gid://shopify/OnlineStoreTheme/*) printf '%s' "$1" ;;
    *[!0-9]*|'') echo "error=bad_theme_id value='$1' (numeric id or gid://shopify/OnlineStoreTheme/…)" >&2; exit 2 ;;
    *) printf 'gid://shopify/OnlineStoreTheme/%s' "$1" ;;
  esac
}
num_of() {
  case "$1" in
    gid://shopify/OnlineStoreTheme/*) printf '%s' "${1##*/}" ;;
    *[!0-9]*|'') echo "error=bad_theme_id value='$1' (numeric id or gid://shopify/OnlineStoreTheme/…)" >&2; exit 2 ;;
    *) printf '%s' "$1" ;;
  esac
}

# shared output path for `get` — $1 is a file holding the raw body
emit_file() {
  filter() {
    if [ "$STRIP" -eq 1 ]; then
      command -v perl >/dev/null 2>&1 || { echo "error=strip_needs_perl" >&2; exit 2; }
      perl -0777 -pe 's{/\*.*?\*/}{}gs; s/\A\s+//' "$1"
    else
      cat "$1"
    fi
  }
  if [ -n "$OUT" ]; then
    filter "$1" > "$OUT"
    echo "ok=saved file=$FILE out=$OUT bytes=$(wc -c < "$OUT" | tr -d ' ')" >&2
  else
    filter "$1"; echo
  fi
}

live_refuse() { # $1 name
  echo "error=live_theme_write_refused theme='$1' role=MAIN — the live theme is merchant-owned content; write to a development/unpublished theme instead" >&2
  exit 4
}

# ---------------------------------------------------------------- gql engine --
# gql <query> <variables>: fills RESP. Returns 0 = ok; 1 = fall back to themecli (auto mode,
# credentials missing/insufficient AND a Theme Access token exists); exits on hard failures.
GQL_NOTE=""
gql() {
  local qf rerr rc=0
  qf="$(mktemp)"; rerr="$(mktemp)"; CLEAN+=("$qf" "$rerr")
  printf '%s\n' "$1" > "$qf"
  RESP="$("$RUNNER" --query "$qf" --variables "$2" ${RUNNER_ARGS[@]+"${RUNNER_ARGS[@]}"} 2>"$rerr")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$ENGINE" = "auto" ] && [ "$rc" -eq 3 ] && cli_token_ready; then
      GQL_NOTE="admin credentials not set up"
      return 1
    fi
    cat "$rerr" >&2
    [ "$rc" -eq 3 ] && echo "hint=the theme-CLI engine is a third option — put the Theme Access password in $TOML or export SHOPIFY_CLI_THEME_TOKEN" >&2
    exit "$rc"
  fi
  printf '%s' "$RESP" | jq empty >/dev/null 2>&1 || {
    echo "error=non_json_response" >&2; printf '%s\n' "$RESP"; exit 5; }
  if [ "$(printf '%s' "$RESP" | jq 'has("errors")')" = "true" ]; then
    if printf '%s' "$RESP" | grep -qi 'ACCESS_DENIED\|access denied'; then
      if [ "$ENGINE" = "auto" ] && cli_token_ready; then
        GQL_NOTE="admin credential lacks read_themes/write_themes"
        return 1
      fi
      printf '%s\n' "$RESP"
      echo "hint=the credential lacks read_themes/write_themes — re-run \`shopify store auth --store <domain> --scopes <existing>,read_themes,write_themes\`, extend the custom app's scopes, or use --engine themecli (Theme Access token)" >&2
      exit 5
    fi
    printf '%s\n' "$RESP"
    exit 5
  fi
}

# role filter applied inside each engine fn so `themes` streams straight to stdout (no capture)
role_filter() {
  if [ -n "$ROLE_FILTER" ]; then jq -c --arg r "$ROLE_FILTER" 'select(.role == ($r | ascii_upcase))'
  else cat; fi
}

gql_themes_lines() {
  gql 'query FndThemesList { themes(first: 50) { nodes { id name role } } }' '{}' || return 1
  printf '%s' "$RESP" | jq -c '.data.themes.nodes[]' | role_filter
}

gql_get() {
  local gid; gid="$(gid_of "$THEME")"
  gql 'query FndThemeFileGet($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      id name role
      files(filenames: $filenames, first: 1) {
        nodes { filename updatedAt body { ... on OnlineStoreThemeFileBodyText { content } } }
        userErrors { filename code }
      }
    }
  }' "$(jq -n --arg id "$gid" --arg f "$FILE" '{id: $id, filenames: [$f]}')" || return 1
  printf '%s' "$RESP" | jq -e '.data.theme' >/dev/null 2>&1 || { echo "error=theme_not_found theme=$gid" >&2; exit 5; }
  local ue; ue="$(printf '%s' "$RESP" | jq -c '.data.theme.files.userErrors // []')"
  [ "$ue" = "[]" ] || { echo "error=file_user_errors file=$FILE $ue" >&2; exit 5; }
  printf '%s' "$RESP" | jq -e '.data.theme.files.nodes[0].body.content != null' >/dev/null 2>&1 \
    || { echo "error=file_not_found_or_not_text file=$FILE theme=$gid" >&2; exit 5; }
  local raw; raw="$(mktemp)"; CLEAN+=("$raw")
  printf '%s' "$RESP" | jq -rj '.data.theme.files.nodes[0].body.content' > "$raw"
  emit_file "$raw"
}

gql_set() {
  local gid role name ue
  gid="$(gid_of "$THEME")"
  gql 'query FndThemeMeta($id: ID!) { theme(id: $id) { id name role } }' \
      "$(jq -n --arg id "$gid" '{id: $id}')" || return 1
  role="$(printf '%s' "$RESP" | jq -r '.data.theme.role // empty')"
  name="$(printf '%s' "$RESP" | jq -r '.data.theme.name // empty')"
  [ -n "$role" ] || { echo "error=theme_not_found theme=$gid" >&2; exit 5; }
  [ "$role" = "MAIN" ] && live_refuse "$name"
  gql 'mutation FndThemeFileSet($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $id, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message code }
    }
  }' "$(jq -n --arg id "$gid" --arg f "$FILE" --rawfile body "$FROM" \
        '{id: $id, files: [{filename: $f, body: {type: "TEXT", value: $body}}]}')" || return 1
  ue="$(printf '%s' "$RESP" | jq -c '.data.themeFilesUpsert.userErrors // []')"
  [ "$ue" = "[]" ] || { printf '%s\n' "$RESP"; echo "error=upsert_user_errors $ue" >&2; exit 5; }
  jq -nc --arg name "$name" --arg role "$role" --arg f "$FILE" \
    '{ok: "upserted", engine: "gql", theme: $name, role: $role, files: [$f]}'
}

# ----------------------------------------------------------- themecli engine --
DOMAIN=""
resolve_domain() {
  local s="$STORE_ARG"
  [ -z "$s" ] && s="${SHOPIFY_STORE:-}"
  if [ -z "$s" ] && [ -f "$TOML" ]; then
    s="$(grep -E '^[[:space:]]*store[[:space:]]*=' "$TOML" | grep -v '^[[:space:]]*#' | head -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*#.*$//; s/^"//; s/"$//')" || true
  fi
  [ -n "$s" ] || { echo "error=no_store (pass --store or set store= in $TOML)" >&2; exit 2; }
  case "$s" in *.myshopify.com) DOMAIN="$s" ;; *) DOMAIN="${s}.myshopify.com" ;; esac
}

# Theme Access token: env wins, else shopify.theme.toml (password=, else first shp*_…).
# Read internally and exported ONLY for the `shopify` subprocess — never printed.
cli_token_ready() {
  [ -n "${SHOPIFY_CLI_THEME_TOKEN:-}" ] && return 0
  [ -f "$TOML" ] || return 1
  local t
  t="$(grep -E '^[[:space:]]*password[[:space:]]*=' "$TOML" | grep -v '^[[:space:]]*#' | head -1 | sed -E 's/^[^"]*"([^"]*)".*/\1/')" || true
  [ -n "$t" ] || t="$(grep -oE 'shp[a-z]+_[A-Za-z0-9]+' "$TOML" | head -1)" || true
  [ -n "$t" ] || return 1
  export SHOPIFY_CLI_THEME_TOKEN="$t"
}

prep_cli() {
  command -v shopify >/dev/null 2>&1 || { echo "error=shopify_cli_not_found" >&2; exit 3; }
  resolve_domain
  cli_token_ready || {
    echo "error=no_theme_token (themecli engine needs SHOPIFY_CLI_THEME_TOKEN or a password=/shp*_ token in $TOML)" >&2
    exit 3; }
  if [ -n "$GQL_NOTE" ]; then
    echo "note=gql engine unavailable ($GQL_NOTE) — using the theme-CLI engine (Theme Access token)" >&2
  fi
}

CLI_LIST=""
cli_list() {
  local err rc=0; err="$(mktemp)"; CLEAN+=("$err")
  CLI_LIST="$(shopify theme list --store "$DOMAIN" --json --no-color 2>"$err")" || rc=$?
  if [ "$rc" -ne 0 ] || ! printf '%s' "$CLI_LIST" | jq empty >/dev/null 2>&1; then
    echo "error=cli_list_failed" >&2; tail -5 "$err" >&2; exit 5
  fi
}

cli_themes_lines() {
  cli_list
  printf '%s' "$CLI_LIST" | jq -c \
    '.[] | {id: ("gid://shopify/OnlineStoreTheme/" + (.id|tostring)), name,
            role: (if .role == "live" then "MAIN" else (.role|ascii_upcase) end)}' | role_filter
}

cli_get() {
  local nid tmp err
  nid="$(num_of "$THEME")"
  tmp="$(mktemp -d)"; err="$(mktemp)"; CLEAN+=("$tmp" "$err")
  shopify theme pull --store "$DOMAIN" --theme "$nid" --path "$tmp" \
      --only "$FILE" --nodelete --no-color >/dev/null 2>"$err" \
    || { echo "error=cli_pull_failed theme=$nid" >&2; tail -5 "$err" >&2; exit 5; }
  [ -f "$tmp/$FILE" ] || { echo "error=file_not_found file=$FILE theme=$nid (engine=themecli)" >&2; exit 5; }
  emit_file "$tmp/$FILE"
}

cli_set() {
  local nid role name tmp err out
  nid="$(num_of "$THEME")"
  cli_list
  role="$(printf '%s' "$CLI_LIST" | jq -r --arg id "$nid" '.[] | select((.id|tostring) == $id) | .role' | head -1)"
  name="$(printf '%s' "$CLI_LIST" | jq -r --arg id "$nid" '.[] | select((.id|tostring) == $id) | .name' | head -1)"
  [ -n "$role" ] || { echo "error=theme_not_found theme=$nid (engine=themecli)" >&2; exit 5; }
  [ "$role" = "live" ] && live_refuse "$name"
  tmp="$(mktemp -d)"; err="$(mktemp)"; CLEAN+=("$tmp" "$err")
  mkdir -p "$tmp/$(dirname "$FILE")"
  cp "$FROM" "$tmp/$FILE"
  out="$(shopify theme push --store "$DOMAIN" --theme "$nid" --path "$tmp" \
      --only "$FILE" --nodelete --json --no-color 2>"$err")" \
    || { echo "error=cli_push_failed theme=$nid" >&2; tail -8 "$err" >&2; exit 5; }
  jq -nc --arg name "$name" --arg role "$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]' | sed 's/^LIVE$/MAIN/')" --arg f "$FILE" \
    '{ok: "upserted", engine: "themecli", theme: $name, role: $role, files: [$f]}'
}

# ------------------------------------------------------------------ dispatch --
# run_op <gql_fn> <cli_fn>: engine dispatch with auto-fallback (gql fn returns 1 = fall back).
run_op() {
  if [ "$ENGINE" = "themecli" ]; then prep_cli; "$2"; return; fi
  if "$1"; then return; fi
  prep_cli; "$2"
}

case "$CMD" in
  themes)
    case "$ROLE_FILTER" in live|LIVE) ROLE_FILTER="MAIN" ;; esac
    run_op gql_themes_lines cli_themes_lines
    ;;
  get)
    [ -n "$THEME" ] && [ -n "$FILE" ] || { echo "error=usage (get needs --theme and --file)" >&2; exit 2; }
    gid_of "$THEME" >/dev/null   # validate id format HERE — inside $(…) an exit can't stop the flow
    run_op gql_get cli_get
    ;;
  set)
    [ -n "$THEME" ] && [ -n "$FILE" ] && [ -n "$FROM" ] || { echo "error=usage (set needs --theme, --file and --from)" >&2; exit 2; }
    gid_of "$THEME" >/dev/null
    [ -f "$FROM" ] || { echo "error=from_file_not_found file=$FROM" >&2; exit 2; }
    case "$FILE" in
      *.json)
        # theme JSON may carry /* … */ comments (Horizon ships an auto-generated banner in its
        # templates) — Shopify strips them, so validate the stripped variant before refusing
        if ! jq empty "$FROM" >/dev/null 2>&1; then
          if command -v perl >/dev/null 2>&1; then
            perl -0777 -pe 's{/\*.*?\*/}{}gs' "$FROM" 2>/dev/null | jq empty >/dev/null 2>&1 \
              || { echo "error=from_file_invalid_json file=$FROM" >&2; exit 2; }
          else
            echo "note=json_validation_skipped (no perl to strip /*…*/ comments)" >&2
          fi
        fi ;;
    esac
    run_op gql_set cli_set
    ;;
esac
