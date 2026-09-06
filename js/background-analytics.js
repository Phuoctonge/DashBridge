(function initDashBridgeBackgroundAnalytics(root) {
    'use strict';

    const STORAGE_KEY = 'dashbridgeAnalyticsState';
    const INSTALLATION_ID_KEY = 'dashbridgeInstallationId';
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
        let activeSend = null;
        const enqueue = task => {
            const result = operation.then(task);
            operation = result.catch(() => undefined);
            return result;
        };

        const validInstallationId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
        const counter = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
        const queueLimit = Math.max(100, Math.min(2000, Number(config.queueLimit) || 2000));
        const freshState = (installationId = randomUUID()) => ({
            schemaVersion: STATE_VERSION,
            installationId,
            aggregates: [],
            inflight: [],
            droppedAggregates: 0,
            lastSnapshotDay: '',
            lastHeartbeatDay: '',
            lastSendAttemptAt: 0,
            nextRetryAt: 0,
            retryCount: 0,
            dailyEvidence: {},
            lastSuccessAt: 0,
            lastError: '',
            quarantine: [],
            quarantinedCount: 0,
        });
        const sanitizeRecord = record => {
            const normalized = contract.normalize(record && {
                featureId: record.featureId, signal: record.signal, dimensions: record.dimensions
            });
            if (!normalized || !validInstallationId(record.eventId)
                || typeof record.periodStart !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(record.periodStart)
                || !Number.isFinite(Date.parse(record.periodStart))
                || new Date(record.periodStart).toISOString() !== record.periodStart
                || Date.parse(record.periodStart) > now() + 24 * 3_600_000
                || !Number.isInteger(record.count) || record.count < 1 || record.count > 1_000_000
                || typeof record.extensionVersion !== 'string'
                || !/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/.test(record.extensionVersion)) return null;
            return { eventId: record.eventId, periodStart: record.periodStart,
                featureId: normalized.featureId, signal: normalized.signal,
                dimensions: normalized.dimensions, count: Math.min(record.count, 1_000_000),
                extensionVersion: record.extensionVersion };
        };
        const load = async () => {
            if (cachedState) return cachedState;
            if (!loadPromise) loadPromise = (async () => {
                const stored = await storageArea.get([STORAGE_KEY, INSTALLATION_ID_KEY]);
                const source = stored?.[STORAGE_KEY];
                const installationId = validInstallationId(stored?.[INSTALLATION_ID_KEY])
                    ? stored[INSTALLATION_ID_KEY]
                    : (validInstallationId(source?.installationId) ? source.installationId : randomUUID());
                const state = freshState(installationId);
                if (source?.schemaVersion === STATE_VERSION) {
                    state.droppedAggregates = counter(source.droppedAggregates);
                    const restore = (values, cap) => {
                        if (!Array.isArray(values)) return [];
                        const records = values.slice(0, cap).map(sanitizeRecord).filter(Boolean);
                        state.droppedAggregates = counter(Math.min(1_000_000, state.droppedAggregates + values.length - records.length));
                        return records;
                    };
                    state.inflight = restore(source.inflight, 100);
                    state.aggregates = restore(source.aggregates, queueLimit - state.inflight.length);
                    state.quarantine = Array.isArray(source.quarantine) ? source.quarantine.slice(0, 100).map(sanitizeRecord).filter(Boolean) : [];
                    state.quarantinedCount = counter(source.quarantinedCount);
                    state.retryCount = Math.min(8, counter(source.retryCount));
                    for (const key of ['lastSendAttemptAt', 'nextRetryAt', 'lastSuccessAt']) {
                        state[key] = Number.isFinite(source[key]) && source[key] >= 0 ? Math.min(source[key], now() + 6 * 3_600_000) : 0;
                    }
                    for (const key of ['lastSnapshotDay', 'lastHeartbeatDay']) {
                        if (typeof source[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source[key])) state[key] = source[key];
                    }
                    state.lastError = ['network', 'timeout', 'http_400', 'configuration', 'rate_limit', 'server', 'http', 'storage'].includes(source.lastError) ? source.lastError : '';
                    const evidence = source.dailyEvidence;
                    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
                        for (const key of Object.keys(evidence).slice(0, 2000)) {
                            if (key.length <= 512 && /^\d{4}-\d{2}-\d{2}\|/.test(key) && evidence[key] === true
                                && key.slice(0, 10) >= dayKey(now() - 2 * 86_400_000) && key.slice(0, 10) <= dayKey(now())) state.dailyEvidence[key] = true;
                        }
                    }
                }
                // Retry the immutable batch with the same IDs after restart.
                // Merging it into aggregates could change already acknowledged counts.
                cachedState = state;
                return state;
            })().finally(() => { loadPromise = null; });
            return loadPromise;
        };
        const persist = state => storageArea.set({
            [STORAGE_KEY]: state,
            [INSTALLATION_ID_KEY]: state.installationId,
        });
        const append = (state, normalized, timestamp = now()) => {
            const periodStart = hourStart(timestamp);
            const extensionVersion = runtimeApi.getManifest().version;
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
                const evidenceKeys = Object.keys(state.dailyEvidence);
                evidenceKeys.slice(0, Math.max(0, evidenceKeys.length - 2000)).forEach(key => delete state.dailyEvidence[key]);
            }
            const existing = state.aggregates.find(item => item.periodStart === periodStart
                && item.extensionVersion === extensionVersion
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
                extensionVersion,
            };
            state.aggregates.push(record);
            const limit = queueLimit - state.inflight.length;
            if (state.aggregates.length > limit) {
                const removed = state.aggregates.length - limit;
                state.aggregates.splice(0, removed);
                state.droppedAggregates = Math.min(1_000_000, counter(state.droppedAggregates) + removed);
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
            const [local, sync] = await Promise.all([
                storageArea.get(['dashbridge_profiles', 'dashbridgeRecorderSettings']),
                syncStorageArea.get(['grafanaCompactScreenshot', 'module_grafana', 'module_grafana_links',
                    'module_grafana_batch', 'module_grafana_debug', 'module_recorder', 'module_jira',
                    'module_tdm', 'confluenceScrollFixEnabled', 'tdmSavePhotosDefault',
                    'tdmExcludeUserDefault', 'tdmRememberDate'])
            ]);
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
            && (state.inflight.length > 0 || state.aggregates.length > 0)
            && now() >= Number(state.nextRetryAt || 0)
            && now() - Number(state.lastSendAttemptAt || 0) >= Number(config.minimumSendIntervalMs ?? 900_000);
        const sendNow = async () => {
            const batch = await enqueue(async () => {
                const state = await load();
                if (!shouldSend(state)) return null;
                const size = Math.max(1, Math.min(100, Number(config.batchSize) || 100));
                if (!state.inflight.length) state.inflight = state.aggregates.splice(0, size);
                state.lastSendAttemptAt = now();
                await persist(state);
                return { schemaVersion: STATE_VERSION, installationId: state.installationId,
                    droppedAggregates: Math.max(0, Number(state.droppedAggregates) || 0), events: state.inflight };
            });
            if (!batch) return { sent: 0, reason: 'not-due' };
            const controller = new AbortController();
            let timer;
            let succeeded = false;
            let errorCategory = 'network';
            let retryAfterMs = 0;
            try {
                const deadline = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        errorCategory = 'timeout'; controller.abort(); reject(new Error('analytics-timeout'));
                    }, Math.min(25_000, Math.max(1000, Number(config.requestTimeoutMs) || 15_000)));
                });
                const response = await Promise.race([deadline, fetchFn(config.endpoint, {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(batch), signal: controller.signal,
                    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
                })]);
                if (!response?.ok) {
                    const code = Number(response?.status) || 0;
                    errorCategory = code === 400 ? 'http_400' : [401, 403].includes(code) ? 'configuration'
                        : code === 429 ? 'rate_limit' : code >= 500 ? 'server' : 'http';
                    const retry = response?.headers?.get('Retry-After');
                    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now();
                    if (Number.isFinite(delay)) retryAfterMs = Math.max(0, Math.min(6 * 3_600_000, delay));
                    throw new Error('analytics-http');
                }
                succeeded = true;
            } catch { /* Retry retains the original event IDs and counts. */ }
            finally { clearTimeout(timer); }
            return enqueue(async () => {
                const state = await load();
                if (succeeded) {
                    state.inflight = [];
                    state.droppedAggregates = Math.max(0, state.droppedAggregates - batch.droppedAggregates);
                    state.retryCount = 0; state.nextRetryAt = 0;
                    state.lastSuccessAt = now(); state.lastError = '';
                } else {
                    state.lastError = errorCategory;
                    if (errorCategory === 'http_400') {
                        // Preserve the latest rejected batch locally, without blocking later batches.
                        state.quarantine = state.inflight;
                        state.quarantinedCount = counter(Math.min(1_000_000, state.quarantinedCount + state.inflight.length));
                        state.droppedAggregates = counter(Math.min(1_000_000, state.droppedAggregates + state.inflight.length));
                        state.inflight = [];
                    }
                    state.retryCount = Math.min(8, Number(state.retryCount || 0) + 1);
                    state.nextRetryAt = now() + Math.max(retryAfterMs, Math.min(6 * 3_600_000, 60_000 * (2 ** state.retryCount)));
                }
                await persist(state);
                return succeeded ? { sent: batch.events.length } : { sent: 0, reason: 'network-error' };
            });
        };
        const scheduleSend = () => {
            if (sendScheduled) return;
            sendScheduled = true;
            setTimeout(() => {
                sendScheduled = false;
                void send();
            }, 0);
        };
        const send = () => {
            if (!activeSend) activeSend = sendNow().catch(() => ({ sent: 0, reason: 'internal-error' }))
                .finally(() => { activeSend = null; });
            return activeSend;
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

    root.DashBridgeBackgroundAnalytics = Object.freeze({ create, STORAGE_KEY, INSTALLATION_ID_KEY });
})(globalThis);
