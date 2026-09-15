'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireProfileLock } = require('./profile-lock');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-live-lock-'));
const first = acquireProfileLock(root);
assert.throws(() => acquireProfileLock(root), /already locked/i);
first.release();
const second = acquireProfileLock(root);
second.release();
assert.equal(fs.existsSync(path.join(root, 'live.lock')), false);
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS live profile lock is exclusive and recoverable');
