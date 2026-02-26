---
name: test
description: Run the test suite. Executes all tests or a specific test file.
argument-hint: "[test-file-or-pattern]"
allowed-tools: Bash(pnpm test*), Bash(pnpm exec vitest *), Read
model: haiku
---

## Run Tests

Execute the A-Eyes test suite using vitest.

### Steps

1. If `$ARGUMENTS` is provided, run specific tests:
   ```bash
   pnpm exec vitest run $ARGUMENTS
   ```

2. If no arguments, run all tests:
   ```bash
   pnpm test
   ```

3. Report results clearly:
   - Number of tests passed/failed
   - For failures: file, test name, and error message
   - Suggest fixes for common failures
