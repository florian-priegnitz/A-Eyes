# ADR-002: PowerShell for Screenshot Capture

## Status
Accepted

## Context
WSL2 has no direct access to the Windows GUI. We need a mechanism to capture screenshots of Windows applications from within WSL2.

## Decision
Use a **PowerShell script** called via `powershell.exe` from WSL2 for screenshot capture.

## Rationale
- `powershell.exe` is directly callable from WSL2
- PowerShell has native access to .NET/Win32 APIs for screen capture
- No additional dependencies needed on the Windows side
- Simple stdin/stdout communication (base64 PNG output)

## Alternatives Considered
- **Compiled Windows binary (C#/Go)**: More performant but adds build complexity
- **Python with pyautogui**: Requires Python + packages on Windows side
- **nircmd/screenshot tools**: External dependency, less control

## Consequences
- PowerShell startup time adds latency (~500ms per capture)
- Script must handle Win32 API calls via .NET interop
- Arguments must be carefully escaped to prevent injection
