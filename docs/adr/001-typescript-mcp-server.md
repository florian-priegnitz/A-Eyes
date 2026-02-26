# ADR-001: TypeScript for MCP Server

## Status
Accepted

## Context
We need to choose a language for the MCP server component of A-Eyes. The server runs in WSL2 and communicates with Claude Code via the MCP protocol (stdio).

## Decision
Use **TypeScript** (Node.js 22+) for the MCP server.

## Rationale
- The MCP SDK (`@modelcontextprotocol/sdk`) is primarily TypeScript-based
- Claude Code and AI agents write excellent TypeScript (ref: steipete "Shipping at Inference Speed")
- Native MCP ecosystem integration
- Fast iteration with `tsx` for development

## Consequences
- Requires Node.js 22+ runtime in WSL2
- PowerShell capture script is a separate component called via `powershell.exe`
- Two languages in the project (TypeScript + PowerShell)
