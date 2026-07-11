## Foundation convention — task workspace (per-ticket memory)

When the work is tied to a Jira ticket (key in the conversation or in the branch name):

- **Read first.** If `.claude/fnd/<work-id>/` exists (`<work-id>` = ticket key, or branch slug
  for a multi-ticket batch), read it before re-asking or re-fetching anything: `progress.md`
  says where the work stands — report that and offer the next unchecked step; `notes.md` holds
  decisions and gotchas. Freshness rules: `references/task-workspace.md` under the plugin root
  printed above.
- **Write as you go.** Fetched ticket fields, approved plans / QA checklists / steps-to-test,
  decisions, per-bug root causes → into the workspace per that reference, so `/compact` and new
  sessions lose nothing.
- **Scratch files** (test scripts, query drafts, dumps) go in `.claude/fnd/<work-id>/tmp/`,
  never the project root.
- Non-trivial ticket work underway with **no workspace yet** → offer `/fnd:save-task-context`
  once; if the developer agrees, keep the workspace updated from then on.
