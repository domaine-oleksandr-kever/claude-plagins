#!/usr/bin/env bash
#
# create-preview-theme.sh — build an unpublished Shopify PREVIEW theme for the fnd
# `create-pull-request` / `create-preview-theme` skills.
#
# MODEL: a preview = YOUR branch's CODE (built locally) + the dev theme's CUSTOMIZER
# SETTINGS. Code always comes from the local repo (so fixes in the branch show up);
# only the customizer content is copied from the configured dev theme. This avoids
# cloning stale/broken code that happens to live on the dev theme.
#
# "Settings" preserved from the dev theme (everything else is code, from the repo):
#   - config/settings_data.json      (theme settings)
#   - templates/**/*.json            (per-template section config)
#   - sections/*.json                (section groups: header/footer/etc.)
#
# WHY a script (not a subagent): deterministic, and the Theme Access token lives in
# shopify.theme.toml. This reads the token straight into the `shopify` subprocess so it
# NEVER enters Claude's context and is never printed. The calling skill must NOT read
# shopify.theme.toml itself.
#
# Config source (project root, or $TOML_PATH): shopify.theme.toml
#   - dev theme id : the UNCOMMENTED `theme = "..."` line (commented variants ignored)
#   - store        : the UNCOMMENTED `store = "..."` line
#   - token        : `password = "..."`, else first shp*_… token in the file
#
# Subcommands:
#   info
#       → store=… dev_theme_id=… dev_theme_name=…                       (no mutation)
#   create --name "<NAME>" [--reuse] [--no-build] [--build-cmd "<cmd>"]
#       → build repo → push code (settings ignored) to a new unpublished theme
#         (or an existing same-named one with --reuse) → overlay dev-theme settings
#       → theme_id=… name=… store=… preview_url=… editor_url=… reused=… built=…
#   refresh --theme <ID> [--no-build] [--build-cmd "<cmd>"]
#       → build repo → push CODE ONLY to <ID>, leaving its customizer settings intact
#         (reuse this when a preview theme's code broke and needs a redeploy)
#       → theme_id=… store=… preview_url=… editor_url=… built=…
#
# Output is `key=value` lines on stdout. Errors print `error=<reason>` and exit non-zero.
# Requires: shopify CLI, jq; npm for the default build.

set -euo pipefail

TOML="${TOML_PATH:-shopify.theme.toml}"

# Customizer content copied from the dev theme; everything else is code from the repo.
SETTINGS_PATTERNS=(
  "config/settings_data.json"
  "templates/*.json"
  "templates/**/*.json"
  "sections/*.json"
)

# Canonical Shopify theme directories. We push ONLY these (a whitelist), so non-theme
# paths in the repo (multi-brand build sources, tmp/ artifacts, metaobjects-def.json,
# src/, schemas/, node_modules/, …) are never sent — regardless of the repo's
# .shopifyignore. Without this, `theme push --path .` scans them and the CLI crashes
# parsing the API's rejection of an invalid asset.
THEME_DIRS=( assets blocks config layout locales sections snippets templates )

fail() { printf 'error=%s\n' "$1"; exit 1; }

command -v shopify >/dev/null 2>&1 || fail "shopify CLI not found on PATH"
command -v jq >/dev/null 2>&1 || fail "jq not found on PATH (install: brew install jq)"
[ -f "$TOML" ] || fail "config not found: $TOML (run from the project root, or set TOML_PATH)"

# --- parse shopify.theme.toml (token is read but NEVER printed) ---------------
toml_value() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$TOML" \
    | grep -vE '^[[:space:]]*#' \
    | head -1 \
    | sed -E 's/^[^"]*"([^"]*)".*/\1/'
}

DEV_THEME_ID="$(toml_value theme || true)"
STORE="$(toml_value store || true)"
TOKEN="$(toml_value password || true)"
[ -n "${TOKEN:-}" ] || TOKEN="$(grep -oE 'shp[a-z]+_[A-Za-z0-9]+' "$TOML" | head -1 || true)"

[ -n "${DEV_THEME_ID:-}" ] || fail "no uncommented \`theme = \"...\"\` line in $TOML"
[ -n "${STORE:-}" ]        || fail "no uncommented \`store = \"...\"\` line in $TOML"
[ -n "${TOKEN:-}" ]        || fail "no access token (password / shp*_…) found in $TOML"

export SHOPIFY_CLI_THEME_TOKEN="$TOKEN"   # consumed by `shopify`; never echoed

# --- helpers ------------------------------------------------------------------
# Build flag arrays portably (bash 3.2 on macOS has no mapfile).
IGN=(); for p in "${SETTINGS_PATTERNS[@]}"; do IGN+=(--ignore "$p"); done   # settings to skip on code push
ONLY=(); for p in "${SETTINGS_PATTERNS[@]}"; do ONLY+=(--only "$p"); done   # settings-only, for the overlay
# Restrict code pushes to real theme dirs (flat + nested). Composes with --ignore.
ONLY_THEME=(); for d in "${THEME_DIRS[@]}"; do ONLY_THEME+=(--only "$d/*" --only "$d/**"); done
EXTRA_IGN=()   # extra --ignore patterns passed through from the CLI (--ignore-extra)

theme_name_by_id() {
  shopify theme list --store "$STORE" --json 2>/dev/null \
    | jq -r --arg id "$1" '.. | objects | select((.id|tostring)==$id) | .name' 2>/dev/null \
    | head -1 || true
}
theme_id_by_name() {
  shopify theme list --store "$STORE" --json 2>/dev/null \
    | jq -r --arg n "$1" '.. | objects | select(.name==$n) | .id' 2>/dev/null \
    | head -1 || true
}
json_field() { printf '%s' "$1" | jq -r --arg f "$2" '.. | objects | .[$f]? // empty' | head -1; }

# Report a push failure with the REAL cause, not a truncated trace. Keeps the full
# stderr log (in $ERR) and points to it, plus shows the last 25 lines inline. Shopify
# crashes ("undefined method 'dig' for nil") when an invalid asset is rejected — the
# offending file is named a few lines above the ruby trace, so show enough context.
push_fail() {
  printf 'error=%s\n' "$1"
  printf 'log=%s\n' "$ERR"
  printf -- '--- last 25 lines of shopify stderr ---\n'
  tail -n 25 "$ERR"
  exit 1
}

NO_BUILD=0
BUILD_CMD="npm run build"
BUILT="no"
run_build() {
  [ "$NO_BUILD" -eq 1 ] && { BUILT="skipped"; return 0; }
  local log; log="$(mktemp)"
  if ( eval "$BUILD_CMD" ) >"$log" 2>&1; then
    BUILT="yes"; rm -f "$log"
  else
    printf 'error=build_failed (%s):\n' "$BUILD_CMD"; tail -n 5 "$log"; rm -f "$log"; exit 1
  fi
}

MODE="${1:-}"; shift || true

case "$MODE" in
  info)
    printf 'store=%s\n' "$STORE"
    printf 'dev_theme_id=%s\n' "$DEV_THEME_ID"
    printf 'dev_theme_name=%s\n' "$(theme_name_by_id "$DEV_THEME_ID")"
    ;;

  create)
    NAME=""; REUSE=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --name) NAME="${2:-}"; shift 2 ;;
        --reuse) REUSE=1; shift ;;
        --no-build) NO_BUILD=1; shift ;;
        --build-cmd) BUILD_CMD="${2:-}"; shift 2 ;;
        --ignore-extra) EXTRA_IGN+=(--ignore "${2:-}"); shift 2 ;;
        *) fail "unknown arg: $1" ;;
      esac
    done
    [ -n "$NAME" ] || fail "create requires --name \"<new theme name>\""

    run_build

    # 1) push the built local code (settings ignored) to a new/existing theme.
    EXISTING=""; REUSED=false
    [ "$REUSE" -eq 1 ] && EXISTING="$(theme_id_by_name "$NAME")"

    ERR="$(mktemp)"
    # ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} expands to nothing when empty (bash-3.2 set -u safe).
    if [ -n "$EXISTING" ]; then
      OUT="$(shopify theme push --store "$STORE" --theme "$EXISTING" --path . "${ONLY_THEME[@]}" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")" \
        || push_fail push_code_failed_reuse
      REUSED=true
    else
      if ! OUT="$(shopify theme push --store "$STORE" --unpublished --theme "$NAME" --path . "${ONLY_THEME[@]}" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")"; then
        grep -qiE 'limit|maximum|too many' "$ERR" \
          && { rm -f "$ERR"; fail "theme_limit — store is at its theme cap (20 non-Plus / 100 Plus). Delete an old theme or re-run with --reuse."; }
        push_fail push_code_failed
      fi
    fi
    rm -f "$ERR"

    THEME_ID="$(json_field "$OUT" id)"
    PREVIEW="$(json_field "$OUT" preview_url)"
    EDITOR="$(json_field "$OUT" editor_url)"
    [ -n "$THEME_ID" ] || fail "code push succeeded but could not parse theme id from --json"

    # 2) overlay the dev theme's customizer settings onto the new theme.
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    shopify theme pull --store "$STORE" --theme "$DEV_THEME_ID" --path "$TMP" "${ONLY[@]}" --nodelete >/dev/null 2>&1 \
      || fail "pull of dev-theme settings failed (dev theme id $DEV_THEME_ID)"
    shopify theme push --store "$STORE" --theme "$THEME_ID" --path "$TMP" --nodelete "${ONLY[@]}" >/dev/null 2>&1 \
      || fail "overlay of dev-theme settings onto $THEME_ID failed"

    printf 'theme_id=%s\n' "$THEME_ID"
    printf 'name=%s\n' "$NAME"
    printf 'store=%s\n' "$STORE"
    printf 'preview_url=%s\n' "$PREVIEW"
    printf 'editor_url=%s\n' "$EDITOR"
    printf 'reused=%s\n' "$REUSED"
    printf 'built=%s\n' "$BUILT"
    ;;

  refresh)
    TARGET=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --theme) TARGET="${2:-}"; shift 2 ;;
        --no-build) NO_BUILD=1; shift ;;
        --build-cmd) BUILD_CMD="${2:-}"; shift 2 ;;
        --ignore-extra) EXTRA_IGN+=(--ignore "${2:-}"); shift 2 ;;
        *) fail "unknown arg: $1" ;;
      esac
    done
    [ -n "$TARGET" ] || fail "refresh requires --theme <existing theme id>"

    run_build

    ERR="$(mktemp)"
    if ! OUT="$(shopify theme push --store "$STORE" --theme "$TARGET" --path . "${ONLY_THEME[@]}" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")"; then
      push_fail refresh_push_failed
    fi
    rm -f "$ERR"

    printf 'theme_id=%s\n' "$(json_field "$OUT" id)"
    printf 'store=%s\n' "$STORE"
    printf 'preview_url=%s\n' "$(json_field "$OUT" preview_url)"
    printf 'editor_url=%s\n' "$(json_field "$OUT" editor_url)"
    printf 'built=%s\n' "$BUILT"
    ;;

  *)
    fail "usage: create-preview-theme.sh info | create --name \"<name>\" [--reuse] [--no-build] [--build-cmd \"<cmd>\"] | refresh --theme <id> [--no-build] [--build-cmd \"<cmd>\"]"
    ;;
esac
