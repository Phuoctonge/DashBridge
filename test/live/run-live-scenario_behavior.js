'use strict';
const assert = require('node:assert/strict');
const { parseArgs } = require('./run-live-scenario');

const parsed = parseArgs(['--url', 'https://grafana.example/d/test?orgId=1', '--panelId', '8', '--hidden', 'A, B']);
assert.equal(parsed.panelId, '8');
assert.deepEqual(parsed.hidden, ['A', 'B']);
assert.equal(parsed.evidenceDir, null);
assert.throws(() => parseArgs(['--url', 'https://user:pass@grafana.example/d/test']), /without credentials/);
assert.throws(() => parseArgs(['--url', 'https://grafana.example/d/test', '--typo', 'value']), /Unknown live scenario option/);
console.log('PASS live scenario CLI validates URL and bounded arguments');
