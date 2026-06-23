# Jira custom fields — discovery reference

Shared reference for every workflow that ingests a Jira ticket (`/write-technical-approach`,
`/develop-feature-or-fix`, `/qa-feature-or-fix`, `/write-steps-to-test`, `/create-pull-request`).
It documents how to locate the ticket fields the workflows depend on:

**Description · Acceptance Criteria · Assumptions · Technical Approach · Documentation Links · Steps to test**

## Why this is needed

The default `getJiraIssue` / `fetch` call (even with `responseContentFormat: "markdown"`) returns
only a **narrow default field set** — typically `summary`, `description`, `status`, `assignee`.
Acceptance Criteria, Assumptions, Technical Approach, Documentation Links, and Steps to test all
live in **custom fields** that must be **explicitly requested by ID**, or discovered (Step B).

## Step A — Known field IDs (meetdomaine site)

Verified against `meetdomaine.atlassian.net` (discovery run on ELC-61, 2026-05-30):

| Field               | Field ID                 |
| ------------------- | ------------------------ |
| Description         | `description` (standard) |
| Acceptance Criteria | `customfield_10036`      |
| Assumptions         | `customfield_10037`      |
| Technical Approach  | `customfield_10038`      |
| Steps to test       | `customfield_10040`      |
| Documentation Links | `customfield_10047`      |

Ready-to-paste request — **always include `expand: "names"`** (you need it to tell "empty" from
"wrong ID", see below):

```
fields: ["summary", "description", "status", "assignee",
         "customfield_10036", "customfield_10037", "customfield_10038",
         "customfield_10040", "customfield_10047"],
expand: "names"
```

### Empty field vs. wrong ID — don't run discovery for an empty field

A `null` value does **not** mean the ID is wrong. Verified against the live API (ELC-61,
2026-05-30):

| Case                        | `names` map        | `fields` value | Meaning                        |
| --------------------------- | ------------------ | -------------- | ------------------------------ |
| Field exists, **filled**    | has the ID + label | ADF doc / text | use it                         |
| Field exists, **empty**     | has the ID + label | `null`         | genuinely empty - **leave it** |
| Field ID **does not exist** | **absent**         | **absent**     | wrong ID - go to **Step B**    |

(An unknown custom-field ID is **silently dropped** from both `names` and `fields` — no error is
raised, so "absent from `names`" is the signal, not a failed request.)

So the decision rule:

- ID **present in the `names` map** → the ID is correct. A `null` value just means the field is
  empty on this ticket; **do not** fall through to Step B, just note it's empty.
- ID **missing from the `names` map** → the ID is wrong / not on this site → fall through to
  **Step B** to rediscover it.

> ⚠️ Note: an earlier version of the playbook mapped `customfield_10037` to Acceptance Criteria —
> that was wrong. `10037` is **Assumptions**; Acceptance Criteria is `customfield_10036`.

### Are these IDs the same in every project?

**Within one Atlassian site, yes.** Custom-field IDs are **global to the site** (`cloudId`), not
per-project — so these IDs hold for every project on `meetdomaine.atlassian.net` (ELC and others).
But:

- A **different Atlassian site / space has completely different IDs** — never assume these IDs
  there.
- A project may simply **not expose a given field** on its screens, so it returns `null` even
  though the ID is valid.

In both cases, fall through to Step B to resolve the live IDs.

## Step B — Discovery fallback (when Step A is null/missing or you're on a new site)

This was verified working — it's the source of the Step A table.

1. Call `getJiraIssue` on a representative ticket with **`expand: "names"`** and either
   `fields: ["*all"]` or a broad custom-field range:

   ```
   fields: ["*all"], expand: "names"
   // or, to keep the response smaller:
   fields: ["customfield_10030", ..., "customfield_10060"], expand: "names"
   ```

2. The response includes a **`names` map** of `fieldId → human-readable label`, e.g.
   `"customfield_10036": "Acceptance Criteria"`. Scan it for the labels you need
   ("Acceptance Criteria", "Assumptions", "Technical Approach", "Documentation Links",
   "Steps to test") to resolve the live IDs.

3. Cross-check the `fields` values: AC / Assumptions / TA / Documentation Links are rich-text
   (ADF) fields; a `null` value means the field is empty on that ticket, not that the ID is wrong.

4. Reuse the resolved IDs for the rest of the session.

5. **If a resolved ID differs from the Step A table above (and you're on `meetdomaine`), alert the
   Engineer:** e.g. _"`Steps to test` is now `customfield_10041`, not `10040` — want me to update
   the Step A table in `jira-custom-fields.md`? It can ride along with this task's other changes."_
   These IDs are shared site-wide, so fixing the table once spares every other workflow (and
   engineer) from re-running discovery and burning time/tokens. Only edit on confirmation.

> Tip: `fields: ["*all"]` can return a very large response. If your tooling truncates it, save the
> result to a file and grep the `names` map for the labels rather than reading the whole payload.

## Parsing ADF responses — markdown when given, decode when not

Always request `responseContentFormat: "markdown"`. Then decide **per field** by the value's shape:

- **Already a string / markdown** → use it as-is. This is what `description` and `comment` return
  under `markdown` format.
- **Still raw ADF** (a JSON object with `type: "doc"`) → **decode it with the bundled converter**.
  The markdown conversion does **not** apply to rich-text **custom** fields — Acceptance Criteria,
  Assumptions, Technical Approach, Steps to test, Documentation Links come back as raw ADF even
  under `markdown` format (verified on ELC-126). Don't hand-walk the JSON; run:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/adf-to-md.cjs <issue.json> --field <customfield_id>
  ```

  Save the getJiraIssue response to a temp file and decode each ADF field with `--field`; it prints
  clean markdown (headings, bold/italic/code/links, lists, code blocks, blockquotes, tables) and
  keeps the bulky raw ADF out of context. `adf-to-md.cjs` is the inverse of `md-to-adf.cjs` (used on
  the write side). A field that is `null` is genuinely empty — report it empty, don't decode.

## Writing to a custom field — emit ADF (don't send markdown/plain text)

The rich-text fields — **Description, Acceptance Criteria, Assumptions, Technical Approach,
Steps to test, Documentation Links** (and issue **comments**) — store **Atlassian Document Format**,
not markdown. When a workflow updates one via `editJiraIssue` (or `addCommentToJiraIssue`),
**convert the approved content to an ADF document first** and pass that object as the field value.
A bare markdown/plain string sent to a rich-text field is rejected or stored literally (asterisks,
`#`, and `|` show up verbatim, lists/tables don't render). This applies to every skill that writes
back: `write-technical-approach` (Technical Approach), `write-steps-to-test` (Steps to test), and
any `qa-feature-or-fix` write.

### Use the converter — don't hand-build ADF

Run the approved markdown through the bundled converter instead of assembling ADF JSON by hand:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables <approved.md>   # or pipe markdown via stdin
```

It prints the ADF document JSON to stdout; pass that object straight to `editJiraIssue`. It's
dependency-free Node, deterministic, and supports headings, **bold**/*italic*/`code`/[links](u)/
~~strike~~, bullet & ordered lists, fenced code blocks, `---` rules, blockquotes, and GFM tables.
(Underscore emphasis is deliberately ignored so `customfield_10038`-style snake_case survives — use
`*`/`**` for emphasis.) Typical flow: write the approved content to a temp `.md`, convert, capture
the JSON, then `editJiraIssue` with `fields: { "<id>": <that JSON> }`. The cheat-sheet below is just
to read/verify the output — the script is the path of record.

#### Keep the ADF compact — a huge field value is fragile (and don't fall back to markdown)

A large ADF object is **fragile to inline into one `editJiraIssue` tool call** — one slip breaks the
JSON, which tempts "shortcutting" by sending a raw **markdown string**. Don't: Jira rich-text
**custom** fields reject it with `Operation value must be an Atlassian Document (see the Atlassian
Document Format)`. (The auto markdown→ADF conversion the MCP does for **comments/description** does
**not** extend to arbitrary custom fields.) ADF is the only accepted form — so keep it small instead:

- **Output is minified by default** (≈half the bytes of the old pretty-printed form) — nothing
  downstream needs indentation, it all goes into the tool call. Use `--pretty` only to eyeball it.
- **Pass `--no-tables`.** ADF `table` nodes are by far the heaviest construct (every cell wraps a
  paragraph). `--no-tables` renders each table row as one compact bullet (`Header: cell · Header:
  cell`). For long Steps to Test this is a large saving and far more robust.
- **Prefer headings + bullet/ordered lists over tables in the source markdown.** That keeps the ADF
  small *and* reads well in Jira; reserve tables for genuinely tabular, short data.
- The converter **prints a size warning to stderr** when the ADF is large (or table-heavy). Treat it
  as a signal to **trim/restructure** (shorter content, drop tables) — never as a reason to switch to
  markdown.

**Document wrapper** — always this shape:

```json
{ "type": "doc", "version": 1, "content": [ /* block nodes */ ] }
```

**Node cheat-sheet** (the blocks these TAs / test steps actually use):

| Markdown | ADF node |
| --- | --- |
| `## Heading` | `{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Heading"}]}` |
| paragraph | `{"type":"paragraph","content":[{"type":"text","text":"…"}]}` |
| **bold** / *italic* | `text` with `"marks":[{"type":"strong"}]` / `[{"type":"em"}]` |
| `` `inline code` `` | `text` with `"marks":[{"type":"code"}]` |
| `[label](url)` | `text` with `"marks":[{"type":"link","attrs":{"href":"url"}}]` |
| `- item` (bullets) | `{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[…]}]}]}` |
| `1. item` (ordered) | `{"type":"orderedList","content":[{"type":"listItem",…}]}` |
| fenced code block | `{"type":"codeBlock","attrs":{"language":"liquid"},"content":[{"type":"text","text":"…"}]}` |
| `---` | `{"type":"rule"}` |
| table | `table` → `tableRow` → `tableHeader`/`tableCell` → block nodes |

**Minimal worked example** (a TA heading + paragraph with an inline-code reference):

```json
{ "type": "doc", "version": 1, "content": [
  { "type": "heading", "attrs": { "level": 2 }, "content": [ { "type": "text", "text": "Approach" } ] },
  { "type": "paragraph", "content": [
    { "type": "text", "text": "Extend " },
    { "type": "text", "text": "sections/main-header.liquid", "marks": [ { "type": "code" } ] },
    { "type": "text", "text": " — do not edit core." } ] }
] }
```

**Call shape:** `editJiraIssue` with `fields: { "<customfield_id>": <ADF doc object> }` — e.g.
`{ "customfield_10038": { "type": "doc", "version": 1, "content": [ … ] } }` for Technical Approach.
Keep the per-field ID from the Step A table (resolve via Step B if it's not in the `names` map).

> Honour the existing TA rule: **no internal repo file links** — reference in-repo files with an
> inline-`code` mark, never a `link` mark. External links (Jira, Figma, public docs) use `link`.

## Fallback — Atlassian MCP unavailable

If Atlassian MCP tool calls fail ("server does not exist") or Jira is not reachable without auth,
ask the Engineer to paste into the thread: issue **summary**, **description**, **Acceptance
Criteria**, **Technical Approach**, and any linked issue keys. Unauthenticated HTTP/curl to
`*.atlassian.net/browse/...` returns the SPA shell, not issue fields.

## When to update this file

This is a **manual** maintenance note — nothing here re-runs by itself; the Step A table is only
as current as the last time someone updated it. The Step B discovery is the live source of truth
when in doubt. Update the Step A table by hand when:

- A field is renamed or added, or the agent notices a Step A ID has fallen out of the `names` map
  (run Step B, then paste the corrected IDs into the table here).
- You're targeting a **different Atlassian site** — those IDs differ, so document them separately
  rather than overwriting the meetdomaine table.

Keep in lockstep with the command files that link here — the same "Living updates" convention the
other references use.
