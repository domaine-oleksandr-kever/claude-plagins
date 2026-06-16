# Technical Approach — Format reference

All Technical Approach (TA) documents produced by Workflow 2 (`/write-technical-approach`) **must**
follow the **short format** below — the same structure used on ELC-126, ELC-80, and the current
Domaine tickets: seven H4 sections, dense and skimmable, no title/metadata block.

---

## North star

**The Jira ticket's Description and Acceptance Criteria are the governing source of truth.** Every
line in the TA describes **how** we deliver those requirements inside this repo.

- Every bullet should trace back to an AC line, a repo constraint (conventions, core protection,
  a11y / contrast / perf rules), or an engineer-confirmed assumption. If you can't trace it, cut it.
- Scope beyond the AC lives in **Assumptions** (with a reason) — never quietly inside another section.
- If the AC is ambiguous or incomplete, stop and flag it; don't invent scope to fill the gap.

---

## Target audience

Write for a **senior Shopify developer** who already knows the CLI / dev server / deploy flow,
Liquid + OS 2.0 sections/blocks, the theme editor, and Domaine / Foundation conventions
(`src/entry/core/*` protection, `@`-prefixed core snippets, `t:` keys, `BaseElementWithoutShadowDOM`).

**Goal:** a senior dev reads the TA in **~3 minutes** and gets a 90% understanding. Skip anything
they can infer. Don't restate how Shopify/CLI/Liquid work. No generic validation boilerplate
(`npm run dev`, `lint`) unless the ticket needs a non-obvious variation.

### Voice

Write how a senior dev talks in a PR description — plain, direct, dense, no throat-clearing. Avoid
AI-speak: no "first-class requirement", "honor X", "thoughtfully", motivational preambles, or
moralizing. If a human engineer wouldn't say it out loud, cut it. Favour fragments over full
sentences where they read cleaner (e.g. "PDP only — cart/checkout → ELC-303.").

---

## Rules

1. **File location:** `docs/technical-approaches/<TICKET-KEY>-technical-approach.md`. This directory
   is **gitignored by default** so per-ticket TAs stay local and don't ship in this client-facing repo.
2. **Sections:** Use **H4** (`####`) and the **exact seven section names, in this order** — do not
   rename, add, number, or reorder them:
   **Summary · Assumptions · Data / Config · Implementation · Accessibility & Performance · Dependencies · Files**
3. **No title or metadata block.** The file content *is* the field content: it starts at
   `#### Summary`. The ticket key/links live in Jira already; reference related tickets **inline**
   as external links where they matter (e.g. in Summary / Dependencies).
4. **Content style — terse and scannable:**
   - **Summary** is 1–2 dense paragraphs. Every other section is **bullets** (Files is the exception, below).
   - **Inline code** (`` `backticks` ``) for every file path, object, setting, selector, input name.
   - **Bold** for key terms and inline sub-labels (`**Liquid:**`, `**Form:**`, `**Block settings**`,
     `**New:**`, `**Modified:**`).
   - `·` (middle dot) as the inline separator for short lists (settings, files, related tickets).
   - One idea per bullet. No sub-bullets / nesting unless unavoidable.
5. **No internal file links.** The TA is pasted into Jira's Technical Approach field, where relative
   links render as plain text. Reference in-repo files/folders/rules with **inline code only**.
   **External** links are fine — other Jira tickets, Figma, public Shopify / Domaine docs.
6. **Scope discipline:** describe **how**, not **what** or **how to verify** — AC and Steps to test
   live in Jira, not here. Net-new apps / app embeds / scripts go under **Dependencies**.
7. **Jira parity:** the markdown file is the review source of truth; converted to ADF
   (`${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs`) it must paste in as the same seven H4 sections.
8. **Client confidentiality:** this repo is client-facing — never reference tickets, projects, repos,
   or Figma files from other client accounts.

---

## Canonical template

Copy this skeleton. Replace placeholders; keep the seven headings and their order. Start at `#### Summary`.

```markdown
#### Summary

<1–2 dense paragraphs: what we're building and why, the key behavior/defaults, and where the data
comes from. State the load-bearing decision up front (e.g. "theme-owned selector, not the app
block"). Link related tickets inline where relevant.>

#### Assumptions

- <scope boundary — what's out of scope and where it lives, e.g. "cart/checkout → [ELC-303](url)">
- <precondition that must hold (app installed, data shape, admin config)>
- <ownership — what the BFF / app / admin owns vs the theme>

#### Data / Config

- **Liquid:** <objects / data read, and gating (when to show/hide)>
- **Form:** <hidden inputs / what ATC submits>, if any
- **Block settings** (`<block>` on `<section>`): `setting` (type, default) · `setting` (type) ...
- Locales: <which `t:` keys / which file; or "fallback only, copy from BFF">

#### Implementation

- <new file `path` + the key behavior it owns, terse>
- <how existing pieces are reused (snippets/components) and the extend-not-edit-core point>
- <JS/TS entry `path` + what it syncs / fetches>

#### Accessibility & Performance

- <a11y: semantics, labels, focus, keyboard, contrast — only the non-obvious bits>
- <perf: SSR vs fetch, number of network calls, CLS/LCP touchpoints>

#### Dependencies

- <prereqs / net-new apps / app embeds / scripts / sync jobs / per-market config>
- <related tickets this blocks-on or hands-off to, as inline links>

#### Files

**New:** `path/to/new-a` · `path/to/new-b`
**Modified:** `path/to/mod-a` · `path/to/mod-b` · locales · `templates/<x>.json`
```

---

## Section intent cheatsheet

| Section | Ask yourself |
| --- | --- |
| Summary | What are we building, what's the key decision/default, and where does the data come from? |
| Assumptions | What's out of scope (→ which ticket), what must already be true, who owns what? |
| Data / Config | Which Liquid objects, form inputs, block/section settings, metafields, and locale keys are touched? |
| Implementation | Which files are new/changed, what behavior each owns, what's reused, where we extend core? |
| Accessibility & Performance | The non-obvious a11y semantics and the runtime/payload/CLS/LCP impact. |
| Dependencies | What must exist (apps, BFF, data, other tickets) for this to work or be QA'd? |
| Files | Concrete `New:` / `Modified:` path list. |

---

## Worked reference (abridged, from ELC-126)

```markdown
#### Summary

Build a **theme-owned subscription selector** on PDP — not the Shopify Subscriptions app block.
One-time vs subscribe radios, allocation pricing, info tooltip. Hidden `selling_plan` on the product
form; empty = one-time. Default = one-time; subscribe defaults to **4 months** when that plan exists
on the active SKU, else first allocation. On flattened parents ([ELC-70](url)) selling plans live on
**child SKUs** — read allocations from the hydrated child; re-render via SRA on child change.

#### Data / Config

- **Liquid:** `variant.selling_plan_allocations` on the active variant; hide when none.
- **Form:** hidden `<input name="selling_plan">`; ATC submits child variant id + plan id.
- **Block settings** (`subscription_selector` on `main-product`): `tooltip_page` (page) · `show_automatic_price` (checkbox, default true).

#### Files

**New:** `snippets/product--main__subscription-selector.liquid` · `src/entry/subscription-selector.ts`
**Modified:** `sections/main-product.liquid` · `snippets/product--main.liquid` · locales · `templates/product.json`
```

---

## Anti-patterns to avoid

- **Long prose** — only Summary is paragraphs; everything else is tight bullets.
- **Scope that doesn't trace to the AC** — map every bullet to a requirement, assumption, or repo
  constraint, or cut it / move it to Assumptions.
- **Embedding AC / steps-to-test** — the TA is *how*, not *what* / *how to verify*; those stay in Jira.
- **Renaming / numbering / reordering** the seven sections, or adding a title/metadata block.
- **Internal repo file links** — inline code for in-repo paths; markdown links only for external destinations.
- **Tutorial explanations / generic validation boilerplate** — assume senior-dev baseline.
- **Listing the Shopify platform, CDN, theme editor, or already-installed apps** under Dependencies —
  that section is for net-new prerequisites only.
- **AI-speak** — write like a dev, not a copywriter.
- **Cross-client references** — never cite other client accounts' tickets, repos, or Figma.

---

## When to update this file

Update this reference when the Jira Technical Approach field structure changes, Domaine's playbook
adds/removes/renames standard sections, or repeated engineer feedback surfaces a better pattern. Keep
edits in lockstep with the `write-technical-approach` skill so it always references the current format.
