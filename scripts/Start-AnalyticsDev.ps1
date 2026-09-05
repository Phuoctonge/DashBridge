param(
    [ValidateRange(1024, 65535)][int]$Port = 18080,
    [switch]$ResetData,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $projectRoot 'deploy\dashbridge-analytics'
$dataRoot = Join-Path $appRoot '.dev-data'
$node = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $node)) {
    throw "Node.js was not found at $node"
}

$seedArguments = @((Join-Path $appRoot 'scripts\seed-dev-data.js'))
if ($ResetData) { $seedArguments += '--reset' }
$env:DATA_DIR = $dataRoot
& $node @seedArguments
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the development analytics database.' }

$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:PUBLIC_DIR = Join-Path $appRoot 'public'
$env:DASHBRIDGE_ANALYTICS_DEV = '1'
$url = "http://127.0.0.1:$Port/admin/"

Write-Host "Analytics preview: $url"
Write-Host 'HTML/CSS changes are visible after refresh; backend changes restart Node automatically.'
if (-not $NoBrowser) { Start-Process $url }

Push-Location $appRoot
try {
    & $node --watch --watch-preserve-output server.js
} finally {
    Pop-Location
}
