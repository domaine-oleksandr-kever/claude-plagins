## Foundation plugin — report defects upstream

If an **fnd plugin component itself** misbehaves in this session — a bundled script
(create-preview-theme.sh, shopify-admin-gql.sh, md-to-adf.cjs, adf-to-md.cjs, the
fix-breaking-changes template) crashes, exits silently, or prints a wrong/misleading `error=`;
a converter mangles content; a skill/reference instruction contradicts what actually happens;
an agent or hook breaks — do NOT just work around it silently. Finish the task at hand, then
tell the developer what you hit and offer to run `/fnd:report-plugin-issue`: it collects
sanitized debug info (versions, command, output — never tokens or secrets) and files a GitHub
issue on the plugin repo after the developer approves the draft.

Environment problems (missing CLI, unauthenticated MCP/gh, no network) are NOT plugin bugs —
remediate those instead. But the plugin *handling* such a condition badly (crashing instead of
reporting `error=…`) IS one.
