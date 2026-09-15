'use strict';
const assert = require('node:assert/strict');
const { runLiveLegendScenario } = require('./live-legend-scenario');

(async () => {
    const state = { hidden: false };
    const page = { evaluate: async (_fn, args) => args.operation === 'assertHidden' ? state.hidden : (args.operation === 'assertRestored' ? !state.hidden : true) };
    const panelProbe = { snapshotPanel: async () => ({ id: '12', title: 'CPU', renderer: 'uplot', labels: ['CPU idle'], width: 800, height: 400 }) };
    const invoker = { apply: async () => { state.hidden = true; }, reset: async () => { state.hidden = false; } };
    const result = await runLiveLegendScenario({ page, panelSelector: '[data-panelid="12"]', panelId: '12', hidden: ['CPU idle'], panelProbe, invoker });
    assert.equal(result.status, 'passed');
    const failingInvoker = {
        apply: async () => { state.hidden = true; throw new Error('apply interrupted after mutation'); },
        reset: async () => { state.hidden = false; },
    };
    const failed = await runLiveLegendScenario({ page, panelSelector: '[data-panelid="12"]', panelId: '12', hidden: ['CPU idle'], panelProbe, invoker: failingInvoker });
    assert.equal(failed.status, 'failed');
    assert.equal(state.hidden, false, 'failed apply must restore the panel in finally');
    console.log('PASS live legend scenario verifies apply and restore through probes');
})().catch(error => { console.error(error); process.exitCode = 1; });
