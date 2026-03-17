---
name: coverage
description: Run vitest with coverage reporting. Shows per-file coverage and flags files below the 80% threshold.
argument-hint: "[--open]"
allowed-tools: Bash(pnpm *), Bash(npx *), Read
model: haiku
---

## Coverage Report

Run the test suite with coverage and report results against the 80% threshold.

### Steps

1. Run vitest with V8 coverage:
   ```bash
   npx pnpm exec vitest run --coverage --coverage.provider=v8 2>&1
   ```

2. Parse the output and report:
   - Overall coverage percentage
   - Files **below 80%** highlighted as ⚠️
   - Files at 80-90% as ✓
   - Files above 90% as ✅

3. If `$ARGUMENTS` contains `--open`, also run:
   ```bash
   npx pnpm exec vitest run --coverage --coverage.reporter=html 2>&1
   ```
   And report the path to the HTML report.

4. Summary line:
   ```
   Coverage: XX% overall | N files below threshold | N files above 90%
   ```

5. If any file is below 80%, list them with their current coverage and suggest which test cases are likely missing (based on uncovered line ranges if available).

### Threshold

The project requires **minimum 80% line coverage** per file (non-functional requirement in ROADMAP.md). Flag any file below this as a blocker for release.
