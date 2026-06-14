# PR body — Domaine structure reference

The body structure and theme-preview table rules for `create-pull-request` (Workflow 6). If a
GitHub PR template exists in the repo, merge these sections into it rather than dropping any.

## Title convention

`[ELC-XX][Type] Short, outcome-focused description`

- `[ELC-XX]` — Jira ticket key; always include when a ticket is linked.
- `[Type]` — `Feature` | `Fix` | `Refactor` | `Chore` | `Docs` | `Style` | `Perf` | `Test`.

Examples:

- `[ELC-42][Feature] PowerReviews integration with star ratings, review snippets, and write form`
- `[ELC-108][Fix] Mega-menu closing on hover when submenu is active`
- `[ELC-73][Refactor] Extract shared header logic into reusable snippets`

## Body sections

Populate these (adapt headings if a team template exists):

- **Summary** — what was implemented and why (short, reviewer-friendly).
- **Theme preview** — the conditional table below.
- **Jira ticket** — key + URL.
- **Technical approach** — summary of the approved TA; call out deviations or additions made during implementation and why.
- **Changes made** — grouped by area (sections/blocks/snippets, styles, schemas/locales, config, scripts).
- **Steps to test** — paste from Jira, or summarise with a pointer to the ticket field if long.
- **Screenshots / visual evidence** — captures, Figma frames, or DevTools validation notes. If none, say "N/A — non-visual change" or state what was verified.
- **Accessibility** — WCAG-oriented notes (keyboard, semantics, contrast), or "None".
- **Performance** — rendering, assets, LCP/CLS touchpoints, or "None".
- **Dependencies** — other PRs, env vars, merchant setup, post-merge steps.
- **Checklist** — self-review complete, tested locally, no console errors in happy path, a11y spot-check if UI changed.

## Theme-preview table — conditional construction

Build rows only from what the engineer provided:

| Row            | When to include |
| -------------- | --------------- |
| **Theme name** | Only if a theme name was provided. |
| **Theme ID**   | Only if at least one URL was provided. Extract the numeric ID from either URL — admin pattern `/themes/<ID>`, preview pattern `?preview_theme_id=<ID>`. |
| **Preview**    | Only if at least one URL was provided. Render available links: `[View theme](THEME_URL)` and/or `[Admin](THEME_ADMIN_URL)` separated by ` · `. Omit the link whose URL was not provided. **Use the full URL as-is** — preserve all query params (`_ab`, `_bt`, `_fd`, `_sc`, `key`, `preview_theme_id`); do not truncate or strip them. |

Full example (all fields provided):

```markdown
|                |                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Theme name** | `my-feature-branch`                                                                                                                        |
| **Theme ID**   | `123456789`                                                                                                                                |
| **Preview**    | [View theme](https://store.myshopify.com/?preview_theme_id=123456789) · [Admin](https://admin.shopify.com/store/my-store/themes/123456789) |
```

Only `THEME_URL` provided (no admin URL, no name):

```markdown
|              |                                                                       |
| ------------ | --------------------------------------------------------------------- |
| **Theme ID** | `123456789`                                                           |
| **Preview**  | [View theme](https://store.myshopify.com/?preview_theme_id=123456789) |
```
