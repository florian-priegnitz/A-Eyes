param(
    [Parameter(Mandatory=$false)]
    [string]$Name = "",

    [Parameter(Mandatory=$false)]
    [int]$Limit = 30,

    [Parameter(Mandatory=$false)]
    [ValidateSet("cpu", "memory")]
    [string]$SortBy = "cpu"
)

$ErrorActionPreference = "Stop"

function Write-JsonError {
    param([string]$Message)
    $result = @{ error = $Message } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}

try {
    $processes = Get-Process | Select-Object `
        Id, ProcessName, `
        @{N='cpu';E={if ($_.CPU -ne $null) { [math]::Round($_.CPU, 1) } else { 0 }}}, `
        @{N='memoryMB';E={[math]::Round($_.WorkingSet64 / 1MB, 1)}}, `
        @{N='status';E={'running'}}, `
        MainWindowTitle

    if ($Name -ne "") {
        $processes = $processes | Where-Object { $_.ProcessName -like "*$Name*" }
    }

    if ($SortBy -eq "memory") {
        $processes = $processes | Sort-Object memoryMB -Descending
    } else {
        $processes = $processes | Sort-Object cpu -Descending
    }

    $result = $processes | Select-Object -First $Limit
    $result | ConvertTo-Json -Compress
} catch {
    Write-JsonError "Failed to get processes: $($_.Exception.Message)"
}
