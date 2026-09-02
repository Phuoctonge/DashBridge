'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { URL, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'local-state-schema.js'), 'utf8'), context);
const schema = context.DashBridgeLocalStateSchema;

const validPanel = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    src: 'https://grafana.example/d-solo/uid/name?panelId=1',
    width: '50%', height: '350px', tools: {
        thresholdEnabled: true, thresholdValue: 80, thresholdInputUnit: 's', thresholdIncludeHidden: true,
        legendSelectionVersion: 2, legendVisibleSeries: ['wanted-1', 'wanted-2'],
        cpuCapacityFilterEnabled: true, cpuCapacityFilterHighlightEnabled: false,
        seriesQueryFilterHighlightEnabled: true, seriesQueryFilterInputUnit: 'ms',
        cpuCapacityFilterCoefficient: 0.8, cpuCapacityFilterMode: 'max',
        cpuCapacityFilterLoad1: true, cpuCapacityFilterLoad5: false, cpuCapacityFilterLoad15: false,
        capturePrepared: true
    }
};
const validProfile = { id: '123e4567-e89b-42d3-a456-426614174001', name: 'Default', panels: [validPanel] };
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].src, validPanel.src);
assert.deepStrictEqual(
    Array.from(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.legendVisibleSeries),
    ['wanted-1', 'wanted-2']
);
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.capturePrepared, true);
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.cpuCapacityFilterCoefficient, 0.8);
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.cpuCapacityFilterHighlightEnabled, false);
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.thresholdInputUnit, 's');
assert.strictEqual(schema.normalizeProfiles([validProfile]).items[0].panels[0].tools.seriesQueryFilterInputUnit, 'ms');
assert.strictEqual(schema.normalizeProfiles([{ ...validProfile, panels: [{ ...validPanel, tools: {
    ...validPanel.tools, forceMemByteUnit: true
} }] }]).items[0].panels[0].tools.forceMemByteUnit, true);
assert.throws(() => schema.normalizeProfiles([{ ...validProfile, panels: [{ ...validPanel, tools: {
    ...validPanel.tools, legendVisibleSeries: 'wanted-1'
} }] }]), /legendVisibleSeries/);

for (const hostileId of ['"><svg/onload=alert(1)>', 'id"] .other', '<input>']) {
    assert.throws(() => schema.normalizeWorklogs([{ id: hostileId }]), /идентификатор/);
    assert.throws(() => schema.normalizeProfiles([{ ...validProfile, panels: [{ ...validPanel, id: hostileId }] }]), /идентификатор/);
}
assert.throws(() => schema.normalizeProfiles([{ ...validProfile, panels: [{ ...validPanel, src: 'javascript:alert(1)' }] }]), /HTTP/);
assert.throws(() => schema.normalizeWorklogs([{ id: validPanel.id, dateStarted: { html: '<svg>' } }]), /строка/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(schema.normalizeCustomButtons([
    { id: 1, name: 'Main', url: 'https://grafana.example/d/main' }
]).items)), [{ id: 1, name: 'Main', url: 'https://grafana.example/d/main' }]);
assert.throws(() => schema.normalizeCustomButtons([null]), /customButtons/);
assert.throws(() => schema.normalizeCustomButtons([{ id: 1, name: 'Bad', url: 'javascript:alert(1)' }]), /HTTP/);
assert.throws(() => schema.normalizeBatchState({ radio_captureThemeMain: '\"]' }), /captureThemeMain/);
assert.strictEqual(schema.normalizeBatchState({ radio_captureThemeMain: 'dark' }).radio_captureThemeMain, 'dark');
assert.strictEqual(schema.normalizeBatchState({ compactCaptureMain: true }).compactCaptureMain, true);
assert.strictEqual(schema.normalizeBatchState({ compactCaptureSeries: false }).compactCaptureSeries, false);
assert.throws(() => schema.normalizeBatchState({ compactCaptureMain: 'true' }), /compactCaptureMain/);

const legacy = schema.normalizeWorklogs([
    { issueId: 'ABC-1', dateStarted: '20/08/2026 10:00' },
    { id: '"><svg>', issueId: 'BAD' }
], { mode: 'load', randomUUID: context.crypto.randomUUID });
assert.strictEqual(legacy.items.length, 1);
assert.strictEqual(legacy.items[0].id, context.crypto.randomUUID());
assert.strictEqual(legacy.skipped, 1);
const legacyProfile = schema.normalizeProfiles([{
    id: 'legacy-profile-42', name: 'Legacy', futureProfileField: { keep: true }, panels: [{
        ...validPanel, id: 'panel_1700000000000', futurePanelField: 'keep',
        tools: { ...validPanel.tools, futureToolField: { keep: true } }
    }]
}], { mode: 'load' }).items[0];
assert.strictEqual(legacyProfile.id, 'legacy-profile-42');
assert.strictEqual(legacyProfile.futureProfileField.keep, true);
assert.strictEqual(legacyProfile.panels[0].futurePanelField, 'keep');
assert.strictEqual(legacyProfile.panels[0].tools.futureToolField.keep, true);
console.log('PASS local state schema rejects hostile imports and safely migrates legacy state');
