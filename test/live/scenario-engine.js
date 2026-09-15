'use strict';

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runScenario({ scenario, invoke, observe = async value => value, assertStep = async () => true, cleanup = async () => undefined } = {}) {
    const phases = { accepted: 0, executed: 0, observable: 0, cleanup: 0 };
    const results = [];
    const deadline = Math.max(100, Number(scenario?.timeoutMs) || 30_000);
    const startedAt = Date.now();
    let status = 'passed';
    let error = null;
    try {
        for (const step of scenario?.steps || []) {
            const remaining = Math.max(1, deadline - (Date.now() - startedAt));
            phases.accepted += 1;
            const commandResult = await withTimeout(Promise.resolve(invoke(step)), remaining, `${step.operation || 'step'} accepted/executed`);
            phases.executed += 1;
            const observed = await withTimeout(Promise.resolve(observe(commandResult, step)), Math.max(1, deadline - (Date.now() - startedAt)), `${step.operation || 'step'} observe`);
            phases.observable += 1;
            results.push({ operation: step.operation, observed });
            const passed = await withTimeout(Promise.resolve(assertStep(observed, step)), Math.max(1, deadline - (Date.now() - startedAt)), `${step.operation || 'step'} assert`);
            if (!passed) throw new Error(`${step.operation || 'step'} assertion failed`);
        }
    } catch (caught) {
        status = /timeout/i.test(String(caught.message)) ? 'timeout' : 'failed';
        error = String(caught.message || caught).slice(0, 512);
    } finally {
        try { await withTimeout(Promise.resolve(cleanup()), Math.max(1, deadline - (Date.now() - startedAt)), 'cleanup'); phases.cleanup = 1; }
        catch (caught) { status = 'failed'; error = error || String(caught.message || caught).slice(0, 512); }
    }
    return { name: scenario?.name || 'unnamed', status, error, phases, results, durationMs: Date.now() - startedAt };
}
module.exports = { runScenario };
