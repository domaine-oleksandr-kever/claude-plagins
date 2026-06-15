#!/usr/bin/env bash
#
# create-preview-theme.sh — duplicate the configured dev theme into a named,
# unpublished PREVIEW theme for the fnd `create-pull-request` skill.
#
# WHY a script (not a subagent): the flow is deterministic, and the Theme Access
# token lives in shopify.theme.toml. This script reads the token straight into
# the `shopify` subprocess env so it NEVER enters Claude's context, and it never
# prints the token. The calling skill must NOT read shopify.theme.toml itself.
#
# It does a real server-side duplicate without admin API / themeDuplicate
# (which is gated): pull the configured dev theme to a temp dir, then push it
# back as a new unpublished theme — so all customizer settings are preserved.
#
# Config source (project root, or $TOML_PATH): shopify.theme.toml
#   - dev theme id : the UNCOMMENTED `theme = "..."` line (commented variants ignored)
#   - store        : the UNCOMMENTED `store = "..."` line
#   - token        : `password = "..."`, else first shp*_… token in the file
#
# Usage:
#   create-preview-theme.sh info
#       → prints: store=… dev_theme_id=… dev_theme_name=…   (no mutation)
#   create-preview-theme.sh create --name "<NEW THEME NAME>" [--reuse]
#       → pull dev theme → push as unpublished (or reuse same-named theme)
#       → prints: theme_id=… name=… store=… preview_url=… editor_url=… reused=true|false
#
# Output is `key=value` lines on stdout. Errors print `error=<reason>` and exit non-zero.
# Requires: shopify CLI, jq.

set -euo pipefail

TOML="${TOML_PATH:-shopify.theme.toml}"

fail() { printf 'error=%s\n' "$1"; exit 1; }

command -v shopify >/dev/null 2>&1 || fail "shopify CLI not found on PATH"
command -v jq >/dev/null 2>&1 || fail "jq not found on PATH (install: brew install jq)"
[ -f "$TOML" ] || fail "config not found: $TOML (run from the project root, or set TOML_PATH)"

# --- parse shopify.theme.toml (token is read but NEVER printed) ---------------
# Uncommented value of `<key> = "<value>"`: drop lines whose first non-space char is '#'.
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

# Find a theme's name by id (best-effort; empty if list fails / id absent).
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
        *) fail "unknown arg: $1" ;;
      esac
    done
    [ -n "$NAME" ] || fail "create requires --name \"<new theme name>\""

    # Pull the configured dev theme (code + settings_data + JSON templates) to a
    # temp dir so the working tree is never touched, then push it as a new theme.
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    shopify theme pull --store "$STORE" --theme "$DEV_THEME_ID" --path "$TMP" >/dev/null 2>&1 \
      || fail "pull failed for dev theme $DEV_THEME_ID (check store/token/theme id)"

    REUSED=false
    EXISTING=""
    [ "$REUSE" -eq 1 ] && EXISTING="$(theme_id_by_name "$NAME")"

    if [ -n "$EXISTING" ]; then
      OUT="$(shopify theme push --store "$STORE" --theme "$EXISTING" --path "$TMP" --json 2>push_err.log)" \
        && REUSED=true || { printf 'error=push_failed_reuse '; sed -n '1,3p' push_err.log; rm -f push_err.log; exit 1; }
      rm -f push_err.log
    else
      if ! OUT="$(shopify theme push --store "$STORE" --unpublished --theme "$NAME" --path "$TMP" --json 2>push_err.log)"; then
        if grep -qiE 'limit|maximum|too many' push_err.log; then
          rm -f push_err.log
          fail "theme_limit — store is at its theme cap (20 non-Plus / 100 Plus). Delete an old theme or re-run with --reuse."
        fi
        printf 'error=push_failed '; sed -n '1,3p' push_err.log; rm -f push_err.log; exit 1
      fi
      rm -f push_err.log
    fi

    THEME_ID="$(printf '%s' "$OUT" | jq -r '.. | objects | .id? // empty' | head -1)"
    PREVIEW="$(printf '%s' "$OUT" | jq -r '.. | objects | .preview_url? // empty' | head -1)"
    EDITOR="$(printf '%s' "$OUT" | jq -r '.. | objects | .editor_url? // empty' | head -1)"
    [ -n "$THEME_ID" ] || fail "push succeeded but could not parse theme id from --json output"

    printf 'theme_id=%s\n' "$THEME_ID"
    printf 'name=%s\n' "$NAME"
    printf 'store=%s\n' "$STORE"
    printf 'preview_url=%s\n' "$PREVIEW"
    printf 'editor_url=%s\n' "$EDITOR"
    printf 'reused=%s\n' "$REUSED"
    ;;

  *)
    fail "usage: create-preview-theme.sh info | create --name \"<name>\" [--reuse]"
    ;;
esac