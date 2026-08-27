'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
const match = source.match(/    const restoreMemByteUnit = data => \{[\s\S]*?\n    \};/);
assert(match, 'restoreMemByteUnit implementation must exist');

const context = {
    Number,
    tools: { totalKeyword: 'total', availKeyword: 'available' },
    getFieldText: field => [
        field.name,
        field.config?.displayName,
        field.config?.displayNameFromDS,
        ...Object.values(field.labels || {})
    ].filter(Boolean).join(' ').toLowerCase()
};
vm.createContext(context);
vm.runInContext(`${match[0]}\nthis.restoreMemByteUnit = restoreMemByteUnit;`, context);

const response = {
    results: {
        A: {
            frames: [{
                schema: { fields: [
                    { name: 'Time', type: 'time', config: {} },
                    { name: 'server01 Total', type: 'number', config: { unit: 'percent' } },
                    { name: 'server01 Available', type: 'number', config: { unit: 'percent' } },
                    { name: 'CPU Total', type: 'string', config: { unit: 'percent' } },
                    { name: 'Unrelated metric', type: 'number', config: { unit: 'percent' } }
                ] },
                data: { values: [
                    [1, 2],
                    [12_429_058_048, 12_429_058_048],
                    [8_201_191_424, 8_201_191_424],
                    ['all', 'all'],
                    [42, 43]
                ] }
            }]
        }
    }
};

const result = context.restoreMemByteUnit(response);
const fields = response.results.A.frames[0].schema.fields;
assert.strictEqual(result.modifiedCount, 2);
assert.strictEqual(fields[1].config.unit, 'bytes');
assert.strictEqual(fields[2].config.unit, 'bytes');
assert.strictEqual(fields[3].config.unit, 'percent', 'non-numeric Total fields must not be changed');
assert.strictEqual(fields[4].config.unit, 'percent', 'unrelated numeric fields must not be changed');

console.log('PASS disabling RAM conversion restores byte units without changing unrelated series');
