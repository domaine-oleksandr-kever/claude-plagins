---
name: qa-feature-or-fix
description: >
  Structured QA for a completed change against its Jira ticket — Workflow 4 of the Agentic Assisted
  Development series. Ingests the ticket, reviews the diff vs the TA/AC, builds an approved QA
  checklist, then runs browser-assisted checks and produces a pass/fail report. Use when the user
  asks to QA / test / verify a completed feature or fix against a Jira ticket, or invokes
  /qa-feature-or-fix.
argument-hint: "<jira-url-or-key> [preview-url-or-theme]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
  - name: how_to_view
    description: How to view the change — preview URL, theme name, template/page path, feature flags or settings.
---

# QA Feature or Fix (Jira)

Structured QA for a completed change. **Do not skip the ✋ checkpoint.**

Series position: Workflow 4 — runs after `develop-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** (`jira_ticket`).
- **How to view the change** (`how_to_view`) — preview URL, theme name, template/page path, feature flags or settings.

## Operating mode

- **Phase 1 — QA preparation:** **plan mode** — ingest ticket, review diffs vs TA/AC, build a checklist.
- **Phase 2 — QA execution:** run automated/browser-assisted checks and produce a report.

## Global rules

- **Never proceed past the ✋ checkpoint** without explicit developer confirmation.
- **Atlassian MCP** for Jira; **Chrome DevTools MCP** for browser validation; **Figma MCP** when comparing to designs if URLs are available. Ticket and design **reads are delegated to the `jira-reader` / `figma-reader` subagents** (raw payloads stay out of context).
- Local preview should be running for interactive checks (see `${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md` → Local dev server) — confirm with the developer.

---

## Phase 1 — QA preparation `[plan mode]`

1. **Ingest the ticket.** **Context-first:** if the conversation context already contains *all* of the fields this skill needs (Description, AC, Technical Approach, Steps to Test, environment notes) in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the fetch**. Otherwise **delegate to the `jira-reader` subagent** (pass the ticket key/URL): it reads via Atlassian MCP, applies `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`, and returns the structured fields plus `figma_urls` / `notion_urls` / `other_links`, keeping the raw ADF out of this context. If it returns `needs_clarification`, ask the developer. **Read the linked docs** that define expected behaviour/data/copy per `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md` — Notion via the Notion MCP (if it isn't connected, tell the developer rather than QA'ing blind).
2. **Analyse the implementation** — review the diff (branch/PR or local — ask which source); cross-check changes against the TA and each AC.
3. **Generate the QA checklist** — rows for: each **acceptance criterion** → concrete test actions + expected results; **edge cases** from TA or code review; **accessibility** (keyboard, focus order, semantics, visible focus, contrast on critical UI); **performance** (layout shift, heavy images/scripts, critical rendering path if touched); **cross-browser / viewport** if layout-critical.

### ✋ Checkpoint — Phase 1

Present the checklist; let the developer add/remove cases. Wait for approval before Phase 2.

---

## Phase 2 — QA execution

1. **Automated / assisted validation** — with Chrome DevTools MCP (when preview is available): visual pass vs Figma if linked (spawn one `figma-reader` per `figma_urls` entry, in parallel, to get the build spec to compare against), console errors, basic performance signals (LCP/CLS context as applicable). Record **Pass / Fail / Needs review** per item with short evidence (what you checked, what you saw).
   - **Data-driven AC — exercise each configured state, don't assume it.** When an AC is conditional on a metafield/metaobject value (enumerated options like aspect ratios, optional copy fields, presence/absence of an element) and you have store access, flip the value via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` (`metaobjectUpdate` / `metafieldsSet`; the runner uses `shopify store execute` — CLI ≥ 4.x stored auth — or the admin token from the gitignored `.env`, **never `Read` it**, exposing neither), reload, and verify each state — e.g. switch the ratio to `1:1`, or clear `heading` and confirm the markup has **no empty placeholder element** (inspect the DOM). **Mind propagation lag:** after a mutation Shopify can serve the old value briefly — re-query to confirm the change landed, then hard-reload, and retry before calling it a Fail. Restore defaults when done. Full pattern: `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`.
2. **Report findings** — summarize in a structured table or list; separate **blocking** vs **non-blocking**; suggest Jira updates (QA notes, screenshots, reopen criteria) but let the developer own ticket edits unless they ask you to use Atlassian MCP. **If you do write to a rich-text field or comment via MCP, convert the markdown to ADF first** — `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables <file>` (minified, table-free → compact) then pass the ADF object to `editJiraIssue` / `addCommentToJiraIssue`. Never send raw markdown to a custom field (rejected as not an Atlassian Document); if the converter warns about size, trim rather than revert to markdown. See `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Keep the ADF compact.

## Quality bar

- Traceability from AC → test → outcome.
- Honest gaps (e.g. cannot test checkout without credentials).
- No false "pass" without basis.
