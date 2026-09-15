'use strict';
const assert = require('node:assert/strict');
const { parseSmokeArgs, runLiveSmoke } = require('./run-live-smoke');

(async () => {
    const args = parseSmokeArgs(['--url', 'https://grafana.example/d/test', '--scenario', 'legend-complete-hide']);
    assert.equal(args.scenario, 'legend-complete-hide');
    assert.deepEqual(await runLiveSmoke({ ...args, scenario: 'not-in-catalog' }), { status: 'blocked', reason: 'unknown-smoke-scenario:not-in-catalog' });
    console.log('PASS live smoke catalog is explicit and fail-closed');
})().catch(error => { console.error(error); process.exitCode = 1; });
