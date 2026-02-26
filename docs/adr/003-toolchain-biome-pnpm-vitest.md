# ADR-003: Toolchain — pnpm, Biome, Vitest, Zod

## Status
Accepted

## Context
We need to choose a package manager, linter/formatter, test framework, and validation library for the TypeScript MCP server.

## Decision
Adopt the toolchain consistently used across steipete's TypeScript projects:
- **pnpm** as package manager
- **Biome** as linter and formatter (replaces ESLint + Prettier)
- **Vitest** as test framework
- **Zod** for runtime input validation

## Rationale
- **Consistency with ecosystem**: steipete's MCP tools (Peekaboo, macos-automator-mcp, claude-code-mcp, poltergeist, etc.) all use this stack. AI agents have extensive training data on this combination.
- **pnpm**: Faster installs, strict dependency resolution, smaller node_modules
- **Biome**: Single tool replaces ESLint + Prettier. ~100x faster, zero config needed, consistent formatting
- **Vitest**: Native TypeScript support, fast execution, compatible with Jest API
- **Zod**: Type-safe schema validation for MCP tool inputs, generates TypeScript types

## Alternatives Considered
- **npm + ESLint + Prettier**: More common but slower, requires more configuration, two tools instead of one
- **Bun**: Some steipete projects use Bun, but Node.js 22+ is more stable for MCP servers

## Consequences
- All npm commands become pnpm commands
- Single `biome.json` config replaces `.eslintrc` + `.prettierrc`
- Test files use vitest's `describe`/`it`/`expect` API
- MCP tool inputs validated with Zod schemas before processing

## References
- [steipete/poltergeist](https://github.com/steipete/poltergeist) — Full reference implementation of this toolchain
- [steipete/claude-code-mcp](https://github.com/steipete/claude-code-mcp) — MCP server with Vitest E2E tests
