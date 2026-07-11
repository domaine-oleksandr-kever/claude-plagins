---
name: commit
description: Create git commits using the Conventional Commits specification. Use when the user asks to commit changes, write a commit message, or run git commit, or invokes /commit.
allowed-tools: Bash(git status*), Bash(git diff*), Bash(git add*), Bash(git commit*), Bash(git log*), Bash(git ls-files*), Read, Glob, Grep
---

# Commit

Create commits that follow [Conventional Commits](https://www.conventionalcommits.org/).

## Rules

- **Write the entire commit message in English** (subject, body, and footers), regardless of the conversation language.
- **Always ask for permission before running `git commit`.** Show the proposed message first and wait for explicit confirmation.
- **Never add a Claude/Co-Authored-By signature or any AI attribution** to the commit message.
- Subject line: lowercase after the type, no trailing period, imperative mood, ≤ 72 chars.

## Format

```
<type>(<scope>): <description>

[body — as many paragraphs as needed; lines wrapped at ~72 cols]

[optional footer — BREAKING CHANGE: …]
```

`<scope>` is optional. Drop the parentheses entirely if there's no scope: `fix: correct off-by-one in pagination`.

## The body

No length cap — `~72 cols` is line *wrapping*, not a limit. Write it complete enough that a future reader understands the change without opening the diff: **what** changed at a high level, **why** (motivation, bug symptom, requirement), and non-obvious **context** (trade-offs, rejected alternatives, side effects, follow-ups). Skip the body only for genuinely trivial changes; when in doubt, write it.

## Types

| type | use for |
|------|---------|
| `feat` | new feature |
| `fix` | bug fix |
| `refactor` | code change that isn't a feature or fix |
| `perf` | performance improvement |
| `style` | formatting, whitespace, no logic change |
| `docs` | documentation only |
| `test` | adding or fixing tests |
| `build` | build system, dependencies |
| `ci` | CI config |
| `chore` | tooling, housekeeping |

## Review gate (before committing)

Consult the fnd review flow (`${CLAUDE_PLUGIN_ROOT}/references/review-flow.md`). `commit`
does **not** run the hygiene review itself — it only ensures one happened:

- Read `.git/.fnd-review`. **No marker for this branch** → offer to run
  `/fnd:pre-commit-review` first; proceed if the developer declines.
- **Marker exists** → continue; don't re-run a review unprompted.

(Your own untracked-file check in step 2 still runs regardless.)

## Workflow

1. Run `git status` and `git diff --staged` (and `git diff` for unstaged) to see what's being committed.
2. **Check for untracked referenced files** — cross-check `git status --porcelain | grep '^??'`
   (or `git ls-files --error-unmatch <path>`) against references in the diff; a referenced file
   that exists on disk but is untracked → `git add` it so it ships with the commit.
3. Pick the `type` from the dominant change.
4. **If a task/ticket is in the conversation context (e.g. ELC-61), ask the user:**
   > "Add the task as scope — e.g. `feat(ELC-61): <message>`? Or commit without it?"
   Only use the ticket as scope after the user confirms.
5. Draft the message. Include a body (see [The body](#the-body)) unless the change is trivial.
6. Show the full message to the user and ask for permission to commit.
7. On approval, commit. Use a HEREDOC for multi-line messages:

   ```bash
   git commit -m "$(cat <<'EOF'
   feat(ELC-61): add region selector to header

   Auto-opens the dropdown when the visitor's IP resolves to an
   unsupported shipping region.
   EOF
   )"
   ```

## Examples

```
feat(ELC-61): add Braze email signup to footer
fix(cart): show delivery row in order summary
```

## Breaking changes

`!` after the type/scope plus a `BREAKING CHANGE: …` footer — e.g. `feat(api)!: drop support for legacy collection handles`.

## Next in the series

When the commit belongs to a ticket with a task workspace, tick `commit` in its `progress.md`, then offer the next unchecked step in one line — normally `/fnd:create-pull-request <ticket>` when the branch has no open PR — **offer only; never auto-run**.
