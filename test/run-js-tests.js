// Dependency-free JavaScript behavior-test runner.
'use strict';

const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const tests = readdirSync(__dirname, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('_behavior.js'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

if (process.argv.includes('--list')) {
    console.log(tests.join('\n'));
    process.exit(0);
}
if (!tests.length) {
    console.error('[FAIL] No JavaScript behavior tests were discovered');
    process.exit(2);
}

const failures = [];
for (const file of tests) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
        cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0) failures.push({ file, status: result.status, error: result.error });
}

if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} of ${tests.length} JavaScript test files failed`);
    failures.forEach(item => console.error(`  - ${item.file}${item.error ? `: ${item.error.message}` : ` (exit ${item.status})`}`));
    process.exit(1);
}
console.log(`\n[OK] ${tests.length} JavaScript test files passed`);
