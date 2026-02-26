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
- Registers MCP tools (`capture`, `list_windows`, `query`)
- Validates input parameters
- Enforces allowlist (if configured)
- Returns results in MCP format

### Capture Module (`src/capture.ts`)
- Calls `powershell.exe` from WSL2
- Passes window title/app name as argument
- Receives PNG screenshot as base64
- Handles path conversion (WSL ↔ Windows)

### Config Module (`src/config.ts`)
- Loads `a-eyes.config.json`
- Manages optional allowlist
- Provides runtime configuration

### PowerShell Script (`scripts/screenshot.ps1`)
- Uses Win32 APIs to find window by title
- Captures window content as bitmap
- Outputs PNG as base64 to stdout

## Key Design Decisions

See `docs/adr/` for Architecture Decision Records.

## Security Boundaries

1. **Input validation** — MCP server validates all parameters before passing to PowerShell
2. **Argument escaping** — Window titles are escaped to prevent PowerShell injection
3. **Allowlist** — Optional config restricts which windows can be captured
4. **No file system access** — Screenshots are passed as base64, no temp files on disk
