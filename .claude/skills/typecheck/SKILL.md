---
name: typecheck
description: Run TypeScript type checking without compiling. Faster than build — use during development to catch type errors quickly.
allowed-tools: Bash(npx *), Bash(pnpm *)
model: haiku
---

## TypeScript Type Check

Run `tsc --noEmit` to catch type errors without writing to `dist/`.

### Steps

1. Run the type checker:
   ```bash
   npx pnpm exec tsc --noEmit 2>&1
   ```

2. Report results:
   - **No output** = no type errors ✅
   - **Errors found** = list each with file, line, and error message

3. For each error, include the clickable file reference:
   `src/filename.ts:42` — Description of the error

### When to use

- After editing TypeScript files, before running full build
- Faster feedback loop than `/build` during active development
- Use `/build` when you need the compiled output in `dist/`
