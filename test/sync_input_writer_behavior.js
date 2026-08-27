'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let nextTimer = 1;
const timers = new Map();
const writes = [];
const context = {
    console,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: {
        runtime: { lastError: null },
        storage: { sync: { set(values, callback) { writes.push(values); callback(); } } }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'sync-input-writer.js'), 'utf8'), context);

(async () => {
    const writer = context.DashBridgeSyncInputWriter.create({ key: 'filter', delay: 500 });
    for (let index = 0; index < 500; index += 1) writer.schedule(`value-${index}`);
    assert.strictEqual(timers.size, 1, 'repeated input must have only one pending timer');
    const timer = [...timers.values()][0];
    timers.clear();
    timer();
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].filter, 'value-499');

    writer.schedule('blur-value');
    await writer.flush();
    assert.strictEqual(writes.at(-1).filter, 'blur-value');
    assert.strictEqual(writer.pending, false);
    console.log('PASS debounced sync input writer coalesces input and flushes the latest value');
})().catch(error => { console.error(error); process.exit(1); });
