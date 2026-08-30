'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('pages/worklog/worklog.js', 'utf8');
const context = {
    document: { addEventListener() {} },
    globalThis: null,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const calculate = context.DashBridgeWorklogMetrics?.calculateTotals;
assert.strictEqual(typeof calculate, 'function', 'Worklog totals must be independently testable');
const totals = calculate([
    { dateStarted: '24/08/2026 10:00', timeSpent: '2' },
    { dateStarted: '28/08/2026 10:00', timeSpent: '3' },
    { dateStarted: '17/08/2026 10:00', timeSpent: '8' },
], new Date(2026, 7, 24, 12, 0));
assert.deepStrictEqual(JSON.parse(JSON.stringify(totals)), { day: 2, week: 5 },
    'week total must include only the current Monday-Sunday interval');
assert(source.includes("showToast('Не удалось сохранить изменения. Повторите действие.', { type: 'error' })"),
    'storage failures must be rendered as errors, not as undo notifications');
assert(!source.includes('toast.innerHTML = `<span>${text}</span>'), 'toast text must not be inserted through innerHTML');

console.log('PASS Worklog calculates weekly totals and renders safe error notifications');
