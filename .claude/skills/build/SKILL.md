---
name: build
description: Build the TypeScript project. Compiles source code and reports errors.
argument-hint: "[--clean]"
allowed-tools: Bash(pnpm *), Bash(rm -rf dist/), Read
model: haiku
---

## Build A-Eyes

Build the TypeScript MCP server.

### Steps

1. If `$ARGUMENTS` contains `--clean`, remove the `dist/` directory first:
   ```bash
   rm -rf dist/
   ```

2. Run the build:
   ```bash
   pnpm build
   ```

3. Report any TypeScript compilation errors clearly with file and line references.

4. On success, confirm the build output in `dist/`.
