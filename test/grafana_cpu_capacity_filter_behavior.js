'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-cpu-capacity-filter.js'), 'utf8'), context);
const filter = context.DashBridgeGrafanaCpuCapacityFilter;

const request = {
    from: 'now-15m', to: 'now', queries: [
        { refId: 'A', expr: 'node_load1{project="one", instance=~"vm-(01|02|03):9182"}', datasource: { uid: 'prom-main' }, range: true },
        { refId: 'B', expr: 'node_load5{project="one", instance=~"vm-(01|02|03):9182"}', datasource: { uid: 'prom-main' }, range: true },
        { refId: 'C', expr: 'unrelated_metric{instance=~"vm-.*"}', datasource: { uid: 'prom-main' }, range: true }
    ]
};
const prepared = filter.prepareRequestBody(JSON.stringify(request), { enabled: true, allowedRefIds: new Set(['A', 'B']) });
assert.strictEqual(prepared.changed, true);
assert.deepStrictEqual(Array.from(prepared.loadRefIds), ['A', 'B']);
const preparedPayload = JSON.parse(prepared.body);
assert.strictEqual(preparedPayload.queries.length, 4, 'same datasource and selector use one helper query');
const helper = preparedPayload.queries[3];
assert.strictEqual(helper.instant, true);
assert.strictEqual(helper.range, false);
assert(helper.expr.includes('count by (instance)'));
assert(helper.expr.includes('project="one"'));
assert(helper.expr.includes('mode="user"'));
assert.deepStrictEqual(helper.__dashbridgeCpuCapacityHelper.loadRefIds, ['A', 'B']);
assert.deepStrictEqual(helper.__dashbridgeCpuCapacityHelper.loadTypes, { A: '1m', B: '5m' });

const field = (instance, name = 'Value') => ({ name, type: 'number', labels: { instance } });
const frame = (instance, values) => ({
    schema: { fields: [{ name: 'Time', type: 'time' }, field(instance)] },
    data: { values: [[1, 2, 3], values] }
});
const response = {
    results: {
        A: { frames: [frame('vm-01:9182', [0.5, 1.7, 1.2]), frame('vm-02:9182', [2, 3, 4])] },
        B: { frames: [frame('vm-01:9182', [0.4, 1, 0.8]), frame('vm-02:9182', [8, 7, 6]), frame('vm-03:9182', [100, 100, 100])] },
        C: { frames: [frame('vm-02:9182', [1, 1, 1])] },
        [helper.refId]: {
            frames: [
                frame('vm-01:9182', [2]),
                frame('vm-02:9182', [8])
            ]
        }
    }
};
const filtered = filter.filterResponse(response, prepared.body, { enabled: true, coefficient: 0.8, mode: 'max', selectedTypes: ['1m', '5m', '15m'] });
assert.strictEqual(response.results[helper.refId], undefined, 'helper result never reaches Grafana');
assert.strictEqual(filtered.metrics.capacityInstances, 2);
assert.strictEqual(filtered.metrics.overloadedInstances, 2, 'vm-01 exceeds in load1 and vm-02 in load5');
assert.strictEqual(response.results.A.frames.length, 2, 'all load windows remain for an overloaded instance');
assert.strictEqual(response.results.B.frames.length, 3, 'missing capacity fails open');
assert.strictEqual(response.results.C.frames.length, 1, 'unrelated query is untouched');
const highlightedA = response.results.A.frames[0];
assert.strictEqual(highlightedA.schema.fields.length, 2, 'highlight metadata must not create a Grafana series');
assert.strictEqual(highlightedA.data.values.length, 2, 'highlight metadata must not duplicate chart values');
assert.strictEqual(highlightedA.schema.fields[1].config.custom.__dashbridgeThresholdHighlight.threshold, 1.6);
assert.strictEqual(highlightedA.schema.fields[1].config.custom.__dashbridgeThresholdHighlight.exceededSamples, 1);
assert.strictEqual(highlightedA.schema.fields[1].config.custom.__dashbridgeThresholdHighlight.kind, 'cpu-capacity-filter');
assert.strictEqual(highlightedA.schema.fields[1].config.custom.__dashbridgeCpuCapacity.value, 2);
assert.strictEqual(highlightedA.schema.fields[1].config.custom.__dashbridgeCpuCapacity.instance, 'vm-01:9182');
assert.strictEqual(highlightedA.schema.fields[1].name, 'Value', 'vCPU metadata must not alter the native series name');

const quietResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [0.2, 0.3]), frame('unknown:9182', [999])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
const quiet = filter.filterResponse(quietResponse, prepared.body, { enabled: true, coefficient: 0.8, mode: 'max' });
assert.strictEqual(quietResponse.results.A.frames.length, 1, 'known quiet instance is removed');
assert.strictEqual(quiet.metrics.missingCapacitySeries, 1, 'unknown instance remains visible');
assert.strictEqual(quietResponse.results.A.frames[0].schema.fields.length, 2, 'unknown capacity is fail-open without a false highlight');
assert.strictEqual(quietResponse.results.A.frames[0].schema.fields[1].config?.custom?.__dashbridgeThresholdHighlight, undefined);

const defaultTypeResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [1.7])] },
        B: { frames: [frame('vm-01:9182', [10])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
filter.filterResponse(defaultTypeResponse, prepared.body, { enabled: true, coefficient: 0.8 });
assert.strictEqual(defaultTypeResponse.results.A.frames.length, 1, 'Load 1m is selected by default');
assert.strictEqual(defaultTypeResponse.results.B.frames.length, 0, 'Load 5m is hidden by default');

const noTypesResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [100])] },
        B: { frames: [frame('vm-01:9182', [100])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
filter.filterResponse(noTypesResponse, prepared.body, { enabled: true, coefficient: 0.8, selectedTypes: [] });
assert.strictEqual(noTypesResponse.results.A.frames.length, 0);
assert.strictEqual(noTypesResponse.results.B.frames.length, 0, 'all Load types can be disabled');

const unsafe = filter.prepareRequestBody(JSON.stringify({
    queries: [
        { refId: 'A', expr: 'node_load1', datasource: { uid: 'prom-main' } }
    ]
}), { enabled: true });
assert.strictEqual(unsafe.changed, false, 'unscoped Load query cannot trigger an all-VM helper');

const manyInstances = Array.from({ length: 25 }, (_, index) => `vm-${String(index + 1).padStart(2, '0')}:9182`).join('|');
const changedProject = filter.prepareRequestBody(JSON.stringify({
    queries: [{
        refId: 'A', datasource: { uid: 'prom-other' },
        expr: `node_load15{project="two", instance=~"${manyInstances}"}`
    }]
}), { enabled: true });
const changedHelper = JSON.parse(changedProject.body).queries[1];
assert(changedHelper.expr.includes('project="two"'));
assert(changedHelper.expr.includes('vm-25:9182'), 'the current project and any dynamic instance count are preserved');

const noCapacityResponse = { results: { A: { frames: [frame('vm-01:9182', [100])] } } };
filter.filterResponse(noCapacityResponse, prepared.body, { enabled: true, coefficient: 0.8 });
assert.strictEqual(noCapacityResponse.results.A.frames.length, 1, 'capacity query failure is fail-open');

const loadField = field('vm-01.passport.local:9182', 'vm-01.passport.local:9182 Load 1m');
loadField.config = { displayName: 'vm-01.passport.local:9182 Load 1m' };
const trimResponse = {
    results: {
        A: {
            frames: [{
                schema: { fields: [{ name: 'Time', type: 'time' }, loadField] },
                data: { values: [[1], [1]] }
            }]
        },
        C: { frames: [frame('vm-02.passport.local:9182', [1])] }
    }
};
filter.filterResponse(trimResponse, JSON.stringify(request), {
    trimDomainEnabled: true,
    trimDomain: '.passport.local:9182'
});
assert.strictEqual(loadField.labels.instance, 'vm-01');
assert.strictEqual(loadField.name, 'vm-01 Load 1m');
assert.strictEqual(loadField.config.displayName, 'vm-01 Load 1m');
assert.strictEqual(trimResponse.results.C.frames[0].schema.fields[1].labels.instance,
    'vm-02.passport.local:9182', 'non-Load query labels must remain untouched');

const lastModeResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [2.5, 1.5])] },
        B: { frames: [frame('vm-01:9182', [9, 0.5])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
filter.filterResponse(lastModeResponse, prepared.body, {
    enabled: true, coefficient: 0.8, mode: 'last', selectedTypes: ['1m', '5m']
});
assert.strictEqual(lastModeResponse.results.A.frames.length, 0,
    'last mode removes a Load series when its final finite value is not above capacity');
assert.strictEqual(lastModeResponse.results.B.frames.length, 0,
    'last mode ignores an older Load spike in every selected Load window');

const equalThresholdResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [1.6])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
filter.filterResponse(equalThresholdResponse, prepared.body, {
    enabled: true, coefficient: 0.8, mode: 'max', selectedTypes: ['1m']
});
assert.strictEqual(equalThresholdResponse.results.A.frames.length, 0,
    'vCPU threshold remains strict: a value equal to capacity × coefficient is not overloaded');

const invalidCoefficientResponse = {
    results: {
        A: { frames: [frame('vm-01:9182', [100])] },
        [helper.refId]: { frames: [frame('vm-01:9182', [2])] }
    }
};
const invalidCoefficient = filter.filterResponse(invalidCoefficientResponse, prepared.body, {
    enabled: true, coefficient: 0, mode: 'max', selectedTypes: ['1m']
});
assert.strictEqual(invalidCoefficient.metrics.invalidCoefficient, true,
    'an invalid coefficient is observable in metrics');
assert.strictEqual(invalidCoefficientResponse.results.A.frames.length, 1,
    'an invalid coefficient fails open for Load data');
assert.strictEqual(invalidCoefficientResponse.results[helper.refId], undefined,
    'even a failed-open vCPU filter must remove its private helper response');

const scopedRequest = {
    queries: [
        { refId: 'S1', expr: 'node_load1{project="shared", instance="same:9182"}', datasource: { uid: 'prom-one' } },
        { refId: 'S2', expr: 'node_load1{project="shared", instance="same:9182"}', datasource: { uid: 'prom-two' } }
    ]
};
const scopedPrepared = filter.prepareRequestBody(JSON.stringify(scopedRequest), { enabled: true });
const scopedQueries = JSON.parse(scopedPrepared.body).queries;
const scopedHelpers = scopedQueries.filter(query => query.__dashbridgeCpuCapacityHelper);
const helperByDatasource = Object.fromEntries(scopedHelpers.map(query => [query.datasource.uid, query]));
assert.strictEqual(scopedHelpers.length, 2, 'different datasources require independent capacity scopes');
const scopedResponse = {
    results: {
        S1: { frames: [frame('same:9182', [2])] },
        S2: { frames: [frame('same:9182', [2])] },
        [helperByDatasource['prom-two'].refId]: { frames: [frame('same:9182', [8])] },
        [helperByDatasource['prom-one'].refId]: { frames: [frame('same:9182', [2])] }
    }
};
const scoped = filter.filterResponse(scopedResponse, scopedPrepared.body, {
    enabled: true, coefficient: 0.8, selectedTypes: ['1m']
});
assert.strictEqual(scoped.metrics.capacityInstances, 2,
    'capacity metrics count the same instance independently in every helper scope');
assert.strictEqual(scopedResponse.results.S1.frames.length, 1,
    'an overloaded instance remains visible in the datasource whose capacity it exceeded');
assert.strictEqual(scopedResponse.results.S2.frames.length, 0,
    'overload and capacity from another datasource must not retain a quiet instance');

const partialScopedResponse = {
    results: {
        S1: { frames: [frame('same:9182', [0.5])] },
        S2: { frames: [frame('same:9182', [999])] },
        [helperByDatasource['prom-one'].refId]: { frames: [frame('same:9182', [2])] }
    }
};
const partialScoped = filter.filterResponse(partialScopedResponse, scopedPrepared.body, {
    enabled: true, coefficient: 0.8, selectedTypes: ['1m']
});
assert.strictEqual(partialScopedResponse.results.S1.frames.length, 0,
    'a quiet series is still removed when its own helper is available');
assert.strictEqual(partialScopedResponse.results.S2.frames.length, 1,
    'a missing helper in one scope fails open without borrowing another scope capacity');
assert.strictEqual(partialScoped.metrics.missingCapacitySeries, 1);

const selectorScopedRequest = {
    queries: [
        { refId: 'P1', expr: 'node_load1{project="one", instance="same:9182"}', datasource: { uid: 'prom-main' } },
        { refId: 'P2', expr: 'node_load1{project="two", instance="same:9182"}', datasource: { uid: 'prom-main' } }
    ]
};
const selectorScopedPrepared = filter.prepareRequestBody(JSON.stringify(selectorScopedRequest), { enabled: true });
const selectorScopedHelpers = JSON.parse(selectorScopedPrepared.body).queries
    .filter(query => query.__dashbridgeCpuCapacityHelper);
const helperForLoad = loadRefId => selectorScopedHelpers
    .find(query => query.__dashbridgeCpuCapacityHelper.loadRefIds.includes(loadRefId));
assert.strictEqual(selectorScopedHelpers.length, 2, 'different selectors require independent capacity scopes');
const selectorScopedResponse = {
    results: {
        P1: { frames: [frame('same:9182', [2])] },
        P2: { frames: [frame('same:9182', [2])] },
        [helperForLoad('P2').refId]: { frames: [frame('same:9182', [8])] },
        [helperForLoad('P1').refId]: { frames: [frame('same:9182', [2])] }
    }
};
filter.filterResponse(selectorScopedResponse, selectorScopedPrepared.body, {
    enabled: true, coefficient: 0.8, selectedTypes: ['1m']
});
assert.strictEqual(selectorScopedResponse.results.P1.frames.length, 1,
    'overload remains visible in the selector scope whose capacity was exceeded');
assert.strictEqual(selectorScopedResponse.results.P2.frames.length, 0,
    'overload from another selector must not retain a quiet series with the same instance');

console.log('PASS dynamic vCPU filter groups Load Average by instance and fails open safely');
