'use strict';
const assert = require('node:assert/strict');
const { parseMatrixArgs, runLiveMatrix } = require('./run-live-matrix');

(async () => {
    const args = parseMatrixArgs(['--urls', 'https://one.example/d/a,https://two.example/d/b', '--panelId', '8']);
    assert.deepEqual(args.urls, ['https://one.example/d/a', 'https://two.example/d/b']);
    assert.equal(args.scenario, 'legend-complete-hide');
    const result = await runLiveMatrix(args, async ({ url }) => ({ status: url.includes('one') ? 'passed' : 'blocked' }));
    assert.equal(result.status, 'blocked');
    assert.equal(result.results.length, 2);
    console.log('PASS live matrix is sequential and preserves per-environment status');
})().catch(error => { console.error(error); process.exitCode = 1; });
