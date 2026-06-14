---
name: pre-commit-review
description: Review the branch's changed files before committing — verify every comment is accurate and still matches the code, strip Jira task numbers (e.g. ELC-123) from comments, and surface refactor / cleanup opportunities. Produces a plan the developer approves before any edit. Use when the user is about to commit, says "before commit", asks to tidy/clean a branch, review comments, or check for stale comments / leftover ticket numbers.
---

# Pre-commit review

Hygiene pass over the changed files **before a commit**. Four checks → a written
plan → developer approves/corrects → apply. **Never commits** (repo rule: never
`git commit` without explicit per-commit permission — see `feedback_never_commit_without_permission`).

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

Diff the branch against **`develop` if it exists, else `main`**:

```bash
base=$(git show-ref --verify --quiet refs/heads/develop && echo develop || echo main)
git diff --name-only "$base"...HEAD
```

Review **only these files**. Read each one (the diff + enough surrounding code to judge comments).

## 2. Run the four checks

**How the work is split** (per `review-flow.md` — don't read the same files twice):

- **B and D run inline here** — they're mechanical (`git diff | grep`, `git status`), no
  agent needed.
- **A and C are delegated to the `change-reviewer` agent** (`hygiene` emphasis) so the
  heavy file-reading stays out of the main context. Small diff → one agent; large diff
  (≳ 15 files) → one `change-reviewer` per file-group, **in parallel**. Pass each agent its
  file group, the `base`, and the raw B-hits to confirm. Merge its findings table with the
  inline B/D hits into the step-3 plan.

The four checks, for reference (full definitions also live in the agent):

For every changed file, inspect each comment — Liquid (`{% comment %}`, `{%- comment -%}`,
`{% doc %}`), JS/TS (`//`, `/* */`, JSDoc `/** */`), CSS (`/* */`):

- **A — Accuracy / staleness.** Does the comment still match the code? Flag comments that
  reference renamed symbols, removed behaviour, wrong file/line/selector, an old approach that
  was replaced, or a TODO that's already done. Verify against the *current* code, not memory.
- **B — Task numbers.** Flag any Jira-style key in a comment: regex `\b[A-Z]{2,}-\d+\b`
  (e.g. `ELC-70`, `ELC-206`). Propose removing the number while keeping any useful context
  (reword, don't just delete the sentence). **Keep** Figma node ids (`8947-59132`), SKU codes
  (`S3HT11`), and design/URL references — those are not task numbers. First-pass signal:
  ```bash
  git diff "$base"...HEAD | grep -nE '^\+' | grep -E '\b[A-Z]{2,}-[0-9]+\b'
  ```
  then confirm each hit is inside a comment (not code/data) before flagging.
- **C — Refactor / improvement (required).** Actively look for and propose: duplication, dead
  code, unclear names, copy-pasted blocks that could be shared, or small correctness/readability
  wins **in the changed code only**. Always run this check — every change gets at least a
  considered pass. Keep proposals scoped to the diff; don't propose broad rewrites of untouched code.
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
| 1 | `snippets/foo.liquid:42` | B (task #) | comment says `ELC-70: …` | drop `ELC-70:` → `Flattened parent: …` |
| 2 | `src/entry/bar.ts:18` | A (stale) | comment names `oldFn`, code uses `newFn` | update to `newFn` |
| 3 | `src/entry/bar.ts:30` | C (refactor) | same 5-line block duplicated below | extract `formatLabel()` helper |
| 4 | `snippets/baz.liquid:7` | D (untracked) | renders `snippets/baz__item.liquid`, file untracked | `git add snippets/baz__item.liquid` |

Then **ask the developer to review and correct** the plan ("remove any you disagree with, add
anything I missed"). Do not edit yet.

## 4. Apply

After the developer approves (with their corrections), make exactly the agreed edits — nothing
more. For approved check-D rows, run the agreed `git add <path>` so the referenced files are
tracked. Then **stop**: report what changed and hand the commit back to the developer (for
`/commit` here: stage files + `pbcopy` the message; never run `git commit`).

**Write the marker.** After the edits are applied, record the review for this branch so
`commit` / `create-pull-request` don't redundantly re-review (recompute `diff_hash` so it
reflects the post-edit state — see `${CLAUDE_PLUGIN_ROOT}/references/review-flow.md` §1):

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
diff_hash=$( { git diff "$base"...HEAD; git diff; } | git hash-object --stdin )
{ echo "branch=$branch"; echo "base=$base"; echo "diff_hash=$diff_hash"; \
  echo "reviewed_at_head=$(git rev-parse HEAD)"; } > .git/.fnd-review
```

## Guardrails

- Report → approve → apply. Never edit before approval; never expand past the approved list.
- Only touch files in the branch diff (step 1). No drive-by changes elsewhere.
- Never commit, push, or stage-and-commit automatically.