'use strict';
const assert = require('node:assert/strict');
const { snapshotPanel } = require('./panel-probe');

(async () => {
    const page = { evaluate: async (_fn, selector) => {
        assert.equal(selector, '[data-panelid="12"]');
        return { id: '12', title: 'CPU', labels: ['CPU user'], width: 800, height: 400, uplotCount: 1, flotCount: 0 };
    } };
    const result = await snapshotPanel(page, '[data-panelid="12"]');
    assert.deepEqual(result, { id: '12', title: 'CPU', renderer: 'uplot', labels: ['CPU user'], width: 800, height: 400 });
    console.log('PASS live panel probe returns bounded DOM facts');
})().catch(error => { console.error(error); process.exitCode = 1; });
