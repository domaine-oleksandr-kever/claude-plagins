## Foundation convention — oversized MCP results

An over-limit MCP result spills to a file — you get a path, not content, and the
compression hook is skipped. Don't raw-`Read` it: run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/json-slim.cjs <path>` and use its stdout (`--stats`
shows the cut). If the file isn't JSON, json-slim hands the path back — then read it
directly with a windowed `Read` (offset/limit).
