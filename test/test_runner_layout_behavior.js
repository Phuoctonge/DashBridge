'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pages/test-runner/test-runner.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pages/test-runner/test-runner.css'), 'utf8');

for (const column of ['id', 'cat', 'name', 'status', 'details', 'dur']) {
    assert.match(html, new RegExp(`<col class="tr-col-${column}">`), `missing stable ${column} column`);
}
assert.match(css, /\.tr-results-table\s*\{[^}]*table-layout:\s*fixed;/s);
assert.match(css, /html\s*\{\s*scrollbar-gutter:\s*stable;\s*\}/);
assert.match(css, /#trProgressText\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);

console.log('PASS test runner live table layout remains stable');
