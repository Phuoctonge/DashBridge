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
    (Join-Path $projectRoot 'css'),
    (Join-Path $projectRoot 'html'),
    (Join-Path $projectRoot 'icons'),
    (Join-Path $projectRoot 'js'),
    (Join-Path $projectRoot 'vendor')
)

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

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $archiveEntries = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($entry in $archive.Entries) {
        [void]$archiveEntries.Add($entry.FullName.Replace('\\', '/').TrimStart('/'))
    }

    function Assert-ArchiveEntry {
        param(
            [Parameter(Mandatory = $true)][string]$Path,
            [Parameter(Mandatory = $true)][string]$Source
        )

        $normalizedPath = $Path.Replace('\\', '/').TrimStart('/')
        if (-not $archiveEntries.Contains($normalizedPath)) {
            throw "Release archive is missing '$normalizedPath' referenced by $Source."
        }
    }

    Assert-ArchiveEntry -Path 'manifest.json' -Source 'the extension package contract'
    Assert-ArchiveEntry -Path ([string]$manifest.background.service_worker) -Source 'manifest background.service_worker'
    Assert-ArchiveEntry -Path ([string]$manifest.action.default_popup) -Source 'manifest action.default_popup'
    Assert-ArchiveEntry -Path ([string]$manifest.options_ui.page) -Source 'manifest options_ui.page'

    foreach ($property in $manifest.icons.PSObject.Properties) {
        Assert-ArchiveEntry -Path ([string]$property.Value) -Source "manifest icons.$($property.Name)"
    }
    foreach ($property in $manifest.action.default_icon.PSObject.Properties) {
        Assert-ArchiveEntry -Path ([string]$property.Value) -Source "manifest action.default_icon.$($property.Name)"
    }
    foreach ($contentScript in $manifest.content_scripts) {
        foreach ($path in @($contentScript.js) + @($contentScript.css)) {
            if ($path) {
                Assert-ArchiveEntry -Path ([string]$path) -Source 'manifest content_scripts'
            }
        }
    }
    foreach ($resourceGroup in $manifest.web_accessible_resources) {
        foreach ($path in $resourceGroup.resources) {
            if (-not [System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters([string]$path)) {
                Assert-ArchiveEntry -Path ([string]$path) -Source 'manifest web_accessible_resources'
            }
        }
    }

    $htmlReferencePattern = '(?i)<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["'']([^"'']+)["'']'
    foreach ($entry in @($archive.Entries | Where-Object { $_.FullName.EndsWith('.html', [System.StringComparison]::OrdinalIgnoreCase) })) {
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            $html = $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }

        foreach ($match in [regex]::Matches($html, $htmlReferencePattern)) {
            $reference = $match.Groups[1].Value
            if ($reference -match '^(?:[a-z][a-z0-9+.-]*:|//|#)') {
                continue
            }

            $pageUri = [Uri]::new("https://dashbridge.invalid/$($entry.FullName)")
            $referenceUri = [Uri]::new($pageUri, $reference)
            $referencePath = [Uri]::UnescapeDataString($referenceUri.AbsolutePath).TrimStart('/')
            Assert-ArchiveEntry -Path $referencePath -Source "HTML entry $($entry.FullName)"
        }
    }
} finally {
    $archive.Dispose()
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$archivePath.sha256" -Value "$hash  $archiveName" -Encoding ascii

$installerName = 'Install-DashBridge.ps1'
$installerSource = Join-Path (Join-Path $projectRoot 'scripts') $installerName
$installerPath = Join-Path $outputRoot $installerName
Copy-Item -LiteralPath $installerSource -Destination $installerPath -Force
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$installerPath.sha256" -Value "$installerHash  $installerName" -Encoding ascii
Write-Output $archivePath
