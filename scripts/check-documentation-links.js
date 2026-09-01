#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipped = new Set(['.git', '.gitnexus', 'dist', 'node_modules', 'test-results']);

const collectMarkdown = directory => {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && skipped.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...collectMarkdown(absolute));
        else if (entry.name.endsWith('.md')) result.push(absolute);
    }
    return result;
};

const errors = [];
const files = collectMarkdown(root);
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, '');
        const target = rawTarget.split('#', 1)[0];
        if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
        const resolved = path.resolve(path.dirname(file), decodeURI(target));
        const relative = path.relative(root, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            errors.push(`${path.relative(root, file)}: link escapes repository: ${rawTarget}`);
        } else if (!fs.existsSync(resolved)) {
            errors.push(`${path.relative(root, file)}: missing link target: ${rawTarget}`);
        }
    }
}

if (errors.length) {
    errors.forEach(error => console.error(`[ERROR] ${error}`));
    process.exit(1);
}

console.log(`[OK] Documentation links: ${files.length} Markdown files`);
