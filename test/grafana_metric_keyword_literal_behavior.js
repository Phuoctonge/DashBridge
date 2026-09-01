'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-data-transforms.js', 'utf8');
const start = source.indexOf('const getFieldText =');
const end = source.indexOf('    const restoreMemByteUnit =', start);
assert(start >= 0 && end > start, 'CPU/RAM transforms must remain independently testable');

const context = {
    tools: {
        idleKeyword: 'idle[0]',
        totalKeyword: 'total[bytes]',
        availKeyword: 'available[bytes]',
        trimDomainEnabled: false,
        trimDomain: ''
    }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.transformCpu = transformCpuData;
globalThis.transformMem = transformMemData;
globalThis.trimDomains = trimResponseDomainLabels;`, context);

const field = (name, instance, values) => ({
    frame: {
        schema: { fields: [
            { name: 'Time', type: 'time' },
            { name, type: 'number', labels: { instance }, config: { displayName: name } }
        ] },
        data: { values: [[1, 2], values] }
    }
});

const cpu = field('server-01 idle[0]', 'server-01:9182', [90, 75]);
const cpuResponse = { results: { A: { frames: [cpu.frame] } } };
assert.doesNotThrow(() => context.transformCpu(cpuResponse),
    'a configured keyword is literal text and must not be parsed as a regular expression');
assert.strictEqual(cpuResponse.results.A.frames[0].schema.fields[1].name, 'server-01 load (calc)');
assert.deepStrictEqual(Array.from(cpuResponse.results.A.frames[0].data.values[1]), [10, 25]);

const total = field('server-01 total[bytes]', 'server-01:9182', [100, 100]);
const available = field('server-01 available[bytes]', 'server-01:9182', [40, 25]);
const memoryResponse = { results: { T: { frames: [total.frame] }, A: { frames: [available.frame] } } };
assert.doesNotThrow(() => context.transformMem(memoryResponse),
    'RAM keywords with punctuation must remain valid literal labels');
const calculated = Object.values(memoryResponse.results).flatMap(result => result.frames)
    .find(frame => frame.schema.fields.some(item => /Used % \(calc\)/.test(item.name)));
assert(calculated, 'a complete Total/Available pair must still produce the calculated series');
assert.deepStrictEqual(Array.from(calculated.data.values[1]), [60, 75]);

context.tools.trimDomainEnabled = true;
context.tools.trimDomain = '.passport.local:9182';
const generic = field(
    'server-02.passport.local:9182 Inbound',
    'server-02.passport.local:9182',
    [1, 2]
);
generic.frame.schema.name = 'server-02.passport.local:9182 network';
const genericResponse = { results: { N: { frames: [generic.frame] } } };
const trimmed = context.trimDomains(genericResponse);
assert(trimmed.modifiedCount >= 3);
assert.strictEqual(generic.frame.schema.name, 'server-02 network');
assert.strictEqual(generic.frame.schema.fields[1].name, 'server-02 Inbound');
assert.strictEqual(generic.frame.schema.fields[1].labels.instance, 'server-02');
assert.strictEqual(generic.frame.schema.fields[1].config.displayName, 'server-02 Inbound');

console.log('PASS Grafana metric keywords remain literal across panel response transforms');
