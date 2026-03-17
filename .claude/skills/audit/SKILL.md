---
name: audit
description: Run a full security audit — dependency vulnerabilities, Biome security rules, and security agent review of critical modules. Use before releases and when touching PowerShell execution or config parsing.
allowed-tools: Bash(pnpm *), Bash(npx *), Read, Glob, Grep
model: sonnet
---

## Security Audit

Full security check across dependencies, static analysis, and code review.

### Steps

1. **Dependency audit:**
   ```bash
   npx pnpm audit 2>&1
   ```
   Report: number of vulnerabilities by severity. Flag any HIGH or CRITICAL as blockers.

2. **Biome lint (security-relevant rules):**
   ```bash
   npx pnpm lint 2>&1
   ```
   Report any `noEval`, `noWith`, `useStrictMode` violations.

3. **Shell injection check** — scan for unsafe patterns:
   ```bash
   grep -rn "shell: true\|exec(\|execSync(\|spawn(" src/ --include="*.ts"
   ```
   Any `shell: true` or `execSync` is a finding. `exec(` without `File` suffix is suspicious.

4. **Path traversal check** — scan for unguarded path joins:
   ```bash
   grep -rn "path\.join\|path\.resolve" src/ --include="*.ts"
   ```
   Flag any that use user-controlled input without validation.

5. **Input sanitization check:**
   ```bash
   grep -rn "z\.string()" src/ --include="*.ts"
   ```
   Verify all string inputs from MCP tool calls go through Zod before use.

6. **PowerShell script audit** — check for string interpolation:
   ```bash
   grep -rn '"\$' scripts/ --include="*.ps1"
   ```
   Any `"$variable"` in PowerShell where the variable comes from user input is a finding.

7. **Summary report:**
   ```
   Dependencies: N vulnerabilities (H HIGH, M MEDIUM, L LOW)
   Shell injection: PASS / N findings
   Path traversal: PASS / N findings
   Input validation: PASS / N findings
   PS interpolation: PASS / N findings

   Overall: PASS / FAIL
   Blockers for release: [list]
   ```

### Severity Classification

- **BLOCKER** (must fix before release): shell injection, path traversal, HIGH/CRITICAL npm vulns
- **HIGH** (fix soon): unvalidated inputs reaching business logic, MEDIUM npm vulns
- **MEDIUM** (track): defense-in-depth gaps, LOW npm vulns
- **INFO** (optional): best practice improvements
