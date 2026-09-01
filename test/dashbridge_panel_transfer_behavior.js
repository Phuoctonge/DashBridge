'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let uuidIndex = 0;
const randomUUID = () => `123e4567-e89b-42d3-a456-${String(++uuidIndex).padStart(12, '0')}`;
const context = {
    URL, URLSearchParams, Date, Number, String, Set, Error, console,
    crypto: { randomUUID },
    parseGrafanaAbsoluteTime: () => null,
    serializeGrafanaAbsoluteTime: value => String(value),
    detectGrafanaTimeFormat: () => 'milliseconds',
};
context.globalThis = context;
context.window = context;
vm.createContext(context);
for (const file of [
    'js/shared/grafana-panel-identity.js',
    'js/shared/local-state-schema.js',
    'js/shared/dashbridge-report.js',
    'pages/dashbridge/dashbridge-time-state.js',
    'pages/dashbridge/dashbridge-panel-url.js',
    'pages/dashbridge/dashbridge-panel-transfer.js',
]) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const transfer = context.DashBridgePanelTransfer;

assert(Object.isFrozen(transfer), 'panel transfer API must be immutable');
const sourcePanel = {
    id: 'source-panel',
    src: 'https://grafana.example/d-solo/uid/name?orgId=1&panelId=7&from=now-1h',
    width: '33%', height: '420px', paused: true, grafanaTheme: 'dark',
    tools: { thresholdEnabled: true, thresholdValue: 80 },
    futurePanelField: { keep: true },
};
const profile = {
    name: 'Production / CPU',
    timeState: { from: 'now-6h', to: 'now', refresh: '30s' },
    report: { enabled: true, template: 'Report: {{panels}}' },
};
const payload = transfer.createPanelExportPayload({
    profile,
    panels: [sourcePanel],
    exportedAt: '2026-08-31T12:00:00.000Z',
});
assert.strictEqual(payload.version, 3);
assert.strictEqual(payload.profileName, profile.name);
assert.strictEqual(payload.exportedAt, '2026-08-31T12:00:00.000Z');
assert.strictEqual(payload.panels[0].futurePanelField.keep, true, 'export must retain unknown compatible fields');
assert.strictEqual(
    transfer.buildPanelExportFileName(profile.name, payload.exportedAt),
    'dashbridge_production___cpu_2026-08-31.json'
);

const imported = transfer.parsePanelImportText(JSON.stringify(payload), {
    fallbackProfileName: 'fallback.json', randomUUID,
});
assert.strictEqual(imported.profileName, profile.name);
assert.strictEqual(imported.panels.length, 1);
assert.notStrictEqual(imported.panels[0].id, sourcePanel.id, 'import must assign a new panel ID');
assert.strictEqual(imported.panels[0].src, sourcePanel.src);
assert.strictEqual(imported.panels[0].paused, true);
assert.strictEqual(imported.panels[0].tools.thresholdValue, 80);
assert.strictEqual(imported.panels[0].futurePanelField.keep, true, 'round-trip must retain compatible fields');
assert.strictEqual(imported.hasTimeState, true);
assert.strictEqual(imported.hasReport, true);

assert.throws(() => transfer.parsePanelImportText('{broken'), error => error?.name === 'SyntaxError');
assert.throws(
    () => transfer.parsePanelImportText('{"version":3}'),
    error => error.code === transfer.INVALID_PANELS_CODE && /panels\[\]/.test(error.message)
);
assert.strictEqual(transfer.parsePanelImportText('{"panels":[]}').panels.length, 0);

const duplicateAndInvalid = transfer.parsePanelImportText(JSON.stringify({
    profileName: '',
    panels: [
        { src: 'javascript:alert(1)', width: '50%', height: '350px' },
        { src: 'https://grafana.example/d/uid/name?orgId=1&viewPanel=7&from=now-6h', width: 'bad', height: '9999px' },
        { src: 'https://grafana.example/d-solo/uid/renamed?orgId=1&panelId=7&to=now', width: '100%', height: '180px' },
        null,
    ],
}), { fallbackProfileName: 'Imported panels.json', randomUUID });
assert.strictEqual(duplicateAndInvalid.profileName, 'Imported panels');
assert.strictEqual(duplicateAndInvalid.panels.length, 1, 'canonical duplicate panel must be dropped');
assert.strictEqual(duplicateAndInvalid.panels[0].width, '50%');
assert.strictEqual(duplicateAndInvalid.panels[0].height, '3000px');
assert.strictEqual(duplicateAndInvalid.duplicatesDropped, 1);
assert.strictEqual(duplicateAndInvalid.invalidEntries, 2);

const hostileSettings = transfer.parsePanelImportText(JSON.stringify({ panels: [{
    src: 'https://grafana.example/d-solo/uid/name?panelId=8',
    width: '50%', height: '350px', tools: { legendVisibleSeries: 'not-an-array' },
}] }), { randomUUID });
assert.strictEqual(hostileSettings.panels.length, 0);
assert.strictEqual(hostileSettings.warnings.length, 1, 'schema rejection must remain diagnosable');

const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
assert(html.indexOf('dashbridge-panel-transfer.js') < html.indexOf('dashbridge.js'),
    'panel transfer owner must load before the DashBridge controller');
const controller = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
const transferController = fs.readFileSync(
    'pages/dashbridge/dashbridge-panel-transfer-controller.js', 'utf8'
);
assert(controller.includes('transfer: window.DashBridgePanelTransfer'),
    'DashBridge must inject the pure transfer API into the lifecycle controller');
assert(transferController.includes('transfer.createPanelExportPayload')
    && transferController.includes('transfer.parsePanelImportText'),
    'lifecycle controller must use the injected transfer API');
assert(!transferController.includes('const candidate = {')
    && !transferController.includes('DashBridgeLocalStateSchema.normalizeProfiles'),
    'lifecycle controller must not duplicate transfer normalization');

console.log('PASS DashBridge panel transfer preserves full round-trip data and rejects invalid or duplicate panels');
