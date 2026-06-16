---
name: create-preview-theme
description: >
  Create an unpublished Shopify PREVIEW theme from your branch — builds the local code and
  overlays the dev theme's customizer settings, so the preview shows YOUR (fixed) code with
  realistic content. A standalone wrapper around create-preview-theme.sh, also handy for testing
  the mechanics outside the full PR flow. Reads store / dev-theme-id / Theme Access token from
  shopify.theme.toml (never exposing the token) and returns the theme id + preview / editor links.
  Use when the user asks to create / make / spin up a preview theme or test the preview script, or
  invokes /create-preview-theme. To redeploy code into an EXISTING preview theme, use
  update-preview-theme.
argument-hint: "[jira-keys] [theme-name] [--reuse] [preview-path]"
arguments:
  - name: jira_keys
    description: One or more Jira keys/numbers used to name the theme (e.g. ELC-126, or "299 307 309"). Optional — only used to derive the name when no explicit theme name is given.
  - name: theme_name
    description: Explicit preview theme name. Optional — overrides name derivation from jira_keys.
  - name: reuse
    description: If set, refresh an existing same-named theme instead of creating a new duplicate (avoids hitting the store theme cap).
  - name: preview_path
    description: Storefront path to deep-link the preview to (e.g. /products/group-lipglass). Optional.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/scripts/create-preview-theme.sh*)
---

# Create preview theme

Build a named, **unpublished** preview theme = **your branch's code (built locally)** + the
**dev theme's customizer settings**. Code comes from the repo (so the fixes in your branch show
up); only the settings (`config/settings_data.json`, `templates/**/*.json`, section groups
`sections/*.json`) are copied from the configured dev theme. This deliberately does **not** clone
the dev theme's code — that code may be stale or broken. This skill is a thin wrapper over
`${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/scripts/create-preview-theme.sh` (the same
script `create-pull-request` uses), so running it is a good way to **test the mechanics in
isolation**. To redeploy code into an existing preview theme without touching its settings, use
**`update-preview-theme`** (the script's `refresh` mode). See
`${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/REFERENCE.md → Preview theme` for the full contract.

> **Security:** the Theme Access token lives in `shopify.theme.toml`. **Never `Read` that file** —
> the script consumes the token inside the `shopify` subprocess and never prints it. Pass nothing
> secret on the command line.

## Steps

1. **Detect.** Run `create-preview-theme.sh info`.
   - **Any `error=` line** (no `shopify.theme.toml`, missing `shopify`/`jq`, unparseable config) →
     report it plainly and stop with the fix (run from the project root / install jq / uncomment a
     `theme = "…"` line). Don't try to read the toml yourself.
   - **Success** → show the detected `store`, `dev_theme_id`, and `dev_theme_name`.
2. **Decide the name.**
   - If `theme_name` was given, use it verbatim.
   - Else if `jira_keys` were given, derive it by swapping the `[DEV]`/role prefix of
     `dev_theme_name` for the key(s): one key → `[ELC-126] Kever | Domaine`; several → one bracket,
     prefix once, numbers slash-separated → `[ELC-299/307/309] Kever | Domaine`.
   - Else **ask** the developer for the name (or the ticket key(s) to derive it).
3. **Confirm before mutating.** This builds the repo and creates a real theme on the store. Show
   the final name and `[ create / reuse existing / cancel ]`. Proceed only on explicit confirmation.
4. **Create.** Run `create-preview-theme.sh create --name "<name>"` (add `--reuse` to push into an
   existing same-named theme instead of making a new one). The script runs `npm run build`, pushes
   the built code (settings ignored), then overlays the dev theme's settings — pass `--no-build` if
   the developer already built, or `--build-cmd "<cmd>"` for a non-default build. On
   `error=theme_limit`, the store is at its cap (20 non-Plus / 100 Plus) — offer `--reuse` or
   deleting an old theme. On `error=build_failed`, surface the build output and stop.
5. **Report.** Print the resulting `theme_id`, `preview_url`, `editor_url`, `reused`, and `built`.
   If a `preview_path` is known, also give the page-deep-linked preview
   (`<preview_url-origin>/<path>?preview_theme_id=<id>`) and the editor-on-template link
   (`…/editor?previewPath=<url-encoded path>`).
   - On **`error=settings_drift`** the dev theme is **ahead of this branch** — its customizer content
     references a block/template type whose schema lives only in another feature branch, so Shopify
     won't accept those settings onto a preview built from this branch's code. The script reports the
     real `cause=` and deletes the code-only theme it just made (`created_theme_deleted=yes`), so
     nothing half-built is left. **Don't retry** — it'll hit the same wall. Tell the developer to
     **duplicate the dev theme manually** in the Shopify admin (Online Store → Themes → ⋯ on
     `[DEV] …` → Duplicate — a server-side copy keeps every setting, even drifted ones) and rename it
     to the `[ELC-…]` name; the preview URL is then `…/?preview_theme_id=<the new id>`.

## Quality bar

- Never expose the access token; never read `shopify.theme.toml` directly.
- Always confirm before creating/overwriting a theme.
- Report exactly what the script returned — don't invent URLs the script didn't produce.
