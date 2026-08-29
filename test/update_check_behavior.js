'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/update-check.js', 'utf8'), context);
const update = context.DashBridgeUpdateCheck;

assert.strictEqual(update.compareVersions('2.4.0', '2.3.1'), 1);
assert.strictEqual(update.compareVersions('v2.4', '2.4.0'), 0);
assert.strictEqual(update.compareVersions('2.3.9', '2.4.0'), -1);
assert.strictEqual(update.compareVersions('2.4.0-beta', '2.3.1'), null);
assert.strictEqual(update.compareVersions('65536.0.0', '2.3.1'), null);

const release = {
    tag_name: 'v2.4.0',
    html_url: 'https://github.com/Phuoctonge/DashBridge/releases/tag/v2.4.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-28T00:00:00Z',
    assets: [{
        name: 'DashBridge-2.4.0.zip',
        browser_download_url: 'https://github.com/Phuoctonge/DashBridge/releases/download/v2.4.0/DashBridge-2.4.0.zip',
    }, {
        name: 'Install-DashBridge.ps1',
        browser_download_url: 'https://github.com/Phuoctonge/DashBridge/releases/download/v2.4.0/Install-DashBridge.ps1',
    }],
};
assert.deepStrictEqual(JSON.parse(JSON.stringify(update.parseLatestRelease(release))), {
    version: '2.4.0',
    pageUrl: release.html_url,
    downloadUrl: release.assets[0].browser_download_url,
    installerUrl: release.assets[1].browser_download_url,
    publishedAt: release.published_at,
});
assert.strictEqual(update.parseLatestRelease({ ...release, prerelease: true }), null);
assert.strictEqual(update.parseLatestRelease({ ...release, tag_name: 'v2.4.1' }), null,
    'tag, page and archive version must be identical');
assert.strictEqual(update.parseLatestRelease({
    ...release,
    assets: [{ ...release.assets[0], browser_download_url: 'https://evil.example/DashBridge-2.4.0.zip' }, release.assets[1]],
}), null, 'download URL must be pinned to the official repository and release');
assert.strictEqual(update.parseLatestRelease({ ...release, assets: [release.assets[0]] }), null,
    'a release without the trusted installer must not be offered as an automatic update');

console.log('PASS update metadata accepts only a newer trusted GitHub release');
