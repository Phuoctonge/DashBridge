'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-unit.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

const unit = context.DashBridgeGrafanaUnit;
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
assert(unit && Object.isFrozen(unit), 'the unit parser API must be installed once as an immutable MAIN-world dependency');

assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('1.5 KiB')), { value: 1.5, unit: 'KiB', factor: 1024 });
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('2 MiB')), { value: 2, unit: 'MiB', factor: 1024 ** 2 });
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('3 GiB')), { value: 3, unit: 'GiB', factor: 1024 ** 3 });
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('4 TiB')), { value: 4, unit: 'TiB', factor: 1024 ** 4 });
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('2 MB/s')), { value: 2, unit: 'MB/s', factor: 1e6 });
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('3 K requests')), {
    value: 3, unit: 'requests', factor: null, displayScale: 1e3
});
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('3 K')), {
    value: 3, unit: '', factor: null, displayScale: 1e3
});
assert.deepStrictEqual(plain(unit.parseAxisUnitLabel('1,5 GiB')), { value: 1.5, unit: 'GiB', factor: 1024 ** 3 });
assert.strictEqual(unit.parseAxisUnitLabel('No data'), null);
assert.strictEqual(unit.parseAxisUnitLabel('10'), null);

assert.deepStrictEqual(plain(unit.inferUnitFromAxisLabels(['1 KiB', '2 KiB'], { min: 1024, max: 2048 })), {
    unit: 'KiB', factor: 1024
});
assert.deepStrictEqual(plain(unit.inferUnitFromAxisLabels(['0 K', '2 K'], { min: 0, max: 2000 })), {
    unit: '', factor: 1
});
assert.deepStrictEqual(plain(unit.inferUnitFromAxisTicks([
    { label: '0 MB', v: 0 },
    { label: '2 MB', v: 2e6 }
])), { unit: 'MB', factor: 1e6 });
assert.strictEqual(unit.inferUnitFromAxisTicks([{ label: 'No data', v: 1 }]), null);

assert.deepStrictEqual(plain(unit.unitFromPanelDefinition(null)), { unit: '', factor: 1, source: 'panel' });
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ fieldConfig: { defaults: { unit: 'short' } } })), {
    unit: '', factor: 1, source: 'panel'
});
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ fieldConfig: { defaults: { unit: 'percent' } } })), {
    unit: '%', factor: 1, source: 'panel', code: 'percent'
});
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ fieldConfig: { defaults: { unit: 'Bps' } } })), {
    unit: 'B/s', factor: 1, source: 'panel', code: 'Bps'
});
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ fieldConfig: { defaults: { unit: 'suffix: requests' } } })), {
    unit: ' requests', factor: 1, source: 'panel', code: 'suffix: requests'
});
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ yaxes: [{ format: 'reqps' }] })), {
    unit: 'req/s', factor: 1, source: 'panel', code: 'reqps'
});
assert.deepStrictEqual(plain(unit.unitFromPanelDefinition({ yaxes: [{ format: 'custom-code' }] })), {
    unit: 'custom-code', factor: 1, source: 'panel', code: 'custom-code'
});
assert.deepStrictEqual(plain(unit.mergeAxisAndPanelUnit({ unit: 'GiB', factor: 1024 ** 3 }, {
    fieldConfig: { defaults: { unit: 'bytes' } }
})), { unit: 'GiB', factor: 1024 ** 3, source: 'axis' });
assert.deepStrictEqual(plain(unit.mergeAxisAndPanelUnit({ unit: '', factor: 1 }, {
    fieldConfig: { defaults: { unit: 'percent' } }
})), { unit: '%', factor: 1, source: 'axis' });
assert.deepStrictEqual(plain(unit.mergeAxisAndPanelUnit({ unit: 'MB', factor: Number.NaN }, {
    fieldConfig: { defaults: { unit: 'bytes' } }
})), { unit: 'B', factor: 1, source: 'panel', code: 'bytes' });

vm.runInContext(source, context);
assert.strictEqual(context.DashBridgeGrafanaUnit, unit, 'repeated runtime installation must preserve the original API object');
console.log('PASS Grafana axis unit parsing is isolated behind a stable runtime API');
