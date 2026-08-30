'use strict';

const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const builder = fs.readFileSync('scripts/build-release.ps1', 'utf8');

assert.strictEqual(manifest.version, '2.4.1');
assert(workflow.includes("- 'v*'")
    && workflow.includes('node test/run-all-tests.js')
    && workflow.indexOf('node test/run-all-tests.js') < workflow.indexOf('gh release create'),
    'tag workflow must run the full suite before publishing a release');
assert(workflow.includes('permissions:') && workflow.includes('contents: write'),
    'release job must declare only the GitHub permission it uses');
assert(builder.includes('$ExpectedTag -ne "v$version"'),
    'archive builder must reject a tag that differs from manifest.version');
for (const input of ['manifest.json', 'css', 'html', 'icons', 'js', 'pages', 'vendor']) {
    assert(builder.includes(input), `release archive must include ${input}`);
}
for (const staleInput of ["Join-Path $projectRoot 'assets'", "Filter '*.html'"]) {
    assert(!builder.includes(staleInput), `release builder must not use stale input ${staleInput}`);
}
for (const excluded of ['README.md', 'docs', 'plans', 'test']) {
    assert(!builder.includes(`Join-Path $projectRoot '${excluded}'`),
        `release archive must not add ${excluded}`);
}
assert(builder.includes('Get-FileHash') && workflow.includes('.zip.sha256'),
    'every release archive must publish its SHA-256 checksum');
assert(builder.includes("'Install-DashBridge.ps1'")
    && workflow.includes('./scripts/Install-DashBridge.ps1 -SelfTest')
    && workflow.includes('dist/Install-DashBridge.ps1.sha256'),
    'the release must test and publish the standalone installer with its checksum');
assert(!builder.includes('"scripts\\$installerName"'),
    'release builder must keep installer paths portable across Windows and GitHub Linux runners');
for (const manifestContract of [
    'background.service_worker',
    'action.default_popup',
    'options_ui.page',
    'content_scripts',
    'web_accessible_resources'
]) {
    assert(builder.includes(manifestContract),
        `release builder must verify manifest contract ${manifestContract}`);
}
assert(builder.includes('Assert-ArchiveEntry')
    && builder.includes("EndsWith('.html'")
    && builder.includes('$htmlReferencePattern'),
    'release builder must verify packaged manifest paths and local HTML dependencies');

console.log('PASS tagged releases test, package and publish a minimal extension archive');
