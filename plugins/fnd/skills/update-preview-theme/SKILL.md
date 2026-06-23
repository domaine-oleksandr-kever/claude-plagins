---
name: update-preview-theme
description: >
  Redeploy your branch's code into an EXISTING unpublished preview theme — rebuilds locally and
  pushes code only, leaving the theme's customizer settings untouched. Use when a preview theme's
  code is broken or stale and needs a fresh build (e.g. after a fix), so reviewers see the update
  without losing the configured content. A thin wrapper around create-preview-theme.sh `refresh`.
  Use when the user asks to update / refresh / redeploy / rebuild a preview theme, push a fix to an
  existing preview, or invokes /update-preview-theme. To make a NEW preview theme, use
  create-preview-theme.
argument-hint: "<theme-id> [--no-build] [--build-cmd \"<cmd>\"]"
arguments:
  - name: theme_id
    description: Numeric id of the existing preview theme to update. Find it in the PR preview table, the preview URL (`?preview_theme_id=<id>`), or the admin theme URL (`/themes/<id>`). Ask if not provided.
  - name: build_cmd
    description: Override the build command (default `npm run build`). Optional.
  - name: no_build
    description: Skip the build if the developer already built locally. Optional.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh*)
---

# Update preview theme

Redeploy the **current branch's code** into an existing unpublished preview theme **without
touching its customizer settings**. The script rebuilds (`npm run build`) and pushes everything
**except** `config/settings_data.json`, `templates/**/*.json`, and section groups `sections/*.json`
— so the configured content the reviewer set up stays put while the code is refreshed. This is the
fix-and-redeploy counterpart to `create-preview-theme`; both wrap
`${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh`.

> **Security:** the Theme Access token lives in `shopify.theme.toml`. **Never `Read` that file** —
> the script consumes the token inside the `shopify` subprocess and never prints it.

## Steps

1. **Identify the theme.** Need the target preview theme's numeric `theme_id`. If the developer
   didn't give it, **ask** (point them to the PR preview table, the `?preview_theme_id=<id>` in the
   preview URL, or `/themes/<id>` in the admin URL). Do not guess.
2. **Confirm before mutating.** This rebuilds and overwrites the theme's **code** (settings are
   preserved). Show the target id and `[ update / cancel ]`. Proceed only on explicit confirmation.
3. **Refresh.** Run `${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh refresh --theme <id>`
   (add `--no-build` if already built, or `--build-cmd "<cmd>"` for a non-default build).
   - **`error=build_failed`** → surface the build output and stop.
   - **Other `error=`** (no `shopify.theme.toml`, missing `shopify`/`jq`, push failure) → report it
     plainly with the fix; don't read the toml yourself.
4. **Report.** Print the returned `theme_id`, `preview_url`, `editor_url`, and `built`. Remind the
   developer that customizer settings were intentionally left as-is.

## Quality bar

- Never expose the access token; never read `shopify.theme.toml` directly.
- Always confirm before overwriting a theme's code.
- Report exactly what the script returned — don't invent URLs the script didn't produce.
