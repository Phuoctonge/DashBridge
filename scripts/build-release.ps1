param(
    [string]$OutputDirectory = 'dist',
    [string]$ExpectedTag = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ($ExpectedTag -and $ExpectedTag -ne "v$version") {
    throw "Tag $ExpectedTag does not match manifest version $version."
}

$releasePaths = @(
    (Join-Path $projectRoot 'manifest.json'),
    (Join-Path $projectRoot 'assets'),
    (Join-Path $projectRoot 'css'),
    (Join-Path $projectRoot 'icons'),
    (Join-Path $projectRoot 'js'),
    (Join-Path $projectRoot 'vendor')
) + @(Get-ChildItem -LiteralPath $projectRoot -Filter '*.html' -File | ForEach-Object FullName)

$missing = @($releasePaths | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count) {
    throw "Release inputs are missing: $($missing -join ', ')"
}

$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory
} else {
    Join-Path $projectRoot $OutputDirectory
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$archiveName = "DashBridge-$version.zip"
$archivePath = Join-Path $outputRoot $archiveName
Compress-Archive -LiteralPath $releasePaths -DestinationPath $archivePath -CompressionLevel Optimal -Force

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$archivePath.sha256" -Value "$hash  $archiveName" -Encoding ascii

$installerName = 'Install-DashBridge.ps1'
$installerSource = Join-Path (Join-Path $projectRoot 'scripts') $installerName
$installerPath = Join-Path $outputRoot $installerName
Copy-Item -LiteralPath $installerSource -Destination $installerPath -Force
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$installerPath.sha256" -Value "$installerHash  $installerName" -Encoding ascii
Write-Output $archivePath
