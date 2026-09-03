'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/analytics-contract.js', 'utf8'), context);
const known = new Set([...context.DashBridgeAnalyticsContract.featureIds]);
const roots = ['js', 'pages'];
const files = [];
const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name.endsWith('.js')) files.push(target);
});
roots.forEach(visit);

const literalCall = /DashBridgeAnalytics\?*\.(?:track|opened|changed|outcome)\(\s*['"]([^'"]+)['"]/g;
const forbiddenDimension = /\b(?:url|domain|hostname|email|username|userName|displayName|title|panelId|profileId|jiraKey|text|error|message)\s*:/;
let calls = 0;
const callSource = (source, start) => {
    let depth = 0; let quote = ''; let escaped = false;
    for (let index = source.indexOf('(', start); index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '(') depth += 1;
        if (char === ')' && --depth === 0) return source.slice(start, index + 1);
    }
    return source.slice(start);
};
files.forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(literalCall)) {
        calls += 1;
        assert(known.has(match[1]), `${file} uses analytics feature outside the strict catalog: ${match[1]}`);
        const excerpt = callSource(source, match.index);
        assert(!forbiddenDimension.test(excerpt), `${file} appears to pass a forbidden analytics dimension near ${match[1]}`);
    }
});
assert(calls >= 40, 'privacy audit must continue to cover the feature instrumentation');
console.log(`PASS ${calls} literal analytics calls use catalogued features without sensitive dimensions`);
