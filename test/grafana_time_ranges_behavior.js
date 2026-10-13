'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Date, Number, String, Math, RegExp };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-time.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/shared/grafana-url.js', 'utf8'), context);

const parsed = context.normalizeGrafanaTimeRanges([
    '17.08.2026 09:30, 17/08/2026 18:00',
    '2026-08-17T09:30:00Z, 2026-08-17T18:00:00+03:00',
    '1786959000, 1786991400000',
    'now-1h, now',
].join('\n'));

assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.errors)), []);
assert.strictEqual(parsed.ranges.length, 4);
assert.strictEqual(parsed.ranges[0].from, String(new Date(2026, 7, 17, 9, 30).getTime()));
assert.strictEqual(parsed.ranges[1].from, '1786959000000');
assert.strictEqual(parsed.ranges[2].from, '1786959000000');
assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.ranges[3])), { from: 'now-1h', to: 'now' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.normalizeGrafanaTimeRanges('31.02.2026, now').errors)), [1]);

console.log('  ✓ Grafana time ranges normalize common date formats and Unix timestamps');
for (const input of [
    '1787791648851, 1787774259463',
    '2026-08-27 03:47:28, 2026-08-26 22:57:39',
    '2026-08-27T03:47:28.851+03:00, 2026-08-26T22:57:39.463+03:00',
]) {
    const result = context.normalizeGrafanaTimeRanges(input);
    assert.strictEqual(result.ranges.length, 0, 'reversed absolute range must not reach capture');
    assert.deepStrictEqual(Array.from(result.errors), [1]);
}
assert.strictEqual(context.normalizeGrafanaTimeRanges('1787774259463, 1787774259463').errors.length, 0);
for (const input of ['2026-02-30T12:00:00Z, now', '2026-02-29T12:00:00+03:00, now', '2026-04-31, now']) {
    assert.strictEqual(context.normalizeGrafanaTimeRanges(input).ranges.length, 0);
}
assert.strictEqual(context.parseGrafanaTimePoint('2024-02-29'), String(new Date(2024,1,29).getTime()));
assert.strictEqual(context.parseGrafanaTimePoint('01/02/2026'), String(new Date(2026,1,1).getTime()));
assert.strictEqual(context.normalizeGrafanaTimeRanges('now-1h, 1787774259463').errors.length,0);
