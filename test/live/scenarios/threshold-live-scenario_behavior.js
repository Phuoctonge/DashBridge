'use strict';
const assert = require('node:assert/strict');
const { runLiveThresholdScenario } = require('./threshold-live-scenario');

(async () => {
    let visible = false;
    const page = { evaluate: async (_fn, operation) => operation === 'assertVisible' ? visible : (operation === 'assertRestored' ? !visible : true) };
    const invoker = { apply: async () => { visible = true; }, reset: async () => { visible = false; } };
    const result = await runLiveThresholdScenario({ page, panelId: '8', threshold: 80, sourceNames: ['CPU'], panelProbe: { snapshotPanel: async () => ({ renderer: 'uplot' }) }, invoker });
    assert.equal(result.status, 'passed');
    assert.equal(visible, false);
    assert.equal((await runLiveThresholdScenario({ page, panelId: '8', threshold: NaN })).error, 'threshold-must-be-finite');
    assert.equal((await runLiveThresholdScenario({ page, panelId: '8', threshold: 80 })).error, 'threshold-source-names-required');
    console.log('PASS live threshold scenario applies, observes, resets, and rejects invalid values');
})().catch(error => { console.error(error); process.exitCode = 1; });
