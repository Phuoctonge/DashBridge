'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ URL, URLSearchParams });
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-variables-state.js', 'utf8'), context);
const api = context.DashBridgeVariablesState;
const first = 'https://example.test/grafana/d-solo/uid/name?panelId=1&orgId=2&from=now-1h&timezone=Europe%2FMoscow&var-x=old&var-other=a#keep';
assert.equal(api.scope(first), api.scope(first.replace('panelId=1', 'panelId=4').replace('/d-solo/', '/d/')));
for (const other of [first.replace('orgId=2', 'orgId=3'), first.replace('/grafana/', '/other/'), first.replace('/uid/', '/else/'), first.replace('example.test', 'other.test')]) {
    assert.notEqual(api.scope(first), api.scope(other));
}
assert.equal(api.scope('javascript:alert(1)'), null);
assert.notEqual(api.scope('https://example.test/d/u/name'), api.scope('https://example.test/d/u/name?orgId=1'));
assert.equal(api.scope('https://user:pass@example.test/d/x/name'), null);
const field = { name: 'x', label: 'Выбор', values: ['a,b', 'с + d'], texts: [], multi: true, supported: true, includeAll: true, options: [] };
const changed = new URL(api.apply(first, [field]));
assert.deepEqual(changed.searchParams.getAll('var-x'), field.values);
assert.equal(changed.searchParams.get('var-other'), 'a');
assert.equal(changed.searchParams.get('from'), 'now-1h');
assert.equal(changed.searchParams.get('timezone'), 'Europe/Moscow');
assert.equal(changed.hash, '#keep');
const dependentUrl = api.resetDependents(first.replace('#keep', '&var-child=stale&var-leaf=old#keep'), [
    { name: 'x', dependencies: [] }, { name: 'child', dependencies: ['x'] },
    { name: 'leaf', dependencies: ['child'] }, { name: 'other', dependencies: [] }
], 'x');
assert.equal(new URL(dependentUrl).searchParams.has('var-child'), false);
assert.equal(new URL(dependentUrl).searchParams.has('var-leaf'), false);
assert.equal(new URL(dependentUrl).searchParams.get('var-other'), 'a');
assert.deepEqual(new URL(api.apply(first, [{ ...field, multi: false }])).searchParams.getAll('var-x'), ['a,b']);
assert.deepEqual(new URL(api.apply(first, [{ ...field, values: ['x', '$__all'] }])).searchParams.getAll('var-x'), ['$__all']);
assert.equal(new URL(api.apply(first, [{ ...field, skipUrlSync: true }])).searchParams.get('var-x'), 'old');
assert.ok(api.normalize({ variables: [field] }));
const manyHosts = Array.from({ length: 100 }, (_, index) => `instance-${index}.corporate-monitoring.example:9100`);
assert.throws(() => api.apply(first, [{ ...field, values: manyHosts }]), /4096/,
    'accepted variable snapshot must not produce an unpersistable panel URL');
const prefix = 'https://example.test/d-solo/u/name?panelId=1&var-x=';
assert.equal(api.apply(prefix + 'a', [{ ...field, values: ['a'.repeat(4096 - prefix.length)] }]).length, 4096);
assert.throws(() => api.apply(prefix + 'a', [{ ...field, values: ['a'.repeat(4097 - prefix.length)] }]), /4096/);
assert.equal(api.normalize({ variables: [field, field] }), null);
assert.equal(api.normalize({ variables: [{ ...field, values: [{}] }] }), null);
assert.equal(api.normalize({ variables: [{ ...field, options: [{ value: '<img>', text: {} }] }] }), null);
assert.equal(api.normalize({ variables: [{ ...field, options: Array(5001).fill({ value: 'a', text: 'a' }) }] }), null);
console.log('DashBridge variables URL scope, repeated values, All, bounds and hostile state: PASS');
