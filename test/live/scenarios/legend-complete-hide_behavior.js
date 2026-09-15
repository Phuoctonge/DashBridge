'use strict';
const assert = require('node:assert/strict');
const { createLegendCompleteHideScenario } = require('./legend-complete-hide');

(async () => {
    const state = { hidden: new Set(), labels: ['CPU user', 'CPU idle'] };
    const scenario = createLegendCompleteHideScenario({ panel: { id: '12' }, series: ['CPU idle'] });
    const result = await scenario.run({
        invoke: async command => {
            if (command.operation === 'apply') state.hidden.add('CPU idle');
            if (command.operation === 'reset') state.hidden.clear();
            return { hidden: [...state.hidden], labels: state.labels };
        },
        observe: async value => value,
        assertStep: async (value, step) => step.operation === 'apply' ? value.hidden.includes('CPU idle') : step.operation === 'reset' ? value.hidden.length === 0 : true,
    });
    assert.equal(result.status, 'passed');
    console.log('PASS legend complete-hide scenario applies and restores state');
})().catch(error => { console.error(error); process.exitCode = 1; });
