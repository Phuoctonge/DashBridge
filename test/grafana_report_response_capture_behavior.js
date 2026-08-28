'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const toolsSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'),
    'utf8'
);
const visualSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'),
    'utf8'
);
const helperStart = toolsSource.indexOf('    const getResponseTableFrameShape');
const helperEnd = toolsSource.indexOf('    const collectResponseFilterVisibleNames', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'response report extractor must remain testable');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(
    `${toolsSource.slice(helperStart, helperEnd)}
globalThis.collectResponseReportSeriesStatsForTest = collectResponseReportSeriesStats;`,
    context
);

const frame = (fields, values, name = '') => ({
    schema: { name, refId: 'A', fields },
    data: { values }
});
const data = {
    results: {
        A: {
            frames: [
                frame([
                    { name: 'Time', type: 'time' },
                    { name: 'Value', type: 'number', labels: { instance: 'host-a' } },
                    { name: 'Value', type: 'number', labels: { instance: 'host-b' } }
                ], [[1, 2], [10, 12], [20, 22]]),
                frame([
                    { name: 'Time', type: 'time' },
                    { name: 'Metric', type: 'string' },
                    { name: 'Value', type: 'number' }
                ], [[1, 2, 3], ['host-c', 'host-d', 'host-c'], [30, 40, 35]])
            ]
        }
    }
};
const records = JSON.parse(JSON.stringify(context.collectResponseReportSeriesStatsForTest(data)));
assert.deepStrictEqual(records, [
    { name: 'host-a', count: 2, min: 10, max: 12, sum: 22, latest: 12 },
    { name: 'host-b', count: 2, min: 20, max: 22, sum: 42, latest: 22 },
    { name: 'host-c', count: 2, min: 30, max: 35, sum: 65, latest: 35 },
    { name: 'host-d', count: 1, min: 40, max: 40, sum: 40, latest: 40 }
], 'wide and long Grafana frames must produce bounded per-series report statistics');

const manyNames = Array.from({ length: 6000 }, (_, index) => `series-${index}`);
const manyValues = Array.from({ length: 6000 }, (_, index) => index);
const bounded = context.collectResponseReportSeriesStatsForTest({
    results: { A: { frames: [frame([
        { name: 'Metric', type: 'string' },
        { name: 'Value', type: 'number' }
    ], [manyNames, manyValues])] } }
});
assert.strictEqual(bounded.length, 5000, 'the cache must cap panels with thousands of series');
assert(!Object.prototype.hasOwnProperty.call(bounded[0], 'values'),
    'the cache must retain aggregates rather than complete point arrays');

assert(toolsSource.includes('const observeNativeFetchResponse = (response, requestBody, request) =>')
    && toolsSource.includes('isDashboardIframe || transformActive')
    && toolsSource.includes('cacheReportResponse(decoded.data, body)')
    && !toolsSource.includes('refreshSelectedPanelData(targetPanel')
    && !toolsSource.includes('dashbridgePanelReportDataCaptured'),
    'report generation must passively observe the iframe\'s normal datasource request without refreshing it');
assert(visualSource.includes("engine = 'response'")
    && visualSource.includes('responseReportSeriesStats')
    && visualSource.includes('evaluateStats(record.stats)'),
    'the report evaluator must prefer bounded datasource statistics over chart runtime data');

assert(!toolsSource.includes('responseReportRecords')
    && !visualSource.includes('responseReportRecords'),
    'the persistent report cache must not retain complete point arrays');

console.log('PASS report generation passively captures bounded Grafana datasource statistics');
