$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;

public class WindowEnumerator {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

try {
    $windows = @()

    # Capture foreground window handle once before enumeration
    $script:foregroundHwnd = [WindowEnumerator]::GetForegroundWindow()

    $callback = [WindowEnumerator+EnumWindowsProc]{
        param($hWnd, $lParam)

        if (-not [WindowEnumerator]::IsWindowVisible($hWnd)) { return $true }

        $length = [WindowEnumerator]::GetWindowTextLength($hWnd)
        if ($length -eq 0) { return $true }

        $sb = New-Object System.Text.StringBuilder($length + 1)
        [WindowEnumerator]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        $title = $sb.ToString()

        # Skip empty titles
        if ([string]::IsNullOrWhiteSpace($title)) { return $true }

        # Get process info
        $processId = [uint32]0
        [WindowEnumerator]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null

        $processName = ""
        try {
            $process = [System.Diagnostics.Process]::GetProcessById($processId)
            $processName = $process.ProcessName
        } catch {
            $processName = "unknown"
        }

        # Get window dimensions
        $rect = New-Object WindowEnumerator+RECT
        [WindowEnumerator]::GetWindowRect($hWnd, [ref]$rect) | Out-Null

        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top

        $isMinimized = [WindowEnumerator]::IsIconic($hWnd)

        $isActive = [bool]($hWnd.ToInt64() -eq $script:foregroundHwnd.ToInt64())

        $script:windows += @{
            title = $title
            processName = $processName
            processId = [int]$processId
            width = $width
            height = $height
            minimized = [bool]$isMinimized
            isActive = $isActive
        }

        return $true
    }

    [WindowEnumerator]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

    # Pass 2: compute windowCount per processId and assign back to each entry
    # Note: avoid $pid — it's a PowerShell read-only automatic variable
    $countByPid = @{}
    foreach ($w in $windows) {
        $procId = $w.processId
        if ($countByPid.ContainsKey($procId)) {
            $countByPid[$procId]++
        } else {
            $countByPid[$procId] = 1
        }
    }
    foreach ($w in $windows) {
        $w.windowCount = $countByPid[$w.processId]
    }

    $result = @{
        windows = $windows
        count = $windows.Count
    } | ConvertTo-Json -Depth 3 -Compress

    Write-Output $result
}
catch {
    $result = @{ error = "Failed to enumerate windows: $($_.Exception.Message)" } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}
