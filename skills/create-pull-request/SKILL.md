---
name: create-pull-request
description: >
  Open a GitHub Pull Request for a completed feature or fix with a Domaine-standard
  description pulled from the Jira ticket, Technical Approach, and the branch diff —
  Workflow 6 of the Agentic Assisted Development series. Drafts the PR title and body,
  builds the theme-preview table, then (after approval) creates the PR via `gh` and
  optionally links it back to Jira. Use when the user asks to open / create / draft a
  pull request or PR, or invokes /create-pull-request.
argument-hint: "<jira-url-or-key> [target-branch] [theme-name] [theme-url] [admin-url]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
  - name: target_branch
    description: Merge base. Defaults to Domaine Git Flow (usually `develop`, sometimes `main`); confirm if not obvious.
  - name: theme_name
    description: Preview theme name (optional). Omitted from the PR body if not provided.
  - name: theme_url
    description: Public theme preview URL / THEME_URL (optional). Used to build the Preview row + extract theme ID.
  - name: theme_admin_url
    description: Shopify admin theme URL / THEME_ADMIN_URL (optional).
allowed-tools: Read, Glob, Grep, Bash(git status), Bash(git fetch*), Bash(git log*), Bash(git diff*), Bash(git remote*), Bash(gh pr create*)
---

# Create PR (GitHub + Jira)

Open a Pull Request with a description that matches Domaine's expectations and pulls context from the Jira ticket, the approved Technical Approach, and the branch diff. **Do not skip the ✋ checkpoints.**

Series position: Workflow 6 — the final step, after `develop-feature-or-fix` and `qa-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** (`jira_ticket`)
- **Target branch** (`target_branch`) — confirm against Git Flow if not obvious (usually `develop`).
- **Theme name / preview URL / admin URL** — all optional; omit the rows they'd populate if absent.

## Operating mode

- **Phase 1 — Analysis & preparation:** **plan mode** — ingest Jira, diff the branch vs target, draft title + full body.
- **Phase 2 — PR creation:** leave plan mode after the engineer approves the draft. Create the PR, optionally update Jira.

## Global rules

- The engineer owns branches, merges, reviewers, and Jira updates; you assist.
- **Never proceed past a ✋ checkpoint** without explicit engineer confirmation.
- Use **Atlassian MCP** to read (and optionally update) Jira.
- **No GitHub MCP** in the toolchain. Prefer **`gh`** when installed and authenticated; otherwise produce a **paste-ready** title + body and a **compare URL** for manual creation.
- This repo may not define `.github/pull_request_template.md`. Use the body structure in `create-pull-request/REFERENCE.md`; if a GitHub template exists, **merge** these sections into it so nothing required is dropped.

---

## Phase 1 — Analysis & preparation `[plan mode]`

1. **Ingest the Jira ticket** — via Atlassian MCP fetch description, AC, **Technical Approach**, **Steps to Test**, attachments, links, linked issues. **Context-first:** if the conversation context already contains *all* of those fields in full (not summarized or truncated — e.g. from an earlier skill run or a pasted ticket), use that and **skip the Atlassian MCP fetch**; call MCP only for fields that are missing or partial. To locate those custom fields, follow `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md` (verified field IDs + `expand: "names"` fallback + ADF parsing).
2. **Analyse the implementation** — after the engineer approves shell usage, inspect read-only: `git status`, `git log --oneline`, `git diff <target>...HEAD`. List files created / modified / deleted. Cross-reference the diff against the TA and AC; note gaps, intentional deviations, out-of-scope items.

   **Conformance review** (fnd review flow — `${CLAUDE_PLUGIN_ROOT}/references/review-flow.md`). Run the flow with **`conformance`** emphasis: read `.git/.fnd-review`; **first review on this branch** → spawn `change-reviewer` over the diff (small → one agent; large → one per file-group, in parallel) and surface its findings table; **already reviewed** → ask the developer `[ full re-review ] / [ only changed files ] / [ skip ]`. **Any `protected-core` blocker stops the PR** until it's resolved or the developer explicitly waives it. Refresh `.git/.fnd-review` after reviewing.
3. **PR metadata** — propose a title `[ELC-XX][Type] Short description` (Type = `Feature` | `Fix` | `Refactor` | `Chore` | `Docs` | `Style` | `Perf` | `Test`). Confirm the target branch. Capture linked tickets / blocks / related PRs.
4. **Draft the PR description** — build all body sections and the conditional theme-preview table per **`create-pull-request/REFERENCE.md`**.

### ✋ Checkpoint — Phase 1

Present the **draft title**, **target branch**, proposed **reviewers/labels**, and the **full body** for the engineer to edit and approve. **Stop** until confirmed.

---

## Phase 2 — PR creation

1. **Create the PR** (after explicit confirmation):
   - **Preferred:** `gh pr create` with the approved title and body (`--body-file` for long bodies), `--base <target>` / `--head <branch>`, `--draft` if requested.
   - **Fallback:** provide the exact markdown title + body to paste, plus the compare URL `https://github.com/<owner>/<repo>/compare/<base>...<head>` (derive `<owner>/<repo>` from `git remote get-url origin`).
2. **Link PR to Jira** — ask whether the engineer adds the PR URL manually, or you update the ticket via Atlassian MCP.
3. **Final confirmation** — share the PR URL; note remaining actions (reviewers, labels, mark ready, merge blockers).

## Quality bar

- Description traceable to **AC** and **TA**.
- Diff summary accurate — no phantom files, no missing risk notes.
- No secrets or internal-only credentials in the PR body.
