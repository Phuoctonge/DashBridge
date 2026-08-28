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
const result = JSON.parse(JSON.stringify(context.collectResponseReportSeriesStatsForTest(data)));
const records = result.records;
assert.deepStrictEqual(records, [
    { name: 'host-a', count: 2, min: 10, max: 12, sum: 22, latest: 12 },
    { name: 'host-b', count: 2, min: 20, max: 22, sum: 42, latest: 22 },
    { name: 'host-c', count: 2, min: 30, max: 35, sum: 65, latest: 35 },
    { name: 'host-d', count: 1, min: 40, max: 40, sum: 40, latest: 40 }
], 'wide and long Grafana frames must produce bounded per-series report statistics');
assert.strictEqual(result.truncated, 0, 'complete datasource responses must not be marked as truncated');

const duplicateFrames = context.collectResponseReportSeriesStatsForTest({
    results: { A: { frames: [
        frame([{ name: 'duplicate', type: 'number' }], [[1, 2]]),
        frame([{ name: 'duplicate', type: 'number' }], [[10, 20]])
    ] } }
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(duplicateFrames.records)), [
    { name: 'duplicate', count: 2, min: 1, max: 2, sum: 3, latest: 2 },
    { name: 'duplicate', count: 2, min: 10, max: 20, sum: 30, latest: 20 }
], 'equal labels from separate Grafana frames must remain separate report series');

const manyNames = Array.from({ length: 20001 }, (_, index) => `series-${index}`);
const manyValues = Array.from({ length: 20001 }, (_, index) => index);
const bounded = context.collectResponseReportSeriesStatsForTest({
    results: { A: { frames: [frame([
        { name: 'Metric', type: 'string' },
        { name: 'Value', type: 'number' }
    ], [manyNames, manyValues])] } }
});
assert.strictEqual(bounded.records.length, 20000, 'the cache must use an explicit high-volume series cap');
assert.strictEqual(bounded.truncated, 1, 'the cache must report every omitted series');
assert(!Object.prototype.hasOwnProperty.call(bounded.records[0], 'values'),
    'the cache must retain aggregates rather than complete point arrays');

assert(toolsSource.includes('const observeNativeFetchResponse = (response, requestBody, request) =>')
    && toolsSource.includes('isDashboardIframe || transformActive')
    && toolsSource.includes('cacheReportResponse(decoded.data, body, request)')
    && toolsSource.includes("if (status === 'loading') return null;")
    && toolsSource.includes('reportCycle.active.size')
    && !toolsSource.includes('refreshSelectedPanelData(targetPanel')
    && !toolsSource.includes('dashbridgePanelReportDataCaptured'),
    'report generation must passively observe the iframe\'s normal datasource request without refreshing it');
assert(visualSource.includes("engine = 'response'")
    && visualSource.includes('responseReportSeriesStats')
    && visualSource.includes('evaluateStats(record.stats)')
    && visualSource.includes('responseReportTruncated')
    && visualSource.includes('const allSeries = records.map'),
    'the report evaluator must prefer bounded datasource statistics over chart runtime data');

assert(!toolsSource.includes('responseReportRecords')
    && !visualSource.includes('responseReportRecords'),
    'the persistent report cache must not retain complete point arrays');

console.log('PASS report generation passively captures bounded Grafana datasource statistics');
