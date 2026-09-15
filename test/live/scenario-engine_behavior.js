'use strict';
const assert = require('node:assert/strict');
const { runScenario } = require('./scenario-engine');

(async () => {
    const calls = [];
    const result = await runScenario({
        scenario: { name: 'demo', timeoutMs: 1000, steps: [
            { capability: 'demo', operation: 'apply', args: { value: 1 } },
            { capability: 'demo', operation: 'snapshot', args: {} },
            { capability: 'demo', operation: 'reset', args: {} },
        ] },
        invoke: async command => { calls.push(command.operation); return { operation: command.operation }; },
        observe: async operation => ({ operation }),
        assertStep: async () => true,
    });
    assert.equal(result.status, 'passed');
    assert.deepEqual(calls, ['apply', 'snapshot', 'reset']);
    assert.equal(result.phases.executed, 3);

    let cleaned = false;
    const failed = await runScenario({
        scenario: { name: 'failure', timeoutMs: 1000, steps: [{ capability: 'demo', operation: 'apply', args: {} }] },
        invoke: async () => { throw new Error('boom'); },
        cleanup: async () => { cleaned = true; },
    });
    assert.equal(failed.status, 'failed');
    assert.equal(cleaned, true);
    console.log('PASS live scenario engine records phases and always cleans up');
})().catch(error => { console.error(error); process.exitCode = 1; });
