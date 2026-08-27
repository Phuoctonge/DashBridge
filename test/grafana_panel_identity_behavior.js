const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = vm.createContext({ URL, URLSearchParams });
const source = fs.readFileSync('js/shared/grafana-panel-identity.js', 'utf8');
vm.runInContext(`${source}\nthis.identity = DashBridgeGrafanaPanelIdentity;`, context);

const existing = 'https://grafanakns.mos.ru/d-solo/d78c98f6dd89/monitoring-jmeter-mirsky?orgId=1&refresh=10s&var-project=RussPass&panelId=panel-137&kiosk=tv';
const current = 'https://grafanakns.mos.ru/d/d78c98f6dd89/renamed-dashboard?orgId=1&refresh=10s&var-project=dns&viewPanel=panel-137&from=2025-04-25T10:48:00.000Z';
assert.strictEqual(context.identity.fromUrl(existing), context.identity.fromUrl(current),
    'the same dashboard panel must match across URL modes, slugs, variables and time ranges');
assert.strictEqual(context.identity.fromUrl(current, '137'), context.identity.fromUrl(existing),
    'numeric and panel-prefixed ids must match');
assert.notStrictEqual(context.identity.fromUrl(existing), context.identity.fromUrl(existing.replace('panel-137', 'panel-138')),
    'different panel ids must remain distinct');
assert.notStrictEqual(context.identity.fromUrl(existing), context.identity.fromUrl(existing.replace('orgId=1', 'orgId=2')),
    'different Grafana organisations must remain distinct');

console.log('PASS Grafana panel identity ignores presentation and variable URL state');
