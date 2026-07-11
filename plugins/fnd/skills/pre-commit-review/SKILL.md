---
name: pre-commit-review
description: Review the branch's changed files before committing — verify every comment is accurate and still matches the code, strip ticket references from comments (Jira task numbers like ELC-123 and ticket-section pointers like "(AC 1a)", "(TA 1a)", "Acceptance Criteria", "Technical Approach"), and surface refactor / cleanup opportunities. Produces a plan the developer approves before any edit. Use when the user is about to commit, says "before commit", asks to tidy/clean a branch, review comments, or check for stale comments / leftover ticket numbers, or invokes /pre-commit-review.
---

# Pre-commit review

Hygiene pass over the changed files **before a commit**. Four checks → a written
plan → developer approves/corrects → apply. **Never commits** (repo rule: never
`git commit` without explicit per-commit permission).

## 0. Review-flow gate

This skill is the primary home of the fnd review flow. Follow the shared contract in
`${CLAUDE_PLUGIN_ROOT}/references/review-flow.md`:

- Compute `branch` / `base` / `diff_hash` and read `.git/.fnd-review`.
- **First review on this branch** (`reviewed_before == no`) → run the full pass below.
- **Already reviewed on this branch** (`reviewed_before == yes`) → **ask** the developer
  `[ full re-review ] / [ only the changed files ] / [ skip ]`, enriched with what changed
  since the last review (recommend *skip* if `diff_hash` is unchanged). Honour their choice.

After the pass is applied (step 4), **write/refresh the marker**.

## 1. Determine scope

Diff against **`develop` if it exists (local, else `origin/develop`), else `main`** — from the
merge-base to the **working tree**, so committed, staged, and not-yet-staged work all land in
scope (this review runs *before* the commit):

```bash
base=$(git show-ref --verify --quiet refs/heads/develop && echo develop \
  || { git show-ref --verify --quiet refs/remotes/origin/develop && echo origin/develop || echo main; })
mb=$(git merge-base "$base" HEAD)
git diff --name-only "$mb"
```

Review **only these files** (untracked new files surface via check D). Read each one (the diff +
enough surrounding code to judge comments).

## 2. Run the four checks

**How the work is split** (per `review-flow.md` — don't read the same files twice):

- **B and D run inline here** — they're mechanical (`git diff | grep`, `git status`), no
  agent needed.
- **A and C are delegated to the `change-reviewer` agent** (`hygiene` emphasis) so the
  heavy file-reading stays out of the main context. Small diff → one agent; large diff
  (≳ 15 files) → one `change-reviewer` per file-group, **in parallel**. Pass each agent its
  file group, the `base`, and the raw B-hits to confirm. Merge its findings table with the
  inline B/D hits into the step-3 plan.

The four checks (A and C full definitions live in the agent — their single home):

- **A — Accuracy / staleness** — run by the agent: comments that no longer match the current code.
- **B — Ticket references.** Flag any reference to the ticket **or its parts** in a comment —
  Jira keys (`\b[A-Z]{2,}-\d+\b`) and ticket-section pointers (`(AC 1a)`, `TA 3b`, and
  `Acceptance Criteria` / `Technical Approach` / `Steps to Test` used as ticket references).
  Propose removing the reference while keeping any useful context (reword to say what the code
  does or why — don't just delete the sentence). First-pass signal:
  ```bash
  git diff "$mb" | grep -nE '^\+' \
    | grep -nE '\b[A-Z]{2,}-[0-9]+\b|\((AC|TA)[^)]*\)|\b(AC|TA) [0-9]+[a-z]?\b|Acceptance Criteria|Technical Approach|Steps to Test'
  ```
  Raw hits go to the agent, which confirms each is inside a **comment** and applies the
  false-positive whitelist (Figma ids, SKUs, `UTF-8`-style acronyms, real schema labels).
- **C — Refactor / improvement (required)** — run by the agent: duplication, dead code, unclear
  names, small correctness/readability wins — **in the changed code only**, every change gets a pass.
- **D — Untracked referenced files.** Verify every file the changed code references —
  rendered/included snippets, imported JS/TS modules, assets, sections named in `templates/*.json` —
  exists on disk **and is tracked by git**. First-pass signal:
  ```bash
  git status --porcelain | grep '^??'
  ```
  then cross-check each untracked path against references in the diff. A referenced-but-untracked
  file breaks the theme on deploy — propose `git add <path>` for each one found.

## 3. Present the plan

Print a single review plan grouped by file. **All four checks (A, B, C, D) go in the plan** — each
row is a concrete proposed change with a one-line rationale. Number the rows sequentially in a
first `#` column so the developer can reference findings by number:

| # | File:line | Check | Issue | Proposed change |
|---|---|---|---|---|
| 1 | `snippets/foo.liquid:42` | B (ticket ref) | comment says `ELC-70 (AC 1a): …` | drop the ref → `Flattened parent: …` |
| 2 | `src/entry/bar.ts:18` | A (stale) | comment names `oldFn`, code uses `newFn` | update to `newFn` |
| 3 | `src/entry/bar.ts:30` | C (refactor) | same 5-line block duplicated below | extract `formatLabel()` helper |
| 4 | `snippets/baz.liquid:7` | D (untracked) | renders `snippets/baz__item.liquid`, file untracked | `git add snippets/baz__item.liquid` |

Then **ask the developer to review and correct** the plan ("remove any you disagree with, add
anything I missed"). Do not edit yet.

## 4. Apply

After the developer approves (with their corrections), make exactly the agreed edits — nothing
more. For approved check-D rows, run the agreed `git add <path>` so the referenced files are
tracked. Then **stop**: report what changed and hand the commit back to the developer — stage
the files and suggest `/fnd:commit` (it always shows the message and asks permission before
committing). Never run `git commit` from this skill. If the branch's ticket has a task
workspace, tick `pre-commit-review` in its `progress.md`.

**Write the marker.** After the edits are applied, record the review for this branch so
`commit` / `create-pull-request` don't redundantly re-review (recompute `diff_hash` so it
reflects the post-edit state — see `${CLAUDE_PLUGIN_ROOT}/references/review-flow.md` §1):

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
diff_hash=$(git diff "$(git merge-base "$base" HEAD)" | git hash-object --stdin)
{ echo "branch=$branch"; echo "base=$base"; echo "diff_hash=$diff_hash"; \
  echo "reviewed_at_head=$(git rev-parse HEAD)"; } > .git/.fnd-review
```

## Guardrails

- Report → approve → apply. Never edit before approval; never expand past the approved list.
- Only touch files in the branch diff (step 1). No drive-by changes elsewhere.
- Never commit, push, or stage-and-commit automatically.