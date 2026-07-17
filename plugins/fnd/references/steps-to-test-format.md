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
- Use the appropriate template — **General** vs **Bug** — per the ticket type.

## Quality bar

- Full AC coverage.
- Deterministic steps (no "verify it works" without criteria).
- Theme-agnostic navigation (relative path / template / customizer location, **not** a
  preview-theme link) so any tester reproduces it on their own theme.
