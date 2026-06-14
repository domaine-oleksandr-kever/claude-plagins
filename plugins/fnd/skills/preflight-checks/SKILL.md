---
name: preflight-checks
description: >
  Validate the local environment — MCP servers, CLI tools, workspace/project context, project
  skills & rules, and the local dev server — before running the other Agentic Assisted Development
  workflows. Workflow 1 of the series; run at session start or when switching projects. Produces a
  grouped pass/fail report and flags blockers. Use when the user asks to run preflight / environment
  checks, validate tooling or MCP connectivity before starting work, or invokes /preflight-checks.
argument-hint: "(no args — validates the current workspace)"
arguments:
  - name: workspace
    description: Project root to validate. Defaults to the current workspace; confirm it is the intended one.
allowed-tools: Read, Glob, Bash(shopify version), Bash(node -v), Bash(npm -v), Bash(git --version), Bash(gh --version)
---

# Preflight Checks

Confirm required tooling is installed, configured, and authenticated so you don't hit failures mid-workflow. After this passes, the environment is cleared for Workflows 2–6. **Do not skip the ✋ checkpoint.**

Series position: Workflow 1 — runs before everything else.

## Inputs (ask if missing)

- Confirm the **workspace** is the intended project root (`workspace` argument).

## Operating mode

- **Phase 1 — Environment validation:** **plan mode** — check workspace, MCP connectivity, CLIs, project skills/rules, and the dev server.
- **Phase 2 — Report & confirmation:** consolidate results, flag blockers, get engineer sign-off.

## Global rules

- **Never proceed past the ✋ checkpoint** without explicit engineer confirmation.
- For MCP checks, use the available MCP tools and **report real connection/auth outcomes — do not fabricate success**.
- Shell version commands require **engineer approval** before running in the agent environment.

---

## Phase 1 — Environment validation `[plan mode]`

Run the full checklist in `${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md`:

1. **Workspace / IDE** — confirm the active workspace matches the target project; remind the engineer to verify IDE/MCP security settings against team policy.
2. **MCP servers** — Figma, Chrome DevTools, Atlassian, Shopify Dev: confirm installed + authenticated; on failure report the specific error + remediation.
3. **CLI tools** — run (or ask the engineer to run) the version commands; record versions; flag missing / outdated.
4. **Project skills & rules** — confirm `.claude/skills/` and the repo's coding rules are present; list anything missing + how to restore.
5. **Local dev server** — determine whether `npm run dev` (or `npm run theme:shopify`) is running; if not, remind the engineer to start it before the develop / QA workflows (they need in-browser validation).

---

## Phase 2 — Report & confirmation

1. **Generate the report** — summary table grouped by IDE/workspace · MCP servers · CLI tools · project skills & rules · local dev server; status per row as **🟢 Pass / 🔴 Fail / 🟡 Warning** with version/connection detail.
2. **Flag blockers** — list critical failures + remediation; state clearly that downstream workflows should wait until critical items pass.

### ✋ Checkpoint

Present the report. Once the engineer confirms issues are resolved or accepted, the environment is cleared for Workflows 2–6.

## Quality bar

- Honest status — no assumed green checks.
- Actionable remediation for every failure.
- Compact table suitable for pasting into a ticket or session notes.
