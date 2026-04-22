---
name: ci
description: Check GitHub Actions CI status. List recent runs, view details of a specific run, or watch for completion. Requires CI pipeline to be set up (see issue #18).
argument-hint: "[run-id | --watch | --failed]"
allowed-tools: Bash(gh *)
model: haiku
---

## CI Status

Check GitHub Actions workflow status for A-Eyes.

### Usage

```
/ci              → list last 10 runs
/ci --failed     → show only failed runs
/ci --watch      → poll until current run completes
/ci 12345678     → show details of run ID 12345678
```

### Steps

**No arguments — list recent runs:**
```bash
gh run list --limit 10 --repo florian-priegnitz/A-Eyes
```
Show: run ID, status (✅/❌/⏳), branch, commit message, duration.

**`--failed` — only failures:**
```bash
gh run list --limit 10 --status failure --repo florian-priegnitz/A-Eyes
```

**`--watch` — poll until done:**
```bash
gh run watch --repo florian-priegnitz/A-Eyes
```

**Specific run ID:**
```bash
gh run view $ARGUMENTS --repo florian-priegnitz/A-Eyes --log-failed
```
Show failed steps and their log output.

### Status Icons
- ✅ `completed / success`
- ❌ `completed / failure`
- ⏳ `in_progress`
- ⏸️ `queued`

### Note
Requires GitHub Actions CI to be configured (issue #18). If no workflows exist yet, this skill will report "no runs found" — set up CI first.
