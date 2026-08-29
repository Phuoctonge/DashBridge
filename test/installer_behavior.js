'use strict';

const assert = require('assert');
const fs = require('fs');

const installerBytes = fs.readFileSync('scripts/Install-DashBridge.ps1');
assert.deepStrictEqual([...installerBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf],
    'installer must retain an UTF-8 BOM so Windows PowerShell 5.1 parses Russian text correctly');
const source = installerBytes.toString('utf8');

for (const browser of ['Google Chrome', 'Microsoft Edge', 'Яндекс Браузер']) {
    assert(source.includes(browser), `installer must support ${browser}`);
}
for (const extensionsUrl of ['chrome://extensions/', 'edge://extensions/', 'browser://extensions/']) {
    assert(source.includes(extensionsUrl), `installer must open the canonical extensions page ${extensionsUrl}`);
}
assert(!source.includes("ExtensionsUrl = 'browser://tune'"),
    'Yandex CRX tune page must not replace the unpacked-extension developer page');
assert(!source.includes("-ArgumentList @('--new-tab', $BrowserDefinition.ExtensionsUrl)")
    && !source.includes('Set-Clipboard')
    && !source.includes('SendKeys')
    && source.includes('Управление расширениями'),
'installer must not steal clipboard/focus and must provide browser-native menu navigation for first install');
assert(!source.includes('function Wait-ForBrowserExit')
    && source.includes('браузер закрывать не нужно')
    && source.includes('Перезагрузить расширение'),
'live updates must keep the browser open and hand activation to the extension reload action');
assert(source.includes("$script:LocalAppDataRoot = if ($env:LOCALAPPDATA)")
    && source.includes("Join-Path $script:LocalAppDataRoot 'DashBridge'")
    && source.includes("installer-state.json")
    && source.includes("'Extension'"),
'installer must own a stable per-user installation directory and state file');
assert(source.includes('function Read-NewInstallPath')
    && source.includes('Папка установки по умолчанию')
    && source.includes('или нажмите Enter')
    && source.includes('ExpandEnvironmentVariables')
    && source.includes('Resolve-RequestedInstallPath $InstallPath'),
'new installations must offer the canonical directory, accept Enter and validate an optional custom absolute path');
const diagnostics = /function Invoke-Diagnostics \{([\s\S]*?)\n\}/.exec(source)?.[1] || '';
assert(diagnostics.includes('Get-DetectedBrowsers')
    && diagnostics.includes('Find-InstalledDashBridge')
    && diagnostics.includes('Extension ID')
    && diagnostics.includes('Git checkout')
    && !diagnostics.includes('Invoke-WebRequest')
    && !diagnostics.includes('Write-InstallerState')
    && !diagnostics.includes('Install-ReleaseDirectory'),
'diagnostics must report browser/profile/path evidence without network or mutations');
assert(source.includes('Find-InstalledDashBridge')
    && source.includes('extensions.settings')
    && source.includes("@('Preferences', 'Secure Preferences')"),
'installer must discover an existing unpacked installation without modifying browser preferences');
assert(source.includes("Test-Path -LiteralPath (Join-Path $fullPath '.git')")
    && source.includes('Assert-SafeTargetPath'),
'installer must reject repository and broad unsafe update targets');
assert(source.includes('Get-FileHash')
    && source.includes('SHA-256')
    && source.includes('DashBridge-$version.zip')
    && source.includes('64MB')
    && source.includes('-TimeoutSec'),
'installer must pin release asset names and verify the published archive checksum');
assert(source.includes('.dashbridge-staging-')
    && source.includes('.backup-')
    && source.includes('Move-Item -LiteralPath $backup -Destination $TargetPath'),
'installer must stage updates, retain a backup and restore it after a failed swap');
assert(source.includes('downgrade отклонён') && source.includes('[version]$release.Version'),
    'installer must not replace a newer local version with an older release');
assert(!source.includes('ExtensionInstallForcelist')
    && !source.includes('--load-extension')
    && !source.includes('Remove-Item -LiteralPath $TargetPath'),
'installer must not bypass browser installation policy or destructively clear the live target');

console.log('PASS Windows installer safely discovers, verifies, stages and hands off DashBridge');
