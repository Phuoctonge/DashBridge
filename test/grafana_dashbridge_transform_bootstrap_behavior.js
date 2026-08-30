'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, URLSearchParams };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-bootstrap.js', 'utf8'), context);
const bootstrap = context.DashBridgeGrafanaPanelBootstrap;

const settings = {
    grafanaIdleKeyword: 'CPU Idle',
    grafanaMemTotalKeyword: 'RAM Total',
    grafanaMemAvailKeyword: 'RAM Used',
    grafanaMemCalcMode: 'used',
    grafanaTrimDomain: '.example.test:9182',
    grafanaTrimDomainEnabled: true
};

for (const [name, tools, expected] of [
    ['CPU', { invertIdle: true }, { invertIdle: true }],
    ['Memory', { convertMemToUsed: true }, { convertMemToUsed: true }],
    ['Load Average', { cpuCapacityFilterEnabled: true }, { trimDomainEnabled: true }]
]) {
    const result = new URL(bootstrap.applyToUrl(
        'https://grafana.example.test/d-solo/infra?panelId=1#keep=value', tools, settings
    ));
    assert.strictEqual(result.searchParams.has(bootstrap.PARAM), false, `${name}: bootstrap must not reach Grafana requests`);
    assert.strictEqual(new URLSearchParams(result.hash.slice(1)).get('keep'), 'value');
    const state = bootstrap.readFromUrl(result.toString());
    Object.entries(expected).forEach(([key, value]) => assert.strictEqual(state[key], value, `${name}: ${key}`));
    assert.strictEqual(state.idleKeyword, 'CPU Idle');
    assert.strictEqual(state.totalKeyword, 'RAM Total');
    assert.strictEqual(state.availKeyword, 'RAM Used');
    assert.strictEqual(state.memCalcMode, 'used');
    assert.strictEqual(state.trimDomain, '.example.test:9182');
}

const disabled = new URL(bootstrap.applyToUrl(
    bootstrap.applyToUrl('https://grafana.example.test/d-solo/infra?panelId=1', { invertIdle: true }, settings),
    {}, { ...settings, grafanaTrimDomainEnabled: false }
));
assert.strictEqual(new URLSearchParams(disabled.hash.slice(1)).has(bootstrap.PARAM), false,
    'disabling the transform removes stale bootstrap state before reload');

const malformed = 'https://grafana.example.test/d-solo/infra?panelId=1#dashbridgePanelTransforms=%7Bbad';
assert.strictEqual(bootstrap.readFromUrl(malformed), null, 'malformed profile data fails closed');

const dashboardHtml = fs.readFileSync('html/dashbridge.html', 'utf8');
assert(dashboardHtml.indexOf('js/shared/grafana-panel-bootstrap.js') < dashboardHtml.indexOf('js/pages/dashbridge.js'));
const panelRuntime = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
assert(panelRuntime.includes('DashBridgeGrafanaPanelBootstrap?.readFromUrl(location.href)'),
    'the MAIN-world runtime must consume bootstrap state before installing its network interceptor');

console.log('PASS DashBridge data transforms are active before Grafana first query');
