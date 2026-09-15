'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeEvidence } = require('./evidence-writer');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-live-evidence-'));
const report = writeEvidence(root, {
    status: 'failed',
    secret: 'should-not-be-written',
    authorization: 'Bearer secret',
    events: Array.from({ length: 200 }, (_, index) => ({ index, message: 'x'.repeat(100) })),
});
assert.ok(report.path.startsWith(root));
assert.ok(report.bytes <= 16 * 1024);
const text = fs.readFileSync(report.path, 'utf8');
assert.equal(text.includes('should-not-be-written'), false);
assert.equal(text.includes('Bearer secret'), false);
assert.equal(JSON.parse(text).status, 'failed');
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS live evidence writer redacts and bounds reports');
