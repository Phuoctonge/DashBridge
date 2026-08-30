// Behavioral contracts for the E2E report model. These tests run without Chrome.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreCode = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'test-runner', 'test-runner-core.js'),
    'utf8'
);

assert(
    coreCode.includes('environmentUnsafe: result.environmentUnsafe === true,'),
    'core обязан получить сигнал небезопасного reset от сценария'
);

const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    URL,
    chrome: {},
    getTestFeatureReference: id => ({ label: `Feature ${id}` }),
});
vm.runInContext(`${coreCode}\nthis.__runner = DashBridgeTestRunner;`, context);

const { classifyRuntimeEvidence, makeNotRunTest } = context.__runner.__test;

const runtime = classifyRuntimeEvidence({
    events: [
        { level: 'error', args: ['DashBridge command failed'] },
        { level: 'error', args: ['Grafana datasource timeout'] },
        { level: 'warn', args: ['Slow panel'] },
    ],
});
assert.strictEqual(runtime.pass, false, 'ошибка DashBridge должна проваливать сценарий');
assert.strictEqual(runtime.dashBridgeErrorCount, 1);
assert.strictEqual(runtime.grafanaWarningCount, 1, 'ошибка Grafana остаётся диагностикой');
assert.strictEqual(runtime.warningCount, 1);

const notRun = makeNotRunTest(
    { id: 'H1', category: 'H', name: 'Матрица' },
    'прогон прерван пользователем'
);
assert.deepStrictEqual(
    { pass: notRun.pass, skip: notRun.skip, aborted: notRun.aborted, notRun: notRun.diagnostic.notRun },
    { pass: false, skip: false, aborted: true, notRun: true },
    'неисполненный тест не должен становиться PASS, FAIL или SKIP'
);
assert.match(notRun.details, /^Не запущен:/);
assert.strictEqual(notRun.feature.label, 'Feature H1');

console.log('[OK] Test runner reporting behavior');
