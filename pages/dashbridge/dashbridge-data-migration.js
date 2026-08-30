// Temporary, versioned migration for persisted DashBridge data.
// Keep this module isolated so it can be removed after the controlled rollout.
// Removal also includes its pages/dashbridge/dashbridge.html script tag, the startup run() call,
// DashBridgeTimeState.load(), the v0 backup and the schema marker.
(function initDashBridgeDataMigration(root) {
    'use strict';

    const CURRENT_SCHEMA_VERSION = 1;
    const VERSION_KEY = 'dashbridge_dataSchemaVersion';
    const BACKUP_KEY = 'dashbridge_migration_backup_v0_to_v1';
    const LEGACY_TIME_KEYS = ['dashbridge_timeFrom', 'dashbridge_timeTo', 'dashbridge_refresh'];
    const MIGRATED_GRAFANA_SETTING_KEYS = [
        'grafanaTrimDomainEnabled', 'grafanaTrimDomainVersion',
        'grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle',
        'grafanaMemCalcMode'
    ];

    const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
    const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

    function readLegacyTimeState() {
        const values = {};
        try {
            LEGACY_TIME_KEYS.forEach(key => { values[key] = localStorage.getItem(key); });
        } catch (_) {
            LEGACY_TIME_KEYS.forEach(key => { values[key] = null; });
        }
        return {
            values,
            normalized: DashBridgeTimeState.normalize({
                from: values.dashbridge_timeFrom || undefined,
                to: values.dashbridge_timeTo || undefined,
                refresh: values.dashbridge_refresh || undefined
            })
        };
    }

    function clearLegacyTimeState() {
        try { LEGACY_TIME_KEYS.forEach(key => localStorage.removeItem(key)); }
        catch (_) { /* A completed storage migration must not fail on localStorage cleanup. */ }
    }

    function migratePanel(panel) {
        if (!isPlainObject(panel) || (panel.tools !== undefined && !isPlainObject(panel.tools))) return panel;
        const isMemoryPanel = /\b(?:memory|ram)\b|памят/i.test(String(panel.title || ''));
        const tools = panel.tools || {};
        if (!isMemoryPanel || tools.convertMemToUsed === true || tools.forceMemByteUnit === true) {
            return panel;
        }
        return { ...panel, tools: { ...tools, forceMemByteUnit: true } };
    }

    function migrateProfiles(value, legacyTimeState) {
        if (!Array.isArray(value)) return value;
        return value.map(profile => {
            if (!isPlainObject(profile)) return profile;
            const timeState = isPlainObject(profile.timeState)
                ? DashBridgeTimeState.normalize(profile.timeState)
                : { ...legacyTimeState };
            const panels = Array.isArray(profile.panels) ? profile.panels.map(migratePanel) : profile.panels;
            if (sameValue(profile.timeState, timeState) && sameValue(profile.panels, panels)) return profile;
            return { ...profile, timeState, ...(panels === undefined ? {} : { panels }) };
        });
    }

    function buildGrafanaSettingsPatch(stored) {
        const normalized = normalizeGrafanaSettings(stored);
        return Object.fromEntries(MIGRATED_GRAFANA_SETTING_KEYS
            .filter(key => !sameValue(stored[key], normalized[key]))
            .map(key => [key, normalized[key]]));
    }

    async function run() {
        const localData = await chrome.storage.local.get([
            VERSION_KEY, BACKUP_KEY, 'dashbridge_profiles', 'dashbridge_activeProfileId'
        ]);
        if (Number(localData[VERSION_KEY]) >= CURRENT_SCHEMA_VERSION) {
            clearLegacyTimeState();
            return { migrated: false, version: CURRENT_SCHEMA_VERSION };
        }

        const legacyTime = readLegacyTimeState();
        const syncKeys = getGrafanaSettingsStorageKeys();
        const syncData = await chrome.storage.sync.get(syncKeys);
        const profiles = migrateProfiles(localData.dashbridge_profiles, legacyTime.normalized);
        const syncPatch = buildGrafanaSettingsPatch(syncData);

        if (!localData[BACKUP_KEY]) {
            const backup = {
                createdAt: new Date().toISOString(),
                sourceSchemaVersion: Number(localData[VERSION_KEY]) || 0,
                legacyTimeState: legacyTime.values,
                grafanaSettings: syncData
            };
            if (localData.dashbridge_profiles !== undefined) {
                backup.dashbridge_profiles = localData.dashbridge_profiles;
            }
            if (localData.dashbridge_activeProfileId !== undefined) {
                backup.dashbridge_activeProfileId = localData.dashbridge_activeProfileId;
            }
            await chrome.storage.local.set({
                [BACKUP_KEY]: backup
            });
        }

        // Sync settings are committed first. The local schema marker is written
        // last, so a partial failure is retried safely on the next page load.
        if (Object.keys(syncPatch).length) await chrome.storage.sync.set(syncPatch);
        const localPatch = { [VERSION_KEY]: CURRENT_SCHEMA_VERSION };
        if (!sameValue(localData.dashbridge_profiles, profiles)) localPatch.dashbridge_profiles = profiles;
        await chrome.storage.local.set(localPatch);
        clearLegacyTimeState();
        return {
            migrated: true,
            version: CURRENT_SCHEMA_VERSION,
            profilesChanged: Object.prototype.hasOwnProperty.call(localPatch, 'dashbridge_profiles'),
            settingsChanged: Object.keys(syncPatch).length
        };
    }

    root.DashBridgeDataMigration = Object.freeze({
        CURRENT_SCHEMA_VERSION, VERSION_KEY, BACKUP_KEY, migrateProfiles, buildGrafanaSettingsPatch, run
    });
})(globalThis);
