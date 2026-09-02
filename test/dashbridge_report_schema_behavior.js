'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { URL, crypto: { randomUUID: () => 'new-id' } };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/shared/local-state-schema.js'), 'utf8'), context);
const schema = context.DashBridgeLocalStateSchema;
const base = {
    id: 'profile-1', name: 'Report', report: { template: '{{panels}}', panelOrder: ['panel-1'] },
    panels: [{
        id: 'panel-1', src: 'https://grafana.example/d-solo/u/x?panelId=1', width: '50%', height: '350px',
        report: { enabled: true, key: 'cpu', includeMode: 'breach_only',
            sla: { source: 'custom', warningValue: 70, value: 80, unit: '%', operator: 'gt', evaluation: 'period_max' },
            templates: { normal: 'OK', warning: 'WARN', breached: 'FAIL', neutral: 'INFO', unavailable: 'UNKNOWN', listItem: '- {{name}}' }, detailsEnabled: true }
    }]
};
const normalized = schema.normalizeProfiles([base]).items[0];
assert.strictEqual(normalized.report.template, '{{panels}}');
assert.deepStrictEqual(Array.from(normalized.report.panelOrder), ['panel-1']);
assert.strictEqual(normalized.panels[0].report.sla.value, 80);
assert.strictEqual(normalized.panels[0].report.sla.warningValue, 70);
const dynamicSla = schema.normalizeProfiles([{ ...base, panels: [{ ...base.panels[0], report: {
    ...base.panels[0].report, sla: { source: 'cpu_capacity', operator: 'gt', evaluation: 'period_max' }
} }] }]).items[0];
assert.strictEqual(dynamicSla.panels[0].report.sla.source, 'cpu_capacity',
    'profile import preserves the dynamic Load Average vCPU SLA source');
assert.throws(() => schema.normalizeProfiles([{ ...base, panels: [{ ...base.panels[0], report: {
    ...base.panels[0].report, sla: { source: 'remote', value: 80 }
} }] }]), /source|источник/u);
assert.throws(() => schema.normalizeProfiles([{ ...base, report: { template: 'x'.repeat(20_001) } }]), /20000/u);
assert.throws(() => schema.normalizeProfiles([{ ...base, report: {
    template: '{{panels}}', panelOrder: ['panel-1', 'panel-1']
} }]), /повторяться/u);
console.log('PASS dashboard report settings are validated during profile import');
