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
    [int]$Quality = 85,

    [Parameter(Mandatory=$false)]
    [string]$Mode = "window",

    [Parameter(Mandatory=$false)]
    [ValidateSet("native", "logical")]
    [string]$DpiMode = "native"
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
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    // DPI helpers
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);  // Win10 v1607+

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);
    // LOGPIXELSX = 88

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

function Get-DpiScale {
    param([IntPtr]$Hwnd)
    # Try GetDpiForWindow first (Win10 v1607+). Returns 0 on older Windows.
    if ($Hwnd -ne [IntPtr]::Zero) {
        try {
            $dpi = [Win32]::GetDpiForWindow($Hwnd)
            if ($dpi -gt 0) { return $dpi / 96.0 }
        } catch {}
    }
    # Fallback: GetDeviceCaps on desktop DC (works on all Windows versions, returns system DPI)
    $hdc = [Win32]::GetDC([IntPtr]::Zero)
    try {
        $dpi = [Win32]::GetDeviceCaps($hdc, 88)  # LOGPIXELSX
        if ($dpi -gt 0) { return $dpi / 96.0 }
    } finally {
        [Win32]::ReleaseDC([IntPtr]::Zero, $hdc) | Out-Null
    }
    return 1.0
}

# Enable DPI awareness for accurate window dimensions
[Win32]::SetProcessDPIAware() | Out-Null

# Capture variables
$foundHandle = [IntPtr]::Zero
$foundTitle = ""
$foundProcessName = ""
$foundProcessId = 0
$width = 0
$height = 0
$screenCaptureLeft = 0
$screenCaptureTop = 0
$useScreenCapture = $false

if ($Mode -eq "screen") {
    # Full-screen capture: use primary screen bounds
    $screenBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $width = $screenBounds.Width
    $height = $screenBounds.Height
    $foundTitle = "__screen__"
    $foundProcessName = ""
    $foundProcessId = 0
    $useScreenCapture = $true
} else {
    # Find window by title and/or process name
    $hasTitle = -not [string]::IsNullOrEmpty($WindowTitle)
    $hasProcess = -not [string]::IsNullOrEmpty($ProcessName)

    if (-not $hasTitle -and -not $hasProcess) {
        # No filter given: capture the foreground (active) window
        $foundHandle = [Win32]::GetForegroundWindow()
        if ($foundHandle -eq [IntPtr]::Zero) {
            Write-JsonError "No foreground window found"
        }
        $length = [Win32]::GetWindowTextLength($foundHandle)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32]::GetWindowText($foundHandle, $sb, $sb.Capacity) | Out-Null
            $foundTitle = $sb.ToString()
        }
    } else {
        if ($hasTitle) {
            $windowTitlePattern = "*$([System.Management.Automation.WildcardPattern]::Escape($WindowTitle))*"
        }

        # Collect all matching windows; rank afterward to pick the best candidate
        $candidates = [System.Collections.Generic.List[hashtable]]::new()
        $foregroundHwnd = [Win32]::GetForegroundWindow()

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
                # Get dimensions for ranking
                $rect = New-Object Win32+RECT
                [Win32]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
                $w = $rect.Right - $rect.Left
                $h = $rect.Bottom - $rect.Top

                $script:candidates.Add(@{
                    hWnd        = $hWnd
                    title       = $title
                    procName    = $procName
                    procId      = $procId
                    width       = $w
                    height      = $h
                    isForeground = ($hWnd -eq $script:foregroundHwnd)
                })
            }
            return $true  # Continue enumerating all windows
        }

        [Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

        # Filter out zero-size and cloaked windows, then rank by foreground first, then largest area
        $DWMWA_CLOAKED = 14
        $best = $null
        foreach ($c in $candidates) {
            if ($c.width -le 0 -or $c.height -le 0) { continue }

            $cloaked = 0
            [Win32]::DwmGetWindowAttribute($c.hWnd, $DWMWA_CLOAKED, [ref]$cloaked, 4) | Out-Null
            if ($cloaked -ne 0) { continue }

            if ($null -eq $best) {
                $best = $c
                continue
            }

            # Prefer the foreground window
            if ($c.isForeground -and -not $best.isForeground) {
                $best = $c
                continue
            }
            if ($best.isForeground -and -not $c.isForeground) {
                continue
            }

            # Among equal foreground status, prefer larger area
            if (($c.width * $c.height) -gt ($best.width * $best.height)) {
                $best = $c
            }
        }

        if ($null -eq $best) {
            if ($hasTitle -and $hasProcess) {
                Write-JsonError "Window not found matching title '$WindowTitle' and process '$ProcessName'"
            } elseif ($hasTitle) {
                Write-JsonError "Window not found: '$WindowTitle'"
            } else {
                Write-JsonError "No window found for process: '$ProcessName'"
            }
        }

        $foundHandle      = $best.hWnd
        $foundTitle       = $best.title
        $foundProcessName = $best.procName
        $foundProcessId   = $best.procId
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
    $screenCaptureLeft = $rect.Left
    $screenCaptureTop = $rect.Top

    if ($width -le 0 -or $height -le 0) {
        Write-JsonError "Window has invalid dimensions (${width}x${height})"
    }
}

# Capture the image (window or full screen)
try {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    if ($useScreenCapture) {
        # Full-screen: copy directly from screen origin
        $graphics.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($width, $height))
    } else {
        $hdc = $graphics.GetHdc()

        # PW_RENDERFULLCONTENT = 2 (captures even if window is partially occluded)
        $captured = [Win32]::PrintWindow($foundHandle, $hdc, 2)
        $graphics.ReleaseHdc($hdc)

        if (-not $captured) {
            # Fallback: bring window to front and use screen capture
            [Win32]::SetForegroundWindow($foundHandle) | Out-Null
            Start-Sleep -Milliseconds 100

            $graphics.CopyFromScreen($screenCaptureLeft, $screenCaptureTop, 0, 0, [System.Drawing.Size]::new($width, $height))
        }
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

    # DPI downscale: convert physical pixels to logical pixels when requested
    # Must happen after crop (crop coords are in native pixels) and before MaxWidth
    # (so max_width applies to logical pixel dimensions, not raw physical ones).
    if ($DpiMode -eq "logical") {
        # Read OS DPI for the capture target (not the bitmap's embedded DPI, which is
        # always 96 for a freshly allocated System.Drawing.Bitmap and is useless here).
        # Window mode: ask for the window's own DPI (per-monitor DPI aware).
        # Screen mode: pass Zero → falls back to GetDeviceCaps on the desktop DC (system DPI).
        $scale = Get-DpiScale -Hwnd $foundHandle

        if ($scale -gt 1.0) {
            $newW = [int]($bitmap.Width  / $scale)
            $newH = [int]($bitmap.Height / $scale)
            $resizedDpi = New-Object System.Drawing.Bitmap($newW, $newH)
            $gScale = [System.Drawing.Graphics]::FromImage($resizedDpi)
            $gScale.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $gScale.DrawImage($bitmap, 0, 0, $newW, $newH)
            $gScale.Dispose()
            $bitmap.Dispose()
            $bitmap = $resizedDpi
            $width  = $newW
            $height = $newH
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
    } | ConvertTo-Json -Compress -Depth 5

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
