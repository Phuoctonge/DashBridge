'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('pages/options/options.html', 'utf8');
const source = fs.readFileSync('pages/options/options.js', 'utf8');

assert.match(html, /id="optionsDirtyStatus"[^>]*role="status"/,
    'Options must expose the unsaved state as a polite status');
assert.match(source, /addEventListener\(['"](?:input|change)['"],\s*markDirty/,
    'Options controls must mark the form dirty after user edits');
assert.match(source, /beforeunload[\s\S]*preventDefault\(\)/,
    'Options must guard navigation while changes are unsaved');
assert.match(source, /setDirty\(false\)/,
    'Successful save must clear the dirty state');

console.log('Options dirty-state behavior passed');
