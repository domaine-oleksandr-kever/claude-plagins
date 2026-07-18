# Steps to Test — Domaine format

The output standard shared by `/fnd:write-steps-to-test` and the pipeline steps-to-test
phase. Steps must be usable by someone **unfamiliar** with the implementation, testing on
their **own** theme/environment.

## Writing rules

- **No document title.** Don't open with a heading like
  `Steps to Test — ELC-104: MAC Pro Member Pricing Display` — the Jira field is already
  labeled and shown on the ticket, so a title only repeats the ticket key/summary. Start
  directly with the first scenario heading (or preconditions).
- **Point testers to the right place, theme-agnostically** — the tester uses **their own
  theme**, so **never hard-code a preview-theme link** (no `?preview_theme_id=…`, no
  dev/preview theme name). Give a **relative storefront path** (e.g.
  `/products/group-lipglass` when it's known from context), the **template** and
  **customizer location** (Online Store → which section/block), and markets if relevant —
  so they reproduce it on whatever theme they're testing.
- **Expectations per step** — exact outcomes, copy, layout, settings values, breakpoints.
- **Visual aids** — reference Figma frames or screenshots where helpful.
- **Edge cases** — boundaries, empty states, error states.
- **Audience** — assume the tester is new to this Shopify setup.
- **Structure as headings + numbered/bullet steps, not big tables.** A scenario = a short
  heading + an ordered list of steps with expectations. **Avoid wide GFM tables** — they
  make the Jira ADF balloon (each cell becomes a nested node) and that large blob is
  fragile to write back. Reserve tables for genuinely tabular, short data.
- Use the matching template skeleton below — **General** vs **Bug** — per the ticket type.

## Templates

Pick by ticket type (`ticket_type` / the Jira issue type): **General** for features and
improvements, **Bug** for defect fixes. Both follow every writing rule above — no document
title, theme-agnostic navigation, expectations per step.

**General (feature / improvement):**

```markdown
**Preconditions:** theme/template, markets, customer state, and data setup (products,
collections, metafields, settings) the tester needs before starting.

### <Scenario heading — one per AC or user-visible flow>
1. Go to <relative path> (<template> · Online Store → <section/block>).
2. <Action>. **Expected:** <exact outcome — copy, layout, values, breakpoint>.

### Edge cases
1. <Boundary / empty / error state>. **Expected:** <behaviour>.
```

**Bug (defect fix):**

```markdown
**Preconditions:** <setup needed to hit the original defect — data, settings, viewport>.

### Reproduce the original issue
1. <The exact steps that used to fail>. **Expected (fixed):** <correct behaviour>.
   *Before the fix:* <what used to happen — so the tester recognizes a regression>.

### Verify the fix
1. <AC-driven checks of the corrected behaviour>. **Expected:** <outcome>.

### Regression sweep
1. <Adjacent flows the fix could disturb>. **Expected:** unchanged behaviour.
```

## Quality bar

- Full AC coverage.
- Deterministic steps (no "verify it works" without criteria).
- Theme-agnostic navigation (relative path / template / customizer location, **not** a
  preview-theme link) so any tester reproduces it on their own theme.
