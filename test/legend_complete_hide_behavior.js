'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-legend-selection.js', 'utf8'), context);
const selection = context.DashBridgeGrafanaLegendSelection;

const frame = names => ({
    schema: { fields: [{ name: 'Time', type: 'time' }, ...names.map(name => ({ name, type: 'number' }))] },
    data: { values: [[1], ...names.map((_, index) => [index])] }
});
const namesOf = data => Array.from(data.results.A.frames[0].schema.fields, field => field.name);
const getNames = (_frame, field) => [field.name];

const state = { legendMode: 'fast_complete_hide', legendSelectionVersion: 2, legendVisibleSeries: ['wanted-1', 'wanted-2'] };
const initial = { results: { A: { frames: [frame(['wanted-1', 'wanted-2', 'old-noise'])] } } };
selection.filterDataFrames(initial, state, getNames);
assert.deepEqual(namesOf(initial), ['Time', 'wanted-1', 'wanted-2']);

const refreshed = { results: { A: { frames: [frame(['wanted-1', 'wanted-2', 'new-random-series'])] } } };
selection.filterDataFrames(refreshed, state, getNames);
assert.deepEqual(namesOf(refreshed), ['Time', 'wanted-1', 'wanted-2'], 'new series must default to hidden');

const emptySelection = { results: { A: { frames: [frame(['wanted-1'])] } } };
selection.filterDataFrames(emptySelection, { ...state, legendVisibleSeries: [] }, getNames);
assert.equal(emptySelection.results.A.frames.length, 0, 'an explicit empty allowlist must not disable filtering');

assert.equal(selection.isSeriesVisible(state, ['Value', 'wanted-2']), true, 'any Grafana legend-name candidate may identify an allowed field');
assert.equal(selection.isSeriesVisible(state, ['Value', 'new-random-series']), false);

const legacy = { legendMode: 'fast_complete_hide', legendFilter: ['old-noise'] };
assert.equal(selection.isSeriesVisible(legacy, ['new-random-series']), true, 'legacy blocklist behavior must stay compatible');
const resetState = { legendMode: 'fast_complete_hide', legendSelectionVersion: null, legendVisibleSeries: [], legendFilter: [] };
const afterResetRefresh = { results: { A: { frames: [frame(['wanted-1', 'new-after-reset'])] } } };
selection.filterDataFrames(afterResetRefresh, resetState, getNames);
assert.deepEqual(namesOf(afterResetRefresh), ['Time', 'wanted-1', 'new-after-reset'],
    'reset must restore current series and allow series arriving on later refreshes');
const clickToggle = { legendMode: 'fast_click_toggle', legendSelectionVersion: 2, legendVisibleSeries: ['wanted-1'] };
const unchanged = { results: { A: { frames: [frame(['wanted-1', 'new-random-series'])] } } };
selection.filterDataFrames(unchanged, clickToggle, getNames);
assert.deepEqual(namesOf(unchanged), ['Time', 'wanted-1', 'new-random-series'], 'click-toggle data must not be filtered');

const variables = { results: { A: { frames: [{ schema: { fields: [{ name: 'option', type: 'string' }] }, data: { values: [['x']] } }] } } };
selection.filterDataFrames(variables, state, getNames);
assert.equal(variables.results.A.frames.length, 1, 'variable responses must remain intact');

console.log('PASS complete-hide allowlist rejects series arriving after save');
