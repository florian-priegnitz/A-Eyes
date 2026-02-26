---
name: lint
description: Lint and format the codebase using Biome. Checks TypeScript for errors and style issues.
argument-hint: "[--fix]"
allowed-tools: Bash(pnpm lint*), Bash(pnpm exec biome *), Read
model: haiku
---

## Lint A-Eyes

Run Biome linting and formatting checks.

### Steps

1. Run the linter:
   ```bash
   pnpm lint
   ```

2. If `$ARGUMENTS` contains `--fix`, auto-fix issues:
   ```bash
   pnpm lint:fix
   ```

3. Report remaining issues with file and line references.
