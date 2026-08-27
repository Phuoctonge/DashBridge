'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/shared/grafana-settings.js', 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context);

const { getGrafanaSettingsDefaults, getGrafanaSettingsStorageKeys, normalizeGrafanaSettings } = context.globalThis;
assert.strictEqual(getGrafanaSettingsDefaults().grafanaMemCalcMode, 'available');
assert(getGrafanaSettingsStorageKeys().includes('grafanaMemCalcMode'));
assert(getGrafanaSettingsStorageKeys().includes('grafanaCpuPanelTitle'));
assert(getGrafanaSettingsStorageKeys().includes('grafanaCpuCapacityCoefficient'));
assert.strictEqual(getGrafanaSettingsDefaults().grafanaCpuCapacityCoefficient, 0.8);
assert.deepStrictEqual([
    getGrafanaSettingsDefaults().grafanaCompactExportWidth,
    getGrafanaSettingsDefaults().grafanaCompactExportHeight
], [1000, 520]);
assert(getGrafanaSettingsStorageKeys().includes('grafanaCompactExportWidth'));
assert(getGrafanaSettingsStorageKeys().includes('grafanaCompactExportHeight'));
assert.deepStrictEqual([
    normalizeGrafanaSettings({ grafanaCompactExportWidth: 1280, grafanaCompactExportHeight: 720 }).grafanaCompactExportWidth,
    normalizeGrafanaSettings({ grafanaCompactExportWidth: 1280, grafanaCompactExportHeight: 720 }).grafanaCompactExportHeight
], [1280, 720], 'legacy custom compact dimensions must remain active');
assert.deepStrictEqual([
    normalizeGrafanaSettings({ grafanaCompactExportWidth: 99 }).grafanaCompactExportWidth,
    normalizeGrafanaSettings({ grafanaCompactExportHeight: 5000 }).grafanaCompactExportHeight
], [1000, 520], 'unsafe compact dimensions must fall back to defaults');
assert.strictEqual(getGrafanaSettingsDefaults().grafanaTrimDomainEnabled, true,
    'server-domain shortening is enabled by default for every Grafana panel');
assert.strictEqual(normalizeGrafanaSettings({ grafanaTrimDomainEnabled: false }).grafanaTrimDomainEnabled, true,
    'legacy false default migrates to enabled when all-panel shortening is introduced');
assert.strictEqual(normalizeGrafanaSettings({
    grafanaTrimDomainEnabled: false, grafanaTrimDomainVersion: 2
}).grafanaTrimDomainEnabled, false, 'an explicit v2 opt-out remains respected');
assert.deepStrictEqual([
    getGrafanaSettingsDefaults().grafanaCpuPanelTitle,
    getGrafanaSettingsDefaults().grafanaMemPanelTitle,
    getGrafanaSettingsDefaults().grafanaLoadPanelTitle
], ['CPU Usage', 'Memory', 'Load Average']);
assert.strictEqual(normalizeGrafanaSettings({ grafanaCpuPanelTitle: '  Processor   Load  ' }).grafanaCpuPanelTitle, 'Processor Load');
assert.strictEqual(normalizeGrafanaSettings({ grafanaMemPanelTitle: '' }).grafanaMemPanelTitle, 'Memory');
assert.strictEqual(normalizeGrafanaSettings({ grafanaCpuPanelTitle: 'CPU' }).grafanaCpuPanelTitle, 'CPU Usage');
assert.strictEqual(normalizeGrafanaSettings({ grafanaMemPanelTitle: 'RAM' }).grafanaMemPanelTitle, 'Memory');
assert.strictEqual(normalizeGrafanaSettings({ grafanaCpuPanelTitle: 'Processor' }).grafanaCpuPanelTitle, 'Processor');
assert.strictEqual(normalizeGrafanaSettings({ grafanaCpuCapacityCoefficient: 0.65 }).grafanaCpuCapacityCoefficient, 0.65);
assert.strictEqual(normalizeGrafanaSettings({ grafanaCpuCapacityCoefficient: 0 }).grafanaCpuCapacityCoefficient, 0.8);
assert.strictEqual(normalizeGrafanaSettings({}).grafanaMemCalcMode, 'available');
assert.strictEqual(normalizeGrafanaSettings({ grafanaMemAvailKeyword: 'Used' }).grafanaMemCalcMode, 'used',
    'legacy settings must retain the Used formula when no explicit mode exists');
assert.strictEqual(normalizeGrafanaSettings({
    grafanaMemAvailKeyword: 'consumed', grafanaMemCalcMode: 'used'
}).grafanaMemCalcMode, 'used', 'a custom second-series name must not control the explicit formula');
assert.strictEqual(normalizeGrafanaSettings({
    grafanaMemAvailKeyword: 'used', grafanaMemCalcMode: 'available'
}).grafanaMemCalcMode, 'available', 'an explicit mode must win over legacy keyword inference');

console.log('PASS Grafana RAM calculation mode preserves legacy settings and supports custom series names');
