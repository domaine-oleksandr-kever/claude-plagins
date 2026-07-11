## Foundation convention — task workspace (per-ticket memory)

When the work is tied to a Jira ticket (key in the conversation or in the branch name):

- **Read first.** If `.claude/fnd/<work-id>/` exists (`<work-id>` = ticket key, or branch slug
  for a multi-ticket batch), read it before re-asking or re-fetching anything: `progress.md`
  says where the work stands — report that and offer the next unchecked step (its `session`
  field + `claude --resume <id>` reopens that conversation when the developer wants to pick up
  where they left off); `notes.md` holds decisions and gotchas. Freshness rules: `references/task-workspace.md` under the plugin root
  printed above.
- **Write as you go.** Fetched ticket fields, linked-doc extracts, approved plans / QA checklists / steps-to-test,
  decisions, per-bug root causes → into the workspace per that reference, so `/compact` and new
  sessions lose nothing.
- **Ticket-scoped working files stay in the workspace**: scratch (test scripts, query drafts,
  dumps, inspection `.graphql`) in `.claude/fnd/<work-id>/tmp/`; durable working artifacts
  (e.g. the living `metaobject-setup.graphql`) at the workspace root — never the project root
  or the repo's `docs/`.
- Non-trivial ticket work underway with **no workspace yet** → offer `/fnd:save-task-context`
  once; if the developer agrees, keep the workspace updated from then on.
