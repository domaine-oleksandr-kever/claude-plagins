---
name: write-technical-approach
description: >
  Draft a Domaine Technical Approach (TA) for a Jira ticket — Workflow 2 of the
  Agentic Assisted Development series. Ingests the ticket's Description and
  Acceptance Criteria via Atlassian MCP, validates readiness, then writes the
  canonical eight-section TA markdown and (after approval) updates the Jira
  Technical Approach field. Use when the user asks to write, draft, or update a
  Technical Approach / TA for a Jira ticket, or invokes /write-technical-approach.
argument-hint: "<jira-ticket-url-or-key>"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). Governing source of truth for the TA. If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
allowed-tools: Read, Glob, Grep, Bash(git add*)
---

# Write Technical Approach (Jira)

Draft a Technical Approach (TA) for a Jira ticket. Follow the phases in order. **Do not skip the human review checkpoints (✋).**

Series position: Workflow 2 — runs after the ticket is validated and before `develop-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** — the `jira_ticket` argument. The ticket's **Description** and **Acceptance Criteria** are the governing source of truth.

## Operating mode

- **Phase 1 — Analysis & planning:** work in **plan mode**. Gather context, validate readiness, clarify scope, draft the TA outline.
- **Phase 2 — Write & publish:** leave plan mode once the engineer approves the outline. Produce the markdown artifact; update Jira only after approval.

## North star

**The ticket's Description and Acceptance Criteria govern the TA.** Every section describes **how** we deliver those requirements in this repo.

- A decision not grounded in the AC belongs in **Assumptions** (engineer-confirmed, with a reason) or **Open follow-ups** (for BSA / design).
- If the AC is ambiguous or incomplete, **stop** and flag it before drafting — do not invent scope.
- Fold ticket-stated assumptions into the Assumptions block so TA and ticket agree.
- Any bullet that doesn't trace to an AC, an assumption, or a repo constraint (the repo's coding rules, core-extension policy, a11y / perf rules) gets cut.

## Global rules

- The engineer owns Git, merges, and ticket updates; you assist.
- **Never proceed past a ✋ checkpoint** without explicit engineer confirmation.
- Use **Atlassian MCP** for Jira: **reads are delegated to the `jira-reader` subagent**; the optional write-back (Phase 2) stays in the main loop.
- Respect Foundation conventions: follow the repo's coding rules and **extend — never directly modify** `src/entry/core/*`.
- **Client-facing repo.** Never reference tickets, repos, or Figma files from other client accounts.
- **No internal repo file links** in the TA — they render as plain text in Jira. Reference in-repo files/rules with **inline code** only (`` `sections/main-header.liquid` ``). External links (Jira, Figma, public Shopify/Domaine docs) are fine.

## Audience & voice

Write for a **senior Shopify developer** who already knows the CLI, theme dev/deploy, Liquid / OS 2.0, and Foundation repo conventions. **Target read time ~5 minutes.** Skip basics; no tutorial content, no generic lint/preview boilerplate, no AI-speak. Full audience + anti-pattern guidance: read `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`.

---

## Phase 1 — Analysis & planning `[plan mode]`

1. **Ingest the ticket.** **Context-first:** if the conversation context already contains *all* the fields this skill needs, in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the fetch**. Otherwise **delegate to the `jira-reader` subagent** (pass the ticket key/URL): it reads via Atlassian MCP, applies `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`, and returns the structured fields — Description, AC, **Assumptions**, Technical Approach, Documentation Links, Steps to Test, `figma_urls` — keeping the raw ADF out of this context. If it returns `needs_clarification`, ask the engineer.
2. **Validate readiness** — confirm Description and AC exist and are sufficient. If missing or ambiguous, **stop**, summarize gaps, ask how to proceed.
3. **Analyse the codebase** — inspect relevant areas for patterns, layout, dependencies, constraints. Apply the repo's coding rules (Liquid, blocks, Tailwind, a11y, etc.).
4. **Clarify ambiguities** — ask concise scope/edge-case/environment questions before drafting.
5. **Draft the TA outline** — use the canonical format in `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`. The eight numbered H4 sections are fixed and in order: **1. Data Management** (config inventory), **2. Production Dependencies**, **3. Feature Enhancement Considerations**, **4. Integrations** (net-new only), **5. Accessibility**, **6. Performance**, **7. Risk Mitigation**, **8. Code Integrity**. Add an `#### Assumptions (engineer-confirmed)` H4 block above section 1. Anchor every bullet to the AC.

### ✋ Checkpoint — Phase 1

Present the **outline and open questions**. Wait for approval or edits before Phase 2.

---

## Phase 2 — Write & review

1. **Generate the TA** as markdown at `docs/technical-approaches/<TICKET-KEY>-technical-approach.md` (or an engineer-preferred path). Strictly follow the skeleton in `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`: H4 sections 1–8 in order, Assumptions block above section 1, bullets/tables over prose, inline code for paths. `git add` the new file right after creating it.

### ✋ Checkpoint — Phase 2

Present the draft path and summary. The engineer must **read, edit, and approve** before any Jira update.

2. **Update Jira** (only after approval) — ask whether **(a)** the engineer updates manually or **(b)** you use Atlassian MCP. Put the approved TA in the **Technical Approach** custom field, not only description/comments.

## Quality bar

- Every section traces to the Description + AC; out-of-AC scope lives in Assumptions / Open follow-ups.
- Aligns with Foundation patterns and repo rules.
- Concise senior-level tone (~5-min read), no AI-speak, no cross-client references, no merge/deploy instructions that bypass engineer ownership.
