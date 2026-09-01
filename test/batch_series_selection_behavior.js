const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const context = { window: {} };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages/batch/batch-series-selection.js'), 'utf8'), context);

const available = ['host-a', 'host-c', 'host-a'];
const result = context.BatchSeriesSelection.resolveExact(['host-a', 'host-b'], available);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    matches: [
        { name: 'host-a', key: 'host-a\u00000' },
        { name: 'host-a', key: 'host-a\u00001' }
    ],
    missing: ['host-b']
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.BatchSeriesSelection.resolveAll(available))), {
    matches: [
        { name: 'host-a', key: 'host-a\u00000' },
        { name: 'host-c', key: 'host-c\u00000' },
        { name: 'host-a', key: 'host-a\u00001' }
    ],
    missing: []
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.BatchSeriesSelection.resolveKeys(['host-a\u00001'], available))), {
    matches: [{ name: 'host-a', key: 'host-a\u00001' }],
    missing: []
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.BatchSeriesSelection.resolvePatterns(
    ['CPU', 'CPU Idle', 'Load', 'Test', 'cpu'],
    ' cpu | | LOAD ',
    'idle|test'
))), {
    matches: [
        { name: 'CPU', key: 'CPU\u00000' },
        { name: 'Load', key: 'Load\u00000' },
        { name: 'cpu', key: 'cpu\u00000' }
    ],
    missing: []
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.BatchSeriesSelection.resolvePatterns(
    ['CPU', 'CPU Idle', 'Load'],
    '',
    'idle'
))), {
    matches: [
        { name: 'CPU', key: 'CPU\u00000' },
        { name: 'Load', key: 'Load\u00000' }
    ],
    missing: []
});

const batchHtml = fs.readFileSync(path.join(__dirname, '..', 'pages/batch/batch.html'), 'utf8');
const batchSource = fs.readFileSync(
    path.join(__dirname, '..', 'pages/batch/batch-series-run-controller.js'),
    'utf8',
);
assert(batchHtml.includes('id="seriesIncludeFilter"') && batchHtml.includes('id="seriesIgnoreFilter"'),
    'Batch must expose include and ignore Series pattern fields');
assert(batchSource.includes('seriesSelection.resolvePatterns(')
    && batchSource.includes('discoveryResult.names, includePattern, ignorePattern'),
    'Batch must apply patterns to the actual Series discovered for every time slice');
assert(!batchSource.includes('series-checkbox'),
    'Batch must not depend on a concrete Series checkbox list');
console.log('[OK] Batch Series selection behavior');
