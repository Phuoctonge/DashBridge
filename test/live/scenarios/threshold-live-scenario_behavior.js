'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
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
    for (const count of [1, 0, 2]) {
        const selectedRoot = { id: 'selected' };
        const otherRoot = { id: 'other' };
        let overlay = false;
        const touched = [];
        const browser = {
            document: {
                querySelectorAll: selector => selector === '#selected'
                    ? Array(count).fill(selectedRoot) : (overlay ? [{}] : []),
            },
            window: {
                DashBridgeGrafanaDom: { findPanel: () => otherRoot },
                DashBridgeGrafanaVisualEngine: {
                    setSeriesThresholdHighlights: ({ root, enabled }) => {
                        touched.push(root); overlay = enabled;
                        return { engine: 'uplot', drawn: enabled ? 1 : 0 };
                    },
                },
            },
        };
        const actualPage = { evaluate: async (fn, argument) => vm.runInNewContext(`(${fn.toString()})(argument)`, { ...browser, argument }) };
        const scoped = await runLiveThresholdScenario({ page: actualPage, panelSelector: '#selected', panelId: 'wrong-id', threshold: 1, sourceNames: ['Value'] });
        if (count === 1) {
            assert.equal(scoped.status, 'passed');
            assert.deepEqual(touched, [selectedRoot, selectedRoot], 'apply/reset must use the selected root, not active-panel fallback');
        } else {
            assert.equal(scoped.status, 'failed');
            assert.equal(touched.length, 0, 'missing or ambiguous selector must not mutate any panel');
        }
    }
    console.log('PASS live threshold scenario applies, observes, resets, and rejects invalid values');
})().catch(error => { console.error(error); process.exitCode = 1; });
