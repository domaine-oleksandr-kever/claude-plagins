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

The Conventional Commits spec puts **no limit on body length** — it's free-form and may be any number of paragraphs. The `~72 cols` is only line *wrapping* (so `git log` reads well in a terminal); it does **not** cap how much you write.

Write a body that's complete enough for a future reader — human or AI — to understand the change without opening the diff. Include:

- **What** changed at a high level (not a line-by-line restatement of the diff).
- **Why** — the motivation, bug symptom, or requirement that drove it.
- **Context** worth knowing: trade-offs, alternatives rejected, side effects, follow-ups, or anything non-obvious.

Skip the body only for genuinely trivial changes (typo, formatting, dependency bump) where the subject already says everything. When in doubt, write the body.

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
2. **Check for untracked referenced files.** Verify every file the committed code references —
   rendered/included snippets, imported JS/TS modules, assets, sections named in `templates/*.json` —
   is tracked by git. Cross-check `git status --porcelain | grep '^??'` (or
   `git ls-files --error-unmatch <path>`) against references in the diff; if a referenced file
   exists on disk but is untracked, `git add` it so it ships with the commit.
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
refactor: extract pagination helper from PLP grid
docs: document FHR feed product-id limitation
chore: bump tailwind to v4.1
```

## Breaking changes

Add a `!` after the type/scope and a `BREAKING CHANGE:` footer:

```
feat(api)!: drop support for legacy collection handles

BREAKING CHANGE: handles must now use the prefixed format.
```

## Next in the series

When the commit belongs to a ticket that has a task workspace (`.claude/fnd/<TICKET>/` — `${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`), tick `commit` in its `progress.md` after committing, then offer the next unchecked step in one line — normally `/fnd:create-pull-request <ticket>` when the branch has no open PR. Offer only; never auto-run.
