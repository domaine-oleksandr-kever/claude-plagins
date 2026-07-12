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

Produce **Steps to Test** in Domaine's standard format.

Series position: Workflow 5 — for QA handoff, typically alongside / after `qa-feature-or-fix`.
Inputs (ask if missing): **Jira ticket URL or key** (`jira_ticket`); **feature or bug** (`ticket_type` — the template may differ).
Operating mode: **Phase 1 in plan mode** (ingest ticket + implementation context); Phase 2 drafts the steps and optionally updates Jira.

## Global rules

- Read the ticket via the **`jira-reader` subagent** (Atlassian MCP) — AC, TA, links, attachments; the optional write-back (Phase 2) stays in the main loop.
- **Never proceed past the ✋ checkpoint** without explicit developer confirmation.
- Output follows the Domaine format — `${CLAUDE_PLUGIN_ROOT}/references/steps-to-test-format.md`: usable by a tester **unfamiliar** with the implementation, on their **OWN** theme (**never a preview-theme link**), deterministic expectations.

---

## Phase 1 — Analysis `[plan mode]`

1. **Ingest the ticket** — context-first: full (not summarized) in-conversation fields count; second stop the task workspace `.claude/fnd/<TICKET>/` if fresh (it also holds QA repro values in `notes.md`); otherwise delegate to the **`jira-reader`** subagent and **save its output to the workspace**. This skill needs: Description, AC, Technical Approach, Steps to Test, Figma links, environment notes (plus `figma_urls` / `notion_urls` / `other_links`). `needs_clarification` → ask. **Read the linked docs** that define expected behaviour/data/copy per `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md` — reuse before fetching (in-conversation or fresh workspace `doc-<slug>.md` copies count; save fresh extracts back); if the Notion MCP isn't connected, tell the developer rather than writing steps blind.
2. **Analyse the implementation** — from the diff or developer summary: what shipped, which settings/metafields/templates matter, and merchant-visible paths (Online Store editor, templates, URLs).
3. **Identify test scenarios** — map each AC to one or more scenarios; include edge cases, negative paths, and data/setup prerequisites (collections, tags, markets, customer state, inventory, etc.).

---

## Phase 2 — Generate Steps to Test

1. **Write Steps to Test** following the Domaine format — read
   `${CLAUDE_PLUGIN_ROOT}/references/steps-to-test-format.md` now (it owns the writing
   rules: theme-agnostic navigation, per-step expectations, visual aids, edge cases,
   headings + steps instead of big tables, and the **General** vs **Bug** template choice
   per `ticket_type`).

### ✋ Checkpoint

Present the Steps to Test. Encourage the developer to **walk through** them (mentally or on preview) to catch gaps. Once approved, save them to the workspace `steps-to-test.md` (`${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`) before the Jira write-back.

2. **Update Jira** (only after approval) — ask **manual update** vs **Atlassian MCP**. Place content in the **Steps to Test** custom field per process — not only comments. **The Steps to Test field is rich-text (ADF), so convert the approved steps to ADF before writing** — write the approved markdown to a temp file, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables <that-file>`, then `editJiraIssue` with `fields: { "<Steps to test field id>": <the ADF JSON> }`. The converter outputs **minified** ADF and `--no-tables` keeps it compact — a big ADF blob is fragile to inline. **Never send the raw markdown string** — custom fields reject it (`Operation value must be an Atlassian Document`); the MCP's markdown auto-conversion only applies to comments/description, not custom fields. If the converter prints a **size warning** to stderr, **trim/restructure** the steps (shorter, drop tables) — do not fall back to markdown. See **`${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Keep the ADF compact**.

## Quality bar

Per `${CLAUDE_PLUGIN_ROOT}/references/steps-to-test-format.md` → Quality bar: full AC
coverage; deterministic steps; theme-agnostic navigation.

## Next in the series

Check off this workflow's row in the workspace `progress.md`, then offer the next unchecked step in one line — `/fnd:create-pull-request <ticket>` if the branch has no PR yet, else the series is complete (reviewers, QA hand-off, ticket transition stay with the developer) — **offer only; never auto-run**.
