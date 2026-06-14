# Technical Approach — Format reference

All Technical Approach (TA) documents produced by Workflow 2 (`/write-technical-approach`) **must** follow the structure below.

---

## North star

**The Jira ticket's Description and Acceptance Criteria are the governing source of truth.** Every section in the TA exists to describe **how** we deliver those requirements inside this repo. Specifically:

- Every bullet in sections 1–8 should be traceable back to an AC line, a repo constraint (conventions, `core.mdc`, a11y / contrast / perf rules), or an engineer-confirmed assumption. If you can't trace it, cut it or move it.
- Ticket-stated assumptions (anything the ticket itself declares as given) are folded into the **Assumptions (engineer-confirmed)** block so the TA and ticket agree.
- Scope beyond the AC lives in **Assumptions** (with a reason) or **Open follow-ups** (for BSA / design) — never quietly inside a numbered section.
- If the AC is ambiguous or incomplete, stop and flag it; don't invent scope to fill the gap.

---

## Target audience

Write for a **senior Shopify developer** who already knows:

- Shopify CLI, theme dev server, preview, and deploy flows
- Liquid, Online Store 2.0 sections / blocks, `content_for`, static blocks
- Theme editor / customizer navigation and merchant-facing settings
- Domaine / Foundation (this repo) conventions — e.g. `src/entry/core/*` protection, `@`-prefixed core snippets, `t:` translation keys, `BaseElementWithoutShadowDOM`, `@needs-script`

**Goal:** a TA should take a senior dev **~5 minutes** to read and give them a 90% understanding of the task. Skip anything they can infer. Do **not** restate how Shopify, the CLI, theme editor, or common Liquid primitives work. Do **not** include generic validation steps (`npm run dev`, `lint`, etc.) unless the ticket needs a non-obvious variation.

Write specifics, decisions, and non-obvious constraints — not tutorials.

### Voice

Write how a senior dev would talk in a PR description or a Slack thread — plain, direct, no throat-clearing. Avoid AI-speak: no "first-class requirement", "honor X", "thoughtfully", "re-render churn", "measured change justifies otherwise", "dedicated QA pass", motivational preambles ("This is on every page — mistakes hurt sitewide"), or moralizing ("do this in code, not spec"). If a human engineer wouldn't say it out loud, cut it.

---

## Rules

1. **File location:** `docs/technical-approaches/<TICKET-KEY>-technical-approach.md` (e.g. `docs/technical-approaches/PROJECT-55-technical-approach.md`). This directory is **gitignored by default** (see `.gitignore`) so per-ticket TAs stay local / internal and do not ship in this client-facing repo.
2. **Section headings:** Use **H4** (`####`) and the **exact numbered section order** below. Do not rename, add, or reorder top-level sections.
3. **Assumptions heading:** Use **H4** (`#### Assumptions (engineer-confirmed)`) so it matches the numbered sections visually. Place it above section 1.
4. **Content style:**
   - Short prose paragraphs. Prefer **bullets** and **tables** over long paragraphs.
   - **Tables** with two or three columns are the default for Integrations, Risk Mitigation, and Code Integrity.
   - Use **inline code** (`` `backticks` ``) for file paths, config keys, component/setting names.
   - Use **bold sub-labels** (e.g. `**New files:**`, `**Modified files:**`) inside a section rather than H5 sub-headings.
5. **No internal file links.** The TA is pasted into Jira's Technical Approach field, where relative links like `[foo.liquid](../../blocks/foo.liquid)` render as unformatted text. Reference files, folders, and repo rules using **inline code only** (e.g. `` `blocks/_header-mega-menu.liquid` ``). **External** links are fine — other Jira tickets, Figma files, public Shopify docs, public Domaine docs.
6. **Data Management is a config inventory, not a summary.** List the actual block / section / snippet settings (and metafields / metaobjects, if any). For each item, mark `(new)` or `(existing)` and note the type + options. Example:

   ```
   All config lives on `sections/main-header.liquid`. No metafields / metaobjects.

   - `logo_position` (existing, `left` | `center`).
   - `enable_sticky` (new, checkbox) — drives sticky across all breakpoints.
   - `search_style` (new, select, `icon_only` | `icon_with_input`).
   - Add `t:` keys for every new label / option in `locales/en.default.schema.json`.
   ```

   When the feature is block-based, list the parent block / section first, then the child block types it accepts, then each block's new / existing settings. Narrative prose about _what_ the feature does belongs in **§3 Feature Enhancement Considerations**, not here.

7. **Scope discipline:** Keep TA focused on **how** the work will be implemented — AC and steps-to-test themselves live in Jira, not here. Every bullet should still trace back to an AC, an assumption, or a repo constraint; if it doesn't, cut it.
8. **Assumptions content:** Record two things under the Assumptions heading: (a) scoping decisions confirmed by the engineer during Phase 1, and (b) assumptions the **ticket itself** states. Do not bury either inside numbered sections.
9. **Jira parity:** The markdown file is the source of truth for review; when updating Jira’s **Technical Approach** custom field, the content should paste in cleanly as numbered H4 sections with the same headings.
10. **Client confidentiality:** This repo is client-facing. **Never** reference tickets, Jira projects, repos, or Figma files from other client accounts. Examples and references must come from this repo or public Shopify / Domaine documentation.

---

## Canonical template

Copy this skeleton for new TAs. Replace placeholder text; keep headings and order.

```markdown
# <TICKET-KEY> — <Ticket summary> — Technical Approach

**Jira:** [<TICKET-KEY>](jira-url)
**Epic / parent:** [<PARENT-KEY>](jira-url) — <Parent summary>
**Related:** <KEY-1>, <KEY-2> (one-line relationship notes optional)
**Status:** Draft for engineer review

#### Assumptions (engineer-confirmed)

- <short, numbered decision from Phase 1>
- <...>

#### 1. Data Management

One-line anchor (where config lives; any metafields / metaobjects) followed by a **bulleted list of the actual settings / blocks / metafields touched**, each marked `(new)` or `(existing)` with type + options. Example:

- `<setting_key>` (new | existing, `<type>`, `<option_a>` | `<option_b>`) — one-line note on behavior or gating (e.g. `visible_if`).
- Add `t:` keys for every new label / option in `locales/en.default.schema.json`.

Narrative about _what_ the feature does belongs in §3, not here.

#### 2. Production Dependencies

Production-facing dependencies: apps, integrations, feature flags, theme sections/templates that must exist, sync jobs, deploy order. Call out environments (dev store, staging) if relevant.

#### 3. Feature Enhancement Considerations

How this change affects existing behavior and code paths. Patterns to follow from elsewhere in the codebase. Migration / back-compat notes.

#### 4. Integrations

**Scope — only list items that are net-new to this ticket:**

- **New Shopify apps** that must be installed for the feature to work
- **App embeds** that must be enabled in the theme editor
- **App-provided scripts / snippets / pixels** that must be added

If nothing net-new is required, write a single line: `None required — feature is delivered entirely in-theme.` Do **not** list the Shopify platform itself, the CDN, the theme editor, or any pre-existing app that is already wired up in the repo.

| Integration | Action required (install / enable / add script) |
| ----------- | ----------------------------------------------- |
| <App name>  | <Install / enable embed / add script / etc.>    |

#### 5. Accessibility

Bullets covering WCAG 2.0 AA baseline (keyboard, semantics, labels, focus management, non-text contrast). Note stricter project rules (e.g. WCAG 2.2 contrast) where they apply.

#### 6. Performance

Bullets for rendering cost, JS weight, CLS/LCP, network calls, caching, loading strategy.

#### 7. Risk Mitigation

| Risk   | Mitigation            |
| ------ | --------------------- |
| <Risk> | <How it is mitigated> |

#### 8. Code Integrity

**New files:**

| Path           | Purpose         |
| -------------- | --------------- |
| `path/to/file` | <Short purpose> |

**Modified files:**

| Path           | Change                 |
| -------------- | ---------------------- |
| `path/to/file` | <What changes and why> |
```

---

## Section intent cheatsheet

| #   | Section                            | Ask yourself                                                                                                                                                                              |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Data Management                    | What block / section / snippet settings, metafields, metaobjects, translations, or admin copy does this introduce or change? List each item with `(new)` / `(existing)` + type + options. |
| 2   | Production Dependencies            | What must exist in production (apps, integrations, other tickets, deploy order) for this to work?                                                                                         |
| 3   | Feature Enhancement Considerations | What existing behavior changes? Any patterns already in the repo to mirror?                                                                                                               |
| 4   | Integrations                       | What **net-new** apps, app embeds, or app scripts must be installed/enabled for this ticket? (Skip platform, CDN, and apps already wired up.)                                             |
| 5   | Accessibility                      | How does this meet WCAG 2.0 AA (and 2.2 where stricter)? Keyboard, contrast, semantics, focus.                                                                                            |
| 6   | Performance                        | What is the runtime / payload / CLS / LCP impact? How is it mitigated?                                                                                                                    |
| 7   | Risk Mitigation                    | What can go wrong in prod, and what is the plan for each risk?                                                                                                                            |
| 8   | Code Integrity                     | Concrete list of files being added or modified.                                                                                                                                           |

---

## Anti-patterns to avoid

- **Scope that doesn't trace back to the AC** — every bullet in sections 1–8 should map to a ticket requirement, an engineer-confirmed assumption, or a repo constraint. Anything else is scope creep; cut it or move it to Assumptions / Open follow-ups.
- **Paragraph-only sections** — prefer bullets/tables.
- **Custom or renamed headings** (e.g. "Summary", "Rollout plan") as top-level sections — fold them into the eight numbered sections, or into Assumptions.
- **Embedding AC / steps-to-test** in the TA — the TA describes _how_, not _what_ or _how to verify_; those stay in Jira.
- **Screenshots without fallback text** — TA is a text artifact; link to Figma / Jira attachments instead.
- **Tutorial-style explanations** — do not describe how the Shopify CLI, theme editor, or standard Liquid primitives work; assume senior-dev baseline.
- **Generic validation boilerplate** — lines like "validated via `npm run dev`" or "run `npm run lint`" add no signal unless the ticket needs a non-obvious variation.
- **Listing the Shopify platform in Integrations** — section 4 is only for net-new apps / app embeds to enable / app scripts to add. "Shopify Online Store", "Shopify CDN", "theme editor", or already-installed apps do not belong there.
- **Internal repo file links** — `[foo.liquid](../../blocks/foo.liquid)` renders as unformatted text in Jira's Technical Approach field. Reference in-repo files with inline code only; reserve markdown links for **external** destinations (Jira tickets, Figma, public Shopify / Domaine docs).
- **Data Management as narrative** — §1 is a config inventory (settings / blocks / metafields, each marked `(new)` / `(existing)` with type + options), not a summary of the feature. Move narrative to §3.
- **AI-speak** — "first-class requirement", "honor X", "re-render churn", "measured change justifies otherwise", "dedicated a11y QA", motivational preambles, and "do this in code, not spec" moralizing. Write like a dev, not a copywriter.
- **Cross-client references** — never cite tickets, repos, or Figma files from other client accounts in this client-facing repo.

---

## When to update this file

Update this reference when:

- The Jira **Technical Approach** custom field structure changes.
- Domaine’s playbook adds/removes/renames standard sections.
- Repeated engineer feedback surfaces a better pattern (new anti-pattern to call out, new sub-label convention, etc.).

Keep edits in lockstep with the `write-technical-approach` skill (`${CLAUDE_PLUGIN_ROOT}/skills/write-technical-approach/SKILL.md`) so it always references the current format.
