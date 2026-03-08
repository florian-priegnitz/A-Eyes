# A-Eyes

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6366F1)](https://modelcontextprotocol.io/)
[![Platform: Windows + WSL2](https://img.shields.io/badge/platform-Windows%20%2B%20WSL2-0078D4?logo=windows)](https://learn.microsoft.com/en-us/windows/wsl/)

Claude Code can read files and run commands, but it cannot see what is on your screen. A-Eyes closes that gap: it is an MCP server that lets Claude Code capture screenshots of Windows applications through WSL2 — so it can diagnose UI errors, verify layouts, or answer questions about what you are looking at. The Windows equivalent of [Peekaboo](https://github.com/steipete/Peekaboo) (macOS).

## Security Model

A-Eyes treats screenshot access as a security-sensitive operation. The design assumes that an AI agent requesting screen captures should be constrained by default, not trusted by default.

**Deny-by-default access control.** Without an explicit allowlist in `a-eyes.config.json`, every capture request is blocked. There is no "capture everything" mode. The operator decides which windows are accessible — the AI agent cannot override this.

**Tamper-resistant audit logging.** Every tool invocation (capture, query, list_windows) is logged to `~/.a-eyes/logs/audit-YYYY-MM-DD.jsonl` — append-only, daily rotation. There is no MCP tool to read, modify, or delete these logs. The AI agent can only access them through filesystem tools that the operator can deny at the permission prompt. Each log entry records timestamp, tool name, parameters, result status, and execution duration.

**No shell interpolation.** Window titles are passed as `execFile` argv arrays, never interpolated into shell command strings. This eliminates command injection through crafted window titles — a realistic attack vector when an AI agent chooses which windows to capture.

**Schema-validated inputs.** All MCP tool parameters are validated through Zod schemas before any processing. Malformed requests fail at the boundary, not inside business logic.

## Architecture

```
Claude Code  ──MCP/stdio──►  A-Eyes Server (TypeScript, WSL2)
                                    │
                              powershell.exe (execFile, argv)
                                    │
                              Win32 API (FindWindow, PrintWindow)
                                    │
                              PNG ──base64──► returned to Claude Code
```

The server runs inside WSL2 and calls Windows PowerShell scripts through WSL interop. Screenshots never touch the filesystem unless explicitly configured — they are returned as base64-encoded PNG data over the MCP stdio transport.

## Tools

| Tool | Description |
|------|-------------|
| `capture` | Screenshot a window by title. Optionally save to disk via `output_path`. Supports `max_width` for resize. |
| `list_windows` | List all visible windows. Shows `+`/`-` markers for capturable vs. blocked. |
| `query` | Capture a screenshot and forward a question about its content to Claude. Supports `max_width`. |
| `check_status` | Health check: verifies config, WSL interop, and script availability. |

## Installation & Quickstart

**Requirements:** WSL2 on Windows 10/11, Node.js 18+, pnpm

```bash
git clone https://github.com/florian-priegnitz/a-eyes.git
cd a-eyes
pnpm install && pnpm build
```

Register as MCP server in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "a-eyes": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/a-eyes"
    }
  }
}
```

Create an allowlist (without this, all captures are blocked):

```bash
cp a-eyes.config.example.json a-eyes.config.json
# Edit the allowlist to match your environment
```

Then in Claude Code: *"Take a screenshot of Chrome"* or *"What windows are open?"*

## Configuration

A-Eyes searches for config in order: `./a-eyes.config.json` (project) → `~/.a-eyes/config.json` (user home) → deny-all defaults.

```json
{
  "allowlist": ["Chrome", "VS Code", "Firefox"],
  "save_screenshots": false,
  "screenshot_dir": "./screenshots"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `allowlist` | `[]` | Window title substrings that are allowed for capture. Empty = all blocked. |
| `save_screenshots` | `false` | Auto-save every capture to `screenshot_dir`. |
| `screenshot_dir` | `"./screenshots"` | Target directory for auto-saved PNGs. |
| `max_captures_per_minute` | `0` | Rate limit for `capture`/`query` calls. 0 = unlimited. |

## Testing

```bash
pnpm test           # 72 tests across 8 files
pnpm lint           # Biome linter + formatter
```

Test coverage includes: config loading and search chain, capture/list-windows PowerShell integration, audit log file rotation and append behavior, server-level tool handler responses for success, blocked, and error paths, WSL path conversion edge cases.

## Troubleshooting

**`Exec format error` when calling PowerShell:** WSL interop is disabled. Run `wsl --shutdown` from Windows CMD/PowerShell, then restart your distro.

**Quick health check** (run inside WSL):

```bash
test -e /proc/sys/fs/binfmt_misc/WSLInterop && echo OK || echo MISSING
```

## Author

Built by [Florian Priegnitz](https://linkedin.com/in/florianpriegnitz), Information Security Consultant at SECURAM Consulting, Hamburg. Focus areas: ISO 27001, AI governance, and security tooling. More projects on [GitHub](https://github.com/florian-priegnitz).

Related project: [Compliance Intelligence Dashboard](https://github.com/florian-priegnitz/Compliance-Intelligence-Dashboard) — a DORA/ISO 27001/NIS-2 gap analysis tool with AI-assisted compliance scoring.

## License

[MIT](LICENSE)
