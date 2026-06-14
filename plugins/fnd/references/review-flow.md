# fnd review flow — shared contract

Single source of truth for the "review the branch's changes" flow used by
`pre-commit-review`, `commit`, and `create-pull-request`. Those skills reference this
file instead of duplicating the logic.

The flow has three parts: **(1) a once-per-branch marker**, **(2) how the four checks
are run** (cheap ones inline, expensive ones delegated to the `change-reviewer` agent),
and **(3) what to do on entry** (first time vs. subsequent).

## 1. The marker — `.git/.fnd-review`

A tiny, branch-keyed record that answers one question: *has this branch been reviewed
before?* It lives inside `.git/`, so it is **never committed**, is local per-clone, and
survives context compaction and new sessions. It is **overwritten** each time (never
appended) → constant size, no cleanup.

Format (plain `key=value` lines, no `jq` needed):

```
branch=<current branch>
base=<develop|main>
diff_hash=<hash of the reviewed diff>
reviewed_at_head=<commit sha at review time>
```

Compute scope + hash:

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
base=$(git show-ref --verify --quiet refs/heads/develop && echo develop || echo main)
# include committed-vs-base AND working-tree changes (pre-commit runs before the commit):
diff_hash=$( { git diff "$base"...HEAD; git diff; } | git hash-object --stdin )
```

Read it:

```bash
marker=.git/.fnd-review
if [ -f "$marker" ] && grep -qx "branch=$branch" "$marker"; then
  reviewed_before=yes
  prev_hash=$(sed -n 's/^diff_hash=//p' "$marker")
  prev_head=$(sed -n 's/^reviewed_at_head=//p' "$marker")
else
  reviewed_before=no   # no marker, or marker is for a different branch → first time here
fi
```

Write it (only after a review actually ran — for `pre-commit-review`, **after** its edits
are applied, so it records the final reviewed state):

```bash
{ echo "branch=$branch"; echo "base=$base"; echo "diff_hash=$diff_hash"; \
  echo "reviewed_at_head=$(git rev-parse HEAD)"; } > .git/.fnd-review
```

## 2. How the four checks run

The cost is **reading the changed files**, which checks A and C (and E) share. So split by
**files, not by checks**:

- **B (Jira task numbers) and D (untracked referenced files) run inline** in the calling
  skill — they're mechanical (`git diff | grep`, `git status`) and operate on the diff
  text + git metadata, not full-file reads:

  ```bash
  git diff "$base"...HEAD | grep -nE '^\+' | grep -E '\b[A-Z]{2,}-[0-9]+\b'   # B candidates
  git status --porcelain | grep '^??'                                          # D candidates
  ```

- **A, C, and E are delegated to the `change-reviewer` agent** so the heavy reading stays
  out of the main context (only the findings table comes back):
  - **Small diff** (≲ 15 changed files / ≲ 1500 diff lines) → **one** `change-reviewer`.
  - **Large diff** → **one `change-reviewer` per file-group, in parallel** — each file is
    read once; wall-clock drops. Split the file list into a few balanced groups.
  - Pass each agent: the `base`, its file group, the **emphasis** (see below), and the raw
    B/D hits to confirm.

- **Emphasis by caller:**
  - `pre-commit-review` → `hygiene` (lead A + C).
  - `create-pull-request` → `conformance` (lead E; `protected-core` = blocker).

Merge the agent findings with the inline B/D hits into one plan/table for the developer.

## 3. On entry — first time vs. subsequent

**Agreed rule: the first review on a branch is full; every later run asks the developer.**

```
reviewed_before == no   → run the FULL flow (§2), then write the marker (§1).
reviewed_before == yes  → ASK the developer; do not auto-skip and do not auto-rerun.
```

When asking (subsequent runs), enrich the prompt so the decision is easy:

- Compare `diff_hash` to `prev_hash`. If **unchanged**, say *"nothing changed since the
  last review"* and recommend **skip**. If **changed**, summarize what changed since the
  last review — `git diff <prev_head>...HEAD` (+ working tree), which files, rough nature
  (comments/style vs. logic):

  ```bash
  git diff "$prev_head"...HEAD --stat ; git diff --stat
  ```

- Offer: **`[ full re-review ] / [ only the changed files ] / [ skip ]`**.
  - *only the changed files* → run `change-reviewer` on just the delta vs. `prev_head`
    (cheapest useful option).
- On any run that actually reviews, **refresh the marker** afterward.

### Per-skill entry behaviour

- **`pre-commit-review`** — the primary home of the full review. Applies edits after
  developer approval, then writes/refreshes the marker.
- **`commit`** — does **not** itself run the hygiene review. On entry: if
  `reviewed_before == no`, offer to run `/fnd:pre-commit-review` first (proceed if the dev
  declines); if `yes`, continue to the commit. (Its own untracked-file check still runs.)
- **`create-pull-request`** — final gate. Run the flow with **`conformance`** emphasis:
  first time on branch → full; else ask. **Any `protected-core` blocker stops the PR**
  until resolved or explicitly waived by the developer.

> Optional fast-path: a skill may also print an in-context sentinel
> (`✓ fnd review · branch=… · <hash>`), but the `.git/` marker is the source of truth.
