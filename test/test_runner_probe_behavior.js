'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    URLSearchParams,
    location: { pathname: '/grafana/d/infra/main', search: '?viewPanel=17' },
    document: {
        querySelectorAll(selector) {
            if (selector === 'canvas') return [{}];
            return [];
        },
        querySelector() { return null; },
        documentElement: { hasAttribute: name => name === 'data-dashbridge-icon-url' },
    },
    window: {
        grafanaBootData: { settings: { buildInfo: { version: '12.1.0' } } },
    },
};
context.window.window = context.window;
context.window.parent = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/test-runner/test-runner-probe.js'), 'utf8'), context);
const snapshot = context.dashbridgeRunProbe();
assert.strictEqual(snapshot.ok, true);
assert.strictEqual(snapshot.engine, 'uplot');
assert.strictEqual(snapshot.routeType, 'zoomed');
assert.strictEqual(snapshot.viewPanelId, 'panel-17');
assert.strictEqual(snapshot.firstPanelId, 'panel-17', 'URL panel ID is the final fallback');
assert.strictEqual(snapshot.firstGraphPanelId, 'panel-17');
assert.strictEqual(snapshot.grafanaVersion, '12.1.0');
assert.strictEqual(snapshot.contentScript, true);
console.log('PASS test runner probe normalizes routes and provides safe fallbacks');
