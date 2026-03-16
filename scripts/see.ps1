param(
    [Parameter(Mandatory=$false)]
    [string]$WindowTitle = "",

    [Parameter(Mandatory=$false)]
    [string]$ProcessName = "",

    [Parameter(Mandatory=$false)]
    [int]$MaxElements = 150,

    [Parameter(Mandatory=$false)]
    [int]$MaxDepth = 6
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($WindowTitle) -and [string]::IsNullOrEmpty($ProcessName)) {
    @{ error = "At least one of -WindowTitle or -ProcessName must be provided" } | ConvertTo-Json -Compress | Write-Output
    exit 1
}

function Write-JsonError {
    param([string]$Message)
    @{ error = $Message } | ConvertTo-Json -Compress | Write-Output
    exit 1
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Win32 for window finding (same pattern as screenshot.ps1)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32See {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

[Win32See]::SetProcessDPIAware() | Out-Null

$foundHandle = [IntPtr]::Zero
$foundTitle = ""
$foundProcessName = ""
$foundProcessId = 0
$hasTitle = -not [string]::IsNullOrEmpty($WindowTitle)
$hasProcess = -not [string]::IsNullOrEmpty($ProcessName)

if ($hasTitle) {
    $windowTitlePattern = "*$([System.Management.Automation.WildcardPattern]::Escape($WindowTitle))*"
}

$callback = [Win32See+EnumWindowsProc]{
    param($hWnd, $lParam)
    if (-not [Win32See]::IsWindowVisible($hWnd)) { return $true }
    $length = [Win32See]::GetWindowTextLength($hWnd)
    if ($length -eq 0) { return $true }
    $sb = New-Object System.Text.StringBuilder($length + 1)
    [Win32See]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
    $title = $sb.ToString()

    $titleMatch = -not $script:hasTitle -or ($title -like $script:windowTitlePattern)
    $processMatch = $true
    $procName = ""
    $procId = 0
    if ($script:hasProcess) {
        $wpid = [uint32]0
        [Win32See]::GetWindowThreadProcessId($hWnd, [ref]$wpid) | Out-Null
        $procId = [int]$wpid
        try {
            $proc = [System.Diagnostics.Process]::GetProcessById($wpid)
            $procName = $proc.ProcessName
        } catch { $procName = "" }
        $processMatch = $procName -eq $script:ProcessName
    }

    if ($titleMatch -and $processMatch) {
        $script:foundHandle = $hWnd
        $script:foundTitle = $title
        if ($procName -ne "") {
            $script:foundProcessName = $procName
            $script:foundProcessId = $procId
        }
        return $false
    }
    return $true
}

[Win32See]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($foundHandle -eq [IntPtr]::Zero) {
    if ($hasTitle -and $hasProcess) {
        Write-JsonError "Window not found matching title '$WindowTitle' and process '$ProcessName'"
    } elseif ($hasTitle) {
        Write-JsonError "Window not found: '$WindowTitle'"
    } else {
        Write-JsonError "No window found for process: '$ProcessName'"
    }
}

if ([string]::IsNullOrEmpty($foundProcessName)) {
    $wpid = [uint32]0
    [Win32See]::GetWindowThreadProcessId($foundHandle, [ref]$wpid) | Out-Null
    $foundProcessId = [int]$wpid
    try {
        $proc = [System.Diagnostics.Process]::GetProcessById($wpid)
        $foundProcessName = $proc.ProcessName
    } catch { $foundProcessName = "unknown" }
}

# Get window rect
$rect = New-Object Win32See+RECT
if (-not [Win32See]::GetWindowRect($foundHandle, [ref]$rect)) {
    Write-JsonError "Failed to get window dimensions"
}
$winWidth = $rect.Right - $rect.Left
$winHeight = $rect.Bottom - $rect.Top

if ($winWidth -le 0 -or $winHeight -le 0) {
    Write-JsonError "Window has invalid dimensions (${winWidth}x${winHeight})"
}

# Capture screenshot (same as screenshot.ps1)
$imageBase64 = ""
$stream = $null
$graphics = $null
$bitmap = $null
try {
    $bitmap = New-Object System.Drawing.Bitmap($winWidth, $winHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $hdc = $graphics.GetHdc()
    $captured = [Win32See]::PrintWindow($foundHandle, $hdc, 2)
    $graphics.ReleaseHdc($hdc)
    if (-not $captured) {
        [Win32See]::SetForegroundWindow($foundHandle) | Out-Null
        Start-Sleep -Milliseconds 100
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($winWidth, $winHeight))
    }
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $imageBase64 = [Convert]::ToBase64String($stream.ToArray())
} catch {
    $imageBase64 = ""
} finally {
    if ($stream) { $stream.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
}

# UI Automation element enumeration
$elements = [System.Collections.Generic.List[object]]::new()
$allText = [System.Collections.Generic.List[string]]::new()
$elementCount = 0

function Get-UIElements {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [int]$Depth = 0
    )
    if ($Depth -gt $script:MaxDepth -or $script:elementCount -ge $script:MaxElements) { return }

    try {
        $children = $Root.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition
        )
    } catch { return }

    foreach ($child in $children) {
        if ($script:elementCount -ge $script:MaxElements) { break }
        try {
            $id = "elem_$($script:elementCount)"
            $script:elementCount++

            $isOffscreen = $child.Current.IsOffscreen
            $controlType = $child.Current.ControlType.ProgrammaticName -replace "ControlType\.", ""
            $name = $child.Current.Name
            $isEnabled = $child.Current.IsEnabled

            $value = ""
            try {
                $vp = $child.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $value = $vp.Current.Value
            } catch {}

            if (-not $isOffscreen) {
                $bounds = $child.Current.BoundingRectangle
                $elem = @{
                    id      = $id
                    type    = $controlType
                    name    = $name
                    value   = $value
                    enabled = $isEnabled
                    bounds  = @{
                        x      = [int]$bounds.X
                        y      = [int]$bounds.Y
                        width  = [int]$bounds.Width
                        height = [int]$bounds.Height
                    }
                }
                $script:elements.Add($elem)

                if (-not [string]::IsNullOrWhiteSpace($name)) { $script:allText.Add($name) }
                if (-not [string]::IsNullOrWhiteSpace($value)) { $script:allText.Add($value) }
            }

            Get-UIElements -Root $child -Depth ($Depth + 1)
        } catch {
            # Skip elements that throw
        }
    }
}

try {
    $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($foundHandle)
    Get-UIElements -Root $rootElement -Depth 0
} catch {
    # UIAutomation failed -- return empty elements
}

$result = @{
    title        = $foundTitle
    processName  = $foundProcessName
    processId    = $foundProcessId
    windowWidth  = $winWidth
    windowHeight = $winHeight
    elementCount = $elements.Count
    elements     = $elements.ToArray()
    text         = ($allText | Select-Object -Unique) -join " "
    image        = $imageBase64
} | ConvertTo-Json -Compress -Depth 5

Write-Output $result
