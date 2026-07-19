## Foundation convention — comment discipline

Minimize inline comments; keep documentation.

**Keep (docs), even multi-line:** file/Liquid-file headers (purpose, key inputs);
function/snippet interface docs — Foundation requires LiquidDoc `{% doc %}` + defaults on
snippet params; schema/config docs; a short note on an architectural decision's WHY /
trade-off. Skip doc that merely restates the signature.

**Minimize (inline):** WHY, not WHAT — only when intent isn't obvious; prefer a clearer
name. Never narrate your change (`// added X`) or put ticket refs (`ELC-123`, `(AC 1a)`,
`(TA 2b)`) in comments — that belongs in the commit/PR. One line; no banners/dividers.
Only the non-obvious: workaround, gotcha, invariant, why-not-the-alternative, spec link.
Match the file's comment density. Stale comment in code you touch → fix or delete.
