#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
foreach ($name in @('server','ngrok')) {
    $pidFile = Join-Path $PSScriptRoot ".local/$name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $taskPid = [int](Get-Content -LiteralPath $pidFile)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
    $matches = if ($name -eq 'server') {
        $process.Name -eq 'node.exe' -and $process.CommandLine.Contains((Join-Path $PSScriptRoot 'server.mjs'))
    } else {
        $process.Name -eq 'ngrok.exe' -and $process.CommandLine -match 'http://127\.0\.0\.1:8787'
    }
    if ($matches) { Stop-Process -Id $taskPid; Write-Output "Stopped $name ($taskPid)." }
    elseif ($process) { Write-Warning "Skipped reused process ID $taskPid." }
}
