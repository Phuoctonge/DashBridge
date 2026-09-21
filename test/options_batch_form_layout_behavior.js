'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

const optionsCss = fs.readFileSync('pages/options/options.css', 'utf8');
const batchCss = fs.readFileSync('pages/batch/batch-workflow.css', 'utf8');
const batchController = fs.readFileSync('pages/batch/batch-page-controller.js', 'utf8');

assert.doesNotMatch(optionsCss, /\.analytics-delivery\s*\{[^}]*margin:\s*1rem\s+0\s+4rem/,
    'Analytics delivery must not reserve an empty four-rem bottom margin');
assert.match(batchCss, /#timestamps[\s\S]*overflow-y:\s*hidden/,
    'Main time ranges textarea must grow instead of showing an inner scrollbar');
assert.match(batchController, /autoResizeTextarea[\s\S]*scrollHeight/,
    'Batch page controller must size time range textareas from scrollHeight');
assert.match(batchController, /\['timestamps',\s*'seriesTimestamps'\]/,
    'Both time range fields must use the auto-resize behavior');

console.log('Options and Batch form layout behavior passed');
