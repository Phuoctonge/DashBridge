const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/shared/grafana-panel-settings-modal.js', 'utf8');
assert.equal(source.includes('panel-tools-select-all'), false, 'redundant apply-selection button must stay removed');
const window = {};
vm.runInNewContext(source, { window });

const select = window.DashBridgePanelSettingsModal.selectLegendSeriesByPatterns;

assert.deepEqual(
    [...select(['CPU', 'CPU Idle', 'Load', 'Test'], 'cpu|load', 'idle|test')],
    ['CPU', 'Load'],
    'exclusion patterns must override inclusion patterns'
);
assert.deepEqual(
    [...select(['CPU', 'CPU Idle', 'Load'], '', 'idle')],
    ['CPU', 'Load'],
    'an empty inclusion pattern must start from all series'
);
assert.deepEqual(
    [...select(['CPU', 'Load'], ' cpu | | LOAD ', '')],
    ['CPU', 'Load'],
    'patterns must be trimmed, case-insensitive, and ignore empty terms'
);

console.log('PASS legend selection patterns');
