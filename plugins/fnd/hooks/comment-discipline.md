## Foundation convention — comment discipline (applies to all skills)

Targets **inline comments**, not **documentation** — keep the second, minimize the first.

### Documentation — keep it

Write these even when multi-line; they document intent and the interface:

- **File / Liquid-file headers** — purpose, responsibility, key inputs (a `{% comment %}` header on a section/snippet is fine).
- **Function / snippet interface docs and LiquidDoc `{% doc %}` blocks** — params, types, defaults, usage. Foundation requires LiquidDoc + defaults on snippet params.
- **Schema / config docs**, and a short note recording an important architectural decision and its WHY / trade-off.

A doc block is the caller's contract — but don't pad it: skip doc that merely restates the signature, keep prose tight.

### Inline comments inside code — minimize

- **Comment WHY, not WHAT** — only when intent isn't obvious from the code. Prefer a clearer name over a comment.
- **Don't narrate your own change** — no `// added X`, `// fixed Y`, no ticket numbers in comments; that belongs in the commit/PR.
- **One line** where possible. No ASCII banners, no section dividers.
- **Only the non-obvious:** a workaround, gotcha, invariant, "why this and not the obvious alternative", or a spec/link reference.
- **Match the surrounding file's** comment density and style.
- **If you touch code with a now-stale comment, fix or delete it.**
