---
name: update-translations
description: >
  Translate English strings in storefront locale JSON files (`locales/*.json`) into all the theme's
  other languages, by building a translation-data file and running the repo's translation script.
  Use when the user asks to translate / localize storefront (customer-facing) copy or add locale
  translations, or invokes /update-translations. For schema/admin strings use update-schema-translations.
argument-hint: "(describe the English keys/strings to translate)"
arguments:
  - name: strings
    description: The English keys/strings to translate (or a pointer to where they live). Used to build sourceStructure.
allowed-tools: Read, Glob, Write, Bash(node scripts/update-translations.js)
---

# Update Storefront Translations

Translate English strings in `locales/*.json` (customer-facing) into the theme's other languages. For schema/admin strings (`locales/*.schema.json`), use `update-schema-translations` instead.

## Step 1 — Build the translation-data file

Create `scripts/translation-data.json` with two top-level keys:

```json
{
  "sourceStructure": {
    "actions": { "add": "Add", "add_to_cart": "Add to cart" },
    "blocks": { "contact_form": { "name": "Name", "email": "Email" } }
  },
  "wordTranslations": {}
}
```

Get the target language codes with **Glob** (`locales/*.json`): take each basename, drop the
`.json` suffix, and skip `en.default.json` plus every `*.schema.json` — what remains are the
language codes (e.g. `fr`, `es`, `de`).

In `wordTranslations`, mirror `sourceStructure` exactly, but make **each leaf value an object of `{ "<lang>": "<translation>" }`** for every language code:

```json
{ "actions": { "add": { "fr": "Ajouter", "es": "Añadir", "de": "Hinzufügen" } } }
```

**Constraints:** mirror `sourceStructure` in `wordTranslations`; every leaf → an object with all languages; only translate the keys in `sourceStructure`; never add other keys; do not read other files.

## Step 2 — Run the script

```bash
node scripts/update-translations.js
```

It updates every locale file with the new translations, then **auto-deletes** `scripts/translation-data.json`.

## Notes

- Storefront copy only — not schema/admin strings.
