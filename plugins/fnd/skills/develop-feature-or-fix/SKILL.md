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

Implement a feature or fix with an approved Technical Approach, validated ticket, and design references. **Do not skip the ✋ checkpoints.**

Series position: Workflow 3 — runs after `write-technical-approach`, before `qa-feature-or-fix`.

## Inputs (ask if missing)

- **Jira ticket URL or key** (`jira_ticket`).
- Confirmation that **Description**, **Acceptance Criteria**, **Technical Approach**, and a **Figma URL with a node** are on the ticket.

## Operating mode

- **Phase 1 — Analysis & planning:** **plan mode** — ingest ticket + designs, align with the TA, produce an implementation plan.
- **Phase 2 — Implementation:** leave plan mode after the engineer approves the plan.

## Global rules

- **Never proceed past a ✋ checkpoint** without explicit engineer confirmation.
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

1. **Ingest the Jira ticket.** **Context-first:** if the conversation context already contains *all* required fields (Description, AC, Technical Approach, Figma URL) in full — not summarized or truncated, e.g. from an earlier skill run or a pasted ticket — use that and **skip the fetch**. Otherwise **delegate to the `jira-reader` subagent** (pass the ticket key/URL): it reads via Atlassian MCP, applies `${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`, and returns the structured fields plus any `figma_urls`, keeping the raw ADF out of this context. If it returns `needs_clarification`, ask the engineer. A field it reports empty is genuinely empty — warn the engineer.
2. **Validate readiness** — if any are missing, **stop** and warn: Description, Acceptance Criteria, Technical Approach, Figma URL pointing to a **specific node**.
3. **Analyse the codebase** — delegate the broad search to the `theme-explorer` subagent (read-only scout): seed it with the task intent; it reads the project's `.claude/rules` + theme layout and returns an **impact map** (relevant files, patterns to follow, new files, schema/locale/settings impacts, rule constraints, open questions), keeping the wide search out of this context. **Then read the load-bearing files it points to yourself** — the scout finds breadth; you build the real understanding the plan and interview need. Do **not** plan from its summary alone.
4. **Analyse Figma** — for each Figma URL on the ticket (from the `jira-reader` output or the engineer), **spawn one `figma-reader` subagent per URL, in parallel**; each returns a compact build spec. These can run in parallel with the codebase analysis (step 3). If a URL has no node id or the target frame is unclear (a `figma-reader` returns `needs_clarification`), **ask** for the correct link.
5. **Read every linked doc.** Once `jira-reader` returns the links, **read them all** — follow `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md`. **Notion links are mandatory:** read each via the **Notion MCP** (`notion-fetch`, and the sub-pages/databases this ticket points at). **If the Notion MCP isn't connected, stop and tell the developer** which Notion links you couldn't read and ask them to enable the MCP (`/mcp`) or paste the content — don't plan around them. Read the other links too (Confluence via Atlassian MCP, plain web via `WebFetch`; Figma is already covered by step 4). Extract only what the task needs into context — especially any **data-mapping / schema** that defines metafields or metaobjects (feeds step 6).
6. **Store data model (metafields / metaobjects).** If the ticket or a linked doc describes a **metafield or metaobject**, the store needs that data model before the theme code can render anything. Follow `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`: draft the **STEP 0 inspection query** (what already exists vs what the doc requires), decide the **mode** — **(1)** you have an Admin API token → you'll run inspect + mutations yourself, or **(2)** no token → you'll produce a living `.graphql` file the developer runs step-by-step in the Shopify GraphiQL App — and fold the resulting definition/mock/bind steps into the implementation plan. (Provisioning happens in Phase 2; here you only plan it.)
7. **Interview the engineer until you reach shared understanding** — walk down each branch of the design tree, resolving dependencies between decisions one-by-one. **Ask questions one at a time**, and **for each, give your recommended answer**. If a question can be answered by exploring the codebase, **explore the codebase instead of asking**.
8. **Create the implementation plan** — informed by the interview: ordered, reviewable steps; files/components/metafields/settings to add or change; **the metafield/metaobject setup from step 6 (which mode, which definitions/mocks)**; call out deviations from the TA and why.
9. **Optional — pressure-test the plan with deep-research.** Once the plan is ready, **offer** it (never auto-run): *"Want me to run this plan through `deep-research`? It cross-checks the approach against fresh external sources (Shopify theme/Liquid capabilities, app/library behaviour, accessibility/perf, known pitfalls) using the ticket, Figma specs, and docs already in context. ⚠️ **It's token-heavy** — it fans out many web searches and verification passes, so it's worth it mainly for risky, novel, or integration-heavy work. `[ yes / no ]"`*. Default **no** — proceed straight to the checkpoint. On **yes**, invoke the `deep-research` skill, seeding it with the draft plan **plus the fresh context already in this conversation** — the `jira-reader` ticket fields, the `figma-reader` build specs, and any docs/links — so it doesn't re-fetch them, scoped to validating *this* approach (not open-ended research). Fold its findings into the plan and note what changed before presenting.

### ✋ Checkpoint — Phase 1

Present the **implementation plan** (with any deep-research findings folded in) and wait for **explicit approval** before writing production code.

---

## Phase 2 — Implementation

1. **Provision the store data model** (only if the plan calls for it — step 6) — **before** building the Liquid that reads it, stand up the metafield/metaobject definitions, mock content, and product binding per `${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md`. **Mode 1 (admin token):** the Admin API token (`shpat_…`) lives in the repo's gitignored `.env` as `SHOPIFY_ADMIN_TOKEN` — **don't `Read` `.env`**; run each `.graphql` via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh --query <file> [--operation <Name>]`, which uses the token without exposing it. Run the STEP 0 inspection, diff against the doc, then the create/wire/mock/bind mutations. For image fields, reuse existing store media or have the dev paste a `MediaImage` gid — don't upload by default. **Mode 2 (no token):** write the living `docs/<TICKET>-metaobject-setup.graphql` file, hand the developer one step at a time, and as they paste each result back, record the returned gid, fill it into the dependent step, mark the step done, and advance. End state: a test product that renders the feature.
2. **Implement** step by step after confirmation — build from the `figma-reader` specs gathered in Phase 1 (re-query Figma MCP only for detail they didn't capture); follow the TA, AC, Foundation rules, Liquid/block patterns, Tailwind/token usage. Pause at logical milestones for review if the change is large or risky. **`git add` every newly created file immediately after creating it** (snippet, section, `src/entry/*`, locale, doc — including any `docs/<TICKET>-metaobject-setup.graphql`) so nothing referenced by the code is left untracked.
3. **In-browser validation** — use Chrome DevTools MCP to verify UI against design and AC (layout, breakpoints, console errors). If the dev server isn't running, say what to start and retry when ready.
   - **Exercise data-driven AC by mutating the metafield/metaobject values** (only when you provisioned the data in step 1 **Mode 1** — you have the admin token and ran the mutations yourself). Many AC are conditional on the configured data, so one default state doesn't prove them; for each such AC, **flip the value via `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` (a `metaobjectUpdate` / `metafieldsSet` mutation), reload, and verify** — then restore. Examples:
     - *"media area supports aspect ratios 4:3 / 1:1"* → check the default, then mutate the field to `1:1`, reload, confirm the rendered ratio changes.
     - *"heading / body / secondary CTA are all optional; if an element isn't configured the remaining copy shows with no empty placeholder"* → clear the `heading` field, reload, and confirm the markup has **no empty heading element** (inspect the DOM, not just the visual) — repeat per optional element.
     - Walk every **enumerated / optional / conditional** value an AC names; don't assume a state you didn't render.
   - **Beware propagation lag:** Shopify can serve a **stale metafield/metaobject value** for a short window after a mutation. After mutating, **don't trust the first reload** — re-query the value (a quick read via the runner) to confirm it actually changed, then hard-reload (cache-bust) the storefront; if the UI still shows the old value, wait briefly and retry before concluding it's a bug. Distinguish "code is wrong" from "value hasn't propagated yet."
   - Leave the data in a known state when done (restore defaults or note what you left set, so QA/`qa-feature-or-fix` starts from a clean baseline).
4. **Iterative review** — accept course corrections; don't argue past scope — surface tradeoffs instead.

## Quality bar

- Meets AC and TA.
- Matches design intent (dimensions, spacing, typography, states).
- Accessibility (WCAG 2.2 AA minimum; stricter project rules where they apply) and performance considered.
- No secrets in code; no broad unsafe refactors.
