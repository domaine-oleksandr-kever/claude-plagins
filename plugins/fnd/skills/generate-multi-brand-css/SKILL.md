---
name: generate-multi-brand-css
description: >
  Generate a brand's static Tailwind v4 CSS — @colors.css, @theme.css, @typography.css,
  and @buttons.css — from its design-token.manifest.json, replacing the JS Tailwind plugin
  with CSS-first directives for colors, spacing, typography, buttons, and border radius.
  Use when the user asks to generate / regenerate multi-brand CSS or design tokens for a
  brand (e.g. estee-lauder, mac), rebuild a brand's @colors/@theme/@typography/@buttons
  files from its manifest, or invokes /generate-multi-brand-css.
argument-hint: "<brand-slug> (e.g. estee-lauder, mac)"
arguments:
  - name: brand_slug
    description: MANDATORY. Brand directory slug under multi-brand/brands/ (e.g. estee-lauder, mac). Ask for this FIRST before doing anything else.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(git add*), Bash(git status*)
---

# Generate Multi-Brand Tailwind CSS

Generate `@colors.css`, `@theme.css`, `@typography.css`, and `@buttons.css` for a specific brand from its `design-token.manifest.json`. These CSS files replace the JS Tailwind plugin entirely — all spacing, typography, buttons, and border radius are defined as static CSS using Tailwind v4 CSS-first directives.

All detailed mapping tables, per-file generation rules, formulas, examples, and edge cases live in **`generate-multi-brand-css/REFERENCE.md`** — read it before generating any file.

## Step 1 — Ask for the brand slug (MANDATORY)

**Always start by asking the user**, before reading anything:

> Which brand slug should I generate CSS for? (e.g., `estee-lauder`, `mac`)

Then verify these files exist before proceeding:

- `multi-brand/brands/{slug}/design-token.manifest.json`
- `multi-brand/brands/{slug}/config.json`

If the brand directory doesn't exist or is missing either file, **stop** and tell the user.

## Step 2 — Gather context

Read all of these before generating anything:

1. **Brand manifest** — `multi-brand/brands/{slug}/design-token.manifest.json`
2. **Brand config** — `multi-brand/brands/{slug}/config.json`. **Check `fluidTypography`:** `"LIMITED_DESKTOP"` → typography uses fluid `min(max(...))` font sizes; `false` → typography uses static `rem` with `@media` breakpoints. This affects `@typography.css`, `@buttons.css`, and `@utility` directives. **Spacing in `@theme.css` is always fluid regardless of this setting.**
3. **Color schemes snippet** — `snippets/@color-schemes.liquid`. Defines every `--color-*` and `--button-*` variable the storefront consumes at runtime; every variable set here **must** have a default in the generated CSS.
4. **An existing brand's CSS for reference** — read `@colors.css`, `@theme.css`, `@typography.css`, `@buttons.css` from another brand (e.g. `multi-brand/brands/estee-lauder/styles/`) to match the exact output format.

See REFERENCE.md → *Formulas & resolution* for the fluid-sizing formula, px→rem / em conversions, responsive-alias chains, and color-alias resolution. **Resolve every alias chain to a number/hex before emitting a value.**

## Step 3 — Generate `@colors.css`

Write `multi-brand/brands/{slug}/styles/@colors.css`. Wrap everything in `@theme { ... }`, emit `--color-{name}` variables as `rgba(R, G, B, A)` (0–255 channels, 0–1 alpha), with a brand-label header comment.

Generate the variable groups **in order**: semantic tokens → extended semantic tokens → utility/primitive colors → grey scale. Full mapping tables, the color-resolution algorithm, and judgment notes are in REFERENCE.md → *@colors.css*.

## Step 4 — Generate `@theme.css`

Write `multi-brand/brands/{slug}/styles/@theme.css`. Sections in order:

1. Header comment + `@import './@colors.css';`
2. `@theme { ... }` — font families, font-size reset, **fluid** spacing scale (+ static `sm-*`/`lg-*` pairs), page grid, forms/button/icon/badge/header sizing, border radius, max-width scale, line-height, container, and button global tokens.
3. `@layer components` + `@layer base` — tertiary button override, cursor rules, search input resets.

Exact per-section rules, key-normalization, and which manifest prefixes to include are in REFERENCE.md → *@theme.css*.

## Step 5 — Generate `@typography.css`

Write `multi-brand/brands/{slug}/styles/@typography.css`. Replaces the JS plugin's `addTypography()` / `addBase()`.

Map each manifest token style to its CSS class / HTML tag / component class (table in REFERENCE.md → *@typography.css*). Resolve font size, line height, letter spacing, font family, weight/style, and uppercase per style. **Output structure branches on `fluidTypography`:** `"LIMITED_DESKTOP"` keeps fluid `.h1`/`.heading-1` vs static `.text-heading-1`; `false` makes all class versions identical static `rem` with `@media` breakpoints. Full structure, both branches, and computed-value rules are in REFERENCE.md.

## Step 6 — Generate `@buttons.css`

Write `multi-brand/brands/{slug}/styles/@buttons.css`. Replaces the JS plugin's `addButtons()`.

Resolve button sizing (`Button/LG/*`, `Button/Radius`, `Forms/Height`) and the `Button` typography style. `.btn` font-size follows `fluidTypography`. Emit `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-tertiary` (underline pattern), plus inverse variants if listed in `config.json`'s `buttonVariants`. Full output skeleton and variant rules are in REFERENCE.md → *@buttons.css*.

## Step 7 — Add `@utility` directives for `@apply` compatibility

In Tailwind v4, classes in `@layer components` are **not** available for `@apply` in other CSS files. `src/styles/_base.css` uses `@apply h1`–`h6`, `@apply p`, `@apply text-body` for `.rte` prose. Re-declare those as `@utility` blocks at the bottom of `@typography.css` (full typography properties + `@media (min-width: 1024px)` overrides; font-size follows `fluidTypography`). **Without these, `vite build` fails with "Cannot apply unknown utility class".** Block list and rules in REFERENCE.md → *@utility directives*.

## Step 8 — Validate

After generating all four files, **`git add` any of them that are new** (untracked — check `git status --porcelain`) so they're in git right away, then cross-check (details in REFERENCE.md → *Validation checklist*):

1. Every `--color-*` set in `@color-schemes.liquid` has a default in `@colors.css`.
2. Every `--button-*` referenced in `@color-schemes.liquid` and `@buttons.css` has a default in `@theme.css`.
3. Font families in `@theme.css` match `multi-brand/brands/{slug}/snippets/font-faces.liquid` (use Secondary slot + note the exception in the header comment when only Secondary ships the needed weights).
4. Common spacing classes (`p-sm`, `gap-md`, `mt-xl`, `right-pagemargin`, `pt-2xs`, …) have `--spacing-*` vars.
5. Radius classes (`rounded-sm/md/lg/rounded/forms-radius/button-radius`) have `--radius-*` vars.
6. No variable defined in more than one file.

## ✋ Manual review required (tell the user)

After overwriting the files, the user **must** manually review: font weights vs actual font files, color contrast (WCAG 2.2), typography scale, spacing consistency, breakpoints, border radius, missing tokens, custom utilities, brand configuration (`fluidTypography` matches output), and cross-browser rendering. Full review checklist and common pitfalls are in REFERENCE.md → *Manual review* and *Common pitfalls*.
