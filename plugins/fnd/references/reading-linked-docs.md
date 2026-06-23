# Reading linked docs — Notion & other external links

Shared reference for every workflow that ingests a Jira ticket (`/write-technical-approach`,
`/develop-feature-or-fix`, `/qa-feature-or-fix`, `/write-steps-to-test`). A ticket is rarely
self-contained: it links out to **Notion** data-mapping / spec docs, **Figma** frames,
**Confluence** pages, Google docs, etc. Those links carry real scope (data models, copy, field
lists, edge cases). **Skipping them means planning against an incomplete picture.** So: read the
links, don't just collect them.

## 1 — Collect every link

From the `jira-reader` output use **`documentation_links`**, **`figma_urls`**, **`notion_urls`**,
and **`other_links`**, plus any inline links inside `description` / `acceptance_criteria` /
`technical_approach` (the `adf-to-md.cjs` decoder preserves inline-mark links **and** block-level
smart links — `inlineCard` / `blockCard` / `embedCard` — as `<url>`, so they survive into the
text). De-duplicate, then read **all** of them — not only the Notion ones.

## 2 — Read each link by type

| Link | How to read |
| --- | --- |
| **Notion** (`notion.so`, `*.notion.site`) | **Notion MCP** — `notion-fetch` with the page URL/ID; `notion-search` to locate a page when only a name is given. **Follow the sub-pages / linked databases that this ticket points at** (e.g. a "V2 data mapping" child), not just the top page. |
| **Figma** (`figma.com`) | the `figma-reader` subagent (one per URL) — already part of the develop/QA flow. |
| **Confluence** (`*.atlassian.net/wiki`) | Atlassian MCP — `getConfluencePage` (+ footer/inline comments if relevant). |
| **Other web URLs** (docs, articles, Shopify/3rd-party docs) | `WebFetch` with a focused prompt. |

Keep the heavy payload **out of context**: extract only what the task needs — data mappings,
field/property lists, copy, asset links, constraints — and (for data-model docs) the
metafield / metaobject schema, which feeds
`${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`.

## 3 — If the Notion MCP isn't configured

If the ticket has a Notion link but the **Notion MCP isn't connected** (tool calls fail / the
server is absent), **do not silently skip it** — Notion is usually where the data model and final
copy live, so proceeding blind risks building the wrong thing. **Stop and notify the developer:**

> "This ticket links Notion docs I can't read — the Notion MCP isn't connected: `<list the URLs>`.
> Either enable the Notion MCP (`/mcp`) and I'll read them, or paste the relevant content here."

Then wait. The same applies to any other link type whose tool is unavailable — name the
unreadable links and ask, rather than guessing.

## 4 — Rule of thumb

- **Read all links, every type** — Notion is mandatory, but Figma/Confluence/web links are too.
- **Notion is authoritative for data models & copy** — when it disagrees with the ticket body,
  surface the conflict to the developer instead of picking one silently.
- Treat what you read as first-class context alongside the AC — every plan/TA bullet should trace
  to the ticket **or** a linked doc.
