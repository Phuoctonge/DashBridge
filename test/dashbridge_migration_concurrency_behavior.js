'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
// Models origin-scoped FIFO Web Locks shared by independent page/SW contexts.
function locks() {
    const queues = new Map();
    return { request(name, callback) {
        const operation = (queues.get(name) || Promise.resolve()).catch(() => {}).then(callback);
        queues.set(name, operation);
        return operation;
    } };
}
function harness({ missingLocks = false } = {}) {
    const storage = { dashbridge_profiles: [{ id: 'a', name: 'Original', panels: [] }], dashbridge_activeProfileId: 'a' };
    const manager = locks();
    const writes = [], removed = [];
    let release, pause = true, fail = '';
    const local = {
        get: async () => structuredClone(storage),
        set: async patch => {
            if (fail === 'marker' && patch.dashbridge_dataSchemaVersion) { fail = ''; throw new Error('marker failure'); }
            writes.push(structuredClone(patch)); Object.assign(storage, structuredClone(patch));
        },
    };
    const context = () => {
        const c = vm.createContext({ console, URL, structuredClone,
            navigator: missingLocks ? {} : { locks: manager }, crypto: { randomUUID: () => 'new-id' },
            localStorage: { getItem: () => null, removeItem: key => removed.push(key) },
            chrome: { runtime: {}, storage: { local, sync: {
                get: async () => { if (pause) { pause = false; await new Promise(done => { release = done; }); } return {}; },
                set: async () => { if (fail === 'sync') { fail = ''; throw new Error('sync failure'); } },
            } } },
        });
        for (const file of ['js/shared/local-state-schema.js', 'js/shared/grafana-settings.js',
            'pages/dashbridge/dashbridge-time-state.js', 'pages/dashbridge/dashbridge-data-migration.js',
            'js/background-profile-storage.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
        return c;
    };
    const page = context(), worker = context();
    const broker = worker.DashBridgeBackgroundProfileStorage.create({ chromeRef: worker.chrome,
        panelIdentity: { normalizePanelId: value => value, fromUrl: value => value },
        grafanaInfrastructure: { getHosts: async () => [] }, isTrustedExtensionPage: () => true });
    const patch = () => ({ activeProfileId: 'a', deleteProfileIds: [],
        upserts: [{ ...storage.dashbridge_profiles[0], name: 'Concurrent edit' }],
        expectedProfiles: { a: worker.DashBridgeLocalStateSchema.profileFingerprint(
            worker.DashBridgeLocalStateSchema.normalizeProfiles(storage.dashbridge_profiles, { mode: 'load' }).items[0]) } });
    return { storage, writes, removed, page, worker, broker, patch, context,
        release: () => release(), fail: value => { fail = value; }, unpause: () => { pause = false; } };
}
(async () => {
    {
        const h = harness();
        const migration = h.page.DashBridgeDataMigration.run(); await tick();
        let settled = false;
        const save = h.broker.queueProfilePatch(h.patch(), {}).then(() => { settled = true; }, error => { settled = true; return error; });
        await tick();
        assert.equal(settled, false, 'CAS must wait while migration owns its read-to-marker transaction');
        h.release(); await migration;
        const outcome = await save;
        assert(outcome instanceof Error || outcome?.message, 'pre-migration stale CAS must reject instead of overwriting migration');
        await h.broker.queueProfilePatch(h.patch(), {});
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Concurrent edit', 'fresh post-migration CAS succeeds');
        assert.equal(h.storage.dashbridge_migration_backup_v0_to_v1.dashbridge_profiles[0].name, 'Original');
    }
    {
        const h = harness(); const first = h.page.DashBridgeDataMigration.run(); await tick();
        const otherPage = h.context();
        let settled = false;
        const second = otherPage.DashBridgeDataMigration.run().then(result => { settled = true; return result; });
        await tick(); assert.equal(settled, false, 'second migration waits for the first');
        h.release(); assert.equal((await first).migrated, true); assert.equal((await second).migrated, false);
        assert.equal(h.writes.filter(patch => patch.dashbridge_migration_backup_v0_to_v1).length, 1);
        assert.equal(h.writes.filter(patch => patch.dashbridge_dataSchemaVersion).length, 1);
    }
    for (const failure of ['sync', 'marker']) {
        const h = harness(); h.unpause(); h.fail(failure);
        await assert.rejects(h.page.DashBridgeDataMigration.run(), new RegExp(failure));
        const backup = JSON.stringify(h.storage.dashbridge_migration_backup_v0_to_v1);
        assert(backup); assert.equal(h.storage.dashbridge_dataSchemaVersion, undefined);
        assert.equal(h.removed.length, 0, 'legacy cleanup cannot precede commit');
        await h.broker.queueProfilePatch(h.patch(), {});
        await h.page.DashBridgeDataMigration.run();
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Concurrent edit', 'retry migrates fresh profiles');
        assert.equal(JSON.stringify(h.storage.dashbridge_migration_backup_v0_to_v1), backup, 'retry retains first backup');
        assert.equal(h.storage.dashbridge_dataSchemaVersion, 1);
        assert.equal(h.removed.length, 3);
    }
    {
        const h = harness({ missingLocks: true }); h.unpause();
        await assert.rejects(h.page.DashBridgeDataMigration.run(), /Web Locks/);
        await assert.rejects(h.broker.queueProfilePatch(h.patch(), {}), /Web Locks/);
        await assert.rejects(h.broker.queueCommit({ dashbridge_profiles: [] }), /Web Locks/);
        assert.equal(h.writes.length, 0, 'missing shared lock must not write');
    }
    console.log('PASS migration and CAS share an origin lock, preserve backup/retry and fail closed without locks');
})().catch(error => { console.error(error); process.exitCode = 1; });
