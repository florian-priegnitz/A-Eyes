# Backlog Seed

These items will be created as GitHub Issues once `gh auth login` is completed.
Run the script below or use `/backlog add` for each item.

## MVP (scope:mvp)

### 1. Implement `capture` MCP tool
- **Labels**: `type:feature`, `scope:mvp`, `priority:high`
- **Description**: Core MCP tool that captures a screenshot of a specific window by title or app name. Calls PowerShell script from WSL2, returns PNG as base64 via MCP.
- **Acceptance criteria**:
  - [ ] MCP tool `capture` registered with proper schema
  - [ ] Accepts `window_title` parameter
  - [ ] Calls PowerShell script via `powershell.exe`
  - [ ] Returns base64 PNG image in MCP response
  - [ ] Error handling for window not found

### 2. Create PowerShell screenshot script
- **Labels**: `type:feature`, `scope:mvp`, `priority:high`
- **Description**: PowerShell script (`scripts/screenshot.ps1`) that uses Win32 APIs to capture a window by title and output PNG as base64 to stdout.
- **Acceptance criteria**:
  - [ ] Find window by title using Win32 API
  - [ ] Capture window content as bitmap
  - [ ] Convert to PNG and output as base64
  - [ ] Handle "window not found" gracefully
  - [ ] Works when called from WSL2 via `powershell.exe`

### 3. Set up TypeScript project scaffolding
- **Labels**: `type:chore`, `scope:mvp`, `priority:high`
- **Description**: Initialize package.json, tsconfig.json, biome.json, vitest config. Install dependencies: @modelcontextprotocol/sdk, zod. Set up build/dev/test scripts.

### 4. Implement config module
- **Labels**: `type:feature`, `scope:mvp`, `priority:medium`
- **Description**: Config loader for `a-eyes.config.json`. Supports optional allowlist of window titles/patterns.
- **Acceptance criteria**:
  - [ ] Load config from `a-eyes.config.json`
  - [ ] Validate with Zod schema
  - [ ] Optional allowlist field (when absent, all windows allowed)
  - [ ] Config file is optional (sensible defaults)

### 5. Write unit tests for MVP
- **Labels**: `type:chore`, `scope:mvp`, `priority:medium`
- **Description**: Unit tests for config module, input validation, path conversion. Integration test for MCP server tool registration.

## Next (scope:next)

### 6. Implement `list_windows` MCP tool
- **Labels**: `type:feature`, `scope:next`, `priority:medium`
- **Description**: MCP tool that lists all visible windows on the Windows desktop. Returns window titles and process names.

### 7. Implement `query` MCP tool
- **Labels**: `type:feature`, `scope:next`, `priority:low`
- **Description**: Screenshot + AI vision question. Captures a window and asks an AI model a question about the screenshot content.

### 8. npm package publishing setup
- **Labels**: `type:chore`, `scope:next`, `priority:low`
- **Description**: Prepare for `npx @a-eyes/mcp` distribution. Set up package.json fields, bin entry, README.

## Future (scope:future)

### 9. Multi-monitor support
- **Labels**: `type:feature`, `scope:future`, `priority:low`

### 10. Full-screen / desktop capture
- **Labels**: `type:feature`, `scope:future`, `priority:low`

### 11. Region capture (crop)
- **Labels**: `type:feature`, `scope:future`, `priority:low`

---

## Quick-create script

```bash
# Run after `gh auth login`:
export PATH="$HOME/bin:$PATH"

# Create labels
gh label create "type:feature" --color "0E8A16" --description "New functionality"
gh label create "type:bug" --color "D73A4A" --description "Bug fix"
gh label create "type:chore" --color "FBCA04" --description "Maintenance, tooling"
gh label create "type:docs" --color "0075CA" --description "Documentation"
gh label create "priority:high" --color "B60205" --description "Must have"
gh label create "priority:medium" --color "E4E669" --description "Should have"
gh label create "priority:low" --color "C5DEF5" --description "Nice to have"
gh label create "scope:mvp" --color "5319E7" --description "MVP milestone"
gh label create "scope:next" --color "1D76DB" --description "Post-MVP"
gh label create "scope:future" --color "BFD4F2" --description "Someday"

# Create MVP issues
gh issue create --title "Implement capture MCP tool" --label "type:feature,scope:mvp,priority:high" --body "Core MCP tool that captures a screenshot of a specific window by title."
gh issue create --title "Create PowerShell screenshot script" --label "type:feature,scope:mvp,priority:high" --body "PowerShell script using Win32 APIs to capture windows and output base64 PNG."
gh issue create --title "Set up TypeScript project scaffolding" --label "type:chore,scope:mvp,priority:high" --body "package.json, tsconfig, biome, vitest, MCP SDK, Zod dependencies."
gh issue create --title "Implement config module" --label "type:feature,scope:mvp,priority:medium" --body "Config loader with optional allowlist. Validated with Zod."
gh issue create --title "Write unit tests for MVP" --label "type:chore,scope:mvp,priority:medium" --body "Tests for config, validation, path conversion, MCP tool registration."

# Create Next issues
gh issue create --title "Implement list_windows MCP tool" --label "type:feature,scope:next,priority:medium" --body "List all visible windows on the desktop."
gh issue create --title "Implement query MCP tool" --label "type:feature,scope:next,priority:low" --body "Screenshot + AI vision question about content."
gh issue create --title "npm package publishing setup" --label "type:chore,scope:next,priority:low" --body "Prepare for npx distribution."
```
