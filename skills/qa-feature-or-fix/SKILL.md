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

- **Never proceed past the ✋ checkpoint** without explicit engineer confirmation.
- **Atlassian MCP** for Jira; **Chrome DevTools MCP** for browser validation; **Figma MCP** when comparing to designs if URLs are available.
- Local preview should be running for interactive checks (see `${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md` → Local dev server) — confirm with the engineer.

---

## Phase 1 — QA preparation `[plan mode]`

1. **Ingest the ticket** — description, AC, Technical Approach, Steps to Test, links, environment notes. **Context-first:** if the conversation context already contains *all* of those fields in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the Atlassian MCP fetch**; call MCP only for fields that are missing or partial. Otherwise, to locate those custom fields, follow `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` (verified field IDs + `expand: "names"` fallback + ADF parsing).
2. **Analyse the implementation** — review the diff (branch/PR or local — ask which source); cross-check changes against the TA and each AC.
3. **Generate the QA checklist** — rows for: each **acceptance criterion** → concrete test actions + expected results; **edge cases** from TA or code review; **accessibility** (keyboard, focus order, semantics, visible focus, contrast on critical UI); **performance** (layout shift, heavy images/scripts, critical rendering path if touched); **cross-browser / viewport** if layout-critical.

### ✋ Checkpoint — Phase 1

Present the checklist; let the engineer add/remove cases. Wait for approval before Phase 2.

---

## Phase 2 — QA execution

1. **Automated / assisted validation** — with Chrome DevTools MCP (when preview is available): visual pass vs Figma if linked, console errors, basic performance signals (LCP/CLS context as applicable). Record **Pass / Fail / Needs review** per item with short evidence (what you checked, what you saw).
2. **Report findings** — summarize in a structured table or list; separate **blocking** vs **non-blocking**; suggest Jira updates (QA notes, screenshots, reopen criteria) but let the engineer own ticket edits unless they ask you to use Atlassian MCP.

## Quality bar

- Traceability from AC → test → outcome.
- Honest gaps (e.g. cannot test checkout without credentials).
- No false "pass" without basis.
