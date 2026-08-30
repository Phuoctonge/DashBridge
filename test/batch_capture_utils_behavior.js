'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    window: { atob: value => Buffer.from(value, 'base64').toString('binary') },
    crypto: { randomUUID: () => 'run-uuid' },
    Date,
    Math
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'pages/batch/batch-capture-utils.js'), 'utf8')}
globalThis.utils = BatchCaptureUtils;`, context);

const utils = context.utils;
const common = { panelId: '5', label: 'CPU [Load] / node', from: 'now-1h', to: 'now', runToken: 'run-a' };
const first = utils.buildCaptureFilename({ ...common, identity: 'https://grafana/d/u?var-node=node-01' });
const second = utils.buildCaptureFilename({ ...common, identity: 'https://grafana/d/u?var-node=node-02' });
assert.notStrictEqual(first, second, 'different dashboard variables must produce different capture names');
assert(!/[\[\]]/.test(first) && !/[\\/:*?"<>|]/.test(first), 'capture names must be accepted by Confluence and Windows');
assert(first.startsWith('panel-5_CPU_Load_node_now-1h_now_') && first.endsWith('.png'));
assert.strictEqual(first, utils.buildCaptureFilename({ ...common, identity: 'https://grafana/d/u?var-node=node-01' }),
    'the same capture identity within a run has a stable filename');
assert.notStrictEqual(first, utils.buildCaptureFilename({ ...common, runToken: 'run-b', identity: 'https://grafana/d/u?var-node=node-01' }),
    'a repeated export gets a new suffix and cannot overwrite an earlier attachment');
assert(first.length <= 181, 'capture filenames remain within the extension download limit');
assert.strictEqual(utils.createRunToken(), 'run-uuid');
const reserve = utils.createFilenameFactory('run-a');
const reservedFirst = reserve({ ...common, identity: 'same' });
const reservedSecond = reserve({ ...common, identity: 'same' });
assert.notStrictEqual(reservedFirst, reservedSecond, 'duplicate jobs inside one ZIP must never overwrite each other');
assert(reservedSecond.endsWith('_002.png'));
assert.strictEqual(utils.buildArchivePath({ filename: first, rangeCount: 1, from: 'now-1h', to: 'now' }), first,
    'a single time range must keep images in the ZIP root');
const localTimestamp = (year, month, day, hour, minute) => String(new Date(year, month - 1, day, hour, minute).getTime());
const archivePath = (rangeIndex, from, to) => utils.buildArchivePath({
    filename: first, rangeIndex, rangeCount: 3, from, to
});
assert.strictEqual(
    archivePath(0, localTimestamp(2026, 8, 27, 10, 0), localTimestamp(2026, 8, 27, 11, 0)),
    `01 [27.08] 10h00-11h00/${first}`,
    'a repeated date must appear only once'
);
assert.strictEqual(
    archivePath(1, localTimestamp(2026, 8, 27, 23, 0), localTimestamp(2026, 8, 28, 1, 0)),
    `02 [27.08 23h00] - [28.08 01h00]/${first}`,
    'different dates in the same month must both be visible'
);
assert.strictEqual(
    archivePath(2, localTimestamp(2026, 8, 31, 23, 0), localTimestamp(2026, 9, 1, 1, 0)),
    `03 [31.08 23h00] - [01.09 01h00]/${first}`,
    'different months must both be visible'
);
assert.strictEqual(archivePath(0, 'now-1h', 'now'), `01_fromnow-1h_tonow/${first}`,
    'relative Grafana ranges must remain readable');
const absoluteFolder = archivePath(0, localTimestamp(2026, 8, 27, 10, 15), localTimestamp(2026, 8, 27, 11, 45))
    .split('/')[0];
assert(!absoluteFolder.includes('2026') && !/\d{2}-\d{2}-\d{2}/.test(absoluteFolder),
    'absolute folders must omit years and seconds');
assert(!/[\\/:*?"<>|]/.test(absoluteFolder),
    'absolute range folders must remain valid Windows names');
console.log('PASS Batch capture filenames are unique and Confluence-safe');
