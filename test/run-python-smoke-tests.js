// Dependency-free runner for standalone Python smoke/security/audit scripts.
'use strict';

const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const testPattern = /^(?:audit|security|smoke)_.+\.py$/;

function findPython() {
    const candidates = [];
    if (process.env.DASHBRIDGE_PYTHON) candidates.push({ command: process.env.DASHBRIDGE_PYTHON, prefix: [] });
    candidates.push(
        { command: 'python', prefix: [] },
        { command: 'python3', prefix: [] },
        { command: 'py', prefix: ['-3'] }
    );
    return candidates.find(candidate => {
        const probe = spawnSync(candidate.command, [...candidate.prefix, '--version'], {
            cwd: projectRoot, encoding: 'utf8', windowsHide: true,
        });
        return !probe.error && probe.status === 0;
    }) || null;
}

const files = readdirSync(__dirname, { withFileTypes: true })
    .filter(entry => entry.isFile() && testPattern.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

if (process.argv.includes('--list')) {
    console.log(files.join('\n'));
    process.exit(0);
}
if (!files.length) {
    console.error('[FAIL] No Python smoke/security/audit scripts were discovered');
    process.exit(2);
}

const python = findPython();
if (!python) {
    console.error('Python runtime not found. Set DASHBRIDGE_PYTHON to an executable path.');
    process.exit(2);
}

const results = files.map(file => {
    const result = spawnSync(python.command, [...python.prefix, path.join('test', file)], {
        cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    const passed = !result.error && result.status === 0;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`);
    if (!passed) {
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (output) console.error(output);
        if (result.error) console.error(result.error.message);
    }
    return { file, passed };
});

const failures = results.filter(item => !item.passed);
console.log(`\nPython checks: ${results.length - failures.length} passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
