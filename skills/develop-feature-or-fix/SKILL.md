---
name: develop-feature-or-fix
description: >
  Implement a feature or fix from an approved Technical Approach, a validated Jira ticket, and Figma
  designs — Workflow 3 of the Agentic Assisted Development series. Plans from the TA + Figma node,
  gets plan approval, then implements with in-browser validation. Use when the user asks to develop,
  implement, or build a feature/fix from a Jira ticket and design, or invokes /develop-feature-or-fix.
argument-hint: "<jira-url-or-key> [figma-node-url]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
  - name: figma_url
    description: Figma URL with the node id for the relevant frame/component. Ask if missing or node-less.
---

# Develop Feature or Fix (Jira + Figma)

Implement a feature or fix with an approved Technical Approach, validated ticket, and design references. **Do not skip the ✋ checkpoints.**

Series position: Workflow 3 — runs after `write-technical-approach`, before `qa-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** (`jira_ticket`).
- Confirmation that **Description**, **Acceptance Criteria**, **Technical Approach**, and a **Figma URL with a node** are on the ticket.

## Operating mode

- **Phase 1 — Analysis & planning:** **plan mode** — ingest ticket + designs, align with the TA, produce an implementation plan.
- **Phase 2 — Implementation:** leave plan mode after the engineer approves the plan.

## Global rules

- **Never proceed past a ✋ checkpoint** without explicit engineer confirmation.
- **Atlassian MCP** for Jira; **Figma MCP** for design extraction; **Chrome DevTools MCP** for in-browser validation when the preview is running.
- **Browser-MCP prerequisite:** the local dev server must be running (see `${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md` → Local dev server). Confirm before validation.
- Respect the repo's coding rules. **Extend — never directly modify** `src/entry/core/*` JS/TS; prefer extending or composing core Liquid blocks/snippets per project conventions.

---

## Phase 1 — Analysis & planning `[plan mode]`

1. **Ingest the Jira ticket** via Atlassian MCP. **Context-first:** if the conversation context already contains *all* required fields (Description, AC, Technical Approach, Figma URL) in full — not summarized or truncated, e.g. from an earlier skill run or a pasted ticket — use that and **skip the Atlassian MCP fetch**; call MCP only for fields that are missing or partial. To locate the fields (Description, AC, Assumptions, Technical Approach, Documentation Links, Steps to test), follow `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` (verified field IDs + `expand: "names"` fallback + ADF parsing). If a required field returns `null` after discovery, it is genuinely empty — warn the engineer.
2. **Validate readiness** — if any are missing, **stop** and warn: Description, Acceptance Criteria, Technical Approach, Figma URL pointing to a **specific node**.
3. **Analyse the codebase** — map current implementation to the TA + AC; note files to change, new files, schema/locale impacts, manual checks.
4. **Analyse Figma** — load the file/node via Figma MCP. If the URL has no node id or scope is unclear, **ask** for the correct link.
5. **Interview the engineer until you reach shared understanding** — walk down each branch of the design tree, resolving dependencies between decisions one-by-one. **Ask questions one at a time**, and **for each, give your recommended answer**. If a question can be answered by exploring the codebase, **explore the codebase instead of asking**.
6. **Create the implementation plan** — informed by the interview: ordered, reviewable steps; files/components/metafields/settings to add or change; call out deviations from the TA and why.

### ✋ Checkpoint — Phase 1

Present the **implementation plan** and wait for **explicit approval** before writing production code.

---

## Phase 2 — Implementation

1. **Implement** step by step after confirmation — reference Figma via MCP while building; follow the TA, AC, Foundation rules, Liquid/block patterns, Tailwind/token usage. Pause at logical milestones for review if the change is large or risky. **`git add` every newly created file immediately after creating it** (snippet, section, `src/entry/*`, locale, doc) so nothing referenced by the code is left untracked.
2. **In-browser validation** — use Chrome DevTools MCP to verify UI against design and AC (layout, breakpoints, console errors). If the dev server isn't running, say what to start and retry when ready.
3. **Iterative review** — accept course corrections; don't argue past scope — surface tradeoffs instead.

## Quality bar

- Meets AC and TA.
- Matches design intent (dimensions, spacing, typography, states).
- Accessibility (WCAG 2.2 AA minimum; stricter project rules where they apply) and performance considered.
- No secrets in code; no broad unsafe refactors.
