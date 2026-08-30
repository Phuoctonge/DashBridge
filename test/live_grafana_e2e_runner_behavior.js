'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { compactSnapshot, parseArguments, pushBoundedEvidence } = require('../scripts/run-live-grafana-e2e');

const projectRoot = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(projectRoot, 'pages/test-runner/test-runner-ui.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(projectRoot, 'scripts/run-live-grafana-e2e.js'), 'utf8');
assert(uiSource.includes("dataset.dashbridgeTestRunnerReady = 'true'")
    && runnerSource.includes("document.documentElement.dataset.dashbridgeTestRunnerReady === 'true'"),
    'Playwright must wait until the asynchronous Test Runner UI initialization is complete');

assert.deepStrictEqual(parseArguments([
    '--mode=fast',
    'https://grafana-one.example/d/one'
]), {
    mode: 'fast',
    urls: ['https://grafana-one.example/d/one']
});
assert.deepStrictEqual(parseArguments([
    '--mode', 'full',
    'https://grafana-one.example/d/one',
    'https://grafana-two.example/d/two'
]), {
    mode: 'full',
    urls: ['https://grafana-one.example/d/one', 'https://grafana-two.example/d/two']
});
assert.throws(() => parseArguments(['--mode=unknown', 'https://grafana.example/d/one']), /Unsupported E2E mode/);
assert.throws(() => parseArguments(['--unsafe', 'https://grafana.example/d/one']), /Unknown option/);

const compact = compactSnapshot({
    running: false,
    mode: 'fast',
    passed: 1,
    failed: 1,
    results: [{
        url: 'https://grafana.example/d/one',
        engine: 'uplot',
        tests: [
            { id: 'H1_1', name: 'removeFill', pass: true, diagnostic: { large: 'must-not-leak' } },
            { id: 'H2_1', name: 'thickenLines', pass: false, error: 'failure', diagnosticRef: { file: 'test.json' } }
        ]
    }]
});
assert.strictEqual(compact.results[0].tests.length, 2);
assert.strictEqual(compact.results[0].tests[0].diagnostic, undefined);
assert.deepStrictEqual(compact.results[0].tests[1].diagnosticRef, { file: 'test.json' });

const boundedEvidence = [];
for (let index = 0; index < 205; index += 1) pushBoundedEvidence(boundedEvidence, { index });
assert.strictEqual(boundedEvidence.length, 200, 'live evidence must retain a fixed-size newest-first window');
assert.strictEqual(boundedEvidence[0].index, 5, 'live evidence must discard only the oldest entries');

console.log('PASS Playwright live Grafana runner keeps one authoritative E2E suite and compact evidence');
