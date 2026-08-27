'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Date, Number, String, Math, RegExp };
vm.createContext(context);
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
