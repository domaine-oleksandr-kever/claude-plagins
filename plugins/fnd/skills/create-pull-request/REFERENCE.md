# PR body — Domaine structure reference

The body structure and theme-preview table rules for `create-pull-request` (Workflow 6). If a
GitHub PR template exists in the repo, merge these sections into it rather than dropping any.

## Title convention

`[ELC-XX][Type] Short, outcome-focused description`

- `[ELC-XX]` — Jira ticket key; always include when a ticket is linked. **Multiple tickets** (one PR closing several bugs/tasks) → one bracket, project prefix once, numbers slash-separated: `[ELC-299/307/309/315/382][Type] …`.
- `[Type]` — `Feature` | `Fix` | `Refactor` | `Chore` | `Docs` | `Style` | `Perf` | `Test`.

Examples:

- `[ELC-42][Feature] PowerReviews integration with star ratings, review snippets, and write form`
- `[ELC-108][Fix] Mega-menu closing on hover when submenu is active`
- `[ELC-299/307/309/315/382][Fix] PDP batch: gallery focus, mobile zoom, swatch labels, sticky CTA, price alignment`
- `[ELC-73][Refactor] Extract shared header logic into reusable snippets`

## Body sections

Populate these (adapt headings if a team template exists), in this order:

- **Summary** — what was implemented and why (short, reviewer-friendly). **First section of the body.**
- **Jira ticket** — key + URL (list every ticket when the PR closes more than one). **Place it right after Summary**, before the Theme preview.
- **Theme preview** — the conditional table below. **Place it immediately after the Jira ticket** so reviewers get the preview link next.
- **Technical approach** — summary of the approved TA; call out deviations or additions made during implementation and why.
- **Changes made** — grouped by area (sections/blocks/snippets, styles, schemas/locales, config, scripts).
- **Steps to test** — paste from Jira, or summarise with a pointer to the ticket field if long.
- **Screenshots / visual evidence** — captures, Figma frames, or DevTools validation notes. If none, say "N/A — non-visual change" or state what was verified.
- **Accessibility** — WCAG-oriented notes (keyboard, semantics, contrast), or "None".
- **Performance** — rendering, assets, LCP/CLS touchpoints, or "None".
- **Dependencies** — other PRs, env vars, merchant setup, post-merge steps.
- **Checklist** — self-review complete, tested locally, no console errors in happy path, a11y spot-check if UI changed.

## Preview theme — auto-create or manual

The Preview row needs an unpublished theme that shows **this branch's code** with the developer's
**configured customizer content**. So `scripts/create-preview-theme.sh` builds the local repo
(`npm run build`) and pushes the built code, then overlays only the dev theme's settings —
`config/settings_data.json`, `templates/**/*.json`, and section groups `sections/*.json`. It does
**not** clone the dev theme's code (which may be stale or broken); code always comes from the
branch. The script reads the store / dev-theme-id / Theme Access token from `shopify.theme.toml`
(the **uncommented** `theme = "…"` line). To redeploy code into an existing preview theme later
(e.g. after a fix) without disturbing its settings, the `refresh` mode / `update-preview-theme`
skill pushes code only.

> **Settings ↔ code drift (`error=settings_drift`):** the dev theme can be **"ahead"** of this
> branch — e.g. its `templates/product.json` references a block type (`subscription_selector`) whose
> schema lives only in another feature branch. Shopify rejects pushing that template onto a preview
> built from this branch's code. A partial overlay would give a misleading preview, so the script
> **stops**: it reports the real `cause=`, deletes the code-only theme it just created
> (`created_theme_deleted=yes` — unless it was a `--reuse` of a pre-existing theme), and exits
> `error=settings_drift`. **The fix is manual:** the developer duplicates the dev theme in the
> Shopify admin (a server-side copy preserves every setting, drifted or not), renames it to the
> `[ELC-…]` name, and re-runs `create-pull-request` with `theme_name` + `theme_url` +
> `theme_admin_url` — which makes the skill use that theme and skip auto-creation.

Code pushes never use `--path .`. The script **assembles a clean push root** containing only the
canonical theme dirs (`assets blocks config layout locales sections snippets templates`, via APFS
clonefile so it's instant) and pushes that, so non-theme paths in the repo (multi-brand build
sources, `tmp/` artifacts, root dev files, `src/`, `schemas/`, `node_modules/`) are physically
absent from the push. This is stricter than a `--only` glob whitelist: Shopify's matcher is loose
(`--only "snippets/**"` also re-captures nested `multi-brand/**/snippets/*`), so a glob leaks but a
clean directory can't. Without it `shopify theme push --path .` scans those files and the CLI
crashes parsing the API's rejection of an invalid asset. For an unusual file living *inside* a
theme dir that still shouldn't ship, pass `--ignore-extra "<glob>"` (both `create` and `refresh`
accept it, repeatable). On a push failure the script prints the real cause plus a `log=<path>` to
the full `shopify` stderr — read that, don't guess.

> **Security:** the access token lives in `shopify.theme.toml`. **Never `Read` that file** —
> it would pull the token into context. The script consumes the token inside the `shopify`
> subprocess and never prints it; it returns only non-secret fields.

Decision flow (step 4 of the skill):

1. **Args win.** If `theme_name` / `theme_url` / `theme_admin_url` were passed in, use them; skip creation.
2. **`info`** (`create-preview-theme.sh info`) detects `store`, `dev_theme_id`, `dev_theme_name`.
   - **`error=…`** (no `shopify.theme.toml`, missing `shopify`/`jq`, unparseable config) → **manual path**: ask the developer for the theme name + Preview / Admin URLs.
   - **success** → propose the new name (swap the role prefix for the Jira key: `[DEV] Kever | Domaine` → `[ELC-126] Kever | Domaine`; **multiple tickets** → one bracket, prefix once, slash-separated numbers: `[ELC-299/307/309/315/382] Kever | Domaine`) and **ask before mutating**: `create the preview theme now? [ yes / no ]`. One PR = one preview theme regardless of how many tickets it carries — the theme is a duplicate of the **current** dev theme, so it reflects everything currently on it, not one ticket in isolation.
3. **`create`** (`create-preview-theme.sh create --name "<name>" [--reuse]`) pulls the dev theme to a temp dir (working tree untouched) and pushes it unpublished. It prints `theme_id`, `preview_url`, `editor_url`, `reused`. Use `--reuse` to refresh an existing same-named theme instead of stacking duplicates. On `error=theme_limit` the store is at its cap (20 / 100) — re-run with `--reuse` or delete an old theme.

### Page deep-links

When the change is reviewed on a specific storefront path (`preview_path`, or inferable from
context — e.g. you developed/QA'd on `/products/group-lipglass`), deep-link the rows instead of
sending the reviewer to the home page:

- **Preview** → `https://<store>/<path>?preview_theme_id=<id>` (append the path to the base `preview_url`).
- **Admin** → the theme editor on that template: `https://<store>/admin/themes/<id>/editor?previewPath=<url-encoded path>`, or `?template=<name>` when the developer names the template (e.g. `product`, `product.lipglass`).

If the path or template is unknown or ambiguous, **ask the developer — never guess.**

**Several pages / several tickets:** when the bugs live on different pages, list one deep-link per
page in the Preview row (e.g. `[PDP](…/products/x?preview_theme_id=ID) · [Cart](…/cart?preview_theme_id=ID)`),
ideally labelled by ticket. Same preview theme ID throughout — only the path differs.

## Theme-preview table — conditional construction

Build rows only from what the engineer provided:

Order the rows **Theme name → Theme ID → Preview** (ID is its own row, directly under the name):

| Row            | When to include |
| -------------- | --------------- |
| **Theme name** | Only if a theme name is known (provided, or the create script's `name`). |
| **Theme ID**   | **Whenever the theme ID is known** — its own row, right under Theme name. The create script returns `theme_id` directly; otherwise extract the numeric ID from a URL (admin `/themes/<ID>`, preview `?preview_theme_id=<ID>`). |
| **Preview**    | Whenever at least one URL is known. Render available links: `[View theme](THEME_URL)` and/or `[Admin](THEME_ADMIN_URL)` separated by ` · `. Omit the link whose URL is missing. **Use the full URL as-is** — preserve all query params (`_ab`, `_bt`, `_fd`, `_sc`, `key`, `preview_theme_id`); do not truncate or strip them. |

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
