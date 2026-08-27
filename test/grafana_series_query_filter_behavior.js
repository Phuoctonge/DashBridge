'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const panelTools = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const cpuFilter = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-cpu-capacity-filter.js'), 'utf8');
const start = panelTools.indexOf('const getResponseTableFrameShape =');
const end = panelTools.indexOf('    const getFieldLegendNames', start);
assert(start >= 0 && end > start, 'generic response-series filter must remain independently testable');
assert(panelTools.includes("rawCandidate !== null && rawCandidate !== undefined && rawCandidate !== ''"),
    'URL bootstrap must not convert a missing raw threshold into zero');

const context = {
    tools: {
        seriesQueryFilterEnabled: true,
        seriesQueryFilterValue: 5,
        seriesQueryFilterRawValue: null,
        seriesQueryFilterMode: 'max'
    },
    getTargetPanel: () => null
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(cpuFilter, context);
vm.runInContext(`${panelTools.slice(start, end)}
globalThis.filterSeries = filterSeriesByThreshold;`, context);

const makeFrame = (name, values) => ({
    schema: {
        name, fields: [
            { name: 'Time', type: 'time' },
            { name, type: 'number', labels: { instance: name } }
        ]
    },
    data: { values: [[1, 2, 3], values] }
});
const response = {
    results: {
        A: {
            frames: [
                makeFrame('below', [1, 2, 3]),
                makeFrame('above', [2, 6, 4])
            ]
        }
    }
};
const result = context.filterSeries(response);
assert.strictEqual(result.metrics.beforeSeries, 2);
assert.strictEqual(result.metrics.removedSeries, 1);
assert.strictEqual(response.results.A.frames.length, 1);
assert.strictEqual(response.results.A.frames[0].schema.name, 'above');
const marker = response.results.A.frames[0].schema.fields[1].config.custom.__dashbridgeThresholdHighlight;
assert.strictEqual(marker.threshold, 5);
assert.strictEqual(marker.kind, 'series-query-filter');

context.tools.seriesQueryFilterMode = 'last';
const lastResponse = {
    results: {
        A: {
            frames: [
                makeFrame('old-spike', [9, 2, 2]),
                makeFrame('current-high', [1, 2, 7])
            ]
        }
    }
};
context.filterSeries(lastResponse);
assert.deepStrictEqual(lastResponse.results.A.frames.map(frame => frame.schema.name), ['current-high'],
    'last-value mode must ignore an old spike');

context.tools.seriesQueryFilterMode = 'max';
context.tools.seriesQueryFilterValue = 100;
const emptyResponse = {
    results: {
        A: {
            frames: [
                makeFrame('weak', [1, 2, 3]),
                makeFrame('strongest', [3, 8, 4])
            ]
        }
    }
};
const empty = context.filterSeries(emptyResponse);
assert.strictEqual(empty.metrics.safetyRetainedSeries, 0);
assert.deepStrictEqual(emptyResponse.results.A.frames.map(frame => frame.schema.name), [],
    'an empty threshold result must remain empty instead of showing an unrelated strongest series');

context.tools.seriesQueryFilterMode = 'last';
const lastFallbackResponse = {
    results: {
        A: {
            frames: [
                makeFrame('old-spike', [1000, 1]),
                makeFrame('latest-strongest', [10, 50])
            ]
        }
    }
};
context.filterSeries(lastFallbackResponse);
assert.deepStrictEqual(lastFallbackResponse.results.A.frames.map(frame => frame.schema.name), [],
    'last-value mode must also produce an empty result when no series exceeds the threshold');

context.tools.seriesQueryFilterMode = 'max';
context.tools.seriesQueryFilterValue = 5;
const equalThresholdResponse = {
    results: {
        A: {
            frames: [
                makeFrame('equal', [5]),
                makeFrame('above', [5.01])
            ]
        }
    }
};
context.filterSeries(equalThresholdResponse);
assert.deepStrictEqual(equalThresholdResponse.results.A.frames.map(frame => frame.schema.name), ['above'],
    'the displayed-series threshold remains strict and excludes a value equal to it');

const nonFiniteResponse = {
    results: {
        A: {
            frames: [
                makeFrame('null-only', [null, null]),
                makeFrame('nan-only', [Number.NaN]),
                makeFrame('finite', [1, 4])
            ]
        },
        Variable: {
            frames: [{
                schema: { fields: [{ name: 'Value', type: 'string' }] },
                data: { values: [['unchanged']] }
            }]
        }
    }
};
const nonFinite = context.filterSeries(nonFiniteResponse);
assert.strictEqual(nonFinite.metrics.safetyRetainedSeries, 0);
assert.deepStrictEqual(nonFiniteResponse.results.A.frames.map(frame => frame.schema.name), []);
assert.strictEqual(nonFiniteResponse.results.Variable.frames.length, 1,
    'variable-query frames without a time field must remain untouched');

const mixedFrame = {
    schema: {
        name: 'mixed', fields: [
            { name: 'Time', type: 'time' },
            { name: 'numeric', type: 'number' },
            { name: 'note', type: 'string' },
            { name: 'active', type: 'boolean' },
            { name: 'legacy-number' }
        ]
    },
    data: { values: [[1, 2], [1, 2], ['one', 'two'], [true, false], [6, 7]] }
};
const mixedResponse = { results: { A: { frames: [mixedFrame] } } };
const mixed = context.filterSeries(mixedResponse);
assert.deepStrictEqual(Array.from(mixedResponse.results.A.frames[0].schema.fields, field => field.name),
    ['Time', 'note', 'active', 'legacy-number'],
    'non-numeric fields remain intact while an untyped field with finite numbers stays filterable');
assert.strictEqual(mixed.metrics.beforeSeries, 2,
    'only explicit or safely inferred numeric fields participate in threshold metrics');
assert.strictEqual(mixed.metrics.thresholdMatchedSeries, 1);

const tableResponse = {
    results: {
        A: {
            frames: [{
                schema: { fields: [
                    { name: 'Metric', type: 'string' },
                    { name: 'Value', type: 'number' }
                ] },
                data: { values: [
                    ['equal', 'above', 'below'],
                    [5, 8, 1]
                ] }
            }]
        }
    }
};
context.filterSeries(tableResponse);
assert.deepStrictEqual(Array.from(tableResponse.results.A.frames[0].data.values[0]), ['above'],
    'Metric/Value table filtering must retain only names whose row value exceeds the threshold');
assert.deepStrictEqual(Array.from(tableResponse.results.A.frames[0].data.values[1]), [8],
    'table names and values must remain positionally correlated after filtering');

context.tools.seriesQueryFilterRawValue = 'invalid';
const invalidThresholdResponse = { results: { A: { frames: [makeFrame('unchanged', [100])] } } };
const invalidThreshold = context.filterSeries(invalidThresholdResponse);
assert.strictEqual(invalidThreshold.metrics.invalidThreshold, undefined,
    'an invalid raw threshold falls back to the configured display threshold');
assert.strictEqual(invalidThresholdResponse.results.A.frames.length, 1);
context.tools.seriesQueryFilterRawValue = null;

console.log('PASS displayed-series filter preserves max, last and honest empty-result contracts');
