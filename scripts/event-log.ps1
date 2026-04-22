param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("Application", "System", "both")]
    [string]$Source = "both",

    [Parameter(Mandatory=$false)]
    [int]$Count = 20,

    [Parameter(Mandatory=$false)]
    [ValidateSet("error", "warning", "all")]
    [string]$Level = "error"
)

$ErrorActionPreference = "Stop"

function Write-JsonError {
    param([string]$Message)
    $result = @{ error = $Message } | ConvertTo-Json -Compress
    Write-Output $result
    exit 1
}

function Get-EventEntries {
    param(
        [string]$LogName,
        [int]$MaxEvents,
        [string]$LevelFilter
    )

    $filter = @{ LogName = $LogName }

    if ($LevelFilter -eq "error") {
        # Level 1 = Critical, Level 2 = Error
        $filter["Level"] = @(1, 2)
    } elseif ($LevelFilter -eq "warning") {
        # Level 1 = Critical, Level 2 = Error, Level 3 = Warning
        $filter["Level"] = @(1, 2, 3)
    }
    # "all" = no level filter

    try {
        $events = Get-WinEvent -FilterHashtable $filter -MaxEvents $MaxEvents -ErrorAction Stop
        return $events
    } catch [System.Exception] {
        if ($_.Exception.Message -like "*No events were found*") {
            return @()
        }
        throw
    }
}

try {
    $allEvents = @()

    if ($Source -eq "both") {
        $appEvents = Get-EventEntries -LogName "Application" -MaxEvents $Count -LevelFilter $Level
        $sysEvents = Get-EventEntries -LogName "System" -MaxEvents $Count -LevelFilter $Level
        $allEvents = @($appEvents) + @($sysEvents)
        $allEvents = $allEvents | Sort-Object TimeCreated -Descending | Select-Object -First $Count
    } else {
        $allEvents = Get-EventEntries -LogName $Source -MaxEvents $Count -LevelFilter $Level
    }

    $result = $allEvents | ForEach-Object {
        $msg = if ($_.Message.Length -gt 500) { $_.Message.Substring(0, 500) + "..." } else { $_.Message }
        @{
            timestamp = $_.TimeCreated.ToString("o")
            level     = $_.LevelDisplayName
            provider  = $_.ProviderName
            message   = $msg
        }
    }

    if ($result.Count -eq 0) {
        $result = @()
    }

    $result | ConvertTo-Json -Compress
} catch {
    Write-JsonError "Failed to read event log: $($_.Exception.Message)"
}
