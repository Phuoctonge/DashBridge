'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ Date, JSON, String, Number, Object, Array });
vm.runInContext(fs.readFileSync('pages/batch/batch-diagnostic-journal.js', 'utf8'), context);

const journal = context.BatchDiagnosticJournal.create({ enabled: true, runId: 'run-1', now: (() => {
    let value = 1000;
    return () => value += 25;
})() });
journal.record({ stage: 'run', event: 'started', details: { token: 'secret', nested: { authorization: 'hidden', ok: true } } });
journal.record({ stage: 'panel', event: 'found', jobId: 'job-1', panelId: 6, panelTitle: 'Memory' });
const events = journal.snapshot();
assert.equal(events.length, 2);
assert.deepEqual(Array.from(events, item => item.seq), [1, 2]);
assert.equal(events[0].runId, 'run-1');
assert.equal(events[1].panelId, '6');
assert.equal(events[0].details.token, '[REDACTED]');
assert.equal(events[0].details.nested.authorization, '[REDACTED]');
assert.equal(events[0].details.nested.ok, true);
assert.equal(journal.toJsonl().trim().split('\n').length, 2);

const disabled = context.BatchDiagnosticJournal.create({ enabled: false, runId: 'off' });
disabled.record({ stage: 'run', event: 'started' });
assert.equal(disabled.snapshot().length, 0);
assert.equal(disabled.toJsonl(), '');
console.log('PASS Batch diagnostic journal ordering, redaction and disabled mode');
