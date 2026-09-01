'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-diagnostic-diff.js', 'utf8'), context);

const before = {
    at: 100,
    panelImage: { hash: 'panel-before', width: 100, height: 50, dataUrl: 'data:image/png;base64,AAAA' },
    series: [{ index: 0, label: 'CPU', value: 10 }],
    interceptor: { events: [{ id: 1, stage: 'request-start' }] },
    domSnapshot: { root: { outerHTMLHash: 'dom-before', outerHTMLBytes: 20 } },
};
const after = {
    at: 175,
    panelImage: { hash: 'panel-after', width: 100, height: 50, dataUrl: 'data:image/png;base64,BBBB' },
    series: [{ index: 0, label: 'CPU', value: 20 }],
    interceptor: { events: [{ id: 1, stage: 'request-start' }, { id: 2, stage: 'transform' }] },
    domSnapshot: { root: { outerHTMLHash: 'dom-after', outerHTMLBytes: 24 } },
};

const diff = context.buildRuntimeDiagnosticDiff(before, after);
assert.equal(diff.schema, 'dashbridge-e2e-runtime-diff/v1');
assert.equal(diff.elapsedMs, 75);
assert.equal(diff.changed, true);
assert.equal(diff.images.panel.before.hash, 'panel-before');
assert.equal(diff.images.panel.after.hash, 'panel-after');
assert.equal(diff.network.addedEvents.length, 1);
assert.equal(diff.network.addedEvents[0].id, 2);
assert.equal(diff.seriesChanges.length, 1);
assert.equal(diff.dom.changed, true);
assert(diff.changes.every(change => change.before?.imagePayload !== true && change.after?.imagePayload !== true),
    'image payloads must be represented by descriptors instead of duplicated base64');

const unchanged = context.buildRuntimeDiagnosticDiff(before, before);
assert.equal(unchanged.changed, false);
assert.equal(unchanged.changeCount, 0);

console.log('PASS test runner diagnostic diff stays bounded and machine-readable');
