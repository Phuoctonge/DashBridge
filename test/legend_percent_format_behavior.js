const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/content/grafana-legend-visuals.js'), 'utf8');
const start = source.indexOf('const formatLast =');
const end = source.indexOf('            const tables =', start);
const format = vm.runInNewContext(`(() => { ${source.slice(start, end)} return formatLast; })()`);
const row = (native, name = 'name', hidden = false) => ({ querySelectorAll: () => [
    { textContent: name, dataset: {} },
    { textContent: native, dataset: {}, hidden },
    { textContent: '0 ms', dataset: { dashbridgeSummaryColumn: 'last' } }
] });
assert.equal(format(97.5, row('97.95%')), '97.50%');
assert.equal(format(0, row('97.95%')), '0.00%');
assert.equal(format(97.5, row('97.95 %', 'latency ms', true)), '97.50 %');
assert.equal(format(5, row('9 ops/m')), '5 ops/m');
assert.equal(format(494, row('2.62 s')), '494 ms');
console.log('PASS Last percentage precision, hidden native columns, and unit isolation');
