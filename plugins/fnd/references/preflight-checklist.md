# Preflight checklist — environment validation

Shared environment checklist for the Agentic Assisted Development workflows. The `preflight-checks`
skill runs the full pass; `develop-feature-or-fix` and `qa-feature-or-fix` link the **Local dev
server** item as their browser-validation prerequisite.

## Required CLI tools

| Tool        | Validation command | Used by |
| ----------- | ------------------ | ------- |
| Shopify CLI | `shopify version`  | dev / preview |
| Node.js     | `node -v`          | build / scripts |
| npm         | `npm -v`           | build / scripts |
| Git         | `git --version`    | all |
| GitHub CLI  | `gh --version`     | `create-pull-request` |

Report version numbers; flag anything missing or below known team minimums. The version commands
above are read-only (the `preflight-checks` skill pre-approves exactly these); any other shell
command still needs the developer's go-ahead.

Shopify CLI **≥ 4.x** additionally provides `shopify store execute` — the preferred engine for
Admin GraphQL work (`metafield-metaobject-setup.md`) and for theme-JSON/customizer state
(`theme-customizer-state.md`): stored `shopify store auth`, no admin token in the repo. An older CLI is a 🟡, not a blocker — the bundled runner falls back to the
`SHOPIFY_ADMIN_TOKEN` path automatically.

## MCP servers

For each, confirm it is installed, connected, and authenticated — **report real outcomes, never
fabricate a green check**:

- **Figma MCP** — design extraction (Dev Mode bridge running).
- **Chrome DevTools MCP** — attaches to a running browser for in-browser validation.
- **Atlassian MCP** — Jira (and Confluence) auth; optionally verify read access with a known ticket key.
- **Shopify Dev MCP** — smoke-test with `learn_shopify_api` (`api: "liquid"`).

On failure, report the **specific** error + remediation (auth, MCP config, server disabled).

## Project skills & rules

- Project skills are present under `.claude/skills/` (and any documented sync locations).
- The repo's coding rules / Foundation conventions are available. List anything missing and how to restore it.

## Local dev server

- Determine whether a theme/dev server is running (`npm run dev` — Turbo: `shopify theme dev -e dev`
  + Vite assets — or `npm run theme:shopify` for preview only).
- If not running, it must be started before any **in-browser validation** (develop / QA workflows).

## Report format

Summary table grouped by **IDE/workspace · MCP servers · CLI tools · project skills & rules · local
dev server**, status per row as **🟢 Pass / 🔴 Fail / 🟡 Warning** (exact values), with version or
connection detail. List blockers + remediation separately.
