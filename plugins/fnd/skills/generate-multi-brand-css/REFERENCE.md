# Multi-Brand CSS generation — detailed reference

Detailed mapping tables, per-file rules, formulas, examples, and edge cases for `generate-multi-brand-css`. SKILL.md holds the high-level process; this file holds everything load-bearing for producing correct output.

---

## Formulas & resolution

### Fluid sizing formula

**Spacing** is always fluid for all brands. **Typography** fluidity is controlled by `config.json`'s `fluidTypography` field:

- `"LIMITED_DESKTOP"` — typography font sizes use the fluid `min(max(...))` formula.
- `false` — typography font sizes use static `rem` values with a `@media (min-width: 1024px)` breakpoint for desktop.

When a value is a **fluid value** for spacing, always compute:

```
min(max(calc({mobile} * 1px), calc(calc(100vw / 1440) * {desktop})), {desktop}px)
```

When a value is a **fluid font size** for typography, check `config.json`'s `fluidTypography`:

- If `"LIMITED_DESKTOP"`: `min(max(calc({mobile_fs} * 1px), calc(calc(100vw / 1440) * {desktop_fs})), {desktop_fs}px)`
- If `false`: `{mobile_fs / 16}rem` as the base font-size, with `font-size: {desktop_fs / 16}rem` inside `@media (min-width: 1024px)` when mobile and desktop differ.

Where `{mobile}` and `{desktop}` are the resolved numeric pixel values from the manifest's `responsive.mobile` and `responsive.desktop` sections.

### Unit conversions

- **px → rem:** `rem = px / 16` (16px = 1rem, 8px = 0.5rem).
- **line-height → em:** `em = lineHeight / fontSize` (26px line-height at 14px = 1.86em).
- **letter-spacing → em:** `em = letterSpacing / fontSize` (0.3px at 48px = 0.01em).

### Responsive alias resolution

Many `responsive` values are **string aliases** to other keys. Follow the chain until you reach a number.

- `"Button/Radius": "Border Radius/SM"` → look up `"Border Radius/SM"` in the same mode → `4`.
- `"Page Grid/Margin": "Space/MD"` → look up `"Space/MD"` → `30` (desktop) / `24` (mobile).

### Color alias resolution

`colorSchemes` values are **alias strings** referencing keys in `colorPrimitives` (or other scheme entries). Resolve the full chain, then convert to rgba.

**Algorithm:**

1. Look up the value string in `colorPrimitives` — if found, use that hex value.
2. If not in `colorPrimitives`, look up in the same color scheme mode — if found, recurse.
3. If the value already starts with `#` or `rgba`, use it directly.
4. Convert the final hex to `rgba(R, G, B, A)`.

**Examples (Estée Lauder manifest):**

- `"Text": "Pure Black"` → `colorPrimitives` `"#000000"` → `rgba(0, 0, 0, 1)`
- `"Disabled": "Grey 40%"` → `colorPrimitives` `"#999999"` → `rgba(153, 153, 153, 1)`

---

## @colors.css

Path: `multi-brand/brands/{slug}/styles/@colors.css`.

### Format

- Wrap everything in a Tailwind v4 `@theme { ... }` block.
- All color values are `rgba(R, G, B, A)` with 0–255 integer channels and alpha 0–1.
- Variable naming: `--color-{name}`.
- Add a comment header with the brand label.

### Required variable groups (in this order)

#### 1. Semantic color tokens (from `colorSchemes.default` and `colorSchemes.inverse`)

| Manifest Token         | CSS Variable                   | Inverse Variable                       |
| ---------------------- | ------------------------------ | -------------------------------------- |
| `Text`                 | `--color-foreground`           | `--color-foreground-inverse`           |
| `Text Secondary`       | `--color-foreground-secondary` | `--color-foreground-secondary-inverse` |
| `Background`           | `--color-background`           | `--color-background-inverse`           |
| `Background Secondary` | `--color-background-secondary` | `--color-background-secondary-inverse` |
| `Border`               | `--color-border-01`            | `--color-border-01-inverse`            |
| `Border Secondary`     | `--color-border-02`            | `--color-border-02-inverse`            |
| `Link`                 | `--color-link`                 | `--color-link-inverse`                 |
| `Disabled`             | `--color-disabled`             | `--color-disabled-inverse`             |
| `Focus`                | `--color-focus`                | (no inverse typically needed)          |
| `Critical/Critical`    | `--color-danger`               | (no inverse typically needed)          |

#### 2. Extended semantic tokens (from `@color-schemes.liquid` usage)

Required by the storefront (set in `@color-schemes.liquid`) but NOT in the map above. Identify the correct mapping by examining the manifest's color scheme and primitives:

| CSS Variable                          | How to find the value                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `--color-accent-01`                   | Look for an accent/brand color in `colorSchemes.default` or pick from `colorPrimitives` |
| `--color-accent-01-inverse`           | Corresponding value from `colorSchemes.inverse`                                          |
| `--color-accent-02`                   | Secondary accent color                                                                  |
| `--color-accent-02-inverse`           | Corresponding inverse                                                                    |
| `--color-background-tertiary`         | If the manifest has a tertiary background token, use it; otherwise pick from primitives |
| `--color-background-tertiary-inverse` | Corresponding inverse                                                                    |

**Judgment required:** the manifest may not have tokens explicitly named "Accent" or "Background Tertiary". Use best judgment based on the brand's primitives and design intent; use other brands' existing CSS as a guide.

#### 3. Utility / primitive colors

Used directly by components for status indicators, badges, and UI:

| CSS Variable         | Source                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------- |
| `--color-green`      | Find a green primitive (e.g. `Positive/Positive` in scheme, or a green in primitives)  |
| `--color-yellow`     | Find a yellow/warning primitive                                                        |
| `--color-blue`       | Find a blue primitive (often same as `--color-focus`)                                  |
| `--color-orange`     | Find an orange primitive                                                               |
| `--color-light-blue` | Find a light blue primitive (info container color)                                     |
| `--color-white`      | Always `rgba(255, 255, 255, 1)`                                                         |
| `--color-black`      | Always `rgba(0, 0, 0, 1)`                                                               |

#### 4. Grey scale

Map grey primitives to a numbered scale by brightness ordering:

- `--color-grey-100` (lightest)
- `--color-grey-200`
- `--color-grey-300`
- `--color-grey-400`
- `--color-grey-500`
- `--color-grey-600` (darkest)

---

## @theme.css

Path: `multi-brand/brands/{slug}/styles/@theme.css`. Sections in order:

### Section 1 — Header comment and color import

```css
/**
 * {Brand Label} Theme Tokens
 *
 * Theme tokens specific to {Brand Label}.
 * Imports {Brand Label}'s color palette and defines brand-specific
 * font families, spacing, border radius, and button tokens.
 */

/* Refer to https://tailwindcss.com/docs/theme#theme-variable-namespaces */
@import './@colors.css';
```

### Section 2 — `@theme { ... }` block

**Font families** — read `config.json`'s `fontMapping` and the manifest's `fonts` section. Use the actual font name from `"Font Families/Primary/Name"`, etc.

```css
--font-*: initial;
--font-family-primary: '{Primary Font Name}';
--font-family-secondary: '{Secondary Font Name}';
```

If a font family value is `"---"` in the manifest, omit that slot.

**Font size reset** (prevents Tailwind defaults from conflicting):

```css
--font-size-*: initial;
```

**Spacing scale (fluid)** — read every `Space/*` key from the manifest's `responsive` section. For each, compute the fluid value using the `LIMITED_DESKTOP` formula. Also generate static `sm-*` (mobile rem) and `lg-*` (desktop rem) pairs. Include keys from these prefixes: `Space/`, `Page Grid/` (as `pagemargin`, `pagegutter`, etc.), `Icon Size/`, `Forms/`, `Button/` sizing tokens.

Key normalization: strip the prefix, remove spaces, replace `/` with `-`, lowercase.

```css
--spacing-none: 0;
--spacing-3xs: min(max(calc(4 * 1px), calc(calc(100vw / 1440) * 4)), 4px);
--spacing-2xs: min(max(calc(8 * 1px), calc(calc(100vw / 1440) * 8)), 8px);
--spacing-xs: min(max(calc(12 * 1px), calc(calc(100vw / 1440) * 12)), 12px);
--spacing-sm: min(max(calc(16 * 1px), calc(calc(100vw / 1440) * 16)), 16px);
--spacing-md: min(max(calc({mobile_md} * 1px), calc(calc(100vw / 1440) * {desktop_md})), {desktop_md}px);
--spacing-lg: min(max(calc({mobile_lg} * 1px), calc(calc(100vw / 1440) * {desktop_lg})), {desktop_lg}px);
--spacing-xl: min(max(calc({mobile_xl} * 1px), calc(calc(100vw / 1440) * {desktop_xl})), {desktop_xl}px);
--spacing-2xl: min(max(calc({mobile_2xl} * 1px), calc(calc(100vw / 1440) * {desktop_2xl})), {desktop_2xl}px);
--spacing-3xl: min(max(calc({mobile_3xl} * 1px), calc(calc(100vw / 1440) * {desktop_3xl})), {desktop_3xl}px);

/* Static mobile/desktop pairs */
--spacing-sm-none: 0;
--spacing-lg-none: 0;
--spacing-sm-3xs: 0.25rem;
--spacing-lg-3xs: 0.25rem;
/* ... for every spacing token ... */

/* Page grid */
--spacing-pagemargin: min(max(calc({mobile_margin} * 1px), calc(calc(100vw / 1440) * {desktop_margin})), {desktop_margin}px);
--spacing-pagegutter: min(max(...), ...);
--spacing-pagecolumns: {desktop_columns};
--spacing-pageviewport: {desktop_viewport};

/* Input/form sizing tokens */
--spacing-forms-height: min(max(...), ...);
--spacing-forms-padding: min(max(...), ...);
--spacing-forms-radius: min(max(...), ...);
/* ... etc for all Forms/*, Button/*, Icon Size/*, Badge/*, Header/* tokens ... */
```

**Border radius** — read `Border Radius/*` tokens. Mobile and desktop are typically identical for radius, so these are static rem values.

```css
--radius-none: 0;
--radius-sm: 0.25rem;
--radius-md: 1rem;
--radius-lg: 1.5rem;
--radius-rounded: 1000px;
--radius-forms-radius: 0.25rem;
--radius-button-radius: 0.25rem;
```

Derive `--radius-forms-radius` from `Forms/Radius` (resolve alias) and `--radius-button-radius` from `Button/Radius` (resolve alias).

**Max-width scale:**

```css
--max-w-*: initial;
--max-width-none: none;
--max-width-sm: 24rem;
--max-width-md: 28rem;
--max-width-lg: 32rem;
--max-width-xl: 36rem;
--max-width-2xl: 42rem;
--max-width-full: 100%;
--max-width-fit: fit-content;
--max-width-96: 24rem;
```

**Line height and container:**

```css
--leading-none: 1;
--container-*: initial;
```

**Button global tokens** — `--button-padding-block`, `--button-padding-inline`, `--button-min-width`, `--button-height`, `--button-border-radius`, and all variant color tokens.

### Section 3 — `@layer components` and `@layer base`

Standard tertiary button override, cursor rules, and search input resets.

---

## @typography.css

Path: `multi-brand/brands/{slug}/styles/@typography.css`. Replaces the JS plugin's `addTypography()` and `addBase()`.

### Typography style map

| Manifest Token | Legacy Name | CSS Class    | HTML Tag     | Component Class   |
| -------------- | ----------- | ------------ | ------------ | ----------------- |
| `Heading 4XL`  | Heading 1   | `.heading-1` | `h1`         | `.text-heading-1` |
| `Heading 3XL`  | Heading 2   | `.heading-2` | `h2`         | `.text-heading-2` |
| `Heading 2XL`  | Heading 3   | `.heading-3` | `h3`         | `.text-heading-3` |
| `Heading XL`   | Heading 4   | `.heading-4` | `h4`         | `.text-heading-4` |
| `Heading LG`   | Heading 5   | `.heading-5` | `h5`         | `.text-heading-5` |
| `Heading MD`   | Heading 6   | `.heading-6` | `h6`         | `.text-heading-6` |
| `Body MD`      | Body        | `.body`      | `p`          | `.text-body`      |
| `Body XS`      | Caption     | `.caption`   | (none)       | `.text-caption`   |
| `Pullquote`    | Pullquote   | `.pullquote` | `blockquote` | `.text-pullquote` |
| `Button`       | Utility     | `.utility`   | (none)       | `.text-utility`   |

### How to resolve a typography style

For each token style (e.g. `Heading 4XL`), extract from the manifest:

1. **Font size** — `responsive.desktop["Typography/Heading 4XL/Font Size"]` and `responsive.mobile[...]`. Resolve aliases if string.
2. **Line height** — same pattern with `/Line Height`. Resolve aliases.
3. **Letter spacing** — same with `/Letter Spacing`. Resolve aliases.
4. **Font family** — `fonts["Heading 4XL/Font Family"]` resolves through alias chain (e.g. `"Font Families/Primary/Name"` → `"Inter"`). Map through `config.json`'s `fontMapping` to get the CSS variable name.
5. **Font style/weight** — `fonts["Heading 4XL/Style"]` resolves to a weight name (e.g. `"Semi Bold"` → 600). Weight map: thin=100, extralight=200, light=300, regular=400, medium=500, semibold/semi=600, bold=700, extrabold=800, black=900. If the resolved style contains "italic", set `font-style: italic`.
6. **Uppercase** — `fonts["Heading 4XL/Uppercase"]` → if `true`, set `text-transform: uppercase`.

### Computed CSS values

- **Font size** — depends on `fluidTypography`:
  - `"LIMITED_DESKTOP"`: `min(max(calc({mobile_fs} * 1px), calc(calc(100vw / 1440) * {desktop_fs})), {desktop_fs}px)`
  - `false`: `{mobile_fs / 16}rem` base, with `font-size: {desktop_fs / 16}rem` inside `@media (min-width: 1024px)` when mobile != desktop. If mobile == desktop, just `{fs / 16}rem` with no media-query override for font-size.
- **Line height (em)** — `lineHeight / fontSize` (56/48 = 1.17). Use the **mobile** ratio as the base; add a `@media (min-width: 1024px)` override when the desktop ratio differs.
- **Letter spacing (em)** — `letterSpacing / fontSize` (0.3/48 = 0.01em). Omit if 0.
- **Font family** — `var(--font-family-primary, 'Inter')` (mapped variable name + raw font name as fallback).

### Output structure

The output depends on `fluidTypography`.

#### When `fluidTypography` is `"LIMITED_DESKTOP"` (fluid)

```css
/**
 * {Brand Label} Typography
 *
 * Base and component typography styles.
 * Generated from design-token.manifest.json.
 */

@layer base {
  h1 {
    font-size: min(max(calc({mobile_fs} * 1px), calc(calc(100vw / 1440) * {desktop_fs})), {desktop_fs}px);
    font-family: var(--font-family-primary, '{raw font name}');
    font-weight: {weight};
    font-style: normal;
    line-height: {mobile_lh / mobile_fs as decimal};
    text-decoration: none;
    text-transform: {uppercase or none};
    letter-spacing: {if non-zero: value in em};
    @media (min-width: 1024px) {
      line-height: {desktop_lh / desktop_fs if different from mobile ratio};
    }
  }
  /* ... h2–h6, p, blockquote, a ... */
}

@layer components {
  /* Fluid font-size versions (same as base tag styles) */
  .h1, .heading-1 { /* same fluid font-size as h1 */ }
  /* ... etc ... */

  /* Static font-size versions (mobile rem, desktop rem at breakpoint) */
  .text-heading-1 {
    font-size: {mobile_fs / 16}rem;
    @media (min-width: 1024px) {
      font-size: {desktop_fs / 16}rem;
    }
  }
  /* ... etc ... */
}
```

**Key difference between fluid and static class versions:**

- `.h1` / `.heading-1` (fluid): use the `min(max(...))` formula for font-size.
- `.text-heading-1` (static): rem for mobile, rem at `@media (min-width: 1024px)` for desktop.

#### When `fluidTypography` is `false` (static)

All typography classes — base tags, `.h1`/`.heading-1`, `.text-heading-1`, and `@utility` — use static `rem` with `@media` breakpoints. There is **no** difference between "fluid" and "static" class versions; they are identical.

```css
@layer base {
  h1 {
    font-size: {mobile_fs / 16}rem;
    font-family: var(--font-family-primary, '{raw font name}');
    font-weight: {weight};
    font-style: normal;
    line-height: {mobile_lh / mobile_fs as decimal};
    text-decoration: none;
    text-transform: {uppercase or none};
    letter-spacing: {if non-zero: value in em};
    @media (min-width: 1024px) {
      font-size: {desktop_fs / 16}rem;  /* only if desktop != mobile */
      line-height: {desktop_lh / desktop_fs if different};
    }
  }
  /* ... h2–h6, p, blockquote, a ... */
}

@layer components {
  /* All class versions use static rem (same as base tags) */
  .h1, .heading-1 {
    font-size: {mobile_fs / 16}rem;
    /* ... same properties ... */
    @media (min-width: 1024px) {
      font-size: {desktop_fs / 16}rem;
    }
  }

  .text-heading-1 {
    /* identical to .h1 / .heading-1 */
  }
  /* ... etc ... */
}
```

---

## @buttons.css

Path: `multi-brand/brands/{slug}/styles/@buttons.css`. Replaces the JS plugin's `addButtons()`.

### Button sizing resolution

Read from the manifest's `responsive` section (resolve aliases):

| Manifest Key                   | Purpose                   |
| ------------------------------ | ------------------------- |
| `Button/LG/Padding Horizontal` | Inline padding            |
| `Button/LG/Padding Vertical`   | Block padding             |
| `Button/LG/Gap`                | Gap between icon and text |
| `Button/LG/Icon Size`          | Icon dimensions           |
| `Button/Radius`                | Border radius             |
| `Forms/Height`                 | Button height             |

### Button font resolution

Read the `Button` typography style from the manifest (same process as @typography.css). The `.btn` class uses the Button/Body MD font properties.

**Font size depends on `fluidTypography`:**

- `"LIMITED_DESKTOP"`: `min(max(calc({mobile_fs} * 1px), calc(calc(100vw / 1440) * {desktop_fs})), {desktop_fs}px)`
- `false`: `{mobile_fs / 16}rem` (static). If mobile != desktop, add `font-size: {desktop_fs / 16}rem` inside the `.btn` `@media (min-width: 1024px)` block.

Check `fonts["Button/Uppercase"]` — if `true`, `.btn` includes `text-transform: uppercase`.

### Output structure

```css
/**
 * {Brand Label} Buttons
 *
 * Button component styles.
 * Generated from design-token.manifest.json.
 */

@layer components {
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    gap: var(--button-gap, {gap_mobile / 16}rem);
    transition-property: background-color, color, border-color, opacity;
    transition-duration: var(--button-transition-duration, 150ms);
    transition-timing-function: var(--button-transition-timing, ease-in-out);

    /* Button typography (from manifest Button style) */
    /* font-size: fluid or static depending on fluidTypography config */
    font-size: {see "Button font resolution" above};
    font-family: var(--font-family-primary, '{raw font name}');
    font-weight: {weight};
    font-style: normal;
    line-height: {lh_em};
    text-decoration: none;
    text-transform: {uppercase or none};

    --icon-size: var(--button-icon-size, {icon_mobile / 16}rem);

    &:hover,
    &:focus,
    &:focus-within,
    &:focus-visible {
      text-decoration: none;
    }

    & > svg, & > .icon, & > img {
      width: var(--icon-size, 1rem);
      height: var(--icon-size, 1rem);
      color: currentColor;
      flex-shrink: 0;
    }

    &:disabled, &.disabled {
      pointer-events: none;
      opacity: var(--button-disabled-opacity, 0.6);
    }

    /* Variant attribute selectors */
    &[variant='primary'] { /* ... primary variant styles ... */ }
    &[variant='secondary'] { /* ... secondary variant styles ... */ }
    &[variant='tertiary'] { /* ... tertiary variant styles ... */ }
    /* ... inverse variants if applicable ... */

    @media (min-width: 1024px) {
      gap: var(--button-gap, {gap_desktop / 16}rem);
      --icon-size: var(--button-icon-size, {icon_desktop / 16}rem);
      /* desktop font overrides if different */
    }
  }

  /* Class-based variant selectors */
  .btn-primary {
    min-width: var(--button-min-width, 160px);
    padding-block: var(--button-padding-block, {pad_block_mobile / 16}rem);
    padding-inline: var(--button-padding-inline, {pad_inline_mobile / 16}rem);
    border-radius: var(--button-border-radius, {radius_mobile / 16}rem);
    height: var(--button-height, {height_mobile / 16}rem);
    white-space: nowrap;
    background-color: var(--button-primary-bg);
    color: var(--button-primary-color);
    border-color: var(--button-primary-border, transparent);
    border-width: var(--button-primary-border-width, 0);
    border-style: solid;

    @media (min-width: 1024px) {
      padding-block: var(--button-padding-block, {pad_block_desktop / 16}rem);
      padding-inline: var(--button-padding-inline, {pad_inline_desktop / 16}rem);
      border-radius: var(--button-border-radius, {radius_desktop / 16}rem);
      height: var(--button-height, {height_desktop / 16}rem);
    }

    &:hover {
      background-color: var(--button-primary-hover-bg);
      color: var(--button-primary-hover-color);
      border-color: var(--button-primary-hover-border, transparent);
    }

    /* Use :focus-visible only — :focus-within matches mouse clicks on <a.btn> */
    &:focus-visible {
      outline-color: var(--button-primary-focus-color);
      outline-width: var(--button-focus-width);
      outline-style: solid;
      outline-offset: var(--button-focus-offset);
    }

    &:disabled, &.disabled {
      background-color: var(--button-primary-disabled-bg);
      color: var(--button-primary-disabled-color);
      border-color: var(--button-primary-disabled-border, transparent);
    }
  }

  .btn-secondary {
    /* Same structure as primary, using --button-secondary-* vars */
    /* ... */
  }

  .btn-tertiary {
    /* Underline/link style button */
    color: var(--button-tertiary-color);
    background-color: transparent;
    border-bottom-width: var(--button-tertiary-border-width);
    border-bottom-style: solid;
    border-color: var(--button-tertiary-border);
    padding-block-end: var(--button-tertiary-padding-bottom);
    padding-inline: 0;
    width: fit-content;
    line-height: 1;

    @media (min-width: 1024px) {
      padding-block-end: var(--button-tertiary-padding-bottom-desktop);
    }

    &:hover, &[active] {
      color: var(--button-tertiary-hover-color);
      border-color: var(--button-tertiary-hover-border);
    }

    &:disabled, &.disabled {
      color: var(--button-tertiary-disabled-color);
      border-color: var(--button-tertiary-disabled-border);
    }

    &:focus-visible {
      border-color: var(--button-tertiary-focus-color);
      outline-width: 0;
    }
  }

  /* Repeat for inverse variants if listed in config.json's buttonVariants */
  /* .btn-primary-inverse { ... } */
  /* .btn-secondary-inverse { ... } */
  /* .btn-tertiary-inverse { ... using tertiary underline pattern ... } */
}
```

---

## @utility directives

In Tailwind v4, classes defined in `@layer components` are **not** available for `@apply` in other CSS files. `src/styles/_base.css` uses `@apply h1`, `@apply h2`, `@apply p`, `@apply text-body`, etc. These **must** be re-declared as `@utility` directives at the bottom of `@typography.css`.

Add these blocks after the `@layer components` block:

```css
@utility text-body {
  /* same properties as .body / p tag base styles */
}

@utility p {
  /* same as text-body */
}

@utility h1 {
  /* same as .h1 / .heading-1 fluid styles */
}

@utility h2 { /* ... */ }
@utility h3 { /* ... */ }
@utility h4 { /* ... */ }
@utility h5 { /* ... */ }
@utility h6 { /* ... */ }
```

Each `@utility` block contains the full typography properties (font-family, font-weight, font-style, font-size, line-height, text-decoration, text-transform, letter-spacing) with `@media (min-width: 1024px)` overrides where mobile and desktop differ.

**Font size in `@utility` blocks depends on `fluidTypography`:**

- `"LIMITED_DESKTOP"`: the fluid `min(max(...))` formula (matching the `.h1` / `.heading-1` fluid classes).
- `false`: static `{mobile_fs / 16}rem` with `font-size: {desktop_fs / 16}rem` inside `@media (min-width: 1024px)` when mobile != desktop.

---

## Validation checklist

After generating all four files:

1. **Cross-check against `@color-schemes.liquid`** — every `--color-*` variable set in the snippet must have a default defined in `@colors.css`.
2. **Cross-check button variables** — every `--button-*` referenced in `@color-schemes.liquid` and in `@buttons.css` must have a default in `@theme.css`.
3. **Verify font families** — font family names in `@theme.css` must match what's loaded in `multi-brand/brands/{slug}/snippets/font-faces.liquid`. If the manifest's `Font Families/Primary/Name` (e.g. `Inter`) does not match the faces actually shipped, keep `@theme` `--font-family-*` strings aligned with **font-faces.liquid** so weights render correctly. When the manifest assigns body copy to Primary but only Secondary has loaded Regular/Medium files, use `--font-family-secondary` for `p` / `.text-body` / `.btn` and note the exception in the file header comment.
4. **Verify spacing tokens** — common spacing classes used in the codebase (`p-sm`, `gap-md`, `mt-xl`, `right-pagemargin`, `pt-2xs`, etc.) have corresponding `--spacing-*` variables in `@theme.css`.
5. **Verify radius tokens** — `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-rounded`, `rounded-forms-radius`, `rounded-button-radius` all have corresponding `--radius-*` variables.
6. **No duplicate variables** — no variable defined in more than one file.

---

## Common pitfalls

- **`@apply` vs `@layer components`** — classes like `.text-body` or `.h1` defined only in `@layer components` are **not** valid for Tailwind's `@apply` (and responsive variants like `md:text-body`) until matching **`@utility`** entries exist (`@utility text-body { … }`, `@utility h1 { … }`). `src/styles/_base.css` uses `@apply h1`–`h6`, `p`, and `text-body` for `.rte` prose — generated `@typography.css` must include those `@utility` blocks for `vite build` to succeed.
- **Alias resolution** — color-scheme and responsive values are usually alias strings; always resolve the full chain.
- **Self-referencing aliases** — some scheme entries reference other scheme entries (e.g. `"Positive/On Container": "Positive/Positive"`); follow the chain.
- **Missing grey mappings** — derive the grey scale from the brand's primitives using brightness ordering.
- **Button border transparency** — if a button border resolves to `"Transparent"`, set it to `transparent`.
- **var() references in buttons** — prefer `var(--color-*)` over hardcoded rgba in button variables for runtime color-scheme overrides.
- **Font slot placeholders** — if the manifest has `"---"` for a font family name, that slot is unused; omit it.
- **Spacing key normalization** — strip prefixes (`Space/`, `Page Grid/`, etc.), remove spaces, replace `/` with `-`, lowercase. E.g. `Space/2XS` → `2xs`, `Page Grid/Margin` → `pagemargin`, `Forms/Gap Horizontal` → `forms-gaphorizontal`.
- **Typography alias chains** — font family resolves through multiple hops (e.g. `"Heading 4XL/Font Family"` → `"Font Families/Primary/Name"` → `"Inter"`). Style resolves similarly (e.g. `"Font Families/Primary/Medium"` → `"Semi Bold"`).
- **Button typography** — the `.btn` font properties come from the `Button` token style, which typically aliases `Body SM` or similar; resolve the full chain.
- **`@utility` directives required** — in Tailwind v4, `@layer components` classes cannot be used with `@apply` in other files. Typography classes used by `@apply` in `_base.css` (`h1`–`h6`, `p`, `text-body`) MUST have corresponding `@utility` declarations in `@typography.css`, or the build fails with "Cannot apply unknown utility class" errors.
- **`fluidTypography` config** — always check it. If `false`, ALL typography font sizes (base tags, component classes, `@utility` directives, button font-size) must use static `rem` with `@media` breakpoints instead of `min(max(...))`. Spacing in `@theme.css` is always fluid regardless.

### Figma-source pitfalls

1. **Font weight mismatches** — Figma style names may not match actual font file weights.
2. **Color format** — Figma uses 0-1 RGB values; ensure proper conversion.
3. **Responsive values** — desktop/mobile differences must be preserved.
4. **Font loading** — ensure font files are properly loaded before using weights.
5. **Utility conflicts** — custom utilities may conflict with core or Tailwind defaults.
6. **Case sensitivity** — token names are case-sensitive in both manifest and usage.
7. **Missing dependencies** — ensure all Tailwind plugins are installed.
8. **LineHeight/LetterSpacing units** — never emit raw px. The generated CSS uses a **decimal
   ratio** for line-height (`lineHeight / fontSize`, e.g. 1.17) and **em** for letter-spacing
   (`letterSpacing / fontSize`) — see *Computed CSS values*. Percent forms
   (`value / fontSize × 100`) belong to the token-manifest side, not the emitted CSS.

---

## Manual review (✋ required after generation)

After the files are overwritten, the user MUST perform these reviews:

1. **Font weights** — verify weight mappings match actual font file weights; test rendering at each weight; confirm font files load.
2. **Color contrast** — verify all text/background combinations meet WCAG 2.2; check foreground/background token pairs; test utility colors (error, success, focus); validate disabled-state contrast.
3. **Typography scale** — confirm heading hierarchy makes visual sense; test responsive font sizes on real devices; verify line heights for readability; check letter spacing doesn't hinder legibility.
4. **Spacing consistency** — ensure the scale follows a logical progression; test in real layouts; verify responsive adjustments.
5. **Breakpoints** — confirm viewport values match design; test responsive behaviors; validate mobile/desktop token differences.
6. **Border radius** — test on real components; ensure the "rounded" variant (1000px) creates proper pill shapes; verify radius scales appropriately.
7. **Missing tokens** — check for tokens used in Figma but missing from manifest; identify custom values needing manual addition; verify all component variants have necessary tokens.
8. **Custom utilities** — review any theme.extend additions for conflicts; test custom utilities don't override core utilities unexpectedly; validate container queries and custom plugins.
9. **Brand configuration** — verify `fluidTypography` in `config.json` matches the generated CSS (fluid `min(max(...))` vs static `rem`); confirm designTokenManifest resolves correctly; test all generated utilities are accessible.
10. **Cross-browser testing** — test typography rendering across browsers; verify color rendering consistency; check custom font loading and fallbacks.
