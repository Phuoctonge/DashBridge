'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('pages/worklog/worklog.js', 'utf8');
assert.match(source, /worklogs\.length === 0[\s\S]*Нет записей/,
    'Worklog must render an actionable empty state when there are no rows');
console.log('Worklog empty-state behavior passed');
