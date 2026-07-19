## Foundation convention — task workspace (per-ticket memory)

When work is tied to a Jira ticket (key in the conversation or in the branch name):

- **Read first.** If `.claude/fnd/<work-id>/` exists (`<work-id>` = ticket key, or branch
  slug for a multi-ticket batch), read it before re-asking or re-fetching: `progress.md`
  says where the work stands — report that and offer the next unchecked step (its
  `session` field + `claude --resume <id>` reopens that conversation); `notes.md` holds
  decisions and gotchas.
- **Write as you go** — reader outputs, doc extracts, approved plans / checklists,
  decisions → into the workspace, so `/compact` and new sessions lose nothing.
- **Placement:** scratch (test scripts, query drafts, dumps) → `.claude/fnd/<work-id>/tmp/`;
  durable artifacts (e.g. the living `metaobject-setup.graphql`) → workspace root — never
  the project root or `docs/`. Details + freshness rules: `references/task-workspace.md`.
- Non-trivial ticket work with **no workspace yet** → offer `/fnd:save-task-context` once.
