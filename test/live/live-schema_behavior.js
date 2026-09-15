'use strict';
const assert = require('node:assert/strict');
const schema = require('./live-schema');

assert.throws(() => schema.validateEnvironment({ name: 'bad', baseUrl: 'grafana.local', dashboardUrls: ['https://grafana.local/d/demo'] }), /HTTP\(S\)/);
assert.throws(() => schema.validateCommand({ capability: 'x', args: { value: 'x'.repeat(9000) } }), /size/i);
assert.throws(() => schema.validateScenario({ name: 'x', capability: 'x', steps: [] }), /step/i);

const environment = schema.validateEnvironment({
    name: 'grafanakns',
    baseUrl: 'https://grafana.example.test',
    dashboardUrls: ['https://grafana.example.test/d/demo/main'],
    renderers: ['uplot', 'flot'],
});
assert.equal(environment.name, 'grafanakns');
assert.deepEqual(environment.renderers, ['uplot', 'flot']);

const scenario = schema.validateScenario({
    name: 'legend-complete-hide',
    capability: 'legend.completeHide',
    timeoutMs: 30_000,
    steps: [
        { operation: 'apply', args: { series: ['CPU idle'] } },
        { operation: 'snapshot' },
        { operation: 'reset' },
    ],
});
assert.equal(scenario.steps.length, 3);

console.log('PASS live schemas validate bounded environments, commands, and scenarios');
