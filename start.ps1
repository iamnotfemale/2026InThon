#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $localDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the local secrets directory.' }

function Get-Tunnels {
    try { (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -NoProxy -TimeoutSec 2).tunnels }
    catch { @() }
}
$tunnels = @(Get-Tunnels)
if ($tunnels.Count -eq 0) {
    $ngrok = Start-Process -FilePath (Get-Command ngrok).Source -ArgumentList @('http','http://127.0.0.1:8787','--inspect=false','--log=stdout','--log-format=json') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$localDir/ngrok.log" -RedirectStandardError "$localDir/ngrok-error.log"
    $ngrok.Id | Set-Content "$localDir/ngrok.pid"
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        $tunnels = @(Get-Tunnels)
        if ($tunnels.Count -gt 0) { break }
    }
}
$tunnel = $tunnels | Where-Object { $_.config.addr -eq 'http://127.0.0.1:8787' -and $_.public_url -like 'https://*' }
if (@($tunnel).Count -ne 1) { throw 'No unique ngrok tunnel for port 8787. Check .local/ngrok.log. Existing tunnels were left running.' }
if ($tunnel.config.inspect -ne $false) { throw 'ngrok request inspection must be disabled before handling credentials.' }
@{publicUrl=$tunnel.public_url} | ConvertTo-Json | Set-Content -Encoding utf8NoBOM "$localDir/runtime.json"

try { $healthy = (Invoke-WebRequest 'http://127.0.0.1:8787/health' -NoProxy -TimeoutSec 2).Content -eq 'ok' } catch { $healthy = $false }
if (-not $healthy) {
    Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$localDir/server.log" -RedirectStandardError "$localDir/server-error.log"
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $healthy = (Invoke-WebRequest 'http://127.0.0.1:8787/health' -NoProxy -TimeoutSec 2).Content -eq 'ok' } catch { $healthy = $false }
        if ($healthy) { break }
    }
}
if (-not $healthy) { throw 'Server did not start. Check .local/server-error.log.' }
Write-Output 'Local setup: http://127.0.0.1:8788/'
Write-Output "Login callback: $($tunnel.public_url)/auth/instagram/callback"
Write-Output "Webhook: $($tunnel.public_url)/webhooks/instagram"
Write-Output 'If the public URL changed, update both URLs in the Meta dashboard before logging in.'
