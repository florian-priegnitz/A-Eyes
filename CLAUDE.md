# A-Eyes

## Project Overview

A-Eyes is a screenshot tool for Claude Code that enables AI agents to capture screenshots of windows on Windows via WSL2. Inspired by [Peekaboo](https://github.com/steipete/Peekaboo) (macOS), A-Eyes brings visual perception to Claude Code on Windows.

The tool runs as an **MCP (Model Context Protocol) Server** so Claude Code can call it directly as a tool.

### MVP Scope

1. **`capture`** — Take a screenshot of a specific window by title/app name (MVP)
2. **`list_windows`** — List available windows (planned)
3. **`query`** — Screenshot + AI-powered question about the content (planned)

### Architecture

```
Claude Code  →  MCP Server (TypeScript, runs in WSL2)
                    ↓
              PowerShell script (called via powershell.exe)
                    ↓
              Windows Screenshot APIs (Win32)
                    ↓
              PNG image → returned to Claude Code
```

### Security

- By default **no** windows can be captured (deny-by-default)
- An allowlist must be configured in `a-eyes.config.json` to enable captures
- Only windows matching the allowlist patterns are accessible
- All tool calls are audit-logged to `~/.a-eyes/logs/` (JSONL, daily rotation, always active, no MCP read/delete access)

### Screenshot-Speicherung

Wenn du das `capture`-Tool von A-Eyes nutzt und der User keinen `output_path` angegeben hat, **frage den User**, ob und wohin der Screenshot als Datei gespeichert werden soll. Übergib dann `output_path` an das Tool. Wenn `save_screenshots: true` in der Config steht, werden Screenshots automatisch im konfigurierten Verzeichnis gespeichert — informiere den User über den Speicherort.

## Tech Stack

- **MCP Server**: TypeScript (Node.js 22+)
- **Screenshot Capture**: PowerShell (Win32 APIs, called from WSL2 via `powershell.exe`)
- **Package Manager**: pnpm
- **Linting/Formatting**: Biome
- **Testing**: Vitest
- **Validation**: Zod (MCP input schemas)
- **MCP SDK**: `@modelcontextprotocol/sdk`

## Project Structure

```
a-eyes/
├── CLAUDE.md              # Project context for Claude Code
├── package.json           # Node.js project config
├── pnpm-lock.yaml         # pnpm lockfile
├── tsconfig.json          # TypeScript config
├── biome.json             # Biome linter/formatter config
├── a-eyes.config.json     # Optional: allowlist & settings
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── server.ts          # MCP server setup & tool definitions
│   ├── capture.ts         # Screenshot capture logic (calls PowerShell)
│   ├── config.ts          # Config loading (allowlist etc.)
│   └── audit-log.ts       # Tamper-resistant audit logging (JSONL to ~/.a-eyes/logs/)
├── scripts/
│   └── screenshot.ps1     # PowerShell script for Windows screenshot capture
├── docs/                  # Central documentation folder
│   ├── CHANGELOG.md       # Keep a Changelog format
│   ├── VERSIONING.md      # Semver rules for this project
│   ├── ARCHITECTURE.md    # System architecture overview
│   └── adr/               # Architecture Decision Records
│       ├── 001-typescript-mcp-server.md
│       ├── 002-powershell-screenshot-capture.md
│       └── 003-toolchain-biome-pnpm-vitest.md
├── tests/
│   └── ...
└── .claude/
    ├── agents/            # Custom agents (architect, coder, reviewer, tester, security)
    ├── skills/            # Slash commands (/build, /test, /lint, /mcp-test, /release, /backlog)
    └── settings.json      # Project permissions
```

## Development

### Setup

```bash
pnpm install
```

### Build & Run

```bash
pnpm build             # Compile TypeScript
pnpm start             # Start MCP server
pnpm dev               # Development mode with watch
```

### Tests

```bash
pnpm test              # Run vitest
pnpm test:watch        # Watch mode
```

### Lint & Format

```bash
pnpm lint              # Biome check
pnpm lint:fix          # Biome auto-fix
```

### Claude Code MCP Config

Register A-Eyes in the target project via `.mcp.json` (not `settings.json`):

```bash
cd /path/to/your-project
claude mcp add a-eyes -s project -- node /path/to/a-eyes/dist/index.js
```

Or create `.mcp.json` manually in the target project root:
```json
{
  "mcpServers": {
    "a-eyes": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/a-eyes/dist/index.js"],
      "cwd": "/path/to/a-eyes"
    }
  }
}
```

## Agents

Custom agents in `.claude/agents/` for team-based development:

| Agent | Model | Role | Tools |
|-------|-------|------|-------|
| **architect** | opus | Plans architecture, designs interfaces, creates implementation plans | Read-only |
| **coder** | sonnet | Implements features in TypeScript and PowerShell | Full edit access |
| **reviewer** | sonnet | Reviews code for quality, correctness, patterns | Read-only |
| **tester** | sonnet | Writes and runs tests with vitest | Edit + Bash |
| **security** | opus | Audits for command injection, path traversal, input sanitization | Read-only |

### Usage Patterns

```bash
# Single agent (Claude auto-delegates based on description):
"Review the capture module for security issues"  → security agent
"Plan the list_windows feature"                  → architect agent
"Write tests for config.ts"                      → tester agent

# Agent team (parallel work):
"Create a team: coder implements capture, tester writes tests, security reviews"
```

## Skills (Slash Commands)

Available via `/command` in Claude Code:

| Skill | Description | Safety |
|-------|-------------|--------|
| `/build [--clean]` | Compile TypeScript to `dist/` | Auto-allowed |
| `/test [pattern]` | Run vitest test suite | Auto-allowed |
| `/lint [--fix]` | Biome check / auto-fix | Auto-allowed |
| `/mcp-test` | Start MCP server and verify tool registration | Auto-allowed |
| `/release <patch\|minor\|major>` | Bump version, changelog, tag (no push/publish) | User-only |
| `/backlog <list\|add\|close\|show>` | Manage GitHub Issues backlog | Auto-allowed |

## Documentation

All documentation lives in `docs/`:

| File | Purpose |
|------|---------|
| `docs/CHANGELOG.md` | Release history ([Keep a Changelog](https://keepachangelog.com)) |
| `docs/VERSIONING.md` | Semantic versioning rules |
| `docs/ARCHITECTURE.md` | System architecture & component overview |
| `docs/adr/` | Architecture Decision Records (numbered) |

### Backlog

The backlog is managed via **GitHub Issues** with labels:
- **Type**: `type:feature`, `type:bug`, `type:chore`, `type:docs`
- **Priority**: `priority:high`, `priority:medium`, `priority:low`
- **Scope**: `scope:mvp`, `scope:next`, `scope:future`

Use `/backlog` to manage issues from Claude Code.

### Changelog Workflow

1. Every change adds an entry under `[Unreleased]` in `docs/CHANGELOG.md`
2. On release, `/release` converts `[Unreleased]` → `[x.y.z] - YYYY-MM-DD`
3. Categories: Added, Changed, Deprecated, Removed, Fixed, Security

## Conventions

- Code and comments: English
- Commit messages: English, imperative mood ("Add feature", not "Added feature")
- Branch naming: `feature/description`, `fix/description`
- Keep it simple — avoid over-engineering, start lean
- Use agents for complex tasks — architect plans, coder implements, reviewer + security verify

## Memory & Kontext

### Cold Memory (PKB — projektübergreifend)
Für vollständigen Kontext zu Florian Priegnitz und Arbeitskonventionen:
Lies den Skill `my-ai-os` unter `~/projects/my-ai-os/SKILL.md` und folge
den Routing-Anweisungen dort.

Relevante Module für dieses Projekt:
- `references/profile/identity.yaml` — Profil, Rollen, Positionierung
- `references/knowledge/cca-exam-guide.yaml` — MCP-Integration (CCA Domain 2: Tool Design & MCP)
- `references/knowledge/memory-architecture.yaml` — Dreistufige Memory-Architektur
- `references/projects/a-eyes.yaml` — Projektstatus (falls vorhanden, sonst `_index.yaml`)

### Hot Memory (Claude Code Built-in)
Claude Code speichert automatisch Session-Kontext in `~/.claude/projects/`.
Wird bei Session-Start injiziert — keine Konfiguration nötig.

### Wissen destillieren
Wenn sich in Sessions wiederkehrende Patterns, Konventionen oder Erkenntnisse
zeigen: `/memory-promote` ausführen, um diese ins PKB zu übernehmen.

## References

### Primary
- [Peekaboo](https://github.com/steipete/Peekaboo) — macOS screenshot MCP server (direct inspiration)
- [macos-automator-mcp](https://github.com/steipete/macos-automator-mcp) — TS MCP server wrapping platform scripts (architecture reference)
- [sweet-cookie](https://github.com/steipete/sweet-cookie) — TypeScript → PowerShell call pattern (implementation reference)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — TypeScript MCP SDK

### Tooling
- [mcporter](https://github.com/steipete/mcporter) — CLI to test MCP servers without Claude Desktop
- [claude-code-mcp](https://github.com/steipete/claude-code-mcp) — MCP npm packaging reference
- [osc-progress](https://github.com/steipete/osc-progress) — Terminal progress bars (Windows Terminal support)

### Ecosystem (complementary MCP servers)
- [Unity-MCP](https://github.com/IvanMurzak/Unity-MCP) — Unity Editor + Runtime MCP server, 100+ tools, screenshots, Roslyn script execute, custom tool extensibility
- [mcp-unity](https://github.com/CoderGamester/mcp-unity) — Unity Editor MCP server, WebSocket bridge, scene/component manipulation
- [ntfy-me-mcp](https://github.com/gitmotion/ntfy-me-mcp) — Push notifications via ntfy.sh

### Philosophy
- [Shipping at Inference Speed](https://steipete.me/posts/2025/shipping-at-inference-speed) — Tech stack philosophy
