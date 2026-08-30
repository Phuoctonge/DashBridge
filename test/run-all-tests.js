// One local/CI entry point for every dependency-free DashBridge test.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const failures = [];
const runners = [
    [path.resolve(__dirname, '..', 'scripts', 'check-dependency-contracts.js')],
    [path.join(__dirname, 'run-js-tests.js'), ...process.argv.slice(2)],
    [path.join(__dirname, 'run-python-smoke-tests.js'), ...process.argv.slice(2)],
];
for (const args of runners) {
    const result = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0) failures.push(path.basename(args[0]));
}
if (failures.length) {
    console.error(`\n[FAIL] Failed test runners: ${failures.join(', ')}`);
    process.exit(1);
}
console.log('\n[OK] All DashBridge test runners passed');
