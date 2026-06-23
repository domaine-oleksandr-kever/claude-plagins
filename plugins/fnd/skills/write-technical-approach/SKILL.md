---
name: write-technical-approach
description: >
  Draft a Domaine Technical Approach (TA) for a Jira ticket — Workflow 2 of the
  Agentic Assisted Development series. Ingests the ticket's Description and
  Acceptance Criteria via Atlassian MCP, validates readiness, then writes the
  short-format TA markdown (Summary · Assumptions · Data / Config · Implementation ·
  Accessibility & Performance · Dependencies · Files) and (after approval) updates the Jira
  Technical Approach field. Use when the user asks to write, draft, or update a
  Technical Approach / TA for a Jira ticket, or invokes /write-technical-approach.
argument-hint: "<jira-ticket-url-or-key>"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). Governing source of truth for the TA. If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
allowed-tools: Read, Glob, Grep, Bash(git add*), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs*)
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

- A decision not grounded in the AC belongs in **Assumptions** (engineer-confirmed, with a reason) — not quietly inside another section.
- If the AC is ambiguous or incomplete, **stop** and flag it before drafting — do not invent scope.
- Fold ticket-stated assumptions into the **Assumptions** section so TA and ticket agree.
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
3. **Read every linked doc.** Read all links the `jira-reader` returned (`documentation_links`, `notion_urls`, `figma_urls`, `other_links`) per `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md` — **Notion is mandatory** (read via the Notion MCP; **if it isn't connected, stop and ask the developer** to enable it or paste the content, don't draft around it). These docs often hold the real data model and final copy the TA must reflect.
4. **Analyse the codebase** — inspect relevant areas for patterns, layout, dependencies, constraints. Apply the repo's coding rules (Liquid, blocks, Tailwind, a11y, etc.).
5. **Clarify ambiguities** — ask concise scope/edge-case/environment questions before drafting.
6. **Draft the TA outline** — use the short format in `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`. Seven **H4** sections, fixed names and order, no numbering and no title/metadata block: **Summary** (1–2 dense paragraphs), **Assumptions**, **Data / Config**, **Implementation**, **Accessibility & Performance**, **Dependencies**, **Files** (`**New:**` / `**Modified:**` inline path lists). Dense bullets, inline code for every path/object/setting, `·` separators. Anchor every bullet to the AC. **If the ticket/linked docs define a metafield or metaobject, name those definitions in Data / Config** (types, keys, field list, owner/namespace) and optionally carry the STEP 0 inspection query — see `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md` — so `develop-feature-or-fix` starts from a known target.

### ✋ Checkpoint — Phase 1

Present the **outline and open questions**. Wait for approval or edits before Phase 2.

---

## Phase 2 — Write & review

1. **Generate the TA** as markdown at `docs/technical-approaches/<TICKET-KEY>-technical-approach.md` (or an engineer-preferred path). Strictly follow the skeleton in `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`: the seven H4 sections in order (Summary → Files), starting at `#### Summary` with no title/metadata block, dense bullets over prose, inline code for paths. `git add` the new file right after creating it.
2. **Optional — pressure-test the TA with deep-research.** Once the TA is drafted, **offer** it (never auto-run): *"Want me to run this TA through `deep-research`? It cross-checks the approach against fresh external sources (Shopify theme/Liquid capabilities, app/library behaviour, accessibility/perf, known pitfalls) using the ticket and any Figma/docs already in context. ⚠️ **It's token-heavy** — it fans out many web searches and verification passes, so it's worth it mainly for risky, novel, or integration-heavy tickets. `[ yes / no ]"`*. Default **no** — go straight to the checkpoint. On **yes**, invoke the `deep-research` skill, seeding it with the drafted TA **plus the fresh context already in this conversation** — the `jira-reader` ticket fields (Description, AC, Assumptions), any `figma-reader` specs, docs/links — so it doesn't re-fetch them, scoped to validating *this* approach (not open-ended research). Fold its findings into the TA and note what changed before presenting.

### ✋ Checkpoint — Phase 2

Present the draft path and summary (with any deep-research findings folded in). The engineer must **read, edit, and approve** before any Jira update.

3. **Update Jira** (only after approval) — ask whether **(a)** the engineer updates manually or **(b)** you use Atlassian MCP. Put the approved TA in the **Technical Approach** custom field, not only description/comments. **The Technical Approach field is rich-text (ADF), so convert the approved markdown to ADF before writing** — run the bundled converter on the approved TA file: `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs docs/technical-approaches/<TICKET-KEY>-technical-approach.md`, then call `editJiraIssue` with `fields: { "<TA field id>": <the ADF JSON> }`. Never send the raw markdown string to the field (it stores literally). See **`${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Writing to a custom field — emit ADF**.

## Quality bar

- Every section traces to the Description + AC; out-of-AC scope lives in **Assumptions** (with a reason).
- Aligns with Foundation patterns and repo rules.
- Concise senior-level tone (~5-min read), no AI-speak, no cross-client references, no merge/deploy instructions that bypass engineer ownership.
