'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-data-transforms.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-data-runtime.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
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

const keywordCollision = { results: {
    T: { frames: [frame('server-01 total', 'server-01', [100, 100])] },
    A: { frames: [frame('server-01 available', 'server-01', [40, 25])] },
    X: { frames: [frame('free slots', 'server-01', [7, 9])] },
    Y: { frames: [frame('total_requests', 'server-01', [11, 13])] },
    Z: { frames: [frame('available_connections', 'server-01', [3, 4])] }
} };
context.transformMem(keywordCollision);
const keywordCollisionFrames = Object.values(keywordCollision.results).flatMap(result => result.frames);
assert(keywordCollisionFrames.some(item => item.schema.fields.some(field => field.name === 'free slots')),
    'a free-named unrelated series must survive RAM conversion');
assert(keywordCollisionFrames.some(item => item.schema.fields.some(field => field.name === 'total_requests')),
    'an underscore-named unrelated series must survive RAM conversion');
assert(keywordCollisionFrames.some(item => item.schema.fields.some(field => field.name === 'available_connections')),
    'an underscore-named available series must survive RAM conversion');

// Grafana 10 Prometheus response: Used is an expression named Value, while
// Total/Available retain __name__. All three carry the same remaining labels.
const memoryFrame = (role, values, overrides = {}) => {
    const result = frame(role === 'Used' ? 'Value' : `node_memory_Mem${role}_bytes`, 'vm-01:9182', values);
    const field = result.schema.fields[1];
    field.labels = { instance: 'vm-01:9182', job: 'node', vm_name: 'vm-01', zone: 'production',
        ...(role === 'Used' ? {} : { __name__: field.name }), ...(overrides.labels || {}) };
    field.config = { displayNameFromDS: `vm-01:9182 ${role}`, ...(overrides.config || {}) };
    if (overrides.time) result.data.values[0] = overrides.time;
    return result;
};
const threeSeries = () => ({ results: {
    U: { frames: [memoryFrame('Used', [55, 70])] },
    A: { frames: [memoryFrame('Available', [40, 25])] },
    T: { frames: [memoryFrame('Total', [100, 100])] }
} });
const coherent = threeSeries();
assert.strictEqual(context.transformMem(coherent).applied, true);
const coherentFrames = Object.values(coherent.results).flatMap(result => result.frames);
assert.strictEqual(coherentFrames.length, 1,
    'related original Used bytes must be replaced together with Total/Available');
assert.deepStrictEqual(Array.from(coherentFrames[0].data.values[1]), [60, 75],
    'Available-based conversion must retain its formula even when original Used differs');
assert.strictEqual(coherentFrames[0].schema.fields[1].config.unit, 'percent');
assert.strictEqual(coherentFrames[0].schema.fields[1].config.displayNameFromDS, 'vm-01:9182 Used % (calc)',
    'response/report name collectors must receive the calculated identity instead of stale Available');

const unrelatedUsed = threeSeries();
unrelatedUsed.results.X = { frames: [
    memoryFrame('Used', [7, 9], { config: { displayNameFromDS: 'vm-01:9182 Used requests' } }),
    memoryFrame('Used', [8, 10], { labels: { job: 'another-job' } }),
    memoryFrame('Used', [20, 30], { config: { unit: 'percent' } })
] };
const unrelatedBefore = clone(unrelatedUsed.results.X);
context.transformMem(unrelatedUsed);
assert.deepStrictEqual(unrelatedUsed.results.X, unrelatedBefore,
    'Used text alone, different complete labels or explicit percent units must not remove unrelated fields');

const misalignedUsed = threeSeries();
misalignedUsed.results.U.frames[0].data.values[0] = [2, 3];
const misalignedBefore = clone(misalignedUsed);
assert.strictEqual(context.transformMem(misalignedUsed).applied, false);
assert.deepStrictEqual(misalignedUsed, misalignedBefore,
    'a related Used series with incompatible timestamps must fail open atomically');

const ambiguousUsed = threeSeries();
ambiguousUsed.results.U.frames.push(memoryFrame('Used', [60, 75]));
const ambiguousBefore = clone(ambiguousUsed);
assert.strictEqual(context.transformMem(ambiguousUsed).applied, false);
assert.deepStrictEqual(ambiguousUsed, ambiguousBefore,
    'multiple related original Used fields must fail open atomically');

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
