'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
const start = source.indexOf('const getFieldText =');
const end = source.indexOf('    const restoreMemByteUnit =', start);
assert(start >= 0 && end > start, 'RAM transform must remain independently testable');

const context = {
    tools: {
        totalKeyword: 'total',
        availKeyword: 'available',
        trimDomainEnabled: false,
        trimDomain: ''
    }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.transformMem = transformMemData;`, context);

const frame = (name, instance, values) => ({
    schema: { fields: [
        { name: 'Time', type: 'time' },
        { name, type: 'number', labels: { instance }, config: { displayName: name } }
    ] },
    data: { values: [[1, 2], values] }
});
const clone = value => JSON.parse(JSON.stringify(value));

const missingAvailable = { results: { T: { frames: [frame('server-01 total', 'server-01', [100, 100])] } } };
const missingAvailableBefore = clone(missingAvailable);
const missingAvailableResult = context.transformMem(missingAvailable);
assert.strictEqual(missingAvailableResult.applied, false);
assert.strictEqual(missingAvailableResult.reason, 'incomplete-pair');
assert.deepStrictEqual(missingAvailable, missingAvailableBefore,
    'a Total-only response must remain byte-for-byte unchanged');

const missingTotal = { results: { A: { frames: [frame('server-01 available', 'server-01', [40, 25])] } } };
const missingTotalBefore = clone(missingTotal);
assert.strictEqual(context.transformMem(missingTotal).applied, false);
assert.deepStrictEqual(missingTotal, missingTotalBefore,
    'an Available-only response must remain byte-for-byte unchanged');

const mixedServers = { results: {
    T: { frames: [
        frame('server-01 total', 'server-01', [100, 100]),
        frame('server-02 total', 'server-02', [200, 200])
    ] },
    A: { frames: [frame('server-01 available', 'server-01', [40, 25])] }
} };
const mixedServersBefore = clone(mixedServers);
assert.strictEqual(context.transformMem(mixedServers).applied, false);
assert.deepStrictEqual(mixedServers, mixedServersBefore,
    'conversion must be atomic when one of several servers has no complete pair');

const complete = { results: {
    T: { frames: [frame('server-01 total', 'server-01', [100, 100])] },
    A: { frames: [frame('server-01 available', 'server-01', [40, 25])] },
    X: { frames: [frame('requests', 'server-01', [7, 9])] }
} };
const completeResult = context.transformMem(complete);
assert.strictEqual(completeResult.applied, true);
assert.strictEqual(completeResult.modifiedCount, 1);
const frames = Object.values(complete.results).flatMap(result => result.frames);
const calculated = frames.find(item => item.schema.fields.some(field => /Used % \(calc\)/.test(field.name)));
assert(calculated, 'a complete pair must still be converted');
assert.deepStrictEqual(Array.from(calculated.data.values[1]), [60, 75]);
assert(frames.some(item => item.schema.fields.some(field => field.name === 'requests')),
    'unrelated series must survive a successful RAM conversion');

context.tools.availKeyword = 'consumed';
context.tools.memCalcMode = 'used';
const customUsed = { results: {
    T: { frames: [frame('server-03 total', 'server-03', [200, 200])] },
    U: { frames: [frame('server-03 consumed', 'server-03', [40, 100])] }
} };
assert.strictEqual(context.transformMem(customUsed).applied, true);
const customUsedFrame = Object.values(customUsed.results).flatMap(result => result.frames)
    .find(item => item.schema.fields.some(field => /Used % \(calc\)/.test(field.name)));
assert.deepStrictEqual(Array.from(customUsedFrame.data.values[1]), [20, 50],
    'explicit Used mode must support a custom second-series name that does not contain "used"');

assert(source.includes('memoryConversionFailed')
    && source.includes("skipped: 'memory-conversion-not-applied'")
    && source.includes('if (!memoryConversionFailed) filterLegendData(scopedData);'),
    'percent filters and converted-name allowlists must fail open when RAM conversion is not applied');
assert(source.includes('memoryConversionApplied')
    && source.includes('thresholdCanApply'),
    'the percent threshold must wait for a successfully converted RAM response');

console.log('PASS RAM conversion is atomic and downstream percent features fail open');
