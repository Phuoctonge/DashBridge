(function initDashBridgeBackgroundAnalytics(root) {
    'use strict';

    const STORAGE_KEY = 'dashbridgeAnalyticsState';
    const STATE_VERSION = 1;
    const hourStart = timestamp => new Date(Math.floor(timestamp / 3_600_000) * 3_600_000).toISOString();
    const dayKey = timestamp => new Date(timestamp).toISOString().slice(0, 10);
    const stableDimensions = dimensions => Object.keys(dimensions).sort()
        .map(key => `${key}:${String(dimensions[key])}`).join('|');

    function create({ contract = root.DashBridgeAnalyticsContract, config = root.DashBridgeAnalyticsConfig,
        storageArea = chrome.storage.local, syncStorageArea = chrome.storage.sync,
        runtimeApi = chrome.runtime, fetchFn = (...args) => fetch(...args),
        randomUUID = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
        if (!contract?.normalize || !contract?.bucket || !storageArea?.get || !storageArea?.set
            || !syncStorageArea?.get || !runtimeApi?.getManifest || typeof fetchFn !== 'function') {
            throw new TypeError('DashBridge analytics dependencies are incomplete');
        }
        let cachedState = null;
        let loadPromise = null;
        let operation = Promise.resolve();
        let sendScheduled = false;

        const freshState = () => ({
            schemaVersion: STATE_VERSION,
            installationId: randomUUID(),
            aggregates: [],
            inflight: [],
            droppedAggregates: 0,
            lastSnapshotDay: '',
            lastHeartbeatDay: '',
            lastSendAttemptAt: 0,
            nextRetryAt: 0,
            retryCount: 0,
            dailyEvidence: {},
        });
        const sanitizeRecord = record => {
            const normalized = contract.normalize(record && {
                featureId: record.featureId, signal: record.signal, dimensions: record.dimensions
            });
            if (!normalized || typeof record.eventId !== 'string' || !record.eventId
                || typeof record.periodStart !== 'string' || !Number.isInteger(record.count)
                || record.count < 1 || typeof record.extensionVersion !== 'string') return null;
            return { eventId: record.eventId, periodStart: record.periodStart,
                featureId: normalized.featureId, signal: normalized.signal,
                dimensions: normalized.dimensions, count: Math.min(record.count, 1_000_000),
                extensionVersion: record.extensionVersion };
        };
        const load = async () => {
            if (cachedState) return cachedState;
            if (!loadPromise) loadPromise = (async () => {
                const stored = await storageArea.get([STORAGE_KEY]);
                const source = stored?.[STORAGE_KEY];
                const state = source && source.schemaVersion === STATE_VERSION ? { ...freshState(), ...source } : freshState();
                if (typeof state.installationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(state.installationId)) {
                    state.installationId = randomUUID();
                }
                state.aggregates = Array.isArray(state.aggregates) ? state.aggregates.map(sanitizeRecord).filter(Boolean) : [];
                state.inflight = Array.isArray(state.inflight) ? state.inflight.map(sanitizeRecord).filter(Boolean) : [];
                if (state.inflight.length) state.aggregates.unshift(...state.inflight);
                state.inflight = [];
                cachedState = state;
                return state;
            })().finally(() => { loadPromise = null; });
            return loadPromise;
        };
        const persist = state => storageArea.set({ [STORAGE_KEY]: state });
        const append = (state, normalized, timestamp = now()) => {
            const periodStart = hourStart(timestamp);
            const dimensionsKey = stableDimensions(normalized.dimensions);
            if (normalized.signal === 'effective') {
                const evidenceKey = `${dayKey(timestamp)}|${normalized.featureId}|${dimensionsKey}`;
                state.dailyEvidence = state.dailyEvidence && typeof state.dailyEvidence === 'object'
                    ? state.dailyEvidence : {};
                if (state.dailyEvidence[evidenceKey]) return null;
                state.dailyEvidence[evidenceKey] = true;
                const keepAfter = new Date(timestamp - 2 * 86_400_000).toISOString().slice(0, 10);
                Object.keys(state.dailyEvidence).forEach(key => {
                    if (key.slice(0, 10) < keepAfter) delete state.dailyEvidence[key];
                });
            }
            const existing = state.aggregates.find(item => item.periodStart === periodStart
                && item.featureId === normalized.featureId && item.signal === normalized.signal
                && stableDimensions(item.dimensions) === dimensionsKey);
            if (existing) {
                existing.count = Math.min(1_000_000, existing.count + 1);
                return existing;
            }
            const record = {
                eventId: randomUUID(), periodStart,
                featureId: normalized.featureId, signal: normalized.signal,
                dimensions: normalized.dimensions, count: 1,
                extensionVersion: runtimeApi.getManifest().version,
            };
            state.aggregates.push(record);
            const limit = Math.max(100, Number(config.queueLimit) || 2000);
            if (state.aggregates.length > limit) {
                const removed = state.aggregates.length - limit;
                state.aggregates.splice(0, removed);
                state.droppedAggregates = (Number(state.droppedAggregates) || 0) + removed;
            }
            return record;
        };
        const appendSafe = (state, input, timestamp) => {
            const normalized = contract.normalize(input);
            return normalized ? append(state, normalized, timestamp) : null;
        };
        const appendConfigured = (state, featureId, count, dimensions = {}, timestamp = now()) => {
            if (count < 1) return;
            appendSafe(state, { featureId, signal: 'configured',
                dimensions: { ...dimensions, countBucket: contract.bucket(count) } }, timestamp);
        };

        const addDailyState = async (state, timestamp) => {
            const day = dayKey(timestamp);
            if (state.lastHeartbeatDay !== day) {
                appendSafe(state, { featureId: 'extension.daily_active', signal: 'lifecycle', dimensions: {} }, timestamp);
                state.lastHeartbeatDay = day;
            }
            if (state.lastSnapshotDay === day) return;
            const [local, sync] = await Promise.all([storageArea.get(null), syncStorageArea.get(null)]);
            const profiles = Array.isArray(local.dashbridge_profiles) ? local.dashbridge_profiles : [];
            const panels = profiles.flatMap(profile => Array.isArray(profile?.panels) ? profile.panels : []);
            const tools = [
                ['removeFill', 'grafana.panel.fill_removed'], ['thickenLines', 'grafana.panel.lines_thickened'],
                ['invertLegend', 'grafana.panel.legend_inverted'], ['invertIdle', 'grafana.panel.cpu_idle_to_load'],
                ['convertMemToUsed', 'grafana.panel.ram_to_used'], ['forceMemByteUnit', 'grafana.panel.ram_force_byte_unit'],
                ['seriesQueryFilterEnabled', 'grafana.panel.series_value_filter'],
                ['cpuCapacityFilterEnabled', 'grafana.panel.load_cpu_capacity_filter'],
                ['thresholdEnabled', 'grafana.panel.threshold'],
            ];
            tools.forEach(([key, featureId]) => appendConfigured(state, featureId,
                panels.filter(panel => panel?.tools?.[key] === true).length, { surface: 'dashbridge' }, timestamp));
            // Prepared capture is one shared sync setting, not a per-panel tool.
            // Snapshot it once so persistent use remains visible without clicks.
            if (sync.grafanaCompactScreenshot === true) {
                appendConfigured(state, 'grafana.panel.compact_capture', 1, {}, timestamp);
            }
            const configuredWhen = (featureId, predicate) => appendConfigured(
                state, featureId, panels.filter(panel => predicate(panel?.tools || {})).length,
                { surface: 'dashbridge' }, timestamp
            );
            configuredWhen('grafana.panel.series_highlight', value =>
                value.seriesQueryFilterEnabled === true && value.seriesQueryFilterHighlightEnabled !== false);
            configuredWhen('grafana.panel.load_cpu_capacity_highlight', value =>
                value.cpuCapacityFilterEnabled === true && value.cpuCapacityFilterHighlightEnabled !== false);
            configuredWhen('grafana.panel.load_series_1m', value =>
                value.cpuCapacityFilterEnabled === true && value.cpuCapacityFilterLoad1 !== false);
            configuredWhen('grafana.panel.load_series_5m', value =>
                value.cpuCapacityFilterEnabled === true && value.cpuCapacityFilterLoad5 === true);
            configuredWhen('grafana.panel.load_series_15m', value =>
                value.cpuCapacityFilterEnabled === true && value.cpuCapacityFilterLoad15 === true);
            configuredWhen('grafana.panel.threshold_notification', value =>
                value.thresholdEnabled === true && value.thresholdNotifyEnabled !== false);
            appendConfigured(state, 'grafana.panel.legend_selection', panels.filter(panel =>
                Array.isArray(panel?.tools?.legendVisibleSeries) && panel.tools.legendVisibleSeries.length).length,
            { surface: 'dashbridge' }, timestamp);
            appendConfigured(state, 'dashbridge.panel_paused', panels.filter(panel => panel?.paused === true).length, {}, timestamp);
            appendConfigured(state, 'dashbridge.report_panel_settings_saved', panels.filter(panel => panel?.report?.enabled === true).length, {}, timestamp);
            appendConfigured(state, 'dashbridge.report_template_saved', profiles.filter(profile =>
                profile?.report?.enabled !== false && typeof profile?.report?.template === 'string' && profile.report.template.trim()).length,
            {}, timestamp);

            const moduleKeys = {
                module_grafana: 'grafana', module_grafana_links: 'grafana_links',
                module_grafana_batch: 'grafana_batch', module_grafana_debug: 'grafana_debug',
                module_recorder: 'recorder', module_jira: 'jira', module_tdm: 'tdm'
            };
            Object.entries(moduleKeys).forEach(([key, module]) => appendSafe(state, {
                featureId: 'options.module_availability', signal: 'configured',
                dimensions: { module, state: sync[key] === false ? 'disabled' : 'enabled' }
            }, timestamp));
            appendSafe(state, { featureId: 'options.module_availability', signal: 'configured', dimensions: {
                module: 'confluence', state: sync.confluenceScrollFixEnabled === true ? 'enabled' : 'disabled'
            } }, timestamp);
            if (sync.confluenceScrollFixEnabled === true) appendSafe(state, {
                featureId: 'confluence.fix_configured', signal: 'configured', dimensions: { state: 'enabled' }
            }, timestamp);
            if (sync.tdmSavePhotosDefault !== false) appendSafe(state, {
                featureId: 'tdm.photos_changed', signal: 'configured', dimensions: { state: 'enabled' }
            }, timestamp);
            if (sync.tdmExcludeUserDefault === true) appendSafe(state, {
                featureId: 'tdm.exclusion_changed', signal: 'configured', dimensions: { state: 'enabled' }
            }, timestamp);
            if (sync.tdmRememberDate === true) appendSafe(state, {
                featureId: 'tdm.remember_dates_changed', signal: 'configured', dimensions: { state: 'enabled' }
            }, timestamp);
            const recorder = local.dashbridgeRecorderSettings;
            if (recorder && typeof recorder === 'object') {
                if (recorder.disableCache === true) appendSafe(state, { featureId: 'recorder.cache_mode_changed', signal: 'configured', dimensions: { state: 'enabled' } }, timestamp);
                if (recorder.disableCookies === true) appendSafe(state, { featureId: 'recorder.cookie_mode_changed', signal: 'configured', dimensions: { state: 'enabled' } }, timestamp);
            }
            state.lastSnapshotDay = day;
        };

        const shouldSend = state => !!String(config.endpoint || '').trim()
            && !state.inflight.length && state.aggregates.length > 0
            && now() >= Number(state.nextRetryAt || 0)
            && (state.aggregates.length >= 50
                || now() - Number(state.lastSendAttemptAt || 0) >= Number(config.minimumSendIntervalMs || 900_000));
        const sendNow = async () => {
            const state = await load();
            if (!shouldSend(state)) return { sent: 0, reason: 'not-due' };
            const size = Math.max(1, Math.min(100, Number(config.batchSize) || 100));
            state.inflight = state.aggregates.splice(0, size);
            state.lastSendAttemptAt = now();
            await persist(state);
            try {
                const response = await fetchFn(config.endpoint, {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ schemaVersion: STATE_VERSION, installationId: state.installationId,
                        droppedAggregates: Math.max(0, Number(state.droppedAggregates) || 0), events: state.inflight }),
                    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
                });
                if (!response?.ok) throw new Error(`analytics-http-${Number(response?.status) || 0}`);
                const sent = state.inflight.length;
                state.inflight = [];
                state.droppedAggregates = 0;
                state.retryCount = 0;
                state.nextRetryAt = 0;
                await persist(state);
                return { sent };
            } catch (_error) {
                state.aggregates.unshift(...state.inflight);
                state.inflight = [];
                state.retryCount = Math.min(8, Number(state.retryCount || 0) + 1);
                state.nextRetryAt = now() + Math.min(6 * 3_600_000, 60_000 * (2 ** state.retryCount));
                await persist(state);
                return { sent: 0, reason: 'network-error' };
            }
        };
        const scheduleSend = () => {
            if (sendScheduled) return;
            sendScheduled = true;
            setTimeout(() => {
                sendScheduled = false;
                operation = operation.then(sendNow).catch(() => ({ sent: 0, reason: 'internal-error' }));
            }, 0);
        };
        const send = () => {
            operation = operation.then(sendNow).catch(() => ({ sent: 0, reason: 'internal-error' }));
            return operation;
        };
        const track = input => {
            operation = operation.then(async () => {
                const normalized = contract.normalize(input);
                if (!normalized) return { ok: false, error: 'invalid-event' };
                const state = await load();
                const timestamp = now();
                append(state, normalized, timestamp);
                await addDailyState(state, timestamp);
                await persist(state);
                scheduleSend();
                return { ok: true };
            }).catch(() => ({ ok: false, error: 'analytics-unavailable' }));
            return operation;
        };
        const recordLifecycle = (reason, previousVersion = '') => {
            const featureId = reason === 'install' ? 'extension.installed' : 'extension.updated';
            return track({ featureId, signal: 'lifecycle', dimensions: {} });
        };
        return Object.freeze({ track, send, recordLifecycle, loadState: load, storageKey: STORAGE_KEY });
    }

    root.DashBridgeBackgroundAnalytics = Object.freeze({ create, STORAGE_KEY });
})(globalThis);
