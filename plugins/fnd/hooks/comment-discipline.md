## Foundation convention — comment discipline (applies to all skills)

This targets **inline comments**, not **documentation**. They are different things — keep one, minimize the other.

### Documentation — keep it (this rule does NOT discourage it)

Write these even when multi-line; they document intent and the interface — exactly the "why", not the "what":

- **File / Liquid-file headers** — the file's purpose, responsibility, and key inputs (a `{% comment %}` header on a section/snippet is fine).
- **Function / snippet interface docs and LiquidDoc `{% doc %}` blocks** — document params, types, defaults, and usage. Foundation requires LiquidDoc + defaults on snippet params, so these are expected, not optional.
- **Schema / config docs**, and a short note recording an **important architectural decision** and its WHY / trade-off.

A doc block is the contract for the caller, so it earns its space. Just don't pad it: skip doc that merely restates the signature/types, and keep prose tight.

### Inline comments inside code — minimize

- **Comment WHY, not WHAT.** The code already says what it does; comment only when the intent isn't obvious from the code. Prefer a clearer name over a comment.
- **Don't narrate your own change** — no `// added X`, `// fixed Y`, `// new`, `// updated`, and no ticket numbers in code comments. That belongs in the commit message / PR.
- **If a comment is needed, keep it to one line** where possible. No ASCII banners, no section dividers.
- **Comment only the non-obvious:** a workaround, a gotcha, an invariant, a "why this and not the obvious alternative", or a spec/link reference.
- **Match the surrounding file's** comment density and style — don't be the one over-commented file.
- **If you touch code with a now-stale comment, fix or delete it.**
