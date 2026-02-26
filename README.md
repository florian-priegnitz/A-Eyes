# A-Eyes

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6366F1)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Biome](https://img.shields.io/badge/Biome-Linter%20%26%20Formatter-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Testing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

**Screenshot MCP server for Claude Code on Windows via WSL2.**

A-Eyes enables AI agents to capture screenshots of Windows applications directly from Claude Code. Inspired by [Peekaboo](https://github.com/steipete/Peekaboo) (macOS), A-Eyes brings visual perception to Claude Code on Windows.

## How It Works

```
Claude Code  →  MCP Server (TypeScript, WSL2)
                    ↓
              PowerShell script (powershell.exe)
                    ↓
              Windows Screenshot APIs (Win32)
                    ↓
              PNG image → returned to Claude Code
```

## Tools

| Tool | Description |
|------|-------------|
| **`capture`** | Take a screenshot of a window by title or app name |
| **`list_windows`** | List all visible windows on the Windows desktop |
| **`query`** | Capture a screenshot and ask a question about its content |

## Requirements

- **WSL2** on Windows 10/11
- **Node.js 22+** (in WSL2)
- **pnpm** (or use `npx pnpm`)
- **PowerShell** (built-in on Windows, called from WSL2 via `powershell.exe`)

## Installation

```bash
git clone https://github.com/florian-priegnitz/a-eyes.git
cd a-eyes
pnpm install
pnpm build
```

## Claude Code Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

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

## Usage Examples

Once configured, Claude Code can use the tools directly:

- *"Take a screenshot of Chrome"* → calls `capture`
- *"What windows are open?"* → calls `list_windows`
- *"What error is shown in VS Code?"* → calls `query`

## Configuration

Optionally create `a-eyes.config.json` to restrict which windows can be captured:

```json
{
  "allowlist": ["Chrome", "VS Code", "Firefox"]
}
```

When no config file is present, all windows are accessible.

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Compile TypeScript
pnpm dev            # Development mode with watch
pnpm test           # Run tests
pnpm lint           # Lint with Biome
pnpm lint:fix       # Auto-fix lint issues
```

## Project Structure

```
a-eyes/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── server.ts          # Tool registration (capture, list_windows, query)
│   ├── capture.ts         # Screenshot capture via PowerShell
│   ├── list-windows.ts    # Window enumeration via PowerShell
│   └── config.ts          # Config loading with Zod validation
├── scripts/
│   ├── screenshot.ps1     # Win32 API window capture
│   └── list-windows.ps1   # Win32 API window enumeration
├── tests/                 # Vitest test suite
└── docs/                  # Architecture docs & ADRs
```

## Security

- Input validation on all MCP tool parameters
- PowerShell argument escaping to prevent injection
- Optional allowlist to restrict accessible windows
- No temp files — screenshots are passed as base64 in memory

## Acknowledgements

- [Peekaboo](https://github.com/steipete/Peekaboo) — macOS screenshot MCP server (direct inspiration)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol SDK

## License

[MIT](LICENSE)
