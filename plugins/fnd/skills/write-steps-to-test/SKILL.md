---
name: write-steps-to-test
description: >
  Produce Steps to Test for a Jira ticket in Domaine's standard format — Workflow 5 of the Agentic
  Assisted Development series. Ingests the ticket + implementation context, maps each AC to test
  scenarios, and writes reproducible steps for a tester unfamiliar with the implementation; updates
  the Jira Steps to Test field after approval. Use when the user asks to write / draft Steps to Test
  or QA steps for a Jira ticket, or invokes /write-steps-to-test.
argument-hint: "<jira-url-or-key> [feature|bug]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
  - name: ticket_type
    description: Whether this is a general "feature" or a "bug" ticket — the template may differ.
---

# Write Steps to Test (Jira)

Produce **Steps to Test** in Domaine's standard format. **Do not skip the ✋ checkpoint.**

Series position: Workflow 5 — for QA handoff, typically alongside / after `qa-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** (`jira_ticket`).
- Whether this is a **feature** or **bug** ticket (`ticket_type`) — the template may differ.

## Operating mode

- **Phase 1 — Analysis:** **plan mode** — ingest ticket + implementation context.
- **Phase 2 — Write:** draft Steps to Test and optionally update Jira.

## Global rules

- Read the ticket via the **`jira-reader` subagent** (Atlassian MCP) — AC, TA, links, attachments; the optional write-back (Phase 2) stays in the main loop.
- **Never proceed past the ✋ checkpoint** without explicit engineer confirmation.
- Steps must be usable by someone **unfamiliar** with the implementation (clear navigation, theme/preview context, expectations).

---

## Phase 1 — Analysis `[plan mode]`

1. **Ingest the ticket.** **Context-first:** if the conversation context already contains *all* of the fields this skill needs (Description, AC, Technical Approach, Steps to Test, Figma links, environment notes) in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the fetch**. Otherwise **delegate to the `jira-reader` subagent** (pass the ticket key/URL): it reads via Atlassian MCP, applies `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`, and returns the structured fields plus any `figma_urls`, keeping the raw ADF out of this context. If it returns `needs_clarification`, ask the engineer.
2. **Analyse the implementation** — from the diff or engineer summary: what shipped, which settings/metafields/templates matter, and merchant-visible paths (Online Store editor, templates, URLs).
3. **Identify test scenarios** — map each AC to one or more scenarios; include edge cases, negative paths, and data/setup prerequisites (collections, tags, markets, customer state, inventory, etc.).

---

## Phase 2 — Generate Steps to Test

1. **Write Steps to Test** following Domaine standards:
   - **Point testers to the right place** — theme name, Online Store preview/customizer path, direct URLs, markets if relevant.
   - **Expectations per step** — exact outcomes, copy, layout, settings values, breakpoints.
   - **Visual aids** — reference Figma frames or screenshots where helpful.
   - **Edge cases** — boundaries, empty states, error states.
   - **Audience** — assume the tester is new to this Shopify setup.

   Use the appropriate template (**General** vs **Bug**) per `ticket_type`.

### ✋ Checkpoint

Present the Steps to Test. Encourage the engineer to **walk through** them (mentally or on preview) to catch gaps.

2. **Update Jira** (only after approval) — ask **manual update** vs **Atlassian MCP**. Place content in the **Steps to Test** custom field per process — not only comments. **The Steps to Test field is rich-text (ADF), so convert the approved steps to ADF before writing** — write the approved markdown to a temp file, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs <that-file>`, then `editJiraIssue` with `fields: { "<Steps to test field id>": <the ADF JSON> }`. Never send the raw markdown string. See **`${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Writing to a custom field — emit ADF**.

## Quality bar

- Full AC coverage.
- Deterministic steps (no "verify it works" without criteria).
- Explicit preview/theme context so QA can reproduce.
