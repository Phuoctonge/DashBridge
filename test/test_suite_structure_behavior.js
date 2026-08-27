'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const entries = fs.readdirSync(__dirname, { withFileTypes: true });
const rootPython = entries.filter(entry => entry.isFile() && entry.name.endsWith('.py')).map(entry => entry.name);
assert.deepStrictEqual(rootPython.filter(file => !/^(?:audit|security|smoke)_.+\.py$/.test(file)), [],
    'root Python files must be discoverable tests; helpers belong in test/support');

const rootJavaScript = entries.filter(entry => entry.isFile() && entry.name.endsWith('.js')).map(entry => entry.name);
const expectedJavaScript = /^(?:.+_behavior|run-(?:all-tests|js-tests|python-smoke-tests)|analyze_e2e_.+|devtools-e2e-.+)\.js$/;
assert.deepStrictEqual(rootJavaScript.filter(file => !expectedJavaScript.test(file)), [],
    'root JavaScript files must be behavior tests, runners, or explicitly named diagnostic tools');

const forbiddenCaches = [];
const findCaches = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__pycache__' || entry.name === '.pytest_cache') forbiddenCaches.push(path.join(directory, entry.name));
        else if (entry.isDirectory()) findCaches(path.join(directory, entry.name));
    }
};
findCaches(__dirname);
assert.deepStrictEqual(forbiddenCaches, [], 'generated Python caches must not be stored in test/');
assert.ok(fs.existsSync(path.join(__dirname, 'support', 'smoke.py')), 'shared Python helpers must live in test/support');
console.log('PASS test suite structure and discovery conventions');
