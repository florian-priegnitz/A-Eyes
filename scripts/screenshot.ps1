param(
    [Parameter(Mandatory=$true)]
    [string]$WindowTitle,

    [Parameter(Mandatory=$false)]
    [int]$MaxWidth = 0
)

# Ensure errors produce clean JSON output
$ErrorActionPreference = "Stop"

function Write-JsonError {
    param([string]$Message)
    $result = @{ error = $Message } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}

# Load required assemblies
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Win32 API declarations
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

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

# Enable DPI awareness for accurate window dimensions
[Win32]::SetProcessDPIAware() | Out-Null

# Find window by title (partial match)
$foundHandle = [IntPtr]::Zero
$foundTitle = ""
$windowTitlePattern = "*$([System.Management.Automation.WildcardPattern]::Escape($WindowTitle))*"

$callback = [Win32+EnumWindowsProc]{
    param($hWnd, $lParam)

    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }

    $length = [Win32]::GetWindowTextLength($hWnd)
    if ($length -eq 0) { return $true }

    $sb = New-Object System.Text.StringBuilder($length + 1)
    [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
    $title = $sb.ToString()

    if ($title -like $script:windowTitlePattern) {
        $script:foundHandle = $hWnd
        $script:foundTitle = $title
        return $false  # Stop enumerating
    }
    return $true
}

[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($foundHandle -eq [IntPtr]::Zero) {
    Write-JsonError "Window not found: '$WindowTitle'"
}

# Get window dimensions
$rect = New-Object Win32+RECT
if (-not [Win32]::GetWindowRect($foundHandle, [ref]$rect)) {
    Write-JsonError "Failed to get window dimensions"
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
    Write-JsonError "Window has invalid dimensions (${width}x${height})"
}

# Capture window using PrintWindow for better results with offscreen/overlapped windows
try {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $hdc = $graphics.GetHdc()

    # PW_RENDERFULLCONTENT = 2 (captures even if window is partially occluded)
    $captured = [Win32]::PrintWindow($foundHandle, $hdc, 2)
    $graphics.ReleaseHdc($hdc)

    if (-not $captured) {
        # Fallback: bring window to front and use screen capture
        [Win32]::SetForegroundWindow($foundHandle) | Out-Null
        Start-Sleep -Milliseconds 100

        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    }

    # Resize if MaxWidth is set and image is wider
    if ($MaxWidth -gt 0 -and $width -gt $MaxWidth) {
        $ratio = $MaxWidth / $width
        $newHeight = [int]($height * $ratio)
        $resized = New-Object System.Drawing.Bitmap($MaxWidth, $newHeight)
        $resizeGraphics = [System.Drawing.Graphics]::FromImage($resized)
        $resizeGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $resizeGraphics.DrawImage($bitmap, 0, 0, $MaxWidth, $newHeight)
        $resizeGraphics.Dispose()
        $bitmap.Dispose()
        $bitmap = $resized
        $width = $MaxWidth
        $height = $newHeight
    }

    # Convert to PNG and base64
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $base64 = [Convert]::ToBase64String($stream.ToArray())

    # Output JSON result
    $result = @{
        image = $base64
        title = $foundTitle
        width = $width
        height = $height
    } | ConvertTo-Json -Compress

    Write-Output $result
}
catch {
    Write-JsonError "Capture failed: $($_.Exception.Message)"
}
finally {
    if ($stream) { $stream.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
}
