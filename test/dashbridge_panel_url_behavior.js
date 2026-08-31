'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = {
    DashBridgeGrafanaPanelIdentity: {
        fromUrl(value) {
            return String(value).includes('/d/') || String(value).includes('/d-solo/')
                ? 'https://grafana.example/d-solo/uid?panelId=7'
                : '';
        },
    },
};
const context = { window, URL, String, Number, Set, Error };
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-url.js', 'utf8'), context);
const panelUrl = window.DashBridgePanelUrl;

assert(Object.isFrozen(panelUrl), 'panel URL API must be immutable');
assert.strictEqual(panelUrl.isSupportedPanelUrl('https://grafana.example/d/uid/name'), true);
assert.strictEqual(panelUrl.isSupportedPanelUrl('http://grafana.example/d/uid/name'), true);
assert.strictEqual(panelUrl.isSupportedPanelUrl('ftp://grafana.example/d/uid/name'), false);
assert.strictEqual(panelUrl.isSupportedPanelUrl('not a URL'), false);

const normalized = new URL(panelUrl.normalizeGrafanaPanelUrl(
    'https://grafana.example/base/d/uid/name?orgId=1&viewPanel=7&from=now-6h&to=now&var-system=A#keep=value'
));
assert.strictEqual(normalized.pathname, '/base/d-solo/uid/name');
assert.strictEqual(normalized.searchParams.has('viewPanel'), false);
assert.strictEqual(normalized.searchParams.get('panelId'), '7');
assert.strictEqual(normalized.searchParams.get('from'), 'now-6h');
assert.strictEqual(normalized.searchParams.get('to'), 'now');
assert.strictEqual(normalized.searchParams.get('var-system'), 'A');
assert.strictEqual(normalized.searchParams.get('kiosk'), 'tv');
assert.strictEqual(normalized.searchParams.get('dashbridge'), '1');
assert.strictEqual(normalized.hash, '#keep=value');

const noPanel = new URL(panelUrl.normalizeGrafanaPanelUrl('https://grafana.example/d-solo/uid/name?orgId=1'));
assert.strictEqual(noPanel.pathname, '/d/uid/name', 'solo route without a panel ID must return to dashboard mode');
assert.throws(() => panelUrl.normalizeGrafanaPanelUrl('file:///d/uid/name'), /http или https/);

const solo = new URL(panelUrl.buildDashBridgeSoloPanelUrl(
    'https://grafana.example/base/d/uid/name?orgId=1&viewPanel=2&editPanel=2&from=now-1h&var-project=X',
    '9'
));
assert.strictEqual(solo.pathname, '/base/d-solo/uid/name');
assert.strictEqual(solo.searchParams.get('panelId'), '9');
assert.strictEqual(solo.searchParams.has('viewPanel'), false);
assert.strictEqual(solo.searchParams.has('editPanel'), false);
assert.strictEqual(solo.searchParams.get('from'), 'now-1h', 'DashBridge must retain the dashboard time range');
assert.strictEqual(solo.searchParams.get('var-project'), 'X', 'DashBridge must retain dashboard variables');
assert.strictEqual(solo.searchParams.get('kiosk'), 'tv');
assert.strictEqual(solo.searchParams.get('dashbridge'), '1');
assert.throws(() => panelUrl.buildDashBridgeSoloPanelUrl('https://grafana.example/explore', '1'), /\/d\/\.\.\./);
assert.throws(() => panelUrl.buildDashBridgeSoloPanelUrl('javascript:alert(1)', '1'), /http или https/);

assert.strictEqual(
    panelUrl.getProfilePanelIdentity('https://grafana.example/d/uid/name?viewPanel=7'),
    'https://grafana.example/d-solo/uid?panelId=7',
    'Grafana identity owner must take precedence'
);
const fallbackIdentity = panelUrl.getProfilePanelIdentity(
    'https://example.test/custom?z=2&from=now-1h&dashbridge=1&a=1#temporary'
);
assert.strictEqual(fallbackIdentity, 'https://example.test/custom?a=1&z=2');
assert.strictEqual(panelUrl.getProfilePanelIdentity('not a URL'), 'not a URL');

assert.deepStrictEqual(Array.from(panelUrl.parseQuickPanelIds('3, 1, 3, 2')), ['3', '1', '2']);
assert.deepStrictEqual(Array.from(panelUrl.parseQuickPanelIds('')), []);
assert.throws(() => panelUrl.parseQuickPanelIds('1, 0, x'), /0, x/);

const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
assert(html.indexOf('dashbridge-panel-url.js') < html.indexOf('dashbridge.js'),
    'panel URL owner must load before the DashBridge controller');
const controller = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
assert(controller.includes('} = window.DashBridgePanelUrl;'));
assert(controller.includes('buildDashBridgeSoloPanelUrl,'),
    'the page-local helper must have a unique name beside the classic shared Grafana URL global');
assert(!controller.includes('buildGrafanaSoloPanelUrl'),
    'the DashBridge controller must not reference the ambiguous shared helper name');
assert.strictEqual((controller.match(/buildDashBridgeSoloPanelUrl\(/g) || []).length, 2,
    'both DashBridge callers must use the page-local URL contract');
for (const name of ['isSupportedPanelUrl', 'normalizeGrafanaPanelUrl', 'buildDashBridgeSoloPanelUrl',
    'getProfilePanelIdentity', 'parseQuickPanelIds']) {
    assert(!controller.includes(`function ${name}(`), `${name} must have one owner`);
}

console.log('PASS DashBridge panel URL module preserves routes, variables, identity and ID validation');
