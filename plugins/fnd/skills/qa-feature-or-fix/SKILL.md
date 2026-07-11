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

1. **Ingest the ticket.** **Context-first:** if the conversation context already contains *all* of the fields this skill needs (Description, AC, Technical Approach, Steps to Test, environment notes) in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the fetch**. Second stop: the **task workspace** — `.claude/fnd/<TICKET>/` may already hold the ticket, Figma specs, dev's test breadcrumbs (`notes.md`), and series progress from an earlier skill or session; if fresh (rules: `${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`), use it and skip the fetch too. Otherwise **delegate to the `jira-reader` subagent** (pass the ticket key/URL): it reads via Atlassian MCP, applies `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`, and returns the structured fields plus `figma_urls` / `notion_urls` / `other_links`, keeping the raw ADF out of this context. If it returns `needs_clarification`, ask the developer. **Read the linked docs** that define expected behaviour/data/copy per `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md` — Notion via the Notion MCP (if it isn't connected, tell the developer rather than QA'ing blind). **After any fresh fetch, save the reader's output to the task workspace** so later skills and sessions skip the refetch.
2. **Analyse the implementation** — review the diff (branch/PR or local — ask which source); cross-check changes against the TA and each AC.
3. **Generate the QA checklist** — rows for: each **acceptance criterion** → concrete test actions + expected results; **design conformance** vs the Figma build spec when a design is linked or its spec is already in context; **edge cases** from TA or code review; **break-it cases** (below — always include this group); **accessibility** (keyboard, focus order, semantics, visible focus, contrast on critical UI); **performance** (layout shift, heavy images/scripts, critical rendering path if touched); **cross-browser / viewport** if layout-critical.

### Break-it cases — think like a QA trying to break it

TA/AC describe intended behaviour; real bugs live in the states nobody wrote down. For **every merchant/user-editable input and every async interaction the diff touches**, ask *"what value or timing breaks this?"* and derive concrete rows from these categories (each has produced real production bugs):

- **Self-reference / cycles** — an entity configured to include itself or its parent: a bundle whose components list the bundle's own product, a "related items" list containing the current page. Expected: the self-reference is skipped or the feature fails closed — not a recursive render or a double-counted total.
- **Missing / emptied config** — delete or blank a metafield/setting the feature depends on (e.g. clear a bundle's `components`). Expected **fail-closed**: the CTA/purchase path disables; no half-render, no selling the parent without its required selections.
- **Boundary & nonsense values** — `0`, negative, or absurdly large quantities/numbers; empty strings; unknown enum values; malformed JSON in JSON-type fields. Expected: clamped/validated — not zeroed totals, `NaN`, or a crash.
- **Injection via editable content** — paste `<img src=x onerror=alert(1)>` into every editable text the change renders (titles, descriptions, settings). Liquid `{{ }}` does **not** HTML-escape: any render without `| escape` is a stored-XSS finding.
- **Timing & races** — interact **before hydration** on a throttled network (change the select before scripts load — is actual DOM state reconciled on connect, or do stale SSR attributes win?); **rapid repeated interaction** (fast variant switching, double-click add-to-cart) — are in-flight requests aborted/superseded so the *last action* wins, not the *slowest response*?

Base the rows on what the diff actually reads and fires (inputs, requests, rendered fields) — the categories are lenses, not a fixed list.

### ✋ Checkpoint — Phase 1

Present the checklist; let the developer add/remove cases. Wait for approval before Phase 2. Once approved, save the checklist to the workspace `qa.md`.

---

## Phase 2 — QA execution

1. **Automated / assisted validation** — with Chrome DevTools MCP (when preview is available): visual pass vs Figma if linked — **context-first:** reuse `figma-reader` build specs already in this conversation in full (e.g. from a `develop-feature-or-fix` run) or in the task workspace (`.claude/fnd/<TICKET>/figma-<node-id>.md`); spawn one `figma-reader` per `figma_urls` entry, in parallel, **only for specs you don't already have**, saving fresh specs to the workspace — console errors, basic performance signals (LCP/CLS context as applicable). Record **Pass / Fail / Needs review** per item with short evidence (what you checked, what you saw).
   - **Data-driven AC — exercise each configured state, don't assume it.** When an AC is conditional on a metafield/metaobject value (enumerated options like aspect ratios, optional copy fields, presence/absence of an element) and you have store access, flip the value via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` (`metaobjectUpdate` / `metafieldsSet`; the runner uses `shopify store execute` — CLI ≥ 4.x stored auth — or the admin token from the gitignored `.env`, **never `Read` it**, exposing neither), reload, and verify each state — e.g. switch the ratio to `1:1`, or clear `heading` and confirm the markup has **no empty placeholder element** (inspect the DOM). **Mind propagation lag:** after a mutation Shopify can serve the old value briefly — re-query to confirm the change landed, then hard-reload, and retry before calling it a Fail. Restore defaults when done. Full pattern: `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`.
   - **Customizer-driven AC — same discipline through theme JSON.** When an AC depends on theme-editor configuration (which sections/blocks a page has, their settings, global theme settings), drive each state with `${CLAUDE_PLUGIN_ROOT}/scripts/theme-json.sh` against the dev/preview theme: snapshot the file, `set` the edited copy, reload and verify, then restore the snapshot — the script refuses the live theme. Setting ids and allowed values come from the section's `{% schema %}`. Pattern: `${CLAUDE_PLUGIN_ROOT}/references/theme-customizer-state.md`.
   - **Break-it rows — same mechanics, hostile values.** Data-shaped cases ride the two patterns above: mutate the metafield / theme JSON to the hostile value (self-reference, blanked field, `0`/negative quantity, injection payload) → reload → verify → **restore**. Timing cases: throttle the network via Chrome DevTools MCP (`emulate`), interact before scripts hydrate, fire rapid repeated interactions and watch the request log for aborted vs racing requests. A break-it row that breaks the feature is a **finding to report** (blocking when it corrupts totals/cart or executes injected markup), not a checklist defect — reproduce it, capture evidence and the exact hostile value, and file it under blocking/non-blocking.
2. **Report findings** — summarize in a structured table or list; separate **blocking** vs **non-blocking**; suggest Jira updates (QA notes, screenshots, reopen criteria) but let the developer own ticket edits unless they ask you to use Atlassian MCP. **If you do write to a rich-text field or comment via MCP, convert the markdown to ADF first** — `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables <file>` (minified, table-free → compact) then pass the ADF object to `editJiraIssue` / `addCommentToJiraIssue`. Never send raw markdown to a custom field (rejected as not an Atlassian Document); if the converter warns about size, trim rather than revert to markdown. See `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` → Keep the ADF compact. Append the pass/fail outcome and confirmed findings (with their repro values) to the workspace `qa.md`, below the checklist.

## Quality bar

- Traceability from AC → test → outcome.
- Honest gaps (e.g. cannot test checkout without credentials).
- No false "pass" without basis.

## Next in the series

**Mark progress:** on completing this workflow, check off its row in the ticket's workspace `progress.md` (creating the folder/file if absent — `${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`) with date + one-line status (e.g. "pass" / "2 blocking bugs"). Then, right after the report, **offer the next step** in one line and wait; never auto-run it: all blocking checks passed → `/fnd:pre-commit-review`; any blocking failure → offer to fix it now (back to the implementation flow) and re-run this QA after.
