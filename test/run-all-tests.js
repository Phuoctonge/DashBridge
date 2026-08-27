// One local/CI entry point for every dependency-free DashBridge test.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const failures = [];
for (const runner of ['run-js-tests.js', 'run-python-smoke-tests.js']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, runner), ...process.argv.slice(2)], {
        cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0) failures.push(runner);
}
if (failures.length) {
    console.error(`\n[FAIL] Failed test runners: ${failures.join(', ')}`);
    process.exit(1);
}
console.log('\n[OK] All DashBridge test runners passed');
