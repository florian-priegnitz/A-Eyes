# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Tamper-resistant audit logging to `~/.a-eyes/logs/` — all tool calls (capture, query, list_windows) are logged as JSONL with timestamp, params, result, and duration
- New `src/audit-log.ts` module with `getAuditLogPath()` and `writeAuditEntry()` functions
- Unit tests for audit-log module and audit logging integration in server tests
- Config search chain: searches `./a-eyes.config.json` (project), then `~/.a-eyes/config.json` (user home), then defaults
- npm publish readiness: `files`, `repository`, `homepage`, `bugs`, `author`, `prepublishOnly` fields in package.json
- Example config file `a-eyes.config.example.json` in repo

### Changed
- Node.js engine requirement lowered from `>=22.0.0` to `>=18.0.0` (no Node 22-specific features used)
- Config validation errors now include the file path for easier debugging
- **BREAKING**: Allowlist is now deny-by-default — without a configured allowlist, all captures are blocked
- Improved error messages: capture/query without allowlist now shows a config hint instead of "not in the allowlist"

### Added
- Screenshot file-saving: optional `output_path` parameter on `capture` tool to save PNG to disk
- Config options `save_screenshots` (default: false) and `screenshot_dir` (default: `./screenshots`) for automatic file saving
- New `src/save-screenshot.ts` module with filename sanitization, timestamped naming, and file writing utilities
- Unit tests for save-screenshot module (11 tests)

### Changed
- `capture` tool now accepts optional `output_path` parameter
- Config schema extended with `save_screenshots` and `screenshot_dir` fields (backward-compatible defaults)
- Architecture docs updated to reflect file-saving capability

### Previously added
- Project scaffolding: CLAUDE.md, agents, skills, docs structure
- 5 custom agents: architect, coder, reviewer, tester, security
- 6 skills: /build, /test, /lint, /mcp-test, /release, /backlog
- Project settings with permission allowlist/denylist
- Central documentation in `docs/`: CHANGELOG, VERSIONING, ARCHITECTURE
- Architecture Decision Records (ADR-001 through ADR-003)
- Backlog management via GitHub Issues (/backlog skill)
- MCP server with stdio transport (`src/index.ts`, `src/server.ts`)
- `capture` tool: screenshot a window by title, returns PNG as base64
- `list_windows` tool: enumerate all visible Windows desktop windows
- `query` tool: capture screenshot + ask a question about its content
- PowerShell `screenshot.ps1`: Win32 API window capture (FindWindow, PrintWindow)
- PowerShell `list-windows.ps1`: Win32 API window enumeration
- Config module with Zod validation and optional allowlist (`src/config.ts`)
- Capture module with PowerShell-based screenshot execution (`src/capture.ts`)
- List-windows module (`src/list-windows.ts`)
- Unit tests for config, capture, list-windows, and server modules (31 tests)
- TypeScript project setup: package.json, tsconfig.json, biome.json, vitest.config.ts
- WSL path conversion utility for PowerShell script execution (`src/windows-path.ts`)
- Unit tests for WSL-to-Windows path conversion edge cases (`tests/windows-path.test.ts`)
- PowerShell output parsing helpers for JSON/base64 handling (`src/powershell-output.ts`)
- Windows interop error normalization helper (`src/windows-interop.ts`)
- Debug status document tracking completed work and blocked items (`docs/DEBUG_STATUS.md`)

### Changed
- Toolchain switched to pnpm + Biome + Vitest + Zod (from npm + ESLint + Prettier)
- `capture` now passes `window_title` directly as argv to `execFile` instead of shell-style quoting
- `capture` and `list_windows` now use shared WSL path conversion for script paths under both `/mnt/*` and `/home/*`
- `tests/capture.test.ts` now validates argument forwarding and JSON parsing behavior instead of only export presence
- Server config loading now uses a dedicated loaded-flag cache to avoid repeated disk reads for empty configs
- `tests/capture.test.ts` and `tests/list-windows.test.ts` now validate timeout/script-error/invalid-JSON paths
- `tests/server.test.ts` now validates config caching, allowlist blocking, and list window marker rendering
- `tests/list-windows.test.ts` now validates timeout and stderr error propagation paths
- `capture` and `list_windows` now parse JSON from the last non-empty output line to tolerate extra PowerShell log lines
- `tests/capture.test.ts` and `tests/list-windows.test.ts` now validate multiline output parsing behavior
- `capture` and `list_windows` now return actionable guidance when WSL interop is unavailable
- `README.md` and `docs/ARCHITECTURE.md` updated to reflect argv-based invocation and troubleshooting flow
- Server config loading now deduplicates concurrent `loadConfig()` calls
- PowerShell capture window-title matching now escapes wildcard characters before `-like` matching
- Unit tests expanded to 32 tests with concurrent config-load coverage in `tests/server.test.ts`

### Fixed
- Fixed script path resolution for WSL projects outside `/mnt/*`: PowerShell now receives a resolvable Windows/UNC path (`\\wsl.localhost\\<distro>\\...`)
- Fixed potential false "window not found" matches when titles contain apostrophes or quote-like characters (root cause: extra manual quoting)
- Fixed debug reproducibility note: local checks are verified via `npm run build/test/lint` when `pnpm` is not available in PATH
- Fixed repeated `loadConfig()` calls when `a-eyes.config.json` resolves to `{}` (root cause: empty-object check used as load sentinel)
- Fixed fragile parsing when PowerShell emits informational lines before JSON payloads
- Fixed opaque errors on disabled WSL interop by surfacing explicit recovery guidance
- Fixed potential duplicate config reads when multiple MCP tools are called in parallel
- Fixed false-positive window matches for titles containing wildcard characters (`*`, `?`, `[`).
