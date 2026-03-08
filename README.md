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
| **`capture`** | Take a screenshot of a window by title or app name. Optionally save to disk via `output_path` |
| **`list_windows`** | List all visible windows on the Windows desktop (with capturable/blocked markers) |
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
- *"Take a screenshot of Firefox and save it to ~/screenshots"* → calls `capture` with `output_path`

## Configuration

Create `a-eyes.config.json` in the project root to configure allowed windows and screenshot saving:

```json
{
  "allowlist": ["Chrome", "VS Code", "Firefox"],
  "save_screenshots": true,
  "screenshot_dir": "./screenshots"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `allowlist` | `[]` (none) | Window title patterns that can be captured. **Without an allowlist, all captures are blocked** (deny-by-default) |
| `save_screenshots` | `false` | Automatically save every captured screenshot to disk |
| `screenshot_dir` | `"./screenshots"` | Directory for auto-saved screenshots (used when `save_screenshots` is `true`) |

> **Security**: Without a configured allowlist, no windows can be captured. This is intentional — A-Eyes follows a deny-by-default security model.

## Security

- **Deny-by-default** — no captures without an explicit allowlist
- **Input validation** on all MCP tool parameters (Zod schemas)
- **No shell interpolation** — `execFile` passes `window_title` as argv, not as shell string
- **Audit logging** — all tool calls are logged to `~/.a-eyes/logs/audit-YYYY-MM-DD.jsonl` (always active, no MCP read/delete access). Logs include timestamp, tool name, parameters, result, and duration
- **No temp files** — screenshots are passed as base64 in memory (file saving is opt-in)

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Compile TypeScript
pnpm dev            # Development mode with watch
pnpm test           # Run tests (68 tests)
pnpm lint           # Lint with Biome
pnpm lint:fix       # Auto-fix lint issues
```

If `pnpm` is not available in `PATH`, use `npx pnpm` or npm equivalents:

```bash
npm run build
npm run test
npm run lint
```

Detailed manual test procedure: [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md)

## Project Structure

```
a-eyes/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── server.ts             # Tool registration (capture, list_windows, query)
│   ├── capture.ts            # Screenshot capture via PowerShell
│   ├── list-windows.ts       # Window enumeration via PowerShell
│   ├── config.ts             # Config loading with Zod validation
│   ├── audit-log.ts          # Tamper-resistant audit logging (JSONL)
│   ├── save-screenshot.ts    # Screenshot file saving utilities
│   ├── windows-path.ts       # WSL path → Windows/UNC conversion
│   ├── powershell-output.ts  # Robust JSON/base64 parsing helpers
│   └── windows-interop.ts    # Interop error normalization
├── scripts/
│   ├── screenshot.ps1        # Win32 API window capture
│   └── list-windows.ps1      # Win32 API window enumeration
├── tests/                    # Vitest test suite (68 tests)
└── docs/                     # Architecture docs, ADRs, changelog
```

## Troubleshooting

### `powershell.exe` fails with `Exec format error`

This indicates WSL Windows interop is disabled in the current session.

1. Run `wsl --shutdown` from **Windows PowerShell/CMD** (not from inside WSL).
2. Start the distro again (`wsl -d <YourDistro>`).
3. Re-run `list_windows`/`capture`.

### Quick interop health check

Run inside WSL:

```bash
test -e /proc/sys/fs/binfmt_misc/WSLInterop && echo WSLInterop_present || echo WSLInterop_missing
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
```

Expected: `WSLInterop_present` and a PowerShell version string.

## Acknowledgements

- [Peekaboo](https://github.com/steipete/Peekaboo) — macOS screenshot MCP server (direct inspiration)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol SDK

## License

[MIT](LICENSE)
