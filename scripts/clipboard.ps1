param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("read", "write")]
    [string]$Action = "read",

    [Parameter(Mandatory=$false)]
    [string]$Text = ""
)

$ErrorActionPreference = "Stop"

function Write-JsonError {
    param([string]$Message)
    $result = @{ error = $Message } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($Action -eq "write") {
    if ($Text -eq "") {
        Write-JsonError "Text parameter is required for write action"
    }
    try {
        [System.Windows.Forms.Clipboard]::SetText($Text)
        @{ success = $true } | ConvertTo-Json -Compress
    } catch {
        Write-JsonError "Failed to write to clipboard: $($_.Exception.Message)"
    }
    exit 0
}

# Action = "read"
try {
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $text = [System.Windows.Forms.Clipboard]::GetText()
        @{ type = "text"; content = $text } | ConvertTo-Json -Compress
    } elseif ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $ms.Dispose()
        $img.Dispose()
        $base64 = [System.Convert]::ToBase64String($bytes)
        @{
            type   = "image"
            data   = $base64
            width  = $img.Width
            height = $img.Height
        } | ConvertTo-Json -Compress
    } else {
        @{ type = "empty" } | ConvertTo-Json -Compress
    }
} catch {
    Write-JsonError "Failed to read clipboard: $($_.Exception.Message)"
}
