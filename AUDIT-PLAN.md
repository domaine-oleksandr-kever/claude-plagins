# fnd plugin — audit plan

> Read-only best-practices / consistency / error audit of the `fnd` Claude Code plugin marketplace.
> Method: 8 dimension finders → per-finding independent skeptical verification against the real files → deduped synthesis (56 agents, 416 tool calls). **47 findings raised, 46 confirmed, 1 refuted. No blockers.**
> Date: 2026-06-24 · Plugin version at audit time: `0.17.0`.

**Overall:** the plugin loads and its core preview / Jira / translation workflows are internally consistent. The most consequential items are content/consistency defects (a reversed preview-theme description, two "read-only" agents that inherit full write tools, a TA read-time mismatch), a cluster of robustness bugs in the Node ADF converters, and one bash arg-parsing footgun. The rest is least-privilege / consistency polish and gitignored local-config cruft that never ships.

## Legend

- Severity: 🔴 high · 🟠 medium · 🟡 low · 🔵 nit
- **⚠️ behavior-risk** = the fix could change current runtime behavior (tightening `allowed-tools`/`tools:`, removing config, prompt-pattern matching). Review individually; do **not** batch-apply.
- `[ ]` = open. Apply Batch A first (no behavior change), then evaluate Batch B.

---

## Suggested order

- **Batch A — safe / documentation (no behavior change):** the 🔴 REFERENCE fix, duplicated bullet, engineer/developer sweep, orphan-reference wiring, converter hardening (null guards, multi-block cells, clamps), bash `error=`/validation fixes, docstring notes, read-time + capitalization alignment.
- **Batch B — ⚠️ behavior-sensitive (decide per item):** narrowing `allowed-tools`/`tools:`, adding allow-lists where none exist, removing the Playwright MCP, the `BRAND=… npx vite build` prefix match, the curl `-H` token off-argv change.

---

## Manifests

- [ ] 🟠 **⚠️ Playwright MCP declared but never consumed** — `plugin.json:31-34`, `README.md:250`. Only zero-consumer server (notion 7, figma 13); everything browser-related uses chrome-devtools. Dead config + extra spawned process. **Fix:** remove from manifest + README, or add a real consumer.
- [ ] 🟡 **⚠️ Playwright npx server omits `-y`** — `plugin.json:33` (siblings at 16/20/24 pass `-y`). Cold npx cache → interactive "Ok to proceed?" can stall a stdio launch. **Fix:** `["-y", "@playwright/mcp@latest"]` (moot if removed above).

## Skill frontmatter & tools

- [ ] 🟠 **⚠️ `md-to-adf.cjs` allow-listed only in `write-technical-approach`** — `write-technical-approach/SKILL.md:15` has it; `qa-feature-or-fix/SKILL.md:57` and `write-steps-to-test/SKILL.md:65` run the identical command without it → prompts. **Fix:** one policy — add `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs*)` to both, or remove from all three and document why.
- [ ] 🟡 **`arguments:` in non-standard `{name, description}` shape, inert** — 14 SKILL.md (e.g. `create-preview-theme/SKILL.md:13-21`). Documented form is a list of names for `$name` substitution; the `{name,description}` objects do nothing today. **Fix:** pick one direction uniformly (drop it / document as human-only convention / wire `$name`).
- [ ] 🟡 **⚠️ `validate-brand-config-and-tokens` `Bash(npx vite build*)` won't match `BRAND=… npx vite build`** — `SKILL.md:16` vs `:99`. Prefix match starts at the env-var assignment → prompts. **Fix:** add `Bash(BRAND=* npx vite build*)`, or prefer the `.env`/`export BRAND=…` path (bare `npx vite build` already matches).
- [ ] 🟡 **⚠️ `get-breaking-changes` bare `Bash(git*)`/`Bash(gh*)` wildcards** — `SKILL.md:15`. Read-only body except one `git add`, but wildcards pre-approve push/reset/checkout and `gh pr merge`/`repo delete`. Only skill using bare wildcards. **Fix:** enumerate verbs actually used (`gh api`, `gh pr list/view/diff`, `git show-ref`, `git show`, `git add`).
- [ ] 🔵 **`commit` / `pre-commit-review` descriptions omit "or invokes /<name>."** — `commit/SKILL.md:3`, `pre-commit-review/SKILL.md:3` (other 15 carry it). Cosmetic — slash invocation is driven by `name`, not description. **Fix:** append for consistency.
- [ ] 🔵 **`create-pull-request` hint `admin-url` vs arg `theme_admin_url`** — `SKILL.md:10` vs `:20`. Display-only drift. **Fix (optional):** use `theme-admin-url` in the hint/prose; keep the `name:` identifier.
- [ ] 🔵 **`commit` allow-list doesn't cover the `| grep '^??'` segment** — `commit/SKILL.md:4`, `:74-75`. Piped segments are matched per-segment → that path may prompt; a non-piped `git ls-files` fallback already exists. **Fix (optional):** add `Bash(grep*)` or parse `--porcelain` directly.

## Reference / link integrity

- [ ] 🟠 **Orphan: `references/eslint-no-restricted-syntax.md`** — cited by nothing → never read. **Fix:** cite from `develop-feature-or-fix` / `fix-accessibility-issue`, or delete if stale.
- [ ] 🟠 **Orphan: `references/section-css-variables-pattern.md`** — cited by nothing → never read. **Fix:** wire into `develop-feature-or-fix` via `${CLAUDE_PLUGIN_ROOT}/references/section-css-variables-pattern.md`, or remove.
- [ ] 🟡 **`create-pull-request/REFERENCE.md` bare `scripts/create-preview-theme.sh` path** — `:45,84,87` (vs SKILL.md `:24,63` prefixed). Bare path resolves to the theme cwd and won't exist; runtime source is SKILL.md so unaffected, but misleads a model reading REFERENCE alone. **Fix:** prefix with `${CLAUDE_PLUGIN_ROOT}/` or add a one-line note.

## Bash scripts

- [ ] 🟠 **Value-flag without value as last arg aborts silently (no `error=`)** — `create-preview-theme.sh:216,219,220,270,272,273`; `shopify-admin-gql.sh:34-39`. `shift 2` with one positional left returns non-zero → `set -euo pipefail` exits before the `error=` guards. **Fix:** guard `$#` before `shift 2`, or `shift; [ $# -gt 0 ] && shift`; emit `error=missing_value`.
- [ ] 🟠 **Malformed `--variables` JSON fails open** — `shopify-admin-gql.sh:73-85`. jq prints prose (not `error=`); body becomes empty and curl still POSTs an empty body (no secret leak — token only in header). **Fix:** pre-validate `printf '%s' "$VARIABLES" | jq -e . >/dev/null 2>&1 || { echo "error=invalid_variables_json" >&2; exit 2; }`.
- [ ] 🟡 **⚠️ Admin token in curl `-H` argv** — `shopify-admin-gql.sh:82-85`. Visible via `ps -ww` / `/proc/<pid>/cmdline` for the request lifetime; the sibling `create-preview-theme.sh:85` uses an env var. macOS doesn't expose other users' argv by default → narrow impact. **Fix:** move header off argv (`curl -K -` / `--config` tmpfile + trap), update comments.
- [ ] 🟡 **`toml_value()` only extracts quoted values** — `create-preview-theme.sh:69-74`. An unquoted `theme = 123456789` returns the whole line. Only triggers on a hand-edited toml (CLI writes quoted). **Fix:** reuse the quote-agnostic extractor at `shopify-admin-gql.sh:65`.
- [ ] 🟡 **`--ignore-extra` missing from script's own usage/header** — `create-preview-theme.sh:29,33,296` (parsed at `:220,273`, documented externally in REFERENCE.md:73). **Fix:** add to the create/refresh header + usage string.
- [ ] 🔵 **`--build-cmd` value `eval`'d as shell** — `create-preview-theme.sh:191,196,219,272`. By design (trusted caller, safe default, `error=build_failed` on failure). **Fix:** no code change; optionally note it's eval'd and must be trusted.

## Node scripts (ADF converters)

- [ ] 🟠 **`adf-to-md.cjs` throws TypeError on a `null`/non-object content element** — `:96-98`, `:75-89`, `:150` (docstring `:16` promises graceful). **Fix:** `if (!node || typeof node!=='object') return '';` at the top of `renderBlock` + skip non-objects in inline map.
- [ ] 🟠 **`adf-to-md.cjs` renders only the first block of a table cell; flattens nested/multi-block list items** — `:91-93`, `:120-130` (cell at `:123`). Silent content loss on real Jira ADF. **Fix:** map all `c.content`; render nested lists with indentation (use the unused `depth`), or document the limitation.
- [ ] 🟡 **`adf-to-md.cjs --field` is positional-order dependent** — `:21-42`. Field id mistaken for the input file unless a file path precedes `--field`; stdin + `--field` always ENOENTs. All current callers use the working file-first form. **Fix:** exclude `args[fieldIdx+1]` from the file search, or parse flags first; at minimum document.
- [ ] 🟡 **`md-to-adf.cjs` tables-on branch emits non-rectangular ADF for ragged rows** — `:162-173`, `:94-96`. Only reachable without `--no-tables` (every documented write path passes it). **Fix:** pad/truncate each row to header length.
- [ ] 🟡 **`md-to-adf.cjs` leaks stray asterisks on `***bold-italic***`** — `:66-72`. Documented-unsupported; output still valid ADF. **Fix:** note in docstring, or add a `***…***` strong+em pattern first.
- [ ] 🟡 **`adf-to-md.cjs` doesn't clamp heading levels > 6** — `:99-102`. `'#'.repeat(9)` → invalid ATX. Defensive only (producer constrains 1-6). **Fix:** `Math.min(6, Math.max(1, level||1))`.
- [ ] 🟡 **Round-trip drops ordered-list `start`** — `md-to-adf.cjs:186-197` never sets `attrs.order`; `adf-to-md.cjs:107-110` honors it. `3. / 4.` → `1. / 2.`. **Fix:** set `attrs:{order:N}` when N !== 1.
- [ ] 🟡 **GFM separator regex false-positive** — `md-to-adf.cjs:137-138`. Prose with `|` directly above a `---` line (no blank line) is parsed as a table. **Fix:** require ≥1 `|` (ideally column-count match) in the separator.
- [ ] 🔵 **Empty codeBlock → spurious blank line; empty heading → empty content** — `adf-to-md.cjs:111-115`, `md-to-adf.cjs:131-132`. Degenerate inputs only. **Fix (optional):** omit the body newline / skip empty headings.

## Subagents

- [ ] 🟠 **⚠️ `jira-reader` & `figma-reader` omit `tools:` → inherit full write toolset** — `agents/jira-reader.md:1-5`, `agents/figma-reader.md:1-5`; README calls them read-only (`:203-204,211`). Inherits Write/Edit + all MCP writes (`editJiraIssue`/`createJiraIssue`/`transitionJiraIssue`…). Siblings (`change-reviewer`/`theme-explorer`) restrict to `Read, Grep, Glob, Bash`. **Fix:** add explicit least-privilege `tools:` (read-only Atlassian / Figma + Read, Bash); reconcile README.
- [ ] 🟠 **`change-reviewer` legend lists Check `B`/`D` but body defines only `A/C/E`** — `agents/change-reviewer.md:54` vs `:26-45`; `review-flow.md:62-64`. A reader of the prompt alone may invent B/D rows. **Fix:** drop B/D from the legend, or add one-line "agent only confirms, never originates" definitions.
- [ ] 🟡 **`figma-reader` ordered list has two consecutive "4." (no step 5)** — `agents/figma-reader.md:37,39`. **Fix:** renumber `:39` to `5.`.
- [ ] 🟡 **All four agents pinned `model: sonnet` with no rationale** — `agents/*.md:4`. Judgment call (defensible); figma-reader's paging + pixel-accuracy is the most truncation-prone. **Fix:** confirm intentional; optionally add a one-line rationale.
- [ ] 🔵 **Figma Dev Mode tool names not backed by a reference doc** — `agents/figma-reader.md:18,22,23,26` (asymmetry vs `jira-custom-fields.md`). **Fix (optional):** add a short tool-name reference so a rename surfaces during maintenance.

## Content consistency & docs

- [ ] 🔴 **`create-pull-request/REFERENCE.md:86-87` describes the preview as a clone of the dev theme — inverse of reality** — contradicts `:44-48`, `create-preview-theme.sh:6`, `create-preview-theme/SKILL.md:27-35`. Real flow: build branch code → push the **built branch code** unpublished (settings `--ignore`'d) → overlay only the dev theme's customizer settings. A model relying on this writes a wrong PR description, defeating the point. **Fix:** rewrite step 3 (`:87`) + the "duplicate of the dev theme" clause (`:86`); align with `:44-48` and SKILL.md.
- [ ] 🟠 **Duplicated "Technical approach" bullet** — `create-pull-request/REFERENCE.md:32-33` byte-identical → two sections possible / drift risk. **Fix:** delete one.
- [ ] 🟠 **"engineer" vs "developer" drift for the same operator** — `create-pull-request/SKILL.md` (7 engineer / 6 developer), `develop-feature-or-fix`, `qa-feature-or-fix`, `write-technical-approach`; `review-flow.md` + `pre-commit-review` already use "developer". **Fix:** standardize on "developer" and sweep; keep `write-technical-approach:53` "senior Shopify developer" (that's the TA's reader audience).
- [ ] 🟡 **TA read-time mismatch** — `write-technical-approach/SKILL.md:53,87` (~5 min) vs `technical-approach-format.md:27` (~3 min, the named authority). **Fix:** adopt ~3 min in both, or defer to the reference and drop the restated number.
- [ ] 🟡 **"Steps to Test" vs "Steps to test" capitalization** — `write-steps-to-test/SKILL.md:65`, `jira-custom-fields.md:167`, `create-pull-request/SKILL.md:72`, `review-flow.md`, `jira-reader.md:23`. Cosmetic (field-id resolves to a numeric id). **Fix:** "Steps to Test" for the section title; literal "Steps to test" only when quoting the field name.

## Security & permissions

- [ ] 🟠 **`qa-feature-or-fix` omits the inline "never Read .env" guard** — `SKILL.md:56`. Invokes `shopify-admin-gql.sh` + names the Admin token, unlike `develop-feature-or-fix:68` / `create-preview-theme:78` / `update-preview-theme:51` / REFERENCE.md:77-79. Mitigated: `:56` links `metafield-metaobject-setup.md`, which forbids it. **Fix:** add the one-line invariant inline.
- [ ] 🟠 **⚠️ `develop-feature-or-fix` & `qa-feature-or-fix` ship no `allowed-tools`** — the two live-store-mutating skills lack the per-skill least-privilege list 13/17 use. Defense-in-depth (Bash still gated by user settings). **Fix:** add scoped allow-lists (Read/Glob/Grep/Edit, `Bash(${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh*)`, develop `Bash(git add*)`); or state the open toolset is intentional. (Note: neither runs `npm run build` — "build" is prose.)
- [ ] 🟡 **⚠️ MCP manifest uses `@latest` / unpinned `mcp-remote` + remote credentialed + browser-automation MCPs** — `plugin.json:13-39`. Supply-chain + trust surface (`evaluate_script` / `browser_run_code_unsafe`). No secret leaked by the manifest. **Fix:** pin npx versions; document the trust granted in README.
- [ ] 🟡 **`settings.local.json` broad/stale grants** — `:4,6,7,8,9,17,19`. Broad `git push *`/`git add *`, stale cross-repo `rm -rf`/`rsync`, `Read(**)` into the theme repo. **Gitignored, never ships.** **Fix:** local hygiene only — prune stale one-shot entries, narrow the Read glob. Do not gate any release on it.
- [ ] 🔵 **(Informational) `.gitignore` clean; no tracked secrets** — `.gitignore:12,13,16,19`. Live `shptka_`/`shpat_` tokens live in the consumer's theme repo, guarded by in-subprocess consumption + the never-Read invariant. **Fix:** optionally have preflight-checks/README remind consumers to gitignore `.env` + `shopify.theme.toml`.
- [ ] 🔵 **Stale Slack leftovers in `settings.local.json`** — `:16,18` (`docs.slack.dev` WebFetch + a Slack-MCP commit grant) after Slack MCP was removed. Gitignored. **Fix:** optionally remove the two lines.
- [ ] 🔵 **(Informational) Living `docs/<TICKET>-*.graphql` committed by design** — `metafield-metaobject-setup.md:92-94`, `develop-feature-or-fix/SKILL.md:69`. Holds gids (fine); token never enters it under the documented flow. **Fix:** optional one-line caution that the file must never contain a raw token.

---

## Coverage gaps (next pass)

- `fix-breaking-changes` Node script (`scripts/fix-breaking-changes.template.js`) — arg handling, find/replace correctness, theme-check step — not audited.
- Translation skills (`update-translations`, `update-schema-translations`) — locale-file handling, arg-matching, allowed-tools — not reviewed.
- `generate-multi-brand-css` / `validate-brand-config-and-tokens` — only the vite-build allow-list checked; manifest→CSS generation (@colors/@theme/@typography/@buttons), config.json cross-checks not audited.
- `fix-accessibility-issue` body — ARIA/focus guidance and references not reviewed.
- MCP runtime behavior (auth flows, figma localhost SSE bridge availability, server-down handling) — static analysis only.
- `preflight-checks` actual check commands and pass/fail logic — not deeply audited.
- Live discovery/load of the four agents by Claude Code — assumed, not verified at runtime.
- Full README pass for other stale/contradictory claims — only spot-checked.
- Exhaustive cross-script consistency of the two toml extractors + `shopify-admin-gql.sh` store/password parsing.

## Refuted (1)

- **"Series-position numbering is inconsistent"** — refuted. Workflow numbering 1–5 is genuinely consistent and non-overlapping; the finding itself reported "no issue".
