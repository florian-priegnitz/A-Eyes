# Architecture

## Overview

A-Eyes is an MCP server that provides screenshot capabilities to Claude Code on Windows via WSL2.

```
┌─────────────┐     MCP (stdio)      ┌──────────────────┐
│ Claude Code  │ ◄──────────────────► │  A-Eyes MCP      │
│ (Client)     │                      │  Server (TS)     │
└─────────────┘                       │  runs in WSL2    │
                                      └────────┬─────────┘
                                               │ powershell.exe
                                      ┌────────▼─────────┐
                                      │  PowerShell       │
                                      │  Screenshot       │
                                      │  Script           │
                                      │  runs in Windows  │
                                      └────────┬─────────┘
                                               │ Win32 API
                                      ┌────────▼─────────┐
                                      │  Windows Desktop  │
                                      │  (target windows) │
                                      └──────────────────┘
```

## Components

### MCP Server (`src/server.ts`)
- Registers MCP tools (`capture`, `list_windows`, `query`, `see`, `check_status`, `clipboard`, `processes`)
- Validates input parameters via Zod schemas
- Enforces allowlist (deny-by-default) and regex policy engine
- Audit-logs every tool call
- Returns results in MCP format

### Capture Module (`src/capture.ts`)
- Calls `powershell.exe` from WSL2
- Passes window title/app name as argument
- Receives PNG screenshot as base64
- Handles path conversion (WSL ↔ Windows)

### Save Screenshot Module (`src/save-screenshot.ts`)
- Sanitizes window titles for use as filenames
- Generates timestamped PNG filenames
- Resolves output paths (directory vs. file)
- Writes base64-decoded PNG data to disk

### Config Module (`src/config.ts`)
- Loads `a-eyes.config.json`
- Manages optional allowlist
- Controls file-saving behavior (`save_screenshots`, `screenshot_dir`)
- Provides runtime configuration

### PowerShell Script (`scripts/screenshot.ps1`)
- Uses Win32 APIs to find window by title
- Captures window content as bitmap
- Outputs PNG as base64 to stdout

### Audit Log Module (`src/audit-log.ts`)
- Logs all tool calls (capture, query, list_windows) to `~/.a-eyes/logs/audit-YYYY-MM-DD.jsonl`
- JSONL format: one JSON object per line with timestamp, tool, params, result, duration_ms
- Always active — no config toggle (security feature)
- Non-blocking: log errors are caught and logged to stderr, never interrupt tool execution
- No MCP tool exposure — logs are only accessible via filesystem (user-controlled)

## Ecosystem

A-Eyes is one of several MCP servers running in parallel in a Claude Code session. Each server has a distinct responsibility — A-Eyes does not attempt to be a monolith.

```
Claude Code Session
  ├── MCP: A-Eyes         → Screenshots, UI Automation, Clipboard, Processes (this project)
  ├── MCP: Unity-MCP      → Unity Editor + Runtime, 100+ tools (github.com/IvanMurzak/Unity-MCP)
  ├── MCP: mcp-unity      → Unity Scene/Components/Tests (github.com/CoderGamester/mcp-unity)
  ├── MCP: lsp-tap        → LSP Diagnostics Push (planned, github.com/florian-priegnitz/lsp-tap)
  ├── MCP: sec-tap        → Tetragon eBPF Security Events Push (planned, github.com/florian-priegnitz/sec-tap)
  └── MCP: ntfy-me-mcp    → Push Notifications via ntfy.sh (github.com/gitmotion/ntfy-me-mcp)
```

**A-Eyes' role in this ecosystem:**
- Windows desktop perception (screenshots, UI trees, clipboard, processes)
- Security-first architecture (deny-by-default allowlist, audit log, redaction) — planned for extraction as `@a-eyes/security` reusable package

**What A-Eyes does NOT do:**
- Unity Editor integration → Unity-MCP / mcp-unity
- Language diagnostics → lsp-tap (planned)
- Kernel security events → sec-tap (planned)
- Push notifications → ntfy-me-mcp

## Key Design Decisions

See `docs/adr/` for Architecture Decision Records.

## Security Boundaries

1. **Input validation** — MCP server validates all parameters before passing to PowerShell
2. **No shell interpolation** — `execFile` passes `window_title` as argv instead of building shell command strings
3. **Allowlist (deny-by-default)** — Without a configured allowlist, all captures are blocked. Only windows matching allowlist patterns can be captured
4. **Optional file saving** — Screenshots are passed as base64 by default; file saving is opt-in via config (`save_screenshots`) or per-call (`output_path`)
