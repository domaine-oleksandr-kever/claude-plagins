---
name: develop-feature-or-fix
description: >
  Implement a feature or fix from an approved Technical Approach, a validated Jira ticket, and Figma
  designs — Workflow 3 of the Agentic Assisted Development series. Plans from the TA + Figma node,
  gets plan approval, then implements with in-browser validation. Use when the user asks to develop,
  implement, or build a feature/fix from a Jira ticket and design, or invokes /develop-feature-or-fix.
argument-hint: "<jira-url-or-key> [figma-node-url]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context (ticket already discussed); ask only if it can't be inferred.
  - name: figma_url
    description: Figma URL with the node id for the relevant frame/component. Ask if missing or node-less.
---

# Develop Feature or Fix (Jira + Figma)

Implement a feature or fix with an approved Technical Approach, validated ticket, and design references.

Series position: Workflow 3 — after `write-technical-approach`, before `qa-feature-or-fix`.
Inputs (ask if missing): **Jira ticket URL or key** (`jira_ticket`); confirmation that **Description, AC, Technical Approach, and a Figma URL with a node** are on the ticket.
Operating mode: **Phase 1 in plan mode** (ingest ticket + designs, align with the TA, produce the plan); leave plan mode after the developer approves the plan.

## Global rules

- **Never proceed past a ✋ checkpoint** without explicit developer confirmation.
- **Atlassian MCP** for Jira; **Figma MCP** for design extraction; **Chrome DevTools MCP** for in-browser validation when the preview is running. Ticket / design / codebase **reads are delegated to the `jira-reader`, `figma-reader`, and `theme-explorer` subagents** so raw ADF, node trees, and broad search stay out of this context — see steps 1, 3, 4.
- **Browser-MCP prerequisite:** the local dev server must be running (see `${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md` → Local dev server). Confirm before validation.
- Respect the repo's coding rules. **Extend — never directly modify** `src/entry/core/*` JS/TS; prefer extending or composing core Liquid blocks/snippets per project conventions.

---

## Phase 1 — Analysis & planning `[plan mode]`

**Kick off the reads in parallel.** When the task scope is already clear (the ticket is in
context or the request is explicit), spawn `jira-reader`, the `figma-reader`(s), and
`theme-explorer` **concurrently** — they're independent. If the scope is only defined by the
ticket you're still fetching, start `theme-explorer` once `jira-reader` returns the AC / TA so
it knows what to map. Steps 1, 3, 4 are reads; step 5 (linked docs) runs once `jira-reader`
returns the links; steps 2 and 6–8 run after the reads return.

1. **Ingest the Jira ticket** — context-first: full (not summarized) in-conversation fields count; second stop the task workspace `.claude/fnd/<TICKET>/` if fresh; otherwise delegate to the **`jira-reader`** subagent and **save its output to the workspace**. This skill needs: Description, AC, Technical Approach, Figma URL (plus any `figma_urls` the reader returns). `needs_clarification` → ask; a field reported empty is genuinely empty — warn the developer.
2. **Validate readiness** — if any are missing, **stop** and warn: Description, Acceptance Criteria, Technical Approach, Figma URL pointing to a **specific node**.
3. **Analyse the codebase** — delegate the broad search to the `theme-explorer` subagent (read-only scout): seed it with the task intent; it reads the project's `.claude/rules` + theme layout and returns an **impact map** (relevant files, patterns to follow, new files, schema/locale/settings impacts, rule constraints, open questions), keeping the wide search out of this context. **Then read the load-bearing files it points to yourself** — the scout finds breadth; you build the real understanding the plan and interview need. Do **not** plan from its summary alone.
4. **Analyse Figma** — for each Figma URL on the ticket (from the `jira-reader` output or the developer), **spawn one `figma-reader` subagent per URL, in parallel**; each returns a compact build spec. **Reuse before spawning:** specs already in this conversation or in the task workspace (`.claude/fnd/<TICKET>/figma-<node-id>.md`) count — spawn readers only for missing nodes, and save fresh specs to the workspace. These can run in parallel with the codebase analysis (step 3). If a URL has no node id or the target frame is unclear (a `figma-reader` returns `needs_clarification`), **ask** for the correct link.
5. **Read every linked doc.** Once `jira-reader` returns the links, **read them all** — follow `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md`. **Reuse before fetching:** docs already in this conversation **in full** (not summarized away) or cached fresh in the task workspace (`.claude/fnd/<TICKET>/doc-<slug>.md`, freshness: `${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`) count — fetch only missing or stale links, and **save fresh extracts to the workspace**. **Notion links are mandatory:** read each via the **Notion MCP** (`notion-fetch`, and the sub-pages/databases this ticket points at). **If the Notion MCP isn't connected, stop and tell the developer** which Notion links you couldn't read and ask them to enable the MCP (`/mcp`) or paste the content — don't plan around them. Read the other links too (Confluence via Atlassian MCP, plain web via `WebFetch`; Figma is already covered by step 4). Extract only what the task needs into context — especially any **data-mapping / schema** that defines metafields or metaobjects (feeds step 6).
6. **Store data model (metafields / metaobjects).** If the ticket or a linked doc describes a **metafield or metaobject**, the store needs that data model before the theme code can render anything. Follow `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`: draft the **STEP 0 inspection query** (what already exists vs what the doc requires), decide the **mode** — **(1)** store access available (CLI ≥ 4.x stored `shopify store auth`, or an Admin API token) → you'll run inspect + mutations yourself via the bundled runner, or **(2)** no store access → you'll produce a living `.graphql` file the developer runs step-by-step in the Shopify GraphiQL App — and fold the resulting definition/mock/bind steps into the implementation plan. (Provisioning happens in Phase 2; here you only plan it.)
7. **Interview the developer until you reach shared understanding** — walk down each branch of the design tree, resolving dependencies between decisions one-by-one. **Ask questions one at a time**, and **for each, give your recommended answer**. If a question can be answered by exploring the codebase, **explore the codebase instead of asking**.
8. **Create the implementation plan** — informed by the interview: ordered, reviewable steps; files/components/metafields/settings to add or change; **the metafield/metaobject setup from step 6 (which mode, which definitions/mocks)**; call out deviations from the TA and why.
9. **Optional — pressure-test the plan with deep-research.** Offer once, never auto-run: *"Run this plan through `deep-research` (cross-checks against fresh external sources)? ⚠️ **Token-heavy** — worth it mainly for risky, novel, or integration-heavy work. `[ yes / no ]"`*. Default **no** — proceed to the checkpoint. On **yes**: invoke `deep-research` seeded with the draft plan plus the ticket/specs/docs already in context (don't re-fetch), scoped to validating *this* approach; fold findings into the plan and note what changed.

### ✋ Checkpoint — Phase 1

Present the **implementation plan** (with any deep-research findings folded in) and wait for **explicit approval** before writing production code. Once approved, save the plan verbatim to the workspace `plan.md` (`${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`). If the context monitor has flagged this session (its notice recommends `/compact`), offer the stronger option — `/clear`, then re-invoke `/fnd:develop-feature-or-fix <ticket>`: Phase 2 resumes from `plan.md`, and an approved plan on disk beats a lossy summary.

---

## Phase 2 — Implementation

**Resume path:** the workspace already holds an approved `plan.md` for this ticket (fresh
session or after `/clear`) → confirm in one line that it's still current and start here —
don't redo Phase 1.

1. **Provision the store data model** (only if the plan calls for it — step 6) — **before** building the Liquid that reads it, stand up the metafield/metaobject definitions, mock content, and product binding by **following `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`** (read it now — it owns both modes' mechanics and the two auth engines, and routes auth failures to the relay blurb). **Mode 1 (store access):** STEP 0 inspection via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh`, diff against the doc, then the create/wire/mock/bind mutations. For image fields, reuse existing store media or have the dev paste a `MediaImage` gid — don't upload by default. **Mode 2 (no store access):** maintain the living `metaobject-setup.graphql` in the task workspace per the reference's step-by-step protocol. End state: a test product that renders the feature.
2. **Implement** step by step after confirmation — build from the `figma-reader` specs gathered in Phase 1 (re-query Figma MCP only for detail they didn't capture); follow the TA, AC, Foundation rules, Liquid/block patterns, Tailwind/token usage. Two Foundation patterns worth knowing: when a **section must drive its blocks' dimensions/alignment** via CSS variables (`use_section_vars`), follow `${CLAUDE_PLUGIN_ROOT}/references/section-css-variables-pattern.md`; for **JS/TS state**, prefer `data-*` attributes + Tailwind `data-[]:` selectors over `classList`/`style.*` mutation — the repo lints against those (`${CLAUDE_PLUGIN_ROOT}/references/eslint-no-restricted-syntax.md`). Pause at logical milestones for review if the change is large or risky. **`git add` every newly created file immediately after creating it** (snippet, section, `src/entry/*`, locale, doc) so nothing referenced by the code is left untracked; ticket-scoped working files (inspection/setup `.graphql`, dumps) live in the task workspace, not the repo, and are never `git add`ed.
3. **In-browser validation** — use Chrome DevTools MCP to verify UI against design and AC (layout, breakpoints, console errors). If the dev server isn't running, say what to start and retry when ready.
   - **Exercise data-driven AC by mutating the metafield/metaobject values** (only when you provisioned in step 1 **Mode 1**). One default state doesn't prove a conditional AC: for each one, **flip the value via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh`, reload, verify, restore** — e.g. *"heading / body / CTA are all optional"* → clear `heading`, reload, confirm the markup has **no empty heading element** (inspect the DOM, not just the visual), repeat per optional element. **Walk every enumerated / optional / conditional value an AC names** — don't assume a state you didn't render. Mind **propagation lag**: don't trust the first reload — re-query, hard-reload, retry briefly before calling it a bug (details in the reference).
   - Leave the data in a known state when done (restore defaults or note what you left set). Log what QA will need — test page paths, provisioned gids, preview theme — to the workspace `notes.md`.
   - **Customizer-driven AC — same discipline through theme JSON:** mutate the dev theme's state with `${CLAUDE_PLUGIN_ROOT}/scripts/theme-json.sh` (snapshot → `set` → reload → verify → restore; the live theme is refused), setting ids/values from the section's `{% schema %}`, walking every enumerated/optional state like the data-driven AC above. Full pattern: `${CLAUDE_PLUGIN_ROOT}/references/theme-customizer-state.md`.
4. **Iterative review** — accept course corrections; don't argue past scope — surface tradeoffs instead.

## Quality bar

- Meets AC and TA.
- Matches design intent (dimensions, spacing, typography, states).
- Accessibility (WCAG 2.2 AA minimum; stricter project rules where they apply) and performance considered.
- No secrets in code; no broad unsafe refactors.

## Next in the series

Check off this workflow's row in the workspace `progress.md` (branch, what shipped), then offer the next unchecked step in one line — normally `/fnd:qa-feature-or-fix <ticket>` — **offer only; never auto-run**. If context is heavy, suggest `/clear` + the next command rather than `/compact`: the workspace preserves the facts and the next skill re-ingests them fresh.
