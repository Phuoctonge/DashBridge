'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pending = [];
const area = { set(value) { return new Promise(resolve => pending.push({ value, resolve })); } };
const context = { structuredClone };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'storage-writer.js'), 'utf8'), context);
(async () => {
    const writer = context.DashBridgeStorageWriter.create(area);
    const state = { value: 1 };
    const first = writer.write(state);
    state.value = 99;
    const second = writer.write({ value: 2 });
    const third = writer.write({ value: 3 });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(pending.length, 1, 'writes must be serialized');
    assert.strictEqual(pending[0].value.value, 1, 'queued write must use a snapshot');
    pending.shift().resolve();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].value.value, 3, 'pending writes must coalesce to the newest snapshot');
    let flushResolved = false;
    const flush = writer.flush().then(() => { flushResolved = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(flushResolved, false, 'flush must wait while the newest snapshot is still in flight');
    pending.shift().resolve();
    const [secondResult, thirdResult] = await Promise.all([second, third]);
    await flush;
    assert.strictEqual(flushResolved, true, 'flush must resolve after the newest snapshot is committed');
    assert.strictEqual(secondResult.current, false);
    assert.strictEqual(thirdResult.current, true);
    assert.strictEqual(writer.committedRevision, 3);
    assert.strictEqual(writer.dirty, false);

    const durablePending = [];
    const durableWriter = context.DashBridgeStorageWriter.create(area, {
        durableWrite(value, revision) {
            return new Promise(resolve => durablePending.push({ value, revision, resolve }));
        }
    });
    durableWriter.write({ value: 'first' });
    durableWriter.write({ value: 'latest' });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(durablePending.length, 1, 'only the in-flight revision is sent normally');
    const checkpoint = durableWriter.checkpoint();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(durablePending.length, 2, 'checkpoint sends the newest pending revision without waiting for unload');
    assert.strictEqual(durablePending[1].revision, 2);
    assert.strictEqual(durablePending[1].value.value, 'latest');
    durablePending[1].resolve();
    assert.strictEqual((await checkpoint).queued, true);
    durablePending[0].resolve();
    console.log('PASS storage writer serializes revisions and snapshots values');
})().catch(error => { console.error(error); process.exit(1); });
