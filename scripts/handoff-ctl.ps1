param (
    [ValidateSet("start", "stop", "restart", "status", "open", "logs")]
    [string]$Action = "status"
)

$ErrorActionPreference = "SilentlyContinue"
$repoDir = (Split-Path -Parent $PSScriptRoot)
$dataDir = Join-Path $repoDir "data"
$pidFile = Join-Path $dataDir "handoff.pid"
$stdoutLog = Join-Path $dataDir "handoff.log"
$stderrLog = Join-Path $dataDir "handoff.err.log"
$ports = @(3009, 5180, 3100)

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

function Get-HandoffStatus {
    $conns = @(Get-NetTCPConnection -LocalPort 5180, 3009 -State Listen -ErrorAction SilentlyContinue)
    $isRunning = ($conns.Count -gt 0)
    $pidVal = $null
    if (Test-Path $pidFile) {
        $pidVal = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
    }
    return [PSCustomObject]@{
        IsRunning = $isRunning
        Pid       = $pidVal
        WebPort   = 5180
        ApiPort   = 3009
        McpPort   = 3100
        LogPath   = $stdoutLog
    }
}

function Stop-Handoff {
    if (Test-Path $pidFile) {
        $savedPid = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
        if ($savedPid) {
            & "taskkill" /PID $savedPid /T /F 2>$null | Out-Null
        }
        Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    }

    # Kill any processes still holding the ports
    foreach ($port in $ports) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            if ($conn.OwningProcess -gt 0) {
                & "taskkill" /PID $conn.OwningProcess /T /F 2>$null | Out-Null
            }
        }
    }
    Start-Sleep -Milliseconds 800
}

function Start-Handoff {
    $status = Get-HandoffStatus
    if ($status.IsRunning) {
        return $status
    }

    # Clean up stale processes on ports if any
    Stop-Handoff

    # Rotate log if larger than 20MB
    if ((Test-Path $stdoutLog) -and (Get-Item $stdoutLog).Length -gt 20MB) {
        Remove-Item -Path $stdoutLog -Force -ErrorAction SilentlyContinue
    }
    if ((Test-Path $stderrLog) -and (Get-Item $stderrLog).Length -gt 20MB) {
        Remove-Item -Path $stderrLog -Force -ErrorAction SilentlyContinue
    }

    $proc = Start-Process -FilePath "node" `
        -ArgumentList "./scripts/dev.mjs" `
        -WorkingDirectory $repoDir `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden `
        -PassThru

    if ($proc) {
        $proc.Id | Out-File -FilePath $pidFile -Encoding ascii -Force
        
        # Wait up to 15 seconds for ports 5180 and 3009 to become active
        $waited = 0
        while ($waited -lt 15) {
            Start-Sleep -Seconds 1
            $waited++
            $s = Get-HandoffStatus
            if ($s.IsRunning) {
                break
            }
        }
    }

    return (Get-HandoffStatus)
}

switch ($Action) {
    "status" {
        $status = Get-HandoffStatus
        $status | ConvertTo-Json -Compress
    }
    "start" {
        $status = Start-Handoff
        $status | ConvertTo-Json -Compress
    }
    "stop" {
        Stop-Handoff
        $status = Get-HandoffStatus
        $status | ConvertTo-Json -Compress
    }
    "restart" {
        Stop-Handoff
        Start-Sleep -Seconds 1
        $status = Start-Handoff
        $status | ConvertTo-Json -Compress
    }
    "open" {
        Start-Process "http://localhost:5180"
    }
    "logs" {
        if (-not (Test-Path $stdoutLog)) {
            New-Item -ItemType File -Path $stdoutLog -Force | Out-Null
        }
        Start-Process "notepad.exe" -ArgumentList "`"$stdoutLog`""
    }
}
