#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const budgetPath = path.join(__dirname, 'module-size-budgets.json');
const budgets = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const normalize = value => value.split(path.sep).join('/');

const collectJavaScript = directory => {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...collectJavaScript(absolute));
        else if (entry.name.endsWith('.js')) result.push(absolute);
    }
    return result;
};

const files = [
    ...collectJavaScript(path.join(root, 'js')),
    ...collectJavaScript(path.join(root, 'pages')),
];
const known = new Set(files.map(file => normalize(path.relative(root, file))));
const errors = [];
const staleExceptions = [];
let exceptionalFiles = 0;

for (const [file, budget] of Object.entries(budgets.exceptions || {})) {
    if (!known.has(file)) errors.push(`size exception references missing production module: ${file}`);
    if (!String(budget.reason || '').trim()) errors.push(`size exception has no reason: ${file}`);
}

for (const absolute of files) {
    const file = normalize(path.relative(root, absolute));
    const source = fs.readFileSync(absolute, 'utf8');
    const lines = source.length ? source.split(/\r?\n/).length : 0;
    const bytes = Buffer.byteLength(source, 'utf8');
    const exception = budgets.exceptions?.[file];
    const budget = exception || budgets.default;
    if (exception) {
        exceptionalFiles += 1;
        if (lines <= budgets.default.maxLines && bytes <= budgets.default.maxBytes) {
            staleExceptions.push(file);
        }
    }
    if (lines > budget.maxLines || bytes > budget.maxBytes) {
        errors.push(`${file}: ${lines}/${budget.maxLines} lines, ${bytes}/${budget.maxBytes} bytes`);
    }
}

if (staleExceptions.length) {
    errors.push(`remove obsolete size exception(s): ${staleExceptions.join(', ')}`);
}

if (errors.length) {
    errors.forEach(error => console.error(`[ERROR] ${error}`));
    process.exit(1);
}

console.log(`[OK] Module boundaries: ${files.length} production JS, ${exceptionalFiles} documented size exceptions`);
