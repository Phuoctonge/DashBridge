'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const scope = { Blob, DOMException };
vm.createContext(scope);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-report-collage.js', 'utf8'), scope);
const collage = scope.DashBridgeReportCollage;
const source = title => ({ title, width: 1000, height: 520, blob: new Blob(['png'], { type: 'image/png' }) });
(async () => {
    for (const count of [1, 2, 3, 4, 8]) {
        const grid = collage.geometry(count);
        assert.equal(grid.columns, count <= 2 ? 1 : 2);
        assert(grid.width * grid.height <= collage.limits.pixels);
        assert.equal(collage.geometry(count, 'column').columns, 1);
    }
    assert.throws(() => collage.geometry(0));
    assert.throws(() => collage.geometry(9));
    assert.throws(() => collage.geometry(4, 'bad'));
    const drawings = [];
    let closes = 0;
    const canvas = {
        getContext: () => ({ fillRect() {}, fillText() {}, measureText: text => ({ width: text.length * 12 }),
            drawImage: (bitmap, x, y) => drawings.push([bitmap.id, x, y]) }),
        toBlob: callback => callback(new Blob(['collage'], { type: 'image/png' }))
    };
    let id = 0;
    const options = { documentRef: { createElement: () => canvas }, decode: async () => ({
        id: ++id, width: 1000, height: 520, close: () => { closes++; }
    }) };
    const result = await collage.compose(['a', 'b', 'c', 'd'].map(source), options);
    assert.equal(result.width, 2048);
    assert.equal(result.height, 1184);
    assert.deepEqual(drawings, [[1, 16, 64], [2, 1032, 64], [3, 16, 648], [4, 1032, 648]]);
    assert.equal(closes, 4);
    assert.equal(canvas.width, 0, 'canvas memory released');
    const abort = new AbortController();
    await assert.rejects(collage.compose([source('a')], { ...options, signal: abort.signal,
        decode: async () => { abort.abort(); return { width: 1000, height: 520, close: () => { closes++; } }; }
    }), { name: 'AbortError' });
    assert.equal(closes, 5, 'bitmap released on abort after decode');
    await assert.rejects(collage.compose([source('a')], { ...options, decode: async () => { throw new Error('decode'); } }), /decode/);
    assert.equal(canvas.height, 0);
    canvas.toBlob = callback => callback(null);
    await assert.rejects(collage.compose([source('a')], options), /PNG/);
    await assert.rejects(collage.compose([{ ...source('a'), width: 999 }], options), /PNG/);
    await assert.rejects(collage.compose([{ ...source('a'), blob: { type: 'image/png', size: collage.limits.bytes + 1 } }], options), /64/);
    console.log('PASS collage geometry, placement, limits, decode/encode failures and resource cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
