# Pipeline mode — the /fnd:ship run contract

How an autonomous `/fnd:ship` run records its decisions, when it may act without asking,
when it must escalate, and how every phase re-grounds itself. Solo skills never read this
file — the pipeline is opt-in and leaves solo behavior untouched.

## Decision record — `.claude/fnd/<work-id>/pipeline.md`

Written by ship after the interview; the single source of pre-approved decisions.

```markdown
---
status: active   # active | done | aborted
started: <ISO datetime>
session: <$CLAUDE_CODE_SESSION_ID>
---
## Policy answers
- working branch: <existing|create + name> · target branch: <develop|main|…>
- commit scope: <ticket key? yes|no> · PR end state: <draft|ready> (always created ready — bots skip drafts)
- preview theme: <auto|manual triplet> · storefront path: </products/…>
- Jira write-backs via MCP: steps-to-test <yes|no> · PR link <yes|no> · hand-off comment <yes|no>
- bots: <names> · bot timebox: <min>
- store data: <gap → resolution: existing on <product> | mock on <product> | Mode 2 (.graphql, dev-run pre-gate) | static-only> (one per audit gap)
## Ticket answers
- <question> → <accepted answer> (recommended: <what ship suggested>)
## Caps
- qa fix→re-QA cycles: 2 · aftercare rounds: 2
## Phases
- [ ] implement
- [ ] qa
- [ ] finalize
- [ ] create-pr
- [ ] steps-to-test
- [ ] aftercare
- [ ] jira-hand-off
```

`status` flips to `done` at the final report, `aborted` when the developer stops the run.
The Phases list is the resume ledger — but on resume, reconcile it against **ground truth**
(`progress.md` ticks, `git log`, `gh pr view`, Jira fields) before trusting it: solo skills
may have advanced the series meanwhile, and a crash can land between an action succeeding
and its tick. Never redo a done phase; never create a duplicate PR.

## Autonomy rule

After the single ✋ (plan + QA checklist) approval: **no further questions.** An answer
recorded in `pipeline.md` is pre-approved. Anything else that is off the escalation
contract: decide, act, and log the call (below). Phases tick `progress.md` exactly like
the solo skills and move straight on — no offer-next inside a run.

## Escalation contract

Escalate — AskUserQuestion from the conductor; a phase agent returns
`ESCALATE(question, context, options)` instead of asking — ONLY for:

- missing access / credentials (store, `gh`, an MCP server);
- an AC contradiction or material ambiguity the interview didn't cover;
- a destructive or irreversible action outside the pre-authorized list;
- a QA blocking failure that survives the fix cap;
- a `protected-core` blocker from the conformance review;
- scope growth beyond the ticket.

Append the developer's answer to `pipeline.md` (the record grows mid-run), then continue.

**Pre-authorized by the record:** commit; push to the working branch; `gh pr create`; the
agreed Jira field writes; preview-theme creation; store TEST-state mutations under
snapshot → mutate → verify → restore — dev/preview theme customizer state via
`theme-json.sh` (the live theme is refused by the script) and test metafield/metaobject
entries per `references/metafield-metaobject-setup.md`.

## Judgment-call log

Every non-escalated call goes to the workspace `notes.md` as a dated `pipeline:` entry —
what was decided, why, and what a reviewer would need in order to undo it. The final
report and the Jira hand-off comment are distilled from these entries.

## Phase-agent models

Phase agents never inherit the session model — the conductor passes `model` on every
spawn: `opus` for reasoning-heavy phases (implement, qa, and the fix agents in the qa
loop and aftercare), `sonnet` for mechanical ones (finalize, steps-to-test). The
conductor itself stays on the session model — planning, decomposition, and synthesis are
where it earns its price. Gotcha: a `CLAUDE_CODE_SUBAGENT_MODEL` env var silently
overrides every pin, including the bundled agents' frontmatter models — it must be unset
or `inherit`.

## Phase-start re-read protocol

Every phase — first run or resumed — STARTS by re-reading from disk, unconditionally:
`pipeline.md`, `progress.md`, and the artifacts it consumes (`ticket.md` AC, `plan.md`,
`qa.md`, `notes.md` as applicable). Context is a cache; the workspace is the truth. After
any compaction the in-context ticket is a lossy summary — never move on with it. This
rule is what makes auto-compact mid-run harmless.
