'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const legacyValues = {
    dashbridge_timeFrom: 'now-6h',
    dashbridge_timeTo: 'now',
    dashbridge_refresh: '30s'
};
const localData = {
    dashbridge_profiles: [{
        id: 'profile-1', name: 'Legacy', panels: [{
            id: 'panel-1', title: 'Memory Usage', src: 'https://grafana.example/d-solo/u/x?panelId=1',
            tools: { convertMemToUsed: false, futureToolField: 'keep' }
        }]
    }, {
        id: 'profile-2', name: 'Current', timeState: { from: 'now-15m', to: 'now', refresh: '' }, panels: []
    }],
    dashbridge_activeProfileId: 'profile-1'
};
const syncData = {
    grafanaTrimDomainEnabled: false,
    grafanaMemAvailKeyword: 'Used',
    grafanaCpuPanelTitle: 'CPU',
    grafanaMemPanelTitle: 'RAM'
};
const localWrites = [];
const syncWrites = [];
const removedKeys = [];
const storageArea = (data, writes) => ({
    async get(keys) {
        const result = {};
        for (const key of keys) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
        return structuredClone(result);
    },
    async set(values) {
        writes.push(structuredClone(values));
        Object.assign(data, structuredClone(values));
    }
});
const context = {
    URL, URLSearchParams, Date, Number, String, structuredClone, console,
    globalThis: null,
    localStorage: {
        getItem: key => legacyValues[key] ?? null,
        removeItem(key) { removedKeys.push(key); delete legacyValues[key]; }
    },
    chrome: { storage: {
        local: storageArea(localData, localWrites),
        sync: storageArea(syncData, syncWrites)
    } },
    parseGrafanaAbsoluteTime: () => null,
    serializeGrafanaAbsoluteTime: value => String(value),
    detectGrafanaTimeFormat: () => 'milliseconds'
};
context.globalThis = context;
vm.createContext(context);
for (const file of [
    'js/shared/grafana-settings.js',
    'js/shared/grafana-panel-bootstrap.js',
    'js/pages/dashbridge-time-state.js',
    'js/pages/dashbridge-data-migration.js'
]) vm.runInContext(fs.readFileSync(file, 'utf8'), context);

(async () => {
    const migration = context.DashBridgeDataMigration;
    const result = await migration.run();
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(localData.dashbridge_dataSchemaVersion, 1, 'schema marker must be committed');
    assert(localData.dashbridge_migration_backup_v0_to_v1, 'legacy values must be backed up before mutation');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(localData.dashbridge_profiles[0].timeState)), {
        from: 'now-6h', to: 'now', refresh: '30s'
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(localData.dashbridge_profiles[1].timeState)), {
        from: 'now-15m', to: 'now', refresh: ''
    }, 'an existing profile-specific range must win over legacy globals');
    assert.strictEqual(localData.dashbridge_profiles[0].panels[0].tools.forceMemByteUnit, true);
    assert.strictEqual(localData.dashbridge_profiles[0].panels[0].tools.futureToolField, 'keep',
        'migration must preserve unknown forward-compatible fields');
    assert.strictEqual(syncData.grafanaTrimDomainVersion, 2);
    assert.strictEqual(syncData.grafanaTrimDomainEnabled, true);
    assert.strictEqual(syncData.grafanaMemCalcMode, 'used');
    assert.strictEqual(syncData.grafanaCpuPanelTitle, 'CPU Usage');
    assert.strictEqual(syncData.grafanaMemPanelTitle, 'Memory');
    assert.strictEqual(syncData.grafanaIframeDomains, undefined,
        'one-shot migration must not materialize unrelated defaults or trigger adjacent infrastructure changes');
    assert.deepStrictEqual(new Set(removedKeys), new Set([
        'dashbridge_timeFrom', 'dashbridge_timeTo', 'dashbridge_refresh'
    ]));

    const writesBeforeSecondRun = localWrites.length + syncWrites.length;
    const second = await migration.run();
    assert.strictEqual(second.migrated, false);
    assert.strictEqual(localWrites.length + syncWrites.length, writesBeforeSecondRun,
        'completed migration must not rewrite extension storage');
    console.log('PASS DashBridge performs a backed-up, idempotent one-shot data migration');
})().catch(error => { console.error(error); process.exit(1); });
