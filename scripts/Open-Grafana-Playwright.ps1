[CmdletBinding()]
param(
    [string]$Url = 'chrome://new-tab-page',
    [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$profileRoot = Join-Path $projectRoot '.dashbridge-local\visible-profile'
$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome не найден.' }
if (-not ($Url -match '^(?:https?|chrome)://')) {
    throw 'URL должен начинаться с http://, https:// или chrome://.'
}

New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
$endpoint = "http://127.0.0.1:$Port/json/version"
$ready = $false
try { $null = Invoke-RestMethod -Uri $endpoint -TimeoutSec 1; $ready = $true } catch { }
if (-not $ready) {
    Start-Process -FilePath $chrome -ArgumentList @(
        "--user-data-dir=$profileRoot",
        "--load-extension=$projectRoot",
        "--remote-debugging-port=$Port",
        "--remote-allow-origins=http://localhost:$Port",
        '--no-first-run', '--no-default-browser-check', '--start-maximized', '--new-window', $Url
    ) | Out-Null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $null = Invoke-RestMethod -Uri $endpoint -TimeoutSec 1; $ready = $true; break } catch { }
    }
}
if (-not $ready) { throw "Chrome не открыл CDP на порту $Port." }
Write-Host "Chrome открыт в отдельном профиле: $profileRoot" -ForegroundColor Green
Write-Host "CDP: $endpoint" -ForegroundColor DarkGray
Write-Host 'Авторизуйтесь в Grafana в открытом окне.' -ForegroundColor Yellow
Write-Host "Проверка: node scripts/check-visible-grafana-cdp.js --port $Port" -ForegroundColor Cyan
Read-Host 'Нажмите Enter, чтобы закрыть PowerShell. Chrome останется открыт'
