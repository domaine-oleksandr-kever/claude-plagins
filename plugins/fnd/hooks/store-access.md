## Foundation capability — live store access, any time

The fnd plugin ships two runners (paths relative to the plugin root printed above). They are not
reserved for plan-completion checks — use them **whenever real store state would answer a
question**: researching a ticket, writing a TA, debugging, verifying a fix.

- `scripts/shopify-admin-gql.sh --query <file.graphql> [--operation <Name>] [--variables <json>]`
  — Admin GraphQL against the project's store (domain from `shopify.theme.toml`). Read-only
  queries are always fair game: products, metafields/metaobjects, files, themes. Don't guess
  store state — look. Mutations follow `references/metafield-metaobject-setup.md`.
- `scripts/theme-json.sh themes|get|set` — the theme's **customizer state** (`templates/*.json`,
  section groups, `settings_data.json`). `themes`/`get` freely, on any theme including live;
  `set` only per the snapshot → mutate → verify → restore protocol in
  `references/theme-customizer-state.md` (the live theme is refused by the script). Works even
  without Admin API credentials — it falls back to the project's Theme Access token
  (`theme dev`'s own auth) automatically.

Auth is handled inside (CLI ≥ 4.x `store execute` → admin-token fallback; on failure they print
the exact setup fix to relay). Never `Read` `.env` or `shopify.theme.toml` yourself — the runners
consume secrets without exposing them.
