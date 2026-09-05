param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$RemoteHost,
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$RemoteUser = 'dashbridge-deploy',
    [ValidateRange(1, 65535)][int]$SshPort = 22,
    [Parameter(Mandatory = $true)][string]$IdentityFile
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $projectRoot 'deploy\dashbridge-analytics'
$node = 'C:\Program Files\nodejs\node.exe'
$identity = (Resolve-Path -LiteralPath $IdentityFile).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dashbridge-analytics-$stamp"
$archive = "$temporaryRoot.tar.gz"
$remoteArchive = "/tmp/dashbridge-analytics-$stamp.tar.gz"

try {
    $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'test') -Filter '*.test.js' | ForEach-Object FullName)
    & $node --test @testFiles
    if ($LASTEXITCODE -ne 0) { throw 'Analytics tests failed; nothing was uploaded.' }

    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $appRoot 'server.js'), (Join-Path $appRoot 'analytics-contract.js') -Destination $temporaryRoot
    Copy-Item -LiteralPath (Join-Path $appRoot 'public') -Destination $temporaryRoot -Recurse
    tar -czf $archive -C $temporaryRoot .
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the analytics release archive.' }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()

    & scp -P $SshPort -i $identity -- $archive "${RemoteUser}@${RemoteHost}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Could not upload the analytics release.' }
    & ssh -p $SshPort -i $identity -- "${RemoteUser}@${RemoteHost}" "sudo /usr/local/sbin/dashbridge-analytics-apply '$remoteArchive' '$hash'"
    if ($LASTEXITCODE -ne 0) { throw 'The VPS rejected the analytics release.' }
    Write-Host "Analytics release $stamp is active and healthy."
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
