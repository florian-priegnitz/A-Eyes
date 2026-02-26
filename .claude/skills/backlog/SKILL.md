---
name: backlog
description: Manage the project backlog via GitHub Issues. List, create, update, and prioritize backlog items.
argument-hint: "<list|add|close|show> [details]"
allowed-tools: Bash(gh issue *), Bash(gh label *), Read
model: sonnet
---

## Backlog Management

Manage A-Eyes backlog using GitHub Issues.

### Labels

The backlog uses these labels for categorization:
- `type:feature` — New functionality
- `type:bug` — Bug fix
- `type:chore` — Maintenance, refactoring, tooling
- `type:docs` — Documentation
- `priority:high` — Must have for current milestone
- `priority:medium` — Should have
- `priority:low` — Nice to have
- `scope:mvp` — Part of MVP milestone
- `scope:next` — Planned for post-MVP
- `scope:future` — Backlog / someday

### Commands

**List backlog items:**
```
/backlog list                    → all open issues
/backlog list --label scope:mvp  → MVP items only
/backlog list --label priority:high → high priority
```

**Add a backlog item:**
```
/backlog add "Implement capture tool" --label type:feature,scope:mvp,priority:high
```

**Show details:**
```
/backlog show 42                 → show issue #42
```

**Close an item:**
```
/backlog close 42                → close issue #42
```

### Execution

Based on `$ARGUMENTS`:

- **`list`**: Run `gh issue list` with any additional flags
- **`add`**: Run `gh issue create` with title and labels
- **`show`**: Run `gh issue view` for the given issue number
- **`close`**: Run `gh issue close` for the given issue number
- **No args**: Run `gh issue list --state open --limit 20`

Always display results in a clear table format.
