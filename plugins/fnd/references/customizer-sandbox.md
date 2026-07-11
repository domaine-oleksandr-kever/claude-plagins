# Customizer sandbox — disposable theme for aggressive walks

Read this only when a theme-JSON walk would thrash the shared dev theme
(gated from `theme-customizer-state.md`).

When a test needs many states or risky JSON, take a disposable copy instead: the ticket's
preview theme from `${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh` (builds the project,
pushes an unpublished theme — the natural sandbox during development), or
`shopify theme duplicate -t <id> -n "fnd-<ticket>-sandbox" -f --json` (needs theme CLI auth).
Don't count on GraphQL `themeCreate(source:)` — it refuses redirecting/chunked zip URLs (GitHub
archive links fail with `Src is empty`). Mutate the copy freely, verify via its preview, then
**delete it** (`shopify theme delete` / `themeDelete`) — stores cap out around 20 themes, and
stray sandboxes read as clutter to the client.
