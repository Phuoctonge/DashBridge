'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const start = source.indexOf('const findPanelSceneQueryRunner');
const end = source.indexOf('    const openPanelSettings', start);
assert(start >= 0 && end > start, 'panel-scoped refresh helpers must remain independently testable');

let dashboardRefreshes = 0;
let uplot = null;
const context = {
    window: {
        angular: null,
        DashBridgeGrafanaDom: { outerPanel: panel => panel },
        DashBridgeGrafanaVisualEngine: { findUPlot: () => uplot }
    },
    document: {
        querySelector() {
            return { click() { dashboardRefreshes += 1; } };
        }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.findRunner = findPanelSceneQueryRunner;
globalThis.refreshPanel = refreshSelectedPanelData;`, context);

let selectedPanelRuns = 0;
let neighbouringPanelRuns = 0;
const selectedRunner = {
    state: { queries: [{ refId: 'A' }] },
    runQueries() { selectedPanelRuns += 1; }
};
const neighbouringRunner = {
    state: { queries: [{ refId: 'B' }] },
    runQueries() { neighbouringPanelRuns += 1; }
};
const panel = {
    querySelector: () => null,
    __reactFiber$test: {
        memoizedProps: { model: { state: { $data: selectedRunner } } },
        return: {
            memoizedProps: { dashboard: { panels: [{ state: { $data: neighbouringRunner } }] } },
            return: null
        }
    }
};

assert.strictEqual(context.refreshPanel(panel), 'scene-query-runner');
assert.strictEqual(selectedPanelRuns, 1, 'only the selected panel SceneQueryRunner must execute');
assert.strictEqual(neighbouringPanelRuns, 0, 'neighbouring panel runners must remain untouched');
assert.strictEqual(dashboardRefreshes, 0, 'modern panel refresh must not click Refresh dashboard');

let legacyRefreshes = 0;
const legacyController = { refresh() { legacyRefreshes += 1; } };
const legacyChild = {};
const legacyPanel = {
    querySelector: () => null,
    querySelectorAll: () => [legacyChild]
};
context.window.angular = {
    element(element) {
        return { scope: () => element === legacyChild ? { panelCtrl: legacyController } : null };
    }
};
assert.strictEqual(context.refreshPanel(legacyPanel), 'angular-panel-controller');
assert.strictEqual(legacyRefreshes, 1, 'legacy Flot refresh must use the selected panel controller');
assert.strictEqual(dashboardRefreshes, 0, 'legacy local controller must avoid dashboard refresh');
context.window.angular = null;

const panelWithoutRunner = { querySelector: () => null };
uplot = {};
assert.strictEqual(context.refreshPanel(panelWithoutRunner), 'uplot-runner-unavailable');
assert.strictEqual(dashboardRefreshes, 0, 'uPlot must fail closed instead of refreshing every panel');

uplot = null;
assert.strictEqual(context.refreshPanel(panelWithoutRunner), 'dashboard-compatibility');
assert.strictEqual(dashboardRefreshes, 1,
    'legacy Flot without a private controller must still query after an explicit filter settings save');

assert(!source.includes('refreshViewPanelDataOnce') && !source.includes('viewPanelRefreshKeys'),
    'View remount must not trigger an automatic datasource refresh');

const transformBlock = source.slice(
    source.indexOf('const dataTransformChanged ='),
    source.indexOf('const thresholdHighlightVisibilityChanged', source.indexOf('const dataTransformChanged ='))
);
assert(!transformBlock.includes('seriesQueryFilterHighlightEnabled'),
    'series highlight visibility must not trigger a data query');
assert(!transformBlock.includes('cpuCapacityFilterHighlightEnabled'),
    'vCPU highlight visibility must not trigger a data query');

console.log('PASS Grafana settings refresh only the selected panel query runner');
