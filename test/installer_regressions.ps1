# Load only function definitions: never run the real installation entry point.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Install-DashBridge.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer parsing failed.' }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($function.Extent.Text))
}
$script:IsWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('dashbridge-install-regressions-' + [guid]::NewGuid().ToString('N'))
$script:LocalAppDataRoot = $testRoot
$script:StatePath = Join-Path $testRoot 'missing-state.json'
$script:CanonicalInstallPath = Join-Path $testRoot 'default'
$script:InstallPath = ''; $script:NonInteractive = $true
function Expect-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe operation was accepted.' }
}
function New-Fixture([string]$Path) {
    New-Item -ItemType Directory -Path (Join-Path $Path 'js'), (Join-Path $Path 'pages/popup') -Force | Out-Null
    '{"name":"DashBridge","version":"1.0.0"}' | Set-Content -LiteralPath (Join-Path $Path 'manifest.json')
    '' | Set-Content -LiteralPath (Join-Path $Path 'js/background.js')
    '' | Set-Content -LiteralPath (Join-Path $Path 'pages/popup/popup.html')
}
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    if ($script:IsWindowsHost) {
        Expect-Rejected { Resolve-RequestedInstallPath 'C:relative' }
        Expect-Rejected { Resolve-RequestedInstallPath '\relative-to-drive' }
    }
    $file = Join-Path $testRoot 'file'; 'keep' | Set-Content -LiteralPath $file
    Expect-Rejected { Assert-SafeTargetPath $file }
    $repo = Join-Path $testRoot 'repo'
    New-Item -ItemType Directory -Path (Join-Path $repo '.git') -Force | Out-Null
    Expect-Rejected { Assert-SafeTargetPath (Join-Path $repo 'nested/Extension') }
    $from = Join-Path $testRoot 'source'; $target = Join-Path $testRoot 'target'
    New-Fixture $from; New-Fixture $target
    'original' | Set-Content -LiteralPath (Join-Path $target 'keep.txt')
    # Windows PowerShell 5.1 rejects New-Item -Force on an existing drive root.
    # Reproduce that provider failure in the temporary parent, never in C:\.
    function New-Item {
        param($ItemType, $Path, [switch]$Force)
        if ($Path -eq $testRoot) { throw [ArgumentException]::new('The path is not of a legal form.') }
        Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Path $Path -Force:$Force
    }
    try {
        $existingParentTarget = Join-Path $testRoot 'existing-parent-update'
        New-Fixture $existingParentTarget
        'preserved' | Set-Content -LiteralPath (Join-Path $existingParentTarget 'keep.txt')
        $parentBackup = Install-ReleaseDirectory $from $existingParentTarget
        if (-not (Test-DashBridgeDirectory $existingParentTarget) -or
            (Get-Content -LiteralPath (Join-Path $parentBackup 'keep.txt') -Raw).Trim() -ne 'preserved') {
            throw 'Update under an existing parent lost its installation or backup.'
        }
        $newParentTarget = Join-Path $testRoot 'existing-parent-new'
        [void](Install-ReleaseDirectory $from $newParentTarget)
        if (-not (Test-DashBridgeDirectory $newParentTarget)) { throw 'Install under an existing parent failed.' }
    } finally {
        Remove-Item Function:New-Item
    }
    $invalid = Join-Path $testRoot 'invalid'
    New-Item -ItemType Directory -Path $invalid | Out-Null
    Expect-Rejected { Install-ReleaseDirectory $invalid $target }
    if (@(Get-ChildItem -LiteralPath $testRoot -Filter '.dashbridge-staging-*' -Force).Count) { throw 'Failed staging leaked.' }
    # Inject failure after backup rename. The production catch must restore the original.
    function Move-Item {
        param($LiteralPath, $Destination)
        if ((Split-Path -Leaf $LiteralPath) -like '.dashbridge-staging-*') { throw 'Simulated swap failure' }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    Expect-Rejected { Install-ReleaseDirectory $from $target }
    if ((Get-Content -LiteralPath (Join-Path $target 'keep.txt') -Raw).Trim() -ne 'original') { throw 'Rollback lost original.' }
    if (@(Get-ChildItem -LiteralPath $testRoot -Filter '.dashbridge-staging-*' -Force).Count) { throw 'Rollback staging leaked.' }
    Remove-Item Function:Move-Item
    function Find-InstalledDashBridge { return @([pscustomobject]@{Path=$from}, [pscustomobject]@{Path=$target}) }
    Expect-Rejected { Select-TargetPath ([pscustomobject]@{Id='Chrome'}) }
    # Exercise checksum and archive validation through the actual receive owner.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $payload = Join-Path $testRoot 'payload.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($from, $payload)
    $checksum = Join-Path $testRoot 'payload.sha256'
    $release = [pscustomobject]@{ArchiveName='DashBridge-1.0.0.zip'; Version='1.0.0'; ArchiveUrl=$payload; ChecksumUrl=$checksum}
    function Invoke-WebRequest {
        param($Uri, $OutFile, $Headers, $TimeoutSec, [switch]$UseBasicParsing)
        Copy-Item -LiteralPath $Uri -Destination $OutFile
    }
    $download = Join-Path $testRoot 'download'
    New-Item -ItemType Directory -Path $download | Out-Null
    (('0' * 64) + '  ' + $release.ArchiveName) | Set-Content -LiteralPath $checksum
    Expect-Rejected { Receive-Release $release $download }
    if (Test-Path -LiteralPath (Join-Path $download 'expanded')) { throw 'Unverified archive extracted.' }
    ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash + '  ' + $release.ArchiveName) | Set-Content -LiteralPath $checksum
    $expanded = Receive-Release $release $download
    if (-not (Test-DashBridgeDirectory $expanded)) { throw 'Valid release rejected.' }
    $badPayload = Join-Path $testRoot 'bad.zip'
    $zip = [IO.Compression.ZipFile]::Open($badPayload, [IO.Compression.ZipArchiveMode]::Create)
    [void]$zip.CreateEntry('../outside.txt'); $zip.Dispose()
    $release.ArchiveUrl = $badPayload
    ((Get-FileHash -LiteralPath $badPayload -Algorithm SHA256).Hash + '  ' + $release.ArchiveName) | Set-Content -LiteralPath $checksum
    $download = Join-Path $testRoot 'bad-download'
    New-Item -ItemType Directory -Path $download | Out-Null
    Expect-Rejected { Receive-Release $release $download }
    if ((Test-Path -LiteralPath (Join-Path $download 'outside.txt')) -or
        (Test-Path -LiteralPath (Join-Path $download 'expanded'))) { throw 'Unsafe archive reached extraction.' }
    Write-Output '[OK] Installer regressions: absolute paths, files, nested Git, ambiguous selection, failed staging and rollback'
    Write-Output '[OK] Installer regressions: checksum mismatch, valid release and archive traversal'
} finally {
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    if ((Split-Path -Parent $resolvedRoot) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
