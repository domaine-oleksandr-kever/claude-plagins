---
name: create-preview-theme
description: >
  Create (or refresh) an unpublished Shopify PREVIEW theme by duplicating the configured dev
  theme — a standalone wrapper around the create-preview-theme.sh script, useful for testing the
  preview-theme mechanics outside the full PR flow. Reads store / dev-theme-id / Theme Access
  token from shopify.theme.toml (never exposing the token), pulls the dev theme and pushes it
  unpublished, then returns the theme id + preview / editor links. Use when the user asks to
  create / make / spin up a preview theme, duplicate the dev theme, or test the preview script,
  or invokes /create-preview-theme.
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

Duplicate the configured **dev theme** into a named, **unpublished** preview theme — so its
customizer settings are preserved (a real server-side-equivalent duplicate done via the CLI,
not `themeDuplicate`). This skill is a thin wrapper over
`${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/scripts/create-preview-theme.sh`; the same
script `create-pull-request` uses, so running this is a good way to **test the mechanics in
isolation**. See `${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/REFERENCE.md → Preview theme`
for the full contract.

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
3. **Confirm before mutating.** This creates a real theme on the store. Show the final name and
   `[ create / reuse existing / cancel ]`. Proceed only on explicit confirmation.
4. **Create.** Run `create-preview-theme.sh create --name "<name>"` (add `--reuse` if the developer
   chose to refresh an existing same-named theme). On `error=theme_limit`, tell the developer the
   store is at its cap (20 non-Plus / 100 Plus) and offer `--reuse` or deleting an old theme.
5. **Report.** Print the resulting `theme_id`, `preview_url`, `editor_url`, and whether it was
   `reused`. If a `preview_path` is known, also give the page-deep-linked preview
   (`<preview_url-origin>/<path>?preview_theme_id=<id>`) and the editor-on-template link
   (`…/editor?previewPath=<url-encoded path>`).

## Quality bar

- Never expose the access token; never read `shopify.theme.toml` directly.
- Always confirm before creating/overwriting a theme.
- Report exactly what the script returned — don't invent URLs the script didn't produce.
