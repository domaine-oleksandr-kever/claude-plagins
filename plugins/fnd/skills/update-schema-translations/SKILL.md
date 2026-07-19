---
name: update-schema-translations
description: >
  Translate English strings in theme schema locale files (`locales/*.schema.json`,
  admin/customizer labels) into the theme's other languages. Use when the user asks to
  translate / localize schema, settings, or theme-editor labels. For storefront copy use
  update-translations.
argument-hint: "(describe the English schema keys/strings to translate)"
arguments:
  - name: strings
    description: The English schema keys/strings to translate (or a pointer to where they live). Used to build sourceStructure.
allowed-tools: Read, Glob, Write, Bash(node scripts/update-translations.js --schema)
---

# Update Schema Translations

Translate English strings in `locales/*.schema.json` (admin / theme-editor labels) into the theme's other languages. For customer-facing copy (`locales/*.json`), use `update-translations` instead.

## Step 1 — Build the translation-data file

Create `scripts/translation-data.json`:

```json
{
  "sourceStructure": {
    "categories": { "banners": "Banners", "decorative": "Decorative", "storytelling": "Storytelling" },
    "content": { "advanced": "Advanced", "some_key": { "child_key_1": "Child key 1" } }
  },
  "wordTranslations": {}
}
```

Get the target language codes with **Glob** (`locales/*.schema.json`): take each basename, drop
the `.schema.json` suffix, and skip `en.default.schema.json` — what remains are the language
codes (e.g. `fr`, `es`, `de`).

In `wordTranslations`, mirror `sourceStructure` exactly, but make **each leaf value an object of `{ "<lang>": "<translation>" }`** for every language code:

```json
{ "categories": { "banners": { "fr": "Bannières", "es": "Banners", "de": "Banner" } } }
```

**Constraints:** mirror `sourceStructure`; every leaf → an object with all languages; only translate the keys in `sourceStructure`; never add other keys; do not read other files.

## Step 2 — Run the script

```bash
node scripts/update-translations.js --schema
```

It updates every schema locale file, then **auto-deletes** `scripts/translation-data.json`.

## Notes

- Section `name` strings in `locales/*.schema.json` must be **25 characters or fewer** (`ValidSchemaName` in `shopify theme check`) — shorten labels (e.g. "FHR collection grid") if needed.
