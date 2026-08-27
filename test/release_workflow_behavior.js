'use strict';

const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const builder = fs.readFileSync('scripts/build-release.ps1', 'utf8');

assert.strictEqual(manifest.version, '2.4.0');
assert(workflow.includes("- 'v*'")
    && workflow.includes('node test/run-all-tests.js')
    && workflow.indexOf('node test/run-all-tests.js') < workflow.indexOf('gh release create'),
    'tag workflow must run the full suite before publishing a release');
assert(workflow.includes('permissions:') && workflow.includes('contents: write'),
    'release job must declare only the GitHub permission it uses');
assert(builder.includes('$ExpectedTag -ne "v$version"'),
    'archive builder must reject a tag that differs from manifest.version');
for (const input of ['manifest.json', 'assets', 'css', 'icons', 'js', 'vendor', "'*.html'"]) {
    assert(builder.includes(input), `release archive must include ${input}`);
}
for (const excluded of ['README.md', 'docs', 'plans', 'test']) {
    assert(!builder.includes(`Join-Path $projectRoot '${excluded}'`),
        `release archive must not add ${excluded}`);
}
assert(builder.includes('Get-FileHash') && workflow.includes('.zip.sha256'),
    'every release archive must publish its SHA-256 checksum');

console.log('PASS tagged releases test, package and publish a minimal extension archive');
