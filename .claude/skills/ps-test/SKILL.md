---
name: ps-test
description: Test a PowerShell script directly from WSL2. Runs a script with given parameters and shows structured output. Use during PS script development to verify behavior without going through the full MCP stack.
argument-hint: "<script-name> [params]"
allowed-tools: Bash(powershell.exe *), Bash(echo *), Read, Glob
model: haiku
---

## Test PowerShell Script

Run a PowerShell script from WSL2 and show structured output.

### Usage

```
/ps-test screenshot -WindowTitle "Notepad"
/ps-test see -ProcessName "chrome"
/ps-test list-windows
/ps-test clipboard -Action read
/ps-test processes -Name "node" -Limit 5
```

### Steps

1. Resolve the script path. Scripts live in `scripts/` — find the matching file:
   ```bash
   ls /home/flowing1978/projects/a-eyes/scripts/
   ```
   Convert to Windows UNC path: `\\wsl.localhost\Ubuntu\home\flowing1978\projects\a-eyes\scripts\<name>.ps1`

2. Build the PowerShell command from `$ARGUMENTS`:
   - First token = script name (without .ps1)
   - Remaining tokens = parameters passed as-is

3. Run the script:
   ```bash
   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
     -File "\\wsl.localhost\Ubuntu\home\flowing1978\projects\a-eyes\scripts\<name>.ps1" \
     <params>
   ```

4. Show output:
   - If valid JSON: pretty-print with key highlights
   - If error: show stderr and suggest likely cause
   - Show exit code

5. For image results (base64 `data` field): show field size in KB instead of full base64.

### Common Issues

- `$PID variable not writable` → script uses `$PID` instead of `$wpid` — report as bug
- `Execution policy` errors → add `-ExecutionPolicy Bypass`
- Empty output → check stderr for PowerShell load errors
- `Access denied` → window may require elevated permissions or be a protected process
