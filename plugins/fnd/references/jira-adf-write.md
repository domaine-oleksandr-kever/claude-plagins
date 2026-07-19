# Writing to Jira rich-text fields — emit ADF, via the converter

The rich-text fields — **Description, Acceptance Criteria, Assumptions, Technical
Approach, Steps to test, Documentation Links** (and issue **comments**) — store
**Atlassian Document Format**, not markdown. When a workflow updates one via
`editJiraIssue` (or `addCommentToJiraIssue`), **convert the approved content to an ADF
document first** and pass that object as the field value. A bare markdown/plain string
sent to a rich-text field is rejected or stored literally. This applies to every skill
that writes back: `write-technical-approach` (Technical Approach), `write-steps-to-test`
(Steps to test), and any `qa-feature-or-fix` write.

## Preferred path from the main loop — delegate to the `jira-writer` subagent

A converted field/comment is a large ADF blob (~3.4k tokens for a real Technical
Approach). Running the converter and typing that object into an `editJiraIssue` call
**inline** pays for it twice in the main-loop context — the converter's stdout copy and
the model-typed argument copy — and leaves it in history forever. So from a main-loop
skill, **after the ✋ approval**, delegate the write to the **`jira-writer`** subagent
instead: it converts and writes inside its own disposable context, and the ADF never
touches the main loop.

Brief (one writer per field; parallel writers for several fields):

> **jira-writer** — ticket `<KEY>` · target `<customfield_id>` (or `comment`) · source
> `<path to the approved .md>`. (Add `tables: keep` only if tables must be preserved.)

It returns one line: `ok: <KEY> <target> written (<n> bytes ADF)` or `error: <reason>`.
The approval gate stays in the calling skill — `jira-writer` only inflates and writes, it
never authorizes or decides content. Resolve the field id yourself (`jira-field-ids.md`)
and pass it in; a manual-update path (developer edits Jira) needs no writer at all.

One case keeps the write **inline** (no `jira-writer` spawn): you are **already inside a
subagent** (subagents can't nest — the ADF is already off the main loop, so convert and
write directly with the mechanics below). A **manual** update is different again: the
developer edits Jira themselves, so no converter runs and no writer is spawned at all.

## The mechanics — use the converter, don't hand-build ADF

`jira-writer` runs exactly this; it is also the inline / manual recipe.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables <approved.md>   # or pipe via stdin
```

It prints the ADF document JSON to stdout; pass that object straight to `editJiraIssue`.
Dependency-free Node, deterministic; supports headings, **bold**/*italic*/`code`/links/
~~strike~~, bullet & ordered lists, fenced code blocks, `---` rules, blockquotes, and GFM
tables. (Underscore emphasis is deliberately ignored so `customfield_10038`-style
snake_case survives — use `*`/`**` for emphasis.) Typical flow: write the approved content
to a temp `.md`, convert, capture the JSON, then `editJiraIssue` with
`fields: { "<id>": <that JSON> }`.

## Keep the ADF compact — a huge field value is fragile (never fall back to markdown)

A large ADF object is fragile to inline into one `editJiraIssue` call — one slip breaks
the JSON, which tempts "shortcutting" to a raw **markdown string**. Don't: Jira rich-text
**custom** fields reject it (`Operation value must be an Atlassian Document…`; the MCP's
auto-conversion for comments/description does **not** extend to custom fields). Keep the
ADF small instead:

- **Output is minified by default** — use `--pretty` only to eyeball it.
- **Pass `--no-tables`** — ADF `table` nodes are the heaviest construct; `--no-tables`
  renders each table row as one compact bullet.
- **Prefer headings + lists over tables in the source markdown**; reserve tables for
  genuinely tabular, short data.
- The converter **prints a size warning to stderr** when the ADF is large — a signal to
  **trim/restructure**, never to switch to markdown.

**Document wrapper** (what the converter emits):

```json
{ "type": "doc", "version": 1, "content": [ /* block nodes */ ] }
```

**Call shape:** `editJiraIssue` with `fields: { "<customfield_id>": <ADF doc object> }` —
field IDs live in `jira-field-ids.md` (their single home; an ID missing from the `names`
map → Step B in `jira-custom-fields.md`).

> Honour the TA rule: **no internal repo file links** — reference in-repo files with an
> inline-`code` mark, never a `link` mark. External links (Jira, Figma, public docs) use
> `link`.
