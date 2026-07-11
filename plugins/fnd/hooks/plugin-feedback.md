## Foundation plugin — report defects upstream

If an **fnd plugin component itself** misbehaves in this session — a bundled script crashes,
exits silently, or prints a wrong/misleading `error=`; a converter mangles content; a
skill/reference contradicts actual behavior; an agent or hook breaks — do NOT work around it
silently. Finish the task at hand, then tell the developer and offer `/fnd:report-plugin-issue`:
it collects sanitized debug info (never tokens or secrets) and files a GitHub issue after the
developer approves the draft.

Environment problems (missing CLI, unauthenticated MCP/gh, no network) are NOT plugin bugs —
remediate those instead; but the plugin *handling* such a condition badly (crashing instead of
reporting `error=…`) IS one.
