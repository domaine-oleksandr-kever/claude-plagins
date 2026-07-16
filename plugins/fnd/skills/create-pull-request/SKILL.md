---
name: create-pull-request
description: >
  Open a GitHub Pull Request for a completed feature or fix with a Domaine-standard
  description pulled from the Jira ticket, Technical Approach, and the branch diff —
  Workflow 6 of the Agentic Assisted Development series. Drafts the PR title and body,
  builds the theme-preview table, then (after approval) creates the PR via `gh` and
  optionally links it back to Jira. Use when the user asks to open / create / draft a
  pull request or PR, or invokes /create-pull-request.
argument-hint: "<jira-url-or-key> [target-branch] [theme-name theme-url theme-admin-url — preview theme is auto-created if you omit these; pass them to use a theme you made yourself]"
arguments:
  - name: jira_ticket
    description: One or more Jira ticket URLs/keys (e.g. ELC-206, or "ELC-126 ELC-130" for a PR that closes several bugs). If absent, infer from the conversation context; ask only if it can't be inferred.
  - name: target_branch
    description: Merge base. Defaults to Domaine Git Flow (usually `develop`, sometimes `main`); confirm if not obvious.
  - name: theme_name
    description: Preview theme name. OPTIONAL. Leave it (and theme_url/admin_url) empty and the skill auto-creates the preview theme for you (step 4). Provide them and the skill SKIPS auto-creation entirely and uses exactly what you pass — e.g. a theme you duplicated manually. Omitted from the PR body if neither provided nor created.
  - name: theme_url
    description: Public theme preview URL / THEME_URL. OPTIONAL — part of the manual triplet (theme-name + theme-url + admin-url). Provided → no auto-creation; auto-filled when the skill creates the preview theme itself.
  - name: theme_admin_url
    description: Shopify admin theme URL / THEME_ADMIN_URL. OPTIONAL — part of the manual triplet. Provided → no auto-creation; auto-filled when the skill creates the preview theme itself.
  - name: preview_path
    description: Storefront path the change should be reviewed on (e.g. /products/group-lipglass). Used to deep-link the Preview + Admin (template) rows. Infer from context; ask if unsure.
allowed-tools: Read, Glob, Grep, Bash(git status), Bash(git fetch*), Bash(git log*), Bash(git diff*), Bash(git remote*), Bash(gh pr create*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh*)
---

# Create PR (GitHub + Jira)

Open a Pull Request with a Domaine-standard description pulled from the Jira ticket, the approved Technical Approach, and the branch diff.

Series position: Workflow 6 — the final step, after `develop-feature-or-fix` and `qa-feature-or-fix`.
Inputs (ask if missing): **Jira ticket(s)** (`jira_ticket` — one key or several); **target branch** (usually `develop` — confirm against Git Flow); optional theme name / preview URL / admin URL (omit their rows if absent).
Operating mode: **Phase 1 in plan mode** (ingest, diff, draft title + body); leave plan mode after the developer approves the draft.

## Global rules

- The developer owns branches, merges, reviewers, and Jira updates; you assist.
- **Never proceed past a ✋ checkpoint** without explicit developer confirmation.
- Use **Atlassian MCP** to read (and optionally update) Jira.
- **No GitHub MCP** in the toolchain. Prefer **`gh`** when installed and authenticated; otherwise produce a **paste-ready** title + body and a **compare URL** for manual creation.
- This repo may not define `.github/pull_request_template.md`. Use the body structure in `create-pull-request/REFERENCE.md`; if a GitHub template exists, **merge** these sections into it so nothing required is dropped.

---

## Phase 1 — Analysis & preparation `[plan mode]`

1. **Ingest the Jira ticket(s)** — context-first: full (not summarized) in-conversation fields count; second stop the task workspace if fresh (`.claude/fnd/<TICKET>/`, or `.claude/fnd/<branch-slug>/` with `ticket-<KEY>.md` files for a multi-ticket PR; `notes.md` holds per-bug root causes and preview-theme breadcrumbs); otherwise delegate to **`jira-reader`** — **several tickets → one reader per key, in parallel**, merge their fields — and **save fresh output(s) to the workspace**. This skill needs: Description, AC, **Technical Approach**, **Steps to Test**, links. `needs_clarification` → ask the developer.
2. **Analyse the implementation** — after the developer approves shell usage, inspect read-only: `git status`, `git log --oneline`, `git diff <target>...HEAD`. List files created / modified / deleted. Cross-reference the diff against the TA and AC; note gaps, intentional deviations, out-of-scope items.

   **Conformance review** (fnd review flow — `${CLAUDE_PLUGIN_ROOT}/references/review-flow.md`). Run the flow with **`conformance`** emphasis: read `.git/.fnd-review`; **first review on this branch** → spawn `change-reviewer` over the diff (small → one agent; large → one per file-group, in parallel) and surface its findings table; **already reviewed** → ask the developer `[ full re-review ] / [ only changed files ] / [ skip ]`. **Any `protected-core` blocker stops the PR** until it's resolved or the developer explicitly waives it. Refresh `.git/.fnd-review` after reviewing.

   **Correctness backstop** (same flow file — this check is NOT subject to the skip question above): the marker's `correctness_hash` **absent or ≠ the current diff hash** → the branch's bug hunt is missing or stale — apply the correctness gate and spawn **`bug-hunter`** over the diff (in parallel with any `change-reviewer` run; pass the `base` and the workspace `notes.md` `ceiling:` entries). Disposition every finding per `review-flow.md → Correctness findings`; a **blocker** stops the PR like `protected-core` does. `correctness_hash` current → say so in one line and move on. Refresh the marker (incl. `correctness_hash`) after.
3. **PR metadata** — propose a title `[ELC-XX][Type] Short description` (Type = `Feature` | `Fix` | `Refactor` | `Chore` | `Docs` | `Style` | `Perf` | `Test`; multiple tickets → one bracket, slash-separated, per **REFERENCE.md → Title convention**). Confirm the target branch. Capture linked tickets / blocks / related PRs.
4. **Preview theme** — populate the theme-preview table by **following `create-pull-request/REFERENCE.md` → Preview theme** (read it now — it owns the decision flow, `[ELC-…]` naming, `--reuse` default, `settings_drift` recovery, and page deep-links). Order of operations: manual triplet supplied as arguments → use as-is (skip creation); otherwise `info` → propose the name → **ask** → `create --name "<name>" --reuse`. **Any `error=` → the manual path**, with two specifics: `error=build_failed` → surface the build output and **stop** (fix the branch, don't enter theme URLs); `error=settings_drift` → **don't retry auto-creation**, follow the reference's duplicate-manually recovery. Append page deep-links when a storefront path is known (`preview_path` or inferable); if unsure, **ask — don't guess**. To redeploy after a later fix: the `update-preview-theme` skill.
5. **Draft the PR description** — build all body sections and the conditional theme-preview table per **`create-pull-request/REFERENCE.md`**. Fold the **named ceilings** into Dependencies — the workspace `notes.md` `ceiling:` entries plus any justified correctness findings (an intentional simplification that isn't named in the body reads as a bug to reviewers and review bots). **Body order is fixed at the top: (1) Summary → (2) Jira ticket(s) → (3) Theme preview table — in that exact order, as the first three sections.** The **Theme preview table belongs in the top third of the body, never appended at the bottom** among Technical approach / Changes / Steps to test / QA / Notes. When merging into an existing repo PR template, still surface these three at the top. Re-read the order before presenting the draft — getting the preview link high up is the point.

### ✋ Checkpoint — Phase 1

Present the **draft title**, **target branch**, proposed **reviewers/labels**, and the **full body** for the developer to edit and approve. **Stop** until confirmed.

---

## Phase 2 — PR creation

1. **Create the PR** (after explicit confirmation):
   - **Preferred:** `gh pr create` with the approved title and body (`--body-file` for long bodies), `--base <target>` / `--head <branch>`, `--draft` if requested.
   - **Fallback:** provide the exact markdown title + body to paste, plus the compare URL `https://github.com/<owner>/<repo>/compare/<base>...<head>` (derive `<owner>/<repo>` from `git remote get-url origin`).
2. **Link PR to Jira** — ask whether the developer adds the PR URL manually, or you update the ticket via Atlassian MCP.
3. **Final confirmation** — share the PR URL; note remaining actions (reviewers, labels, mark ready, merge blockers).

## Quality bar

- Description traceable to **AC** and **TA**.
- Diff summary accurate — no phantom files, no missing risk notes.
- No secrets or internal-only credentials in the PR body.

## Next in the series

After sharing the PR URL, check off this workflow's row in the workspace `progress.md` (+ the PR URL), then offer the next unchecked step in one line — `/fnd:write-steps-to-test <ticket>` if the ticket's Steps to Test field is still empty, else the series is complete — **offer only; never auto-run**.
