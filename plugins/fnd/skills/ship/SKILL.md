---
name: ship
description: >
  Autonomous end-to-end delivery of a ready Jira ticket — the auto-mode alternative to
  running workflows 3–6 solo. One upfront interview + a single plan/QA-checklist approval,
  then: implement → QA (state-variant matrix + break-it + adversarial bug hunt) →
  finalize (review + commit) →
  PR + preview theme → Steps to Test → PR aftercare (CI checks + review bots) → Jira
  hand-off comment, escalating only per an explicit blocker contract. Requires a ticket
  with Description, AC, an approved Technical Approach, and a Figma node. Use when the
  user asks to ship a ticket end-to-end, run the pipeline / auto mode / autopilot on a
  ticket, or invokes /ship.
argument-hint: "<jira-url-or-key> [figma-node-url]"
arguments:
  - name: jira_ticket
    description: Jira ticket URL or key (e.g. ELC-206). If absent, infer it from the conversation context; ask only if it can't be inferred.
  - name: figma_url
    description: Figma URL with the node id. Optional — the ticket's Figma link is used when present; ask only if both are missing.
---

# Ship — autonomous series run (auto mode)

From a ready ticket to an open PR + Steps to Test in one run. The run contract —
decision-record format, autonomy rule, escalation contract with the pre-authorized list,
judgment-call log, phase-start re-read — lives in
`${CLAUDE_PLUGIN_ROOT}/references/pipeline-mode.md`. **Read it now; it governs the run.**

Relationship to the series: the autonomous alternative to workflows 3–6. It never invokes
the solo skills — it reuses their shared references, agents, and scripts, writes the same
workspace artifacts, and ticks the same `progress.md` rows, so an interrupted run degrades
to solo cleanly. Row mapping: implement → `develop-feature-or-fix`; qa →
`qa-feature-or-fix`; finalize → `pre-commit-review` **and** `commit`; create-pr →
`create-pull-request`; steps-to-test → `write-steps-to-test`; aftercare / jira-hand-off
live only in `pipeline.md`.

Inputs (ask if missing): **Jira ticket** (`jira_ticket`); designs from the ticket's Figma
link or `figma_url`.
Operating mode: Steps 0–3 interactive (plan-mode discipline — read, align, ask; the only
writes are the workspace cache and `pipeline.md`); Step 4 autonomous.

## Global rules

- **One gate.** Questions live in Step 2 and the single ✋ in Step 3. After approval: no
  questions — `ESCALATE` per the contract; everything else is decide + act + log.
- **Thin conductor.** After the ✋ this context holds decisions, the plan summary, and
  compact phase reports — nothing else. Heavy phases run as fresh subagents; never pull
  their file dumps back here.
- **Files are the memory.** Every phase re-reads its inputs from the workspace
  (phase-start re-read protocol). Ticks and artifacts are written before moving on — a
  crash at any point must leave a resumable state.
- **Crash-safe ordering:** record externally-visible results (PR URL, created theme id,
  Jira writes) to `progress.md` / `notes.md` **immediately** after the action succeeds,
  before doing anything else.

## Step 0 — Readiness (any failure → stop; nothing half-started)

1. **Resume?** Workspace `pipeline.md` with `status: active` → reconcile against ground
   truth per `pipeline-mode.md` (progress ticks, `git log`, `gh pr view`, Jira fields),
   then continue from the first genuinely-undone phase (jump to Step 4). `done` /
   `aborted` / absent → fresh run.
2. **Fresh context.** If the context monitor flagged this prompt (its notice
   recommends `/compact`), recommend the stronger option — `/clear` + rerunning
   `/fnd:ship <ticket>`; proceed only if the developer insists.
3. **Environment** (the `preflight-checks` scope, inline and compact): Atlassian MCP up;
   Figma MCP when designs are involved; Chrome DevTools MCP + the local dev server
   (`${CLAUDE_PLUGIN_ROOT}/references/preflight-checklist.md`); `gh auth status`;
   Shopify CLI present; **store access** — one cheap read through
   `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` (e.g. shop name). `error=` is
   **not** a stop: record the access level (full / read-only / none — `theme-json.sh`
   still works via the Theme Access token) plus the exact fix the runner prints; Step 2
   turns it into a question — apply the fix, or run data work in **Mode 2**
   (`metafield-metaobject-setup.md`). What kills runs is discovering a dead runner
   mid-QA — classify it here.
4. **Permissions.** List the side-effect commands this run will execute — `git commit`,
   `git push`, `gh pr create`, `${CLAUDE_PLUGIN_ROOT}/scripts/*.sh`,
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs` — and confirm with the developer
   that they're allowlisted (or acceptEdits is on); offer the `settings.json` entries or
   `/fewer-permission-prompts` if not. A permission prompt mid-run kills autonomy — fix
   this before the interview, not after the ✋.
5. **Workspace.** Ensure `.claude/fnd/<work-id>/` exists with `progress.md`
   (`${CLAUDE_PLUGIN_ROOT}/references/task-workspace.md`, incl. the git-exclude line).
6. **Branch.** Working tree clean (or only this ticket's work in it); note the current
   branch for the interview.

## Step 1 — Ingest (parallel reads, workspace-first)

As develop's Phase 1: context-first, then workspace, then fetch — saving fresh output
back. Spawn concurrently: **`jira-reader`** (Description, AC, TA, Steps to Test, links,
`figma_urls`), one **`figma-reader`** per Figma URL, **`theme-explorer`** seeded with the
task intent. Read every linked doc per
`${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md` (Notion mandatory — stop and
tell the developer if that MCP is missing). Then **validate readiness**: Description, AC,
approved **Technical Approach**, Figma node — any missing → **stop** and point at the gap
(`/fnd:write-technical-approach` for a missing TA). If the ticket/docs define metafields
or metaobjects, plan the provisioning per
`${CLAUDE_PLUGIN_ROOT}/references/metafield-metaobject-setup.md` (mode 1 vs 2). Read the
load-bearing files `theme-explorer` points to yourself — the plan is built from real
understanding, not the scout's summary.

**Store-data audit** — the classic mid-run killer is discovering during QA that no
product on the dev store carries the data the feature needs. From the ticket + TA + the
theme code the change touches, list every store-data dependency needed to **build and to
QA**: metafield/metaobject definitions AND actual values, selling plan groups
(subscriptions), bundle configuration, target products/collections/pages, template
assignments, app-owned records. Probe each with read-only queries via
`${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` — targeted queries, not a full
catalog scan — and write the map to `notes.md` as `store-data:` entries: requirement →
**present** (+ the concrete product/entity handle that carries it — that's the QA
target), **definition-only** (schema exists, no values), or **missing**. No/partial
admin access → audit what you still can (theme code, `theme-json.sh` state, public
storefront endpoints: `/products/<handle>.js` exposes `selling_plan_groups`, while
metafield-driven markup shows only in the rendered page HTML, not in that payload) and
mark the rest **unverified**. Every gap
or unverified entry becomes a Step 2 interview question — never a mid-run escalation.

## Step 2 — Interview (batched, once)

AskUserQuestion, ≤4 questions per call, 2–3 calls; every question carries your
recommended answer. Explore the codebase instead of asking whenever the code can answer.

- **Ticket-specific:** the design-tree walk develop does one-at-a-time — batched here:
  AC ambiguities, component/pattern choices, data-source decisions; **every store-data
  gap from the audit**, one question each with your recommended answer — provision mock
  data (say on which product and with what values; the default when **write** access
  exists — on a read-only store recommend existing data or Mode 2 instead;
  snapshot → restore per the references) vs the developer points at existing data
  (product/URL — e.g. "subscriptions live on /products/lip-pencil") vs **Mode 2**: you
  prepare the queries/mutations as the living `.graphql` file and the whole exchange —
  the developer runs each step in the GraphiQL App and pastes the returned ids back —
  **completes before the ✋** (the data must exist when Step 4 starts; the autonomous
  run can't pause for manual execution) vs static-only validation for those
  QA rows (named in the checklist, never silently skipped).
- **Policy set:** working branch (stay vs create + name) and PR target branch (default
  `develop`); commit scope (ticket key?); preview theme (auto-create `--reuse` vs manual
  triplet) + storefront path for deep-links; PR **end state — draft vs ready** (default
  and recommended answer: `draft`; the PR is always *created* ready-for-review: review
  bots skip drafts; `draft` means aftercare flips it back once the bot rounds are done —
  so the developer looks at a bot-reviewed PR before it reads as ready); Jira write-backs via
  MCP — Steps to Test field / PR link / hand-off comment (each yes/no); PR bots to await
  (names) + timebox in minutes; deep-research pressure-test of the plan (default no).
  QA depth is **not** a question — break-it always runs the full method.

Write `pipeline.md` per `pipeline-mode.md` (`status: active`, caps, the phase list).

## Step 3 — Contract ✋ (the only gate)

Draft **two artifacts** and present them together:

- **Implementation plan** — ordered, reviewable; heavy tickets split into milestones,
  each independently landable and ending in a working, clean state; metafield/metaobject
  provisioning included; deviations from the TA called out.
- **QA checklist** from the AC — the **state-variant matrix**: every AC-relevant config
  axis × each allowed value × each source that can drive it (customizer AND
  metafield/metaobject when both exist); every data-driven row names its **QA target**
  (product/entity handle) from the store-data audit — rows resolved as static-only are
  marked so; break-it rows per
  `${CLAUDE_PLUGIN_ROOT}/references/break-it-qa.md` — always the full method, never a
  reduced depth; design conformance vs the Figma
  specs; accessibility; performance; viewport — the same dimensions solo QA covers.

✋ Wait for explicit approval (edits welcome). Then save `plan.md` + the checklist into
`qa.md`, finalize `pipeline.md` — the autonomy rule takes over from here.

## Step 4 — Autonomous run (conductor + phase-agents)

**Phase protocol**, for every phase below except those marked inline: spawn a **fresh
general-purpose subagent**
whose brief contains the workspace paths (`pipeline.md`, `progress.md`, the artifacts
this phase consumes), the phase's reference list, its mission, and the standing rules —
*"follow the phase-start re-read protocol; never ask the user — return
`ESCALATE(question, context, options)` instead; log judgment calls to `notes.md` as dated
`pipeline:` entries; on completion write your artifact and tick your `progress.md` row
(aftercare / jira-hand-off: `pipeline.md` only); your final message is a compact report
(≤ ~20 lines), never file dumps."*
**Model tiering:** phase agents never inherit the session model — pass `model` explicitly
on every spawn: `opus` for implement, qa, and fix agents (qa loop + aftercare); `sonnet`
for finalize and steps-to-test. The conductor stays on the session model.
The conductor verifies tick + artifact before advancing, ticks the `pipeline.md` phase
row, and relays any `ESCALATE` via AskUserQuestion → appends the answer to `pipeline.md`
→ re-spawns the phase (it resumes from the artifacts).

1. **implement** — one agent per plan milestone, sequential. Brief: the milestone from
   `plan.md`, the AC, `figma-<node>.md` specs, the `store-data:` map + interview answers
   from `notes.md` (provision the approved mock data first — the audit already named the
   products and values); references:
   `metafield-metaobject-setup.md` (provision first when planned),
   `section-css-variables-pattern.md`, `eslint-no-restricted-syntax.md`,
   `theme-customizer-state.md`. In-browser validation vs design + AC (Chrome DevTools
   MCP), data/customizer state walks via the runners, `git add` every new file, test
   paths / gids / `ceiling:` entries for intentional simplifications → `notes.md`.
2. **qa** — a fresh agent that did NOT implement, **plus a parallel `bug-hunter` spawn**
   over the final diff (pass the base branch and the `notes.md` `ceiling:` entries) —
   live QA can't reproduce timing races on a slow local proxy; the static hunt covers
   them from the code. The qa agent's brief: **first extend `qa.md`** with break-it rows
   derived from the *final diff* per `break-it-qa.md` → Deriving the rows (interactions
   added during implementation aren't in the gate-approved checklist — append them,
   marked `post-plan`), then execute `qa.md` verbatim + `break-it-qa.md` → Executing the
   rows; **QA targets (products/entities) come from the `store-data:` map in
   `notes.md`** — never rediscover them by scanning the store; a data gap the audit
   missed → ESCALATE, don't improvise; state walks through
   `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` /
   `${CLAUDE_PLUGIN_ROOT}/scripts/theme-json.sh` (snapshot → mutate → verify →
   **restore**); evidence per row; append the pass/fail report + findings with exact
   repro values to `qa.md`, blocking vs non-blocking. Merge the `bug-hunter` findings
   into the same triage — every one **dispositioned** (fix / justify → `ceiling:` entry +
   PR body / ESCALATE), never dropped.
   **QA loop:** blocking findings (either source) → a fix agent scoped to them → a fresh
   qa agent re-runs the affected rows (a fixed bug-hunter finding is re-verified by code
   read when it can't be reproduced live); **cap 2 cycles**, then ESCALATE with the report.
3. **finalize** — review + commit in one pass. Review per
   `${CLAUDE_PLUGIN_ROOT}/references/review-flow.md` with `hygiene` emphasis
   (`change-reviewer` subagent(s)); apply the objective classes (comment accuracy,
   ticket-ref stripping, untracked referenced files) — C-class refactor findings are NOT
   applied autonomously (the change already passed QA); log them to `notes.md` for the
   report and hand-off. **F-class (correctness) findings never land in that log-only
   bucket**: an F row from the reviewer → fix it (counts toward the qa cap) or ESCALATE.
   Stamp `.git/.fnd-review` **including `correctness_hash`** — the bug hunt ran in the
   qa phase; recompute the hash after any finalize edits. Commit
   per `${CLAUDE_PLUGIN_ROOT}/references/commit-message-format.md` (scope per policy;
   body from plan + notes), then push the working branch. Tick **both**
   `pre-commit-review` and `commit` rows.
4. **create-pr** — inline (glue). Preview theme per policy: manual triplet → use as-is;
   else follow `${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/REFERENCE.md` →
   Preview theme (`[ELC-…]` naming,
   `--reuse`; `error=build_failed` → ESCALATE with the build output;
   `error=settings_drift` → the reference's manual recovery). Conformance pass:
   `change-reviewer` with `conformance` emphasis — a `protected-core` blocker →
   ESCALATE. Body per `${CLAUDE_PLUGIN_ROOT}/skills/create-pull-request/REFERENCE.md`
   (Summary → Jira ticket(s) →
   theme-preview table in the top third; title `[ELC-XX][Type] …`; named ceilings from
   the `notes.md` `ceiling:` entries → Dependencies).
   `gh pr create --base <target> --body-file <tmp>` — **never `--draft`**, even when the
   policy's end state is draft: review bots (Bugbot) don't scan drafts, and aftercare
   needs their feedback; the end-state policy is applied by aftercare.
   **Record the PR URL to `progress.md` + `notes.md` the moment it exists.**
5. **steps-to-test** — agent; fills the bot wait. Write per
   `${CLAUDE_PLUGIN_ROOT}/references/steps-to-test-format.md` from the AC + `qa.md` +
   `notes.md` repro values; save `steps-to-test.md`; policy allows → write the field via
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/md-to-adf.cjs --no-tables` + `editJiraIssue`
   (`${CLAUDE_PLUGIN_ROOT}/references/jira-custom-fields.md`).
6. **aftercare** — `gh pr checks --watch`; a failing check → diagnose → fix agent →
   commit + push (counts toward the cap). Then poll the policy bots' review threads via
   `gh api` (~90 s interval, up to the timebox). Per finding: triage vs AC/TA —
   AC-compatible → fix; contradicts AC or out of scope → don't, and say why. After any
   fixes: refresh the preview theme code
   (`${CLAUDE_PLUGIN_ROOT}/scripts/create-preview-theme.sh refresh` — settings
   untouched), re-verify the touched flow in the browser, commit + push. Reply to
   **every** thread (what was done / why not) and resolve it (`gh api graphql`,
   `resolveReviewThread`). **Cap 2 rounds** → ESCALATE survivors. Timebox expiry with
   silent bots → "bots pending" in the report; move on. **Last, apply the PR end-state
   policy** — on both exits (bot rounds done AND timebox expiry): `draft` →
   `gh pr ready --undo <pr>` flips the now-reviewed PR to draft (log to `notes.md`);
   `ready` → leave as-is.
7. **jira-hand-off** — policy allows → one ticket comment: a **clickable PR link** + the
   distilled judgment calls from `notes.md` (accepted edge cases, anything not
   implemented and why, open questions), converted via `md-to-adf.cjs --no-tables` →
   `addCommentToJiraIssue`; policy forbids → print the comment for manual paste.

## Final report

PR URL · checks/threads state · QA pass/fail table · Jira writes made · preview-theme
links · judgment-call digest · anything pending (bots). Set `pipeline.md` →
`status: done`; every `progress.md` row ticked with dates. Offer workspace cleanup once
the ticket is Done. Nothing else to offer — the series is complete.

## Quality bar

- Zero unplanned stops: the interview, one ✋, and contract escalations only — a
  permission prompt mid-run is a Step 0 failure.
- Solo interop intact: same artifacts, same `progress.md` rows, `.fnd-review` stamped —
  an interrupted run continues solo without unwinding.
- Every autonomous decision is either pre-approved in `pipeline.md` or logged in
  `notes.md`.
- Output formats render from the shared references (commit message, PR body, Steps to
  Test) — parity with the solo skills' standards.
