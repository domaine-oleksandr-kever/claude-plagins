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

## Parsing ADF responses

Custom fields return **Atlassian Document Format** (nested JSON with `type: "doc"`). Either:

- Pass `responseContentFormat: "markdown"` for the overall response where supported, or
- Walk the ADF tree and extract all `text` values, respecting structure (headings, lists, tables)
  to reconstruct readable content.

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
