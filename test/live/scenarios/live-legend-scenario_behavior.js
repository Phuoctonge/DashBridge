'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runLiveLegendScenario } = require('./live-legend-scenario');

(async () => {
    const state = { hidden: false };
    const page = { evaluate: async (_fn, args) => args.operation === 'assertHidden' ? state.hidden : (args.operation === 'assertRestored' ? !state.hidden : true) };
    const panelProbe = { snapshotPanel: async () => ({ id: '12', title: 'CPU', renderer: 'uplot', labels: ['CPU idle'], legendAdapterReady: true, width: 800, height: 400 }) };
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
    const blocked = await runLiveLegendScenario({ page, panelSelector: '[data-panelid="12"]', panelId: '12', hidden: ['CPU idle'], panelProbe: { snapshotPanel: async () => ({ legendAdapterReady: false }) }, invoker });
    assert.deepEqual(blocked, { status: 'blocked', error: 'legend-adapter-unsupported' });
    // Run the real page callback, probe normalizer and scenario together.
    // A missing readiness field used to bypass the guard after normalization.
    let mutations = 0;
    const unsupportedRoot = {
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 800, height: 400 }),
    };
    const domPage = { evaluate: async (fn, argument) => vm.runInNewContext(`(${fn.toString()})(argument)`, {
        argument, document: { querySelector: () => unsupportedRoot },
    }) };
    const integrated = await runLiveLegendScenario({
        page: domPage, panelSelector: '#unsupported', panelId: '12', hidden: ['CPU idle'],
        invoker: { apply: async () => { mutations += 1; }, reset: async () => { mutations += 1; } },
    });
    assert.deepEqual(integrated, { status: 'blocked', error: 'legend-adapter-unsupported' });
    assert.equal(mutations, 0, 'unsupported DOM must be blocked before any renderer command');
    console.log('PASS live legend scenario verifies apply and restore through probes');
})().catch(error => { console.error(error); process.exitCode = 1; });
