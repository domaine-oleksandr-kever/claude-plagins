# Task workspace — per-ticket cache of reader outputs & working notes

Once `jira-reader` / `figma-reader` have pulled a ticket or a Figma node, their structured
output is saved to files in the project so the **next** skill — or a new session, or the turn
after a `/compact` — reads the file instead of re-spawning the agent. Facts that live here
survive context compaction, so compacting between workflow steps becomes cheap.

## Location & layout

`.claude/fnd/<work-id>/` in the project repo — one folder per **unit of work**; the folder is a
**cache**, safe to delete at any time (suggest removing it once the ticket is Done). `<work-id>` is
the **ticket key** (`ELC-206`) for single-ticket work; for a **batch shipping as one PR**
(several bug tickets fixed on one branch, no full series per bug) use the **branch slug**
(`fix-plp-bugs`) with one `ticket-<KEY>.md` per ticket inside:

| File | Holds | Written by |
|---|---|---|
| `ticket.md` — in a batch, `ticket-<KEY>.md` each | `jira-reader` structured output, **verbatim** (Description, AC, Assumptions, TA, Steps to Test, links) | the skill that ran the fetch |
| `figma-<node-id>.md` | one `figma-reader` build spec, **verbatim** — one file per node | same |
| `doc-<slug>.md` | one linked doc's **extracted** content (data models, copy, field lists — never the raw page); slug from the page title | the skill that read it |
| `plan.md` | the **approved implementation plan**, verbatim | `develop-feature-or-fix`, at its ✋ checkpoint |
| `qa.md` | the **approved QA checklist**, then the pass/fail report + confirmed findings with their repro values | `qa-feature-or-fix` |
| `steps-to-test.md` | the **approved Steps to Test** (local copy of what went to Jira) | `write-steps-to-test` |
| `metaobject-setup.graphql` | the Mode 2 living data-model setup file (`references/metafield-metaobject-setup.md`); inspection drafts go in `tmp/` | `develop-feature-or-fix` |
| `notes.md` | append-only dated log: checkpoint decisions, gotchas, provisioned metafield/metaobject gids, preview theme name/id, test page paths; in a batch — root cause + fix summary per bug | any skill, at natural boundaries |
| `progress.md` | work checklist — what's done, what's next (date + one-line status) | every series skill, at completion |
| `tmp/` | scratch made while working — test scripts, query drafts, JSON dumps, screenshots — instead of littering the project root | anyone; delete freely |

Frontmatter on ticket files: `ticket`, `url`, `fetched_at` (ISO datetime), `jira_updated` (the
ticket's `updated` field as Jira returned it), and `verified_at` (last freshness probe that
matched). On `figma-*.md`: `url`, `fetched_at`. On `doc-*.md`: `url`, `title`, `fetched_at`,
`last_edited` (the source's own last-edited stamp, when known) and — when sub-pages were folded
into the extract — a `sources:` list of url + last-edited pairs. The TA
itself isn't duplicated here — it already lives in
`docs/technical-approaches/<KEY>-technical-approach.md` (gitignored) and on the ticket.

**Keep it out of git.** Before the first write, ensure the folder is ignored **locally** (never
ships in a diff):

```bash
git check-ignore -q .claude/fnd || echo '.claude/fnd/' >> .git/info/exclude
```

A team that prefers a committed rule can put the line in `.gitignore` instead.

## Read rule — context-first order

1. **This conversation** — the fields are already in context, in full (not summarized): use them.
2. **The workspace files** — present and fresh (below): read them; don't spawn a reader.
3. **Fetch** — spawn `jira-reader` / `figma-reader`, or read the linked doc, then save the
   output (write rule).

### Freshness

- Ticket files: **re-verify before trusting** when (a) it's a new session, (b) `fetched_at` /
  `verified_at` is **older than 24 h** — even mid-session, or (c) the developer hints the
  ticket changed. The check is a cheap probe from the main loop — `getJiraIssue` with
  `fields: ["updated"]` only (tiny response, no subagent): match → stamp `verified_at` and
  trust the cache (probe at most once per session unless hinted).
- **Probe mismatch ≠ stale.** Jira bumps `updated` on sprint moves, rank, priority,
  status/assignee flips, estimates, comments — none of which touch what the cache stores.
  Don't re-fetch blindly: spawn `jira-reader` **passing the stored `jira_updated`** — it
  checks the changelog first (its freshness mode) and returns either `no_content_change`
  (→ keep the cache: overwrite `jira_updated` with the new value, fix the `status:` line if
  it moved, stamp `verified_at` — so the same noise never re-triggers — and tell the
  developer in one line, e.g. "ticket bump was Sprint ×1, comments — cache still valid") or,
  when a cached field really changed, the full re-read in the same spawn → rewrite the file.
- **Probe unavailable** (Atlassian MCP not connected)? Don't trust silently — tell the
  developer the cache age ("ticket cached N h ago — use it, or refresh?") and let them decide.
- `figma-*.md`: no cheap version probe exists — when in doubt, ask the developer whether the
  design changed since `fetched_at`.
- `doc-*.md`: same triggers as ticket files. Cheap probe, no full fetch — **Notion**:
  `notion-search` the stored `title` (small `page_size`, `max_highlight_length: 0`), match the
  result to the page id embedded in the stored `url`, read its `timestamp`: a **day**-granular
  last-edited date (covers connected Google-Drive docs too); **Confluence**:
  `searchConfluenceUsingCql` with `cql: "id=<pageId>"` → precise `lastModified`. Probe date ≤
  stored `last_edited` / `fetched_at` date → fresh: stamp `verified_at`; newer → re-fetch,
  re-extract, overwrite. Same-day edits (day granularity) and plain-web links (no probe): ask,
  as with `figma-*.md`. An extract that lacks something *this* task needs isn't stale, it's
  incomplete — re-read the source.
- `notes.md` is a log; it doesn't go stale.

## Write rule

- Immediately after a reader returns, write its structured output **verbatim** — don't
  re-summarize; later skills need the full fields. Overwrite on re-fetch.
- `doc-*.md` holds the **extract** (what the task needs), not the page — write it right after
  reading the source, while the content is at hand.
- Append to `notes.md` at natural boundaries — approved-plan decisions, provisioned data
  (gids), preview theme, test URLs, confirmed bugs + the hostile values that triggered them.
  One dated `##` entry per event, newest last.
- Scratch files created while working (test scripts, query drafts, dumps, screenshots) go in
  the workspace `tmp/` — never the project root.
- **Never** store secrets (tokens, `.env` values) or raw payloads (ADF, Figma node trees, full Notion/Confluence pages) —
  only the readers' compact structured outputs.

## Progress tracking — `progress.md`

So a **clean/new session** knows where the work stands and what to offer next. The first
series skill to run on a ticket creates the folder and this file with the full list unchecked;
outside the series (ad-hoc flows), the `save-task-context` skill or the session convention does:

```markdown
---
ticket: ELC-206
updated: <ISO datetime>
session: <$CLAUDE_CODE_SESSION_ID of the last session that wrote here>
---
- [ ] write-technical-approach
- [ ] develop-feature-or-fix
- [ ] qa-feature-or-fix
- [ ] pre-commit-review
- [ ] commit
- [ ] create-pull-request
- [ ] write-steps-to-test
```

For a **batch** (`<work-id>` = branch slug) the rows are the tickets plus the same shared tail
(pre-commit-review → … → write-steps-to-test) — check each bug off as it's fixed, with its root
cause: `- [x] ELC-301 — 2026-07-11, fixed: self-reference skipped in bundle resolve`.

- On completing its workflow (final report delivered and, where applicable, approved), a skill
  checks off its row and appends `— <date>, <one-line status>` (branch, PR URL, "QA: 2 blocking
  bugs", …). Re-runs update the row in place; stamp `updated` and `session` (from
  `$CLAUDE_CODE_SESSION_ID`; skip if unset) on every write.
- **Offering the next step:** offer the first unchecked row (QA failures branch back to the
  implementation flow first). In a fresh session, reading this file replaces the lost
  conversation state — when the developer brings up a ticket that has a workspace, report where
  the series stands and offer the next unchecked step.
- **Resuming a conversation:** `session` names the conversation that last wrote here. On
  *"where did we leave off on X?"*, answer from `progress.md` + `notes.md`; if it isn't the
  current session, also offer `claude --resume <session>` (from this project). A detail the
  workspace didn't capture → pull the last user/assistant messages from that transcript's tail
  (`~/.claude/projects/<project-dir-slug>/<session>.jsonl`), not the tool dumps.
