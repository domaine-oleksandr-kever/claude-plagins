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

Draft a Technical Approach (TA) for a Jira ticket. Follow the phases in order.

Series position: Workflow 2 — after ticket validation, before `develop-feature-or-fix`.
Input (ask if missing): **Jira ticket URL or key** (`jira_ticket`) — its **Description** and **Acceptance Criteria** are the governing source of truth.
Operating mode: **Phase 1 in plan mode** (analysis, outline); leave plan mode once the developer approves the outline; Jira updates only after approval.

## North star

**The ticket's Description and AC govern the TA** — decisions not grounded in the AC land in **Assumptions** (developer-confirmed, with a reason), ambiguous or incomplete AC **stops** the draft, and any bullet that traces to neither AC, assumption, nor repo constraint gets cut. Full grounding rules: `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md` §North star.

## Global rules

- The developer owns Git, merges, and ticket updates; you assist.
- **Never proceed past a ✋ checkpoint** without explicit developer confirmation.
- Use **Atlassian MCP** for Jira: **reads are delegated to the `jira-reader` subagent**; the optional write-back (Phase 2) stays in the main loop.
- Respect Foundation conventions: follow the repo's coding rules and **extend — never directly modify** `src/entry/core/*`.
- **Client-facing repo.** Never reference tickets, repos, or Figma files from other client accounts.
- **No internal repo file links** in the TA — they render as plain text in Jira. Reference in-repo files/rules with **inline code** only (`` `sections/main-header.liquid` ``). External links (Jira, Figma, public Shopify/Domaine docs) are fine.

## Audience & voice

Senior-Shopify-developer audience, **~3-minute read**, no tutorial content, no AI-speak — full audience + anti-pattern guidance: `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md` §Target audience / §Voice.

---

## Phase 1 — Analysis & planning `[plan mode]`

1. **Ingest the ticket** — context-first: full (not summarized) in-conversation fields count; second stop the task workspace `.claude/fnd/<TICKET>/` if fresh; otherwise delegate to the **`jira-reader`** subagent and **save its output to the workspace**. This skill needs: Description, AC, **Assumptions**, Technical Approach, Documentation Links, Steps to Test, `figma_urls`. `needs_clarification` → ask the developer.
2. **Validate readiness** — confirm Description and AC exist and are sufficient. If missing or ambiguous, **stop**, summarize gaps, ask how to proceed.
3. **Read every linked doc.** Read all links the `jira-reader` returned (`documentation_links`, `notion_urls`, `figma_urls`, `other_links`) per `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md`. **Reuse before fetching:** in-conversation (full) or fresh workspace copies (`doc-<slug>.md`) count — fetch only missing/stale links, and save fresh extracts back. **Notion is mandatory** (read via the Notion MCP; **if it isn't connected, stop and ask the developer** to enable it or paste the content, don't draft around it). These docs often hold the real data model and final copy the TA must reflect.
4. **Analyse the codebase** — inspect relevant areas for patterns, layout, dependencies, constraints. Apply the repo's coding rules (Liquid, blocks, Tailwind, a11y, etc.).
5. **Clarify ambiguities** — ask concise scope/edge-case/environment questions before drafting.
6. **Draft the TA outline** — use the short format in `${CLAUDE_PLUGIN_ROOT}/references/technical-approach-format.md`. Seven **H4** sections, fixed names and order, no numbering and no title/metadata block: **Summary** (1–2 dense paragraphs), **Assumptions**, **Data / Config**, **Implementation**, **Accessibility & Performance**, **Dependencies**, **Files** (`**New:**` / `**Modified:**` inline path lists). Dense bullets, inline code for every path/object/setting, `·` separators. Anchor every bullet to the AC. **If the ticket/linked docs define a metafield or metaobject, name those definitions in Data / Config** (types, keys, field list, owner/namespace) and optionally carry the STEP 0 inspection query — see `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md` — so `develop-feature-or-fix` starts from a known target. When store access is available, **verify Data / Config assumptions against the real store instead of guessing**: read-only Admin GraphQL via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh`, current customizer/theme-JSON state via `${CLAUDE_PLUGIN_ROOT}/scripts/theme-json.sh get` (`${CLAUDE_PLUGIN_ROOT}/references/theme-customizer-state.md`).

### ✋ Checkpoint — Phase 1

Present the **outline and open questions**. Wait for approval or edits before Phase 2.

---

## Phase 2 — Write & review

1. **Generate the TA** as markdown at `docs/technical-approaches/<TICKET-KEY>-technical-approach.md` (or an developer-preferred path). Strictly follow the skeleton in the format reference (step 6): starting at `#### Summary`, no title/metadata block. `docs/technical-approaches/` is **gitignored by default** — the TA stays local and doesn't ship in the client-facing repo (see the format reference) — so don't `git add` it unless `git check-ignore -q` shows the repo actually tracks that path and the developer wants it committed.
2. **Optional — pressure-test the TA with deep-research.** Offer once, never auto-run: *"Run this TA through `deep-research` (cross-checks against fresh external sources)? ⚠️ **Token-heavy** — worth it mainly for risky, novel, or integration-heavy tickets. `[ yes / no ]"`*. Default **no** — go straight to the checkpoint. On **yes**: invoke `deep-research` seeded with the drafted TA plus the ticket/specs/docs already in context (don't re-fetch), scoped to validating *this* approach; fold findings into the TA and note what changed.

### ✋ Checkpoint — Phase 2

Present the draft path and summary (with any deep-research findings folded in). The developer must **read, edit, and approve** before any Jira update.

3. **Update Jira** (only after approval) — ask whether **(a)** the developer updates manually or **(b)** you use Atlassian MCP. Put the approved TA in the **Technical Approach** custom field, not only description/comments. **The Technical Approach field is rich-text (ADF), so convert the approved markdown to ADF before writing** — run the bundled converter on the approved TA file: `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables docs/technical-approaches/<TICKET-KEY>-technical-approach.md`, then call `editJiraIssue` with `fields: { "<TA field id>": <the ADF JSON> }`. Output is **minified** and `--no-tables` keeps it compact (a big ADF blob is fragile to inline). **Never send the raw markdown string** — custom fields reject it (`Operation value must be an Atlassian Document`), and the MCP's markdown auto-conversion covers only comments/description. If the converter prints a size warning, trim/restructure rather than reverting to markdown. See **`${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Keep the ADF compact**.

## Quality bar

- Every section traces to the Description + AC; out-of-AC scope lives in **Assumptions** (with a reason).
- Aligns with Foundation patterns and repo rules.
- Concise senior-level tone (~3-min read), no AI-speak, no cross-client references, no merge/deploy instructions that bypass developer ownership.

## Next in the series

Check off this workflow's row in the workspace `progress.md`, then offer the next unchecked step in one line — normally `/fnd:develop-feature-or-fix <ticket>` once the TA is on the ticket — **offer only; never auto-run**.
