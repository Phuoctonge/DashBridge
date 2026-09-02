[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Chrome', 'Edge', 'Yandex')]
    [string]$Browser = 'Auto',
    [string]$InstallPath = '',
    [string]$ReleaseTag = '',
    [switch]$NonInteractive,
    [switch]$SelfTest,
    [switch]$Diagnostics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:IsWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if (-not $script:IsWindowsHost -and -not $SelfTest) {
    throw 'DashBridge Installer supports Windows only.'
}
$script:LocalAppDataRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [IO.Path]::GetTempPath() }

$script:RepositoryOwner = 'Phuoctonge'
$script:RepositoryName = 'DashBridge'
$script:StateRoot = Join-Path $script:LocalAppDataRoot 'DashBridge'
$script:StatePath = Join-Path $script:StateRoot 'installer-state.json'
$script:CanonicalInstallPath = Join-Path $script:StateRoot 'Extension'

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Read-Confirmation([string]$Prompt, [bool]$Default = $true) {
    if ($NonInteractive) { return $Default }
    $suffix = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $answer = (Read-Host "$Prompt $suffix").Trim()
    if (-not $answer) { return $Default }
    return $answer -match '^(?:y|yes|да|д)$'
}

function Get-BrowserDefinitions {
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    $programFiles = [Environment]::GetFolderPath('ProgramFiles')
    return @(
        [pscustomobject]@{
            Id = 'Chrome'; Name = 'Google Chrome'; Process = 'chrome'; ExtensionsUrl = 'chrome://extensions/'
            UserData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
            Executables = @(
                (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
                (Join-Path $programFiles 'Google\Chrome\Application\chrome.exe'),
                (Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe')
            )
        },
        [pscustomobject]@{
            Id = 'Edge'; Name = 'Microsoft Edge'; Process = 'msedge'; ExtensionsUrl = 'edge://extensions/'
            UserData = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
            Executables = @(
                (Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
                (Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe'),
                (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
            )
        },
        [pscustomobject]@{
            Id = 'Yandex'; Name = 'Яндекс Браузер'; Process = 'browser'; ExtensionsUrl = 'browser://extensions/'
            UserData = Join-Path $env:LOCALAPPDATA 'Yandex\YandexBrowser\User Data'
            Executables = @(
                (Join-Path $env:LOCALAPPDATA 'Yandex\YandexBrowser\Application\browser.exe'),
                (Join-Path $programFiles 'Yandex\YandexBrowser\Application\browser.exe'),
                (Join-Path $programFilesX86 'Yandex\YandexBrowser\Application\browser.exe')
            )
        }
    )
}

function Get-DetectedBrowsers {
    foreach ($definition in Get-BrowserDefinitions) {
        $executable = @($definition.Executables | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) | Select-Object -First 1
        if ($executable) {
            $definition | Add-Member -NotePropertyName Executable -NotePropertyValue $executable -Force
            $definition
        }
    }
}

function Get-DefaultBrowserId {
    try {
        $choice = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice'
        $programId = [string]$choice.ProgId
        if ($programId -match 'MSEdge') { return 'Edge' }
        if ($programId -match 'Yandex') { return 'Yandex' }
        if ($programId -match 'Chrome') { return 'Chrome' }
    } catch { }
    return ''
}

function Select-BrowserDefinition {
    $detected = @(Get-DetectedBrowsers)
    if (-not $detected.Count) { throw 'Не найдены Google Chrome, Microsoft Edge или Яндекс Браузер.' }
    if ($Browser -ne 'Auto') {
        $selected = @($detected | Where-Object Id -eq $Browser) | Select-Object -First 1
        if (-not $selected) { throw "Браузер $Browser не найден." }
        return $selected
    }
    if ($detected.Count -eq 1 -or $NonInteractive) {
        $defaultId = Get-DefaultBrowserId
        return @($detected | Sort-Object { if ($_.Id -eq $defaultId) { 0 } else { 1 } })[0]
    }

    $defaultBrowserId = Get-DefaultBrowserId
    Write-Host 'Найдены браузеры:'
    for ($index = 0; $index -lt $detected.Count; $index += 1) {
        $mark = if ($detected[$index].Id -eq $defaultBrowserId) { ' (по умолчанию)' } else { '' }
        Write-Host "[$($index + 1)] $($detected[$index].Name)$mark"
    }
    while ($true) {
        $answer = Read-Host 'Выберите браузер'
        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $detected.Count) {
            return $detected[$number - 1]
        }
    }
}

function Test-DashBridgeDirectory([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    $manifestPath = Join-Path $Path 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        return [string]$manifest.name -eq 'DashBridge' -and
            (Test-Path -LiteralPath (Join-Path $Path 'pages\popup\popup.html') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $Path 'js\background.js') -PathType Leaf)
    } catch {
        return $false
    }
}

function Resolve-PreferenceExtensionPath([string]$RawPath, [string]$ProfileDirectory, [string]$UserDataDirectory) {
    if (-not $RawPath) { return $null }
    $candidates = if ([IO.Path]::IsPathRooted($RawPath)) {
        @($RawPath)
    } else {
        @((Join-Path $ProfileDirectory $RawPath), (Join-Path $UserDataDirectory $RawPath))
    }
    foreach ($candidate in $candidates) {
        try {
            $fullPath = [IO.Path]::GetFullPath($candidate)
            if (Test-DashBridgeDirectory $fullPath) { return $fullPath }
        } catch { }
    }
    return $null
}

function Find-InstalledDashBridge([pscustomobject]$BrowserDefinition) {
    if (-not (Test-Path -LiteralPath $BrowserDefinition.UserData -PathType Container)) { return @() }
    $profiles = @(Get-ChildItem -LiteralPath $BrowserDefinition.UserData -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' })
    $preferenceNames = @('Preferences', 'Secure Preferences')
    $preferenceFiles = @($profiles | ForEach-Object {
        foreach ($preferenceName in $preferenceNames) { Join-Path $_.FullName $preferenceName }
    })
    foreach ($preferenceName in $preferenceNames) {
        $rootPreferences = Join-Path $BrowserDefinition.UserData $preferenceName
        if (Test-Path -LiteralPath $rootPreferences -PathType Leaf) { $preferenceFiles += $rootPreferences }
    }
    $found = @{}
    foreach ($preferenceFile in $preferenceFiles) {
        if (-not (Test-Path -LiteralPath $preferenceFile -PathType Leaf)) { continue }
        try {
            $preferences = Get-Content -LiteralPath $preferenceFile -Raw | ConvertFrom-Json
            if (-not $preferences.PSObject.Properties['extensions'] -or
                -not $preferences.extensions.PSObject.Properties['settings']) { continue }
            $settings = $preferences.extensions.settings
            if (-not $settings) { continue }
            foreach ($property in $settings.PSObject.Properties) {
                $entry = $property.Value
                $profileDirectory = Split-Path -Parent $preferenceFile
                $rawPath = if ($entry -and $entry.PSObject.Properties['path']) { [string]$entry.path } else { '' }
                $resolved = Resolve-PreferenceExtensionPath $rawPath $profileDirectory $BrowserDefinition.UserData
                if (-not $resolved) { continue }
                $manifest = Get-Content -LiteralPath (Join-Path $resolved 'manifest.json') -Raw | ConvertFrom-Json
                $key = $resolved.ToLowerInvariant()
                if (-not $found.ContainsKey($key)) {
                    $found[$key] = [pscustomobject]@{
                        Path = $resolved; Version = [string]$manifest.version
                        ExtensionId = [string]$property.Name; Profile = Split-Path -Leaf $profileDirectory
                    }
                }
            }
        } catch {
            Write-Warning "Не удалось прочитать профиль: $preferenceFile"
        }
    }
    return @($found.Values)
}

function Read-InstallerState {
    if (-not (Test-Path -LiteralPath $script:StatePath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-InstallerState([pscustomobject]$BrowserDefinition, [string]$TargetPath, [string]$Version) {
    New-Item -ItemType Directory -Path $script:StateRoot -Force | Out-Null
    [pscustomobject]@{
        schemaVersion = 1
        browser = $BrowserDefinition.Id
        extensionPath = $TargetPath
        installedVersion = $Version
        updatedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $script:StatePath -Encoding utf8
}

function Resolve-RequestedInstallPath([string]$Value) {
    $expanded = [Environment]::ExpandEnvironmentVariables(([string]$Value).Trim().Trim('"'))
    if (-not $expanded -or -not [IO.Path]::IsPathRooted($expanded)) {
        throw 'Укажите полный пут, например C:\Tools\DashBridge.'
    }
    return [IO.Path]::GetFullPath($expanded)
}

function Read-NewInstallPath {
    if ($NonInteractive) { return $script:CanonicalInstallPath }
    Write-Host "Папка установки по умолчанию: $script:CanonicalInstallPath"
    while ($true) {
        $answer = Read-Host 'Введите другой полный пут или нажмите Enter'
        if (-not $answer.Trim()) { return $script:CanonicalInstallPath }
        try {
            return Assert-SafeTargetPath (Resolve-RequestedInstallPath $answer)
        } catch {
            Write-Warning $_.Exception.Message
        }
    }
}

function Select-TargetPath([pscustomobject]$BrowserDefinition) {
    if ($InstallPath) { return Resolve-RequestedInstallPath $InstallPath }
    $state = Read-InstallerState
    if ($state -and $state.PSObject.Properties['browser'] -and $state.PSObject.Properties['extensionPath'] -and
        $state.browser -eq $BrowserDefinition.Id -and (Test-DashBridgeDirectory ([string]$state.extensionPath))) {
        return [IO.Path]::GetFullPath([string]$state.extensionPath)
    }
    $installed = @(Find-InstalledDashBridge $BrowserDefinition)
    if ($installed.Count -eq 1) {
        Write-Host "Найден DashBridge $($installed[0].Version): $($installed[0].Path)"
        if (Read-Confirmation 'Обновлять эту папку?') { return $installed[0].Path }
    } elseif ($installed.Count -gt 1 -and -not $NonInteractive) {
        Write-Host 'Найдено несколько папок DashBridge:'
        for ($index = 0; $index -lt $installed.Count; $index += 1) {
            Write-Host "[$($index + 1)] $($installed[$index].Path) ($($installed[$index].Profile))"
        }
        $answer = Read-Host 'Выберите папку или Enter для новой установки'
        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $installed.Count) {
            return $installed[$number - 1].Path
        }
    }
    return Read-NewInstallPath
}

function Assert-SafeTargetPath([string]$TargetPath) {
    $fullPath = [IO.Path]::GetFullPath($TargetPath).TrimEnd('\')
    $root = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
    $userProfile = [Environment]::GetFolderPath('UserProfile').TrimEnd('\')
    $localAppData = $script:LocalAppDataRoot.TrimEnd('\')
    if (-not $fullPath -or $fullPath -eq $root -or $fullPath -eq $userProfile -or $fullPath -eq $localAppData) {
        throw "Небезопасная папка установки: $fullPath"
    }
    if (Test-Path -LiteralPath (Join-Path $fullPath '.git')) {
        throw "Папка $fullPath является Git checkout. Установщик не будет её перезаписывать."
    }
    if ((Test-Path -LiteralPath $fullPath) -and -not (Test-DashBridgeDirectory $fullPath)) {
        $items = @(Get-ChildItem -LiteralPath $fullPath -Force -ErrorAction SilentlyContinue)
        if ($items.Count) { throw "Папка $fullPath не пуста и не является установкой DashBridge." }
    }
    return $fullPath
}

function Get-ReleaseMetadata {
    $apiUrl = if ($ReleaseTag) {
        if ($ReleaseTag -notmatch '^v\d+\.\d+\.\d+$') { throw 'Неверный ReleaseTag.' }
        "https://api.github.com/repos/$script:RepositoryOwner/$script:RepositoryName/releases/tags/$ReleaseTag"
    } else {
        "https://api.github.com/repos/$script:RepositoryOwner/$script:RepositoryName/releases/latest"
    }
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'DashBridge-Installer' }
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 30
    if ($release.draft -or $release.prerelease -or [string]$release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') {
        throw 'Ответ GitHub не является стабильным релизом DashBridge.'
    }
    $version = $Matches[1]
    $tag = "v$version"
    $expectedPage = "https://github.com/$script:RepositoryOwner/$script:RepositoryName/releases/tag/$tag"
    if ([string]$release.html_url -ne $expectedPage) { throw 'Недоверенный URL релиза.' }
    $archiveName = "DashBridge-$version.zip"
    $hashName = "$archiveName.sha256"
    $expectedPrefix = "https://github.com/$script:RepositoryOwner/$script:RepositoryName/releases/download/$tag/"
    $archive = @($release.assets | Where-Object name -eq $archiveName) | Select-Object -First 1
    $checksum = @($release.assets | Where-Object name -eq $hashName) | Select-Object -First 1
    if (-not $archive -or -not $checksum -or
        [string]$archive.browser_download_url -ne "$expectedPrefix$archiveName" -or
        [string]$checksum.browser_download_url -ne "$expectedPrefix$hashName") {
        throw 'В релизе нет доверенного ZIP или SHA-256.'
    }
    return [pscustomobject]@{
        Version = $version; Tag = $tag; ArchiveName = $archiveName
        ArchiveUrl = [string]$archive.browser_download_url; ChecksumUrl = [string]$checksum.browser_download_url
    }
}

function Receive-Release([pscustomobject]$Release, [string]$TemporaryRoot) {
    $archivePath = Join-Path $TemporaryRoot $Release.ArchiveName
    $checksumPath = "$archivePath.sha256"
    Invoke-WebRequest -Uri $Release.ArchiveUrl -OutFile $archivePath -Headers @{ 'User-Agent' = 'DashBridge-Installer' } -TimeoutSec 120 -UseBasicParsing
    Invoke-WebRequest -Uri $Release.ChecksumUrl -OutFile $checksumPath -Headers @{ 'User-Agent' = 'DashBridge-Installer' } -TimeoutSec 30 -UseBasicParsing
    if ((Get-Item -LiteralPath $archivePath).Length -gt 64MB) { throw 'Архив превышает лимит 64 МиБ.' }
    $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $checksumPattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($Release.ArchiveName) + '$'
    if ($checksumText -notmatch $checksumPattern) {
        throw 'Неверный формат SHA-256 файла.'
    }
    $expectedHash = $Matches[1].ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'Хеш ZIP не совпадает с опубликованным SHA-256.' }
    $expandedPath = Join-Path $TemporaryRoot 'expanded'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedPath
    if (-not (Test-DashBridgeDirectory $expandedPath)) { throw 'Архив не содержит корректный DashBridge.' }
    $manifest = Get-Content -LiteralPath (Join-Path $expandedPath 'manifest.json') -Raw | ConvertFrom-Json
    if ([string]$manifest.version -ne $Release.Version) { throw 'Версия manifest не совпадает с релизом.' }
    return $expandedPath
}

function Install-ReleaseDirectory([string]$SourcePath, [string]$TargetPath) {
    $parent = Split-Path -Parent $TargetPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $staging = Join-Path $parent ('.dashbridge-staging-' + [guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $SourcePath -Destination $staging -Recurse
    if (-not (Test-DashBridgeDirectory $staging)) { throw 'Не удалось подготовить staging-папку.' }
    $backup = $null
    try {
        if (Test-Path -LiteralPath $TargetPath) {
            $backup = "$TargetPath.backup-$([DateTime]::Now.ToString('yyyyMMdd-HHmmssfff'))"
            Move-Item -LiteralPath $TargetPath -Destination $backup
        }
        Move-Item -LiteralPath $staging -Destination $TargetPath
    } catch {
        if ((-not (Test-Path -LiteralPath $TargetPath)) -and $backup -and (Test-Path -LiteralPath $backup)) {
            Move-Item -LiteralPath $backup -Destination $TargetPath
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
    return $backup
}

function Open-BrowserInstructions([pscustomobject]$BrowserDefinition, [string]$TargetPath, [bool]$WasUpdate) {
    Write-Host ''
    if ($WasUpdate) {
        Write-Host 'DashBridge обновлён на диске.' -ForegroundColor Green
        Write-Host 'Откройте popup DashBridge и нажмите «Перезагрузить расширение».'
        Write-Host 'До этого старый runtime продолжает работать; браузер закрывать не нужно.'
    } else {
        if (-not (Get-Process -Name $BrowserDefinition.Process -ErrorAction SilentlyContinue)) {
            try { Start-Process -FilePath $BrowserDefinition.Executable | Out-Null }
            catch { Write-Warning "Не удалось запустить $($BrowserDefinition.Name): $($_.Exception.Message)" }
        }
        try { Start-Process -FilePath 'explorer.exe' -ArgumentList $TargetPath | Out-Null }
        catch { Write-Warning "Не удалось открыть Проводник: $($_.Exception.Message)" }
        $menuPath = switch ($BrowserDefinition.Id) {
            'Chrome' { 'Меню ⋮ → Расширения → Управление расширениями' }
            'Edge' { 'Меню … → Расширения → Управление расширениями' }
            'Yandex' { 'Меню → Расширения' }
        }
        Write-Host 'DashBridge скачан. Завершите первую установку:' -ForegroundColor Green
        Write-Host "1. Откройте: $menuPath."
        Write-Host '2. Включите «Режим разработчика».'
        Write-Host '3. Нажмите «Загрузить распакованное расширение».'
        Write-Host "4. Выберите открытую папку: $TargetPath"
    }
}

function Invoke-SelfTest {
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('dashbridge-installer-selftest-' + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $testRoot | Out-Null
        $safe = Join-Path $testRoot 'Extension'
        if ((Assert-SafeTargetPath $safe) -ne $safe) { throw 'Safe path normalization failed.' }
        if ((Resolve-RequestedInstallPath ('"' + $safe + '"')) -ne $safe) { throw 'Quoted custom path normalization failed.' }
        $unsafeAccepted = $false
        try { [void](Assert-SafeTargetPath ([IO.Path]::GetPathRoot($safe))); $unsafeAccepted = $true } catch { }
        if ($unsafeAccepted) { throw 'Drive root was accepted.' }
        Write-Output '[OK] Safe path validation'
        $source = Join-Path $testRoot 'source'
        $target = Join-Path $testRoot 'target'
        foreach ($directory in @($source, $target)) {
            $jsDirectory = Join-Path $directory 'js'
            $popupDirectory = Join-Path (Join-Path $directory 'pages') 'popup'
            New-Item -ItemType Directory -Path $jsDirectory -Force | Out-Null
            New-Item -ItemType Directory -Path $popupDirectory -Force | Out-Null
            '{"name":"DashBridge","version":"1.0.0"}' | Set-Content -LiteralPath (Join-Path $directory 'manifest.json')
            '' | Set-Content -LiteralPath (Join-Path $popupDirectory 'popup.html')
            '' | Set-Content -LiteralPath (Join-Path $jsDirectory 'background.js')
        }
        $userData = Join-Path $testRoot 'User Data'
        $profile = Join-Path $userData 'Default'
        New-Item -ItemType Directory -Path $profile -Force | Out-Null
        @{ extensions = @{ settings = @{ 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' = @{ path = $source } } } } |
            ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $profile 'Secure Preferences')
        $discovered = @(Find-InstalledDashBridge ([pscustomobject]@{ UserData = $userData }))
        if ($discovered.Count -ne 1 -or $discovered[0].Path -ne $source) {
            throw 'Existing installation discovery failed.'
        }
        Write-Output '[OK] Chromium Preferences discovery'
        'old' | Set-Content -LiteralPath (Join-Path $target 'old.txt')
        $backup = Install-ReleaseDirectory $source $target
        if (-not (Test-DashBridgeDirectory $target) -or -not (Test-Path -LiteralPath (Join-Path $backup 'old.txt'))) {
            throw 'Staged update or backup failed.'
        }
        Write-Output '[OK] Staging, backup and atomic replacement'
        Write-Output '[OK] DashBridge installer self-test passed'
    } finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    }
}

function Invoke-Diagnostics {
    Write-Host 'DashBridge Installer Diagnostics' -ForegroundColor White
    Write-Host "Installer state: $script:StatePath"
    $state = Read-InstallerState
    if ($state) {
        $stateBrowser = if ($state.PSObject.Properties['browser']) { [string]$state.browser } else { 'не указан' }
        $statePath = if ($state.PSObject.Properties['extensionPath']) { [string]$state.extensionPath } else { 'не указан' }
        $stateVersion = if ($state.PSObject.Properties['installedVersion']) { [string]$state.installedVersion } else { 'не указа' }
        Write-Host "  Browser: $stateBrowser"
        Write-Host "  Version: $stateVersion"
        Write-Host "  Path: $statePath"
    } else {
        Write-Host '  Сохранённое состояние не найдено.'
    }
    Write-Host "Default install path: $script:CanonicalInstallPath"

    $detected = @(Get-DetectedBrowsers)
    if (-not $detected.Count) {
        Write-Host 'Поддерживаемые браузеры не найдены.' -ForegroundColor Yellow
        return
    }
    $defaultBrowserId = Get-DefaultBrowserId
    foreach ($browserDefinition in $detected) {
        $defaultMark = if ($browserDefinition.Id -eq $defaultBrowserId) { ' [default]' } else { '' }
        Write-Host "`n$($browserDefinition.Name)$defaultMark" -ForegroundColor Cyan
        Write-Host "  Executable: $($browserDefinition.Executable)"
        Write-Host "  User data: $($browserDefinition.UserData)"
        if (-not (Test-Path -LiteralPath $browserDefinition.UserData -PathType Container)) {
            Write-Host '  DashBridge: browser User Data недоступен или не найден.' -ForegroundColor Yellow
            continue
        }
        $installations = @(Find-InstalledDashBridge $browserDefinition)
        if (-not $installations.Count) {
            Write-Host '  DashBridge: распакованная установка не найдена.'
            continue
        }
        foreach ($installation in $installations) {
            Write-Host "  DashBridge $($installation.Version)"
            Write-Host "    Profile: $($installation.Profile)"
            Write-Host "    Extension ID: $($installation.ExtensionId)"
            Write-Host "    Path: $($installation.Path)"
            Write-Host "    Git checkout: $(Test-Path -LiteralPath (Join-Path $installation.Path '.git'))"
        }
    }
    Write-Output "`n[OK] Diagnostics completed without changes"
}

if ($SelfTest) { Invoke-SelfTest; exit 0 }
if ($Diagnostics) { Invoke-Diagnostics; exit 0 }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('dashbridge-install-' + [guid]::NewGuid().ToString('N'))
try {
    Write-Host 'DashBridge Installer' -ForegroundColor White
    $selectedBrowser = Select-BrowserDefinition
    Write-Step "Браузер: $($selectedBrowser.Name)"
    $targetPath = Assert-SafeTargetPath (Select-TargetPath $selectedBrowser)
    $wasUpdate = Test-DashBridgeDirectory $targetPath
    Write-Host "Папка: $targetPath"

    Write-Step 'Получение метаданных GitHub Release'
    $release = Get-ReleaseMetadata
    Write-Host "Версия: $($release.Version)"
    if ($wasUpdate) {
        $currentManifest = Get-Content -LiteralPath (Join-Path $targetPath 'manifest.json') -Raw | ConvertFrom-Json
        if ([version]([string]$currentManifest.version) -gt [version]$release.Version) {
            throw "Установлена более новая версия $($currentManifest.version); downgrade отклонён."
        }
    }
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Write-Step 'Скачивание и проверка SHA-256'
    $sourcePath = Receive-Release $release $temporaryRoot
    Write-Step $(if ($wasUpdate) { 'Безопасное обновление' } else { 'Установка' })
    $backup = Install-ReleaseDirectory $sourcePath $targetPath
    Write-InstallerState $selectedBrowser $targetPath $release.Version
    if ($backup) { Write-Host "Резервная копия: $backup" }
    Open-BrowserInstructions $selectedBrowser $targetPath $wasUpdate
} catch {
    Write-Host "`nОшибка: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
