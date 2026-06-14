# Foundation — Claude Code plugin

Domaine's **Agentic Assisted Development** skills for Claude Code, packaged as a
plugin. It bundles the Foundation workflow skills (technical approach → develop →
QA → PR, plus multi-brand CSS, translations, breaking-changes, etc.) for Shopify
theme work.

## What's inside

```
.
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace entry (for install)
├── skills/                  # 15 workflow skills (see table below)
│   ├── develop-feature-or-fix/SKILL.md
│   ├── write-technical-approach/SKILL.md
│   └── ...
├── references/              # Shared docs the skills read
│   ├── jira-custom-fields.md
│   ├── technical-approach-format.md
│   └── ...
├── LICENSE
└── README.md
```

> **Note on rules.** Project coding conventions (`css-conventions`,
> `liquid-conventions`, `protected-core`, …) are **not** shipped in this plugin.
> They live in the target repo under `.claude/rules/*.md` and auto-attach
> natively by their `paths:` globs when you edit matching files. The skills just
> say "follow the repo's coding rules" — the rules themselves come from the
> project. See [Skills + project rules](#how-global-skills-use-project-rules).

## Skills

| Skill | Invoke |
|-------|--------|
| `write-technical-approach`        | `/fnd:write-technical-approach` |
| `develop-feature-or-fix`          | `/fnd:develop-feature-or-fix` |
| `qa-feature-or-fix`               | `/fnd:qa-feature-or-fix` |
| `write-steps-to-test`             | `/fnd:write-steps-to-test` |
| `create-pull-request`             | `/fnd:create-pull-request` |
| `pre-commit-review`               | `/fnd:pre-commit-review` |
| `commit`                          | `/fnd:commit` |
| `preflight-checks`                | `/fnd:preflight-checks` |
| `fix-accessibility-issue`         | `/fnd:fix-accessibility-issue` |
| `get-breaking-changes`            | `/fnd:get-breaking-changes` |
| `fix-breaking-changes`            | `/fnd:fix-breaking-changes` |
| `generate-multi-brand-css`        | `/fnd:generate-multi-brand-css` |
| `validate-brand-config-and-tokens`| `/fnd:validate-brand-config-and-tokens` |
| `update-translations`             | `/fnd:update-translations` |
| `update-schema-translations`      | `/fnd:update-schema-translations` |

Skills are also **auto-invoked**: Claude reads each skill's `description` and
runs the relevant one when your request matches — you don't have to type the
slash command.

## Install

### From the published Git marketplace (team use)

```text
# 1. Add the marketplace (you'll get a trust prompt — confirm it)
/plugin marketplace add <github-org>/foundation-claude-plagin

# 2. Install the plugin from it
/plugin install fnd@domaine

# 3. Activate without restarting the session
/reload-plugins
```

`/plugin marketplace add` shows a **trust dialog** the first time, because a
marketplace can ship hooks and commands that run on your machine. Review the
source, then confirm to add it to your trusted marketplaces. To make it trusted
for a whole team without each person confirming, an admin can predeclare it in
managed settings under `extraKnownMarketplaces`.

### Local development (from this folder on disk)

```text
/plugin marketplace add /Users/oleksandrkever/projects/foundation-claude-plagin
/plugin install fnd@domaine
/reload-plugins
```

Edits to skill files in a local marketplace are picked up on the next session
(or after `/reload-plugins`). See [Updating](#updating).

### Managing it

```text
/plugin disable fnd@domaine    # keep installed, turn off
/plugin enable  fnd@domaine
/plugin uninstall fnd@domaine  # remove the plugin
/plugin marketplace remove domaine    # remove the marketplace
```

## Updating

There is **no proactive "new version available" notification.** Updates are
pull-based:

- **Auto-update on:** at startup Claude Code pulls the latest version silently,
  then prompts you to run `/reload-plugins`. Toggle per-marketplace in
  `/plugin` → Marketplaces.
- **Auto-update off (default for third-party):** run
  `/plugin marketplace update domaine` to pull changes.

The `version` field in `plugin.json` gates updates: bump it on every release, or
omit it to use the git commit SHA (every commit counts as a new version).

## How global skills use project rules

A common question: *if the plugin is installed globally, do its skills still pick
up the project's rules?*

**Yes.** The skills do **not** hardcode paths to the rule files — they reference
"the repo's coding rules" in prose. The actual rules are loaded by the **project
context**, not by the skill:

- The plugin (global) provides the **workflow** — the steps of each skill.
- The target repo's `.claude/rules/*.md` provide the **conventions** — and
  Claude Code auto-attaches each rule when you touch a file matching its `paths:`
  glob (e.g. `css-conventions` when you edit a `*.css`).

So when you run a skill inside `elc-theme`, you get both at once: the global
workflow + the project's native rules. Run the same skill in a repo without
those rules, and the skill simply proceeds on general best practices. Bundled
`references/` docs (Jira field IDs, TA format) travel **with the plugin** and are
read via `${CLAUDE_PLUGIN_ROOT}`, so they always resolve regardless of install
scope.

## Concepts: commands vs skills vs agents

### Commands vs skills

Both are Markdown files with frontmatter; the difference is **who triggers them**
and **where they run**:

| | **Command** (`commands/*.md`) | **Skill** (`skills/<name>/SKILL.md`) |
|---|---|---|
| Trigger | **You** type `/name` explicitly | **You** type `/name` **or Claude auto-invokes** it by matching `description` |
| Best for | A fixed action you run on demand | A capability Claude should reach for when the task fits |
| Extra files | Single `.md` | A folder — can bundle `REFERENCE.md`, `scripts/`, etc. |
| Runs in | The main conversation | The main conversation |

Rule of thumb: if you want Claude to *decide* when to use it, write a **skill**
(it has a discoverable `description` and can carry supporting files). If you only
ever fire it manually, a **command** is the lighter option. This plugin ships
skills because the Foundation steps are things Claude should select on its own.

### Agents (subagents)

An **agent** is a separate Claude instance with its own context window, its own
system prompt, and its own restricted toolset. The main conversation **delegates
a self-contained task** to it; the agent works in isolation and returns only its
final result. Use them to (a) keep heavy/noisy work out of the main context, and
(b) run focused, read-only analysis with a tailored prompt.

A plugin ships agents as `agents/<name>.md`:

```markdown
---
name: change-reviewer
description: Reviews the branch's changed files (Liquid / TS / CSS) against Foundation conventions. Invoke before a commit or PR to catch core-file violations, stale comments, and schema mistakes.
model: sonnet
tools: Read, Grep, Glob, Bash
---

You are a Shopify theme reviewer for the Foundation codebase.

Given a set of changed files, check them against Foundation conventions:
- Never modify `src/entry/core/*` or `blocks/core-*.liquid` directly — flag any direct edits.
- Verify snippet params have LiquidDoc + defaults.
- Verify schemas are authored in `schemas/` (TS), not hand-edited in compiled output.

Return a concise findings list grouped by file, each with severity and a fix.
Your final message IS the result handed back — return data, not chatter.
```

**How it's used:**

- **Auto-delegation** — when your request matches the agent's `description`
  ("review my changes"), Claude spawns it automatically.
- **Explicit** — ask directly: *"use the change-reviewer agent on my staged
  changes."*
- **Isolation** — it can only `Read/Grep/Glob/Bash` here (no `Write`), so it
  analyzes without touching files. Add `isolation: worktree` if an agent must
  edit files in parallel without colliding with the main session.

Agents differ from skills: a **skill** runs inline in the main conversation and
steers *your* Claude; an **agent** is a *separate* Claude you hand a task to,
with its own context — ideal for parallel, sandboxed, or token-heavy subtasks.

This plugin ships no agents yet — the block above is a ready-to-use template, and
wiring `change-reviewer` into the review flow is the next planned step
(see `AGENTS_PLAN.md`).

## License

MIT — see [LICENSE](./LICENSE).
