## Foundation capability — live store access, any time

Two bundled runners (paths relative to the plugin root printed above) — use them **whenever real
store state would answer a question**: researching a ticket, writing a TA, debugging, verifying
a fix. Don't guess store state — look.

- `scripts/shopify-admin-gql.sh --query <file.graphql> [--operation <Name>] [--variables <json>]`
  — Admin GraphQL against the project's store. Read-only queries are always fair game; mutations
  follow `references/metafield-metaobject-setup.md`.
- `scripts/theme-json.sh themes|get|set` — the theme's **customizer state**. `themes`/`get`
  freely, on any theme including live; `set` only per the snapshot → mutate → verify → restore
  protocol in `references/theme-customizer-state.md` (the live theme is refused). Works without
  Admin credentials — falls back to the project's Theme Access token automatically.

Auth is handled inside; on failure they print the exact setup fix to relay. Never `Read` `.env`
or `shopify.theme.toml` yourself — the runners consume secrets without exposing them.
