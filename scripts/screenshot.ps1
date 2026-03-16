param(
    [Parameter(Mandatory=$false)]
    [string]$WindowTitle = "",

    [Parameter(Mandatory=$false)]
    [string]$ProcessName = "",

    [Parameter(Mandatory=$false)]
    [int]$MaxWidth = 0,

    [Parameter(Mandatory=$false)]
    [int]$CropX = 0,

    [Parameter(Mandatory=$false)]
    [int]$CropY = 0,

    [Parameter(Mandatory=$false)]
    [int]$CropWidth = 0,

    [Parameter(Mandatory=$false)]
    [int]$CropHeight = 0,

    [Parameter(Mandatory=$false)]
    [string]$Format = "PNG",

    [Parameter(Mandatory=$false)]
    [int]$Quality = 85
)

# Ensure errors produce clean JSON output
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($WindowTitle) -and [string]::IsNullOrEmpty($ProcessName)) {
    $result = @{ error = "At least one of -WindowTitle or -ProcessName must be provided" } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}

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
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

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

# Find window by title and/or process name
$foundHandle = [IntPtr]::Zero
$foundTitle = ""
$foundProcessName = ""
$foundProcessId = 0
$hasTitle = -not [string]::IsNullOrEmpty($WindowTitle)
$hasProcess = -not [string]::IsNullOrEmpty($ProcessName)

if ($hasTitle) {
    $windowTitlePattern = "*$([System.Management.Automation.WildcardPattern]::Escape($WindowTitle))*"
}

$callback = [Win32+EnumWindowsProc]{
    param($hWnd, $lParam)

    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }

    $length = [Win32]::GetWindowTextLength($hWnd)
    if ($length -eq 0) { return $true }

    $sb = New-Object System.Text.StringBuilder($length + 1)
    [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
    $title = $sb.ToString()

    # Check title match (if required)
    $titleMatch = $true
    if ($script:hasTitle) {
        $titleMatch = $title -like $script:windowTitlePattern
    }

    # Check process name match (if required)
    $processMatch = $true
    $procName = ""
    $procId = 0
    if ($script:hasProcess) {
        $wpid = [uint32]0
        [Win32]::GetWindowThreadProcessId($hWnd, [ref]$wpid) | Out-Null
        $procId = [int]$wpid
        try {
            $proc = [System.Diagnostics.Process]::GetProcessById($wpid)
            $procName = $proc.ProcessName
        } catch {
            $procName = ""
        }
        $processMatch = $procName -eq $script:ProcessName
    }

    # Both must match (AND logic)
    if ($titleMatch -and $processMatch) {
        $script:foundHandle = $hWnd
        $script:foundTitle = $title
        if ($procName -ne "") {
            $script:foundProcessName = $procName
            $script:foundProcessId = $procId
        }
        return $false  # Stop enumerating
    }
    return $true
}

[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($foundHandle -eq [IntPtr]::Zero) {
    if ($hasTitle -and $hasProcess) {
        Write-JsonError "Window not found matching title '$WindowTitle' and process '$ProcessName'"
    } elseif ($hasTitle) {
        Write-JsonError "Window not found: '$WindowTitle'"
    } else {
        Write-JsonError "No window found for process: '$ProcessName'"
    }
}

# Get process info if not already resolved (title-only match)
if ([string]::IsNullOrEmpty($foundProcessName)) {
    $wpid = [uint32]0
    [Win32]::GetWindowThreadProcessId($foundHandle, [ref]$wpid) | Out-Null
    $foundProcessId = [int]$wpid
    try {
        $proc = [System.Diagnostics.Process]::GetProcessById($wpid)
        $foundProcessName = $proc.ProcessName
    } catch {
        $foundProcessName = "unknown"
    }
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

    # Crop if crop parameters are set
    if ($CropWidth -gt 0 -and $CropHeight -gt 0) {
        # Clamp crop region to actual image dimensions
        $CropX = [Math]::Max(0, [Math]::Min($CropX, $width - 1))
        $CropY = [Math]::Max(0, [Math]::Min($CropY, $height - 1))
        $CropWidth = [Math]::Min($CropWidth, $width - $CropX)
        $CropHeight = [Math]::Min($CropHeight, $height - $CropY)

        if ($CropWidth -gt 0 -and $CropHeight -gt 0) {
            $cropRect = New-Object System.Drawing.Rectangle($CropX, $CropY, $CropWidth, $CropHeight)
            $cropped = $bitmap.Clone($cropRect, $bitmap.PixelFormat)
            $bitmap.Dispose()
            $bitmap = $cropped
            $width = $CropWidth
            $height = $CropHeight
        }
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

    # Convert to image format and base64
    $stream = New-Object System.IO.MemoryStream
    if ($Format.ToUpper() -eq "JPEG") {
        $encoder = [System.Drawing.Imaging.Encoder]::Quality
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($encoder, [long]$Quality)
        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" }
        $bitmap.Save($stream, $jpegCodec, $encoderParams)
    } else {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $base64 = [Convert]::ToBase64String($stream.ToArray())

    # Output JSON result
    $result = @{
        image = $base64
        title = $foundTitle
        processName = $foundProcessName
        processId = $foundProcessId
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
