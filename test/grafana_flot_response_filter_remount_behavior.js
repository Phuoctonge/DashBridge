'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const start = source.indexOf('const responseSeriesFilterIsEnabled');
const end = source.indexOf('    const normalizeCpuCapacityLegendName', start);
assert(start >= 0 && end > start, 'Flot response-filter remount helper must remain independently testable');

const calls = [];
const context = {
    tools: { seriesQueryFilterEnabled: true, cpuCapacityFilterEnabled: false },
    visualMetadata: {
        responseFilterVisibleNames: ['vm-01:9182', 'vm-01:9182   Load 1m'],
        responseFilterReady: true
    },
    flotResponseFilterRoot: null,
    window: {
        DashBridgeGrafanaVisualEngine: {
            getFlotSeriesLabels(root) { return root.labels || null; },
            applyFlotSeriesVisibility(options) {
                calls.push({ action: 'apply', ...options });
                return 'flot';
            },
            resetFlotSeriesVisibility(options) {
                calls.push({ action: 'reset', ...options });
                return true;
            }
        }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.syncFlot = syncFlotResponseFilterState;`, context);

const dashboardRoot = {
    id: 'dashboard',
    labels: [
        'vm-01:9182 Load 1m',
        'vm-01:9182 Load 5m',
        'vm-01:9182 Load 15m',
        'vm-02:9182 Load 1m'
    ]
};
context.syncFlot(dashboardRoot);
assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.at(-1).seriesConfig)), {
    'vm-01:9182 Load 1m': true,
    'vm-01:9182 Load 5m': false,
    'vm-01:9182 Load 15m': false,
    'vm-02:9182 Load 1m': false
});
assert.strictEqual(calls.at(-1).mode, 'fast_complete_hide');

const viewRoot = { id: 'view', labels: ['vm-01:9182 Load 1m', 'vm-02:9182 Load 1m'] };
context.syncFlot(viewRoot);
assert.strictEqual(calls.at(-2).action, 'reset');
assert.strictEqual(calls.at(-2).root.id, 'dashboard', 'old dashboard plot controller must be detached');
assert.strictEqual(calls.at(-1).action, 'apply');
assert.strictEqual(calls.at(-1).root.id, 'view', 'the cached allowlist must attach to the new View plot');

context.tools.seriesQueryFilterEnabled = false;
context.syncFlot(viewRoot);
assert.strictEqual(calls.at(-1).action, 'reset', 'disabling the filter restores native Flot data');

assert(!source.includes('refreshViewPanelDataOnce') && !source.includes('viewPanelRefreshKeys'),
    'View restoration must not issue a datasource refresh');

console.log('PASS cached response-filter state follows Flot from dashboard to View');
