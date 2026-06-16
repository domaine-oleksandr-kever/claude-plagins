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

# Canonical Shopify theme directories. We assemble ONLY these into a clean temp dir and
# push that (never `--path .`), so non-theme paths in the repo (multi-brand build sources,
# tmp/ artifacts, metaobjects-def.json, src/, schemas/, node_modules/, …) are physically
# absent from the push root. This is stricter than `--only` globs: Shopify's matcher is
# loose (e.g. `--only "snippets/**"` also re-captures nested multi-brand/**/snippets/*),
# so a whitelist glob leaks; a clean directory cannot. Repo-agnostic, no .shopifyignore
# dependency. Without this the CLI crashes parsing the API's rejection of an invalid asset.
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
EXTRA_IGN=()   # extra --ignore patterns passed through from the CLI (--ignore-extra)

# Temp dirs to clean up on exit (registered as they're created).
CLEAN_DIRS=()
cleanup() { for d in ${CLEAN_DIRS[@]+"${CLEAN_DIRS[@]}"}; do rm -rf "$d"; done; }
trap cleanup EXIT

# Assemble a clean push root containing only the canonical theme dirs (post-build).
# Uses APFS clonefile (cp -Rc, instant/zero-copy) with a plain-copy fallback. Echoes the
# temp path; the caller registers it for cleanup. The repo's .shopifyignore is carried
# along so any intentional excludes still apply.
assemble_theme() {
  local dest d; dest="$(mktemp -d)"
  for d in "${THEME_DIRS[@]}"; do
    if [ -e "$d" ]; then cp -Rc "$d" "$dest/" 2>/dev/null || cp -R "$d" "$dest/"; fi
  done
  if [ -f .shopifyignore ]; then cp .shopifyignore "$dest/" 2>/dev/null || true; fi
  printf '%s' "$dest"
}

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

# Apply the dev theme's customizer settings onto $1 (target theme id).
#   $2 = "true" if the theme pre-existed (--reuse), else we created it this run.
# The dev theme can be "ahead" of this branch — e.g. its templates/product.json
# references a block type whose schema lives only in another feature branch — and
# Shopify rejects the push of that template. A partial overlay would give a misleading
# preview, so on such DRIFT we stop cleanly: report the real cause, delete the code-only
# theme we just created (nothing half-built left behind), and exit error=settings_drift.
# The caller then asks the developer to duplicate the dev theme MANUALLY in the Shopify
# admin (a server-side copy keeps every setting, even drifted ones) and pass theme args.
# stderr is captured, never swallowed.
overlay_settings() {
  local target="$1" reused="$2" tmp perr reason deleted
  tmp="$(mktemp -d)"; CLEAN_DIRS+=("$tmp")
  perr="$(mktemp)"
  if ! shopify theme pull --store "$STORE" --theme "$DEV_THEME_ID" --path "$tmp" "${ONLY[@]}" --nodelete >/dev/null 2>"$perr"; then
    ERR="$perr"; push_fail overlay_pull_failed
  fi
  if shopify theme push --store "$STORE" --theme "$target" --path "$tmp" --nodelete "${ONLY[@]}" >/dev/null 2>"$perr"; then
    rm -f "$perr"; return 0   # no drift — settings applied
  fi
  # Drift: settings reference code not present in this branch. Surface + bail to manual.
  reason="$(grep -iE 'must be defined|invalid value|could not be synced|invalid' "$perr" | head -1 | sed -E 's/^[[:space:]]*//')"
  [ -n "$reason" ] || reason="$(grep -iE 'error' "$perr" | head -1 | sed -E 's/^[[:space:]]*//')"
  deleted="no"
  if [ "$reused" != "true" ]; then
    if shopify theme delete --store "$STORE" --theme "$target" --force >/dev/null 2>&1; then deleted="yes"; else deleted="failed"; fi
  fi
  printf 'error=settings_drift\n'
  printf 'cause=%s\n' "${reason:-the dev theme references code not present in this branch}"
  printf 'dev_theme_id=%s\n' "$DEV_THEME_ID"
  printf 'created_theme=%s\n' "$target"
  printf 'created_theme_deleted=%s\n' "$deleted"
  printf 'log=%s\n' "$perr"
  printf -- '--- last 25 lines of shopify stderr ---\n'
  tail -n 25 "$perr"
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
    TMP_CODE="$(assemble_theme)"; CLEAN_DIRS+=("$TMP_CODE")

    # 1) push the built local code (settings ignored) to a new/existing theme.
    EXISTING=""; REUSED=false
    [ "$REUSE" -eq 1 ] && EXISTING="$(theme_id_by_name "$NAME")"

    ERR="$(mktemp)"
    # ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} expands to nothing when empty (bash-3.2 set -u safe).
    if [ -n "$EXISTING" ]; then
      OUT="$(shopify theme push --store "$STORE" --theme "$EXISTING" --path "$TMP_CODE" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")" \
        || push_fail push_code_failed_reuse
      REUSED=true
    else
      if ! OUT="$(shopify theme push --store "$STORE" --unpublished --theme "$NAME" --path "$TMP_CODE" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")"; then
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
    #    On drift this exits error=settings_drift (and removes the just-created theme).
    overlay_settings "$THEME_ID" "$REUSED"

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
    TMP_CODE="$(assemble_theme)"; CLEAN_DIRS+=("$TMP_CODE")

    ERR="$(mktemp)"
    if ! OUT="$(shopify theme push --store "$STORE" --theme "$TARGET" --path "$TMP_CODE" "${IGN[@]}" ${EXTRA_IGN[@]+"${EXTRA_IGN[@]}"} --json 2>"$ERR")"; then
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
