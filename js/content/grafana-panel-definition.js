(function initDashBridgeGrafanaPanelDefinition(globalScope) {
    'use strict';
    if (globalScope.DashBridgeGrafanaPanelDefinition) return;

    // Grafana stores the semantic unit in the panel definition, while the
    // axis contains the *currently selected display scale* (GiB vs TiB,
    // MB/s vs GB/s).  We need both: the definition is a reliable fallback,
    // and the axis supplies the conversion factor the user sees.
    // BUG-G fix: заменён singleton-объект на Map, чтобы параллельные запросы
    // к разным панелям не перезаписывали кеш друг друга.
    const PANEL_DEFINITION_CACHE_LIMIT = 50;
    const PANEL_DEFINITION_CACHE_TTL_MS = 5 * 60 * 1000;
    const panelDefinitionCache = new Map(); // key → { value, promise, accessedAt }
    const touchPanelDefinitionCache = (key, entry) => {
        entry.accessedAt = Date.now();
        panelDefinitionCache.delete(key);
        panelDefinitionCache.set(key, entry);
        while (panelDefinitionCache.size > PANEL_DEFINITION_CACHE_LIMIT) {
            const oldestKey = panelDefinitionCache.keys().next().value;
            panelDefinitionCache.delete(oldestKey);
        }
    };

    const getPanelLocation = () => {
        const uid = location.pathname.match(/\/d(?:-solo)?\/([^/]+)/)?.[1] || '';
        const params = new URLSearchParams(location.search);
        // In a regular Grafana URL viewPanel is the panel actually open on
        // screen; panelId can be left over from the original copied link.
        const panelId = params.get('viewPanel') || params.get('panelId') || '';
        return { uid, panelId: String(panelId) };
    };

    const flattenPanels = panels => (panels || []).flatMap(panel => [
        panel,
        ...flattenPanels(panel.panels)
    ]);

    // Синхронный доступ к уже загруженному определению панели по текущей локации.
    // Используется в синхронных функциях (getThresholdUnit, setThreshold),
    // которые не могут ждать fetch. Возвращает null, если определение ещё не загружено.
    const getCachedPanelDefinition = () => {
        const { uid, panelId } = getPanelLocation();
        if (!uid || !panelId) return null;
        const key = `${uid}:${panelId}`;
        const entry = panelDefinitionCache.get(key);
        if (!entry || Date.now() - entry.accessedAt > PANEL_DEFINITION_CACHE_TTL_MS) {
            panelDefinitionCache.delete(key);
            return null;
        }
        touchPanelDefinitionCache(key, entry);
        return entry.value ?? null;
    };

    // BUG-G fix: кеш переключён с единственного объекта на Map.
    // Каждая панель хранит своё состояние независимо — параллельные вызовы
    // для разных панелей больше не перезаписывают кеш друг друга.
    const getPanelDefinition = async ({ root = document, panelId: requestedPanelId = '' } = {}) => {
        const { uid, panelId: locationPanelId } = getPanelLocation();
        const panelId = String(
            requestedPanelId
            || window.DashBridgeGrafanaDom?.panelKey?.(root)
            || locationPanelId
            || ''
        ).replace(/^panel-/, '');
        // Public d-solo embeds can render a panel without granting access to
        // the dashboard-definition API.  Avoid a guaranteed 404 there; the
        // chart axis remains the source for threshold units in this mode.
        if (!uid || !panelId || location.pathname.startsWith('/d-solo/')) return null;
        const key = `${uid}:${panelId}`;
        const cached = panelDefinitionCache.get(key);
        if (cached && Date.now() - cached.accessedAt <= PANEL_DEFINITION_CACHE_TTL_MS) {
            touchPanelDefinitionCache(key, cached);
            if (cached.value) return cached.value;
            if (cached.promise) return cached.promise;
        } else if (cached) panelDefinitionCache.delete(key);

        const entry = { value: null, promise: null, accessedAt: Date.now() };
        touchPanelDefinitionCache(key, entry);
        entry.promise = fetch(`/api/dashboards/uid/${encodeURIComponent(uid)}`)
            .then(response => response.ok ? response.json() : null)
            .then(data => flattenPanels(data?.dashboard?.panels)
                .find(panel => String(panel?.id) === panelId) || null)
            .catch(() => null)
            .then(panel => {
                entry.value = panel;
                touchPanelDefinitionCache(key, entry);
                return panel;
            })
            .finally(() => {
                entry.promise = null;
            });
        return entry.promise;
    };

    // Grafana's datasource payload does not include panelId.  A compact,
    // stable fingerprint of the panel's configured targets lets the MAIN-world
    // interceptor recognise only responses belonging to that panel.
    const querySignatureKeys = ['refId', 'alias', 'expr', 'datasource', 'legendFormat', 'measurement', 'policy', 'rawQuery', 'rawSql', 'query', 'select', 'groupBy', 'where', 'orderByTime', 'resultFormat', 'dsType'];
    // Grafana replaces dashboard variables (for example `$project`) in the
    // datasource payload. Keep a second fingerprint for matching that runtime
    // form without weakening the stable target shape.
    const queryScopeSignatureKeys = querySignatureKeys.filter(key => !['measurement', 'query', 'rawSql'].includes(key));
    const stableJson = value => {
        if (Array.isArray(value)) return value.map(stableJson);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
        return value;
    };
    const getQuerySignatureForKeys = (query, keys) => JSON.stringify(stableJson(Object.fromEntries(
        keys.filter(key => Object.hasOwn(query || {}, key)).map(key => [key, query[key]])
    )));
    const getQuerySignature = query => getQuerySignatureForKeys(query, querySignatureKeys);
    const getQueryScopeSignature = query => getQuerySignatureForKeys(query, queryScopeSignatureKeys);
    const templateVariablePattern = /\$\{[A-Za-z_][\w]*(?::[^}]*)?\}|\$[A-Za-z_][\w]*/g;
    const stringMatchesTemplate = (template, runtimeValue) => {
        const source = String(template ?? '');
        const actual = String(runtimeValue ?? '');
        templateVariablePattern.lastIndex = 0;
        if (!templateVariablePattern.test(source)) return source === actual;
        templateVariablePattern.lastIndex = 0;
        const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let pattern = '';
        let cursor = 0;
        for (const match of source.matchAll(templateVariablePattern)) {
            pattern += escape(source.slice(cursor, match.index)) + '.*?';
            cursor = match.index + match[0].length;
        }
        pattern += escape(source.slice(cursor));
        return new RegExp(`^${pattern}$`).test(actual);
    };
    const valueMatchesTemplate = (configured, runtime) => {
        if (typeof configured === 'string') return stringMatchesTemplate(configured, runtime);
        if (Array.isArray(configured)) {
            return Array.isArray(runtime) && configured.length === runtime.length
                && configured.every((value, index) => valueMatchesTemplate(value, runtime[index]));
        }
        if (configured && typeof configured === 'object') {
            return !!runtime && typeof runtime === 'object' && !Array.isArray(runtime)
                && Object.keys(configured).every(key => Object.hasOwn(runtime, key)
                    && valueMatchesTemplate(configured[key], runtime[key]));
        }
        return Object.is(configured, runtime);
    };
    const queryMatchesConfiguredTarget = (configured, runtime) => {
        if (!configured || !runtime || typeof configured !== 'object' || typeof runtime !== 'object') return false;
        if (!configured.refId || String(configured.refId) !== String(runtime.refId || '')) return false;
        const comparableKeys = querySignatureKeys.filter(key => key !== 'refId' && Object.hasOwn(configured, key));
        if (!comparableKeys.length) return false;
        return comparableKeys.every(key => Object.hasOwn(runtime, key)
            && valueMatchesTemplate(configured[key], runtime[key]));
    };
    const getPanelQuerySignaturesAsync = async ({ root = document, panelId = '' } = {}) => {
        const panel = await getPanelDefinition({ root, panelId });
        return [...new Set((panel?.targets || []).map(getQuerySignature).filter(signature => signature !== '{}'))];
    };

    globalThis.DashBridgeGrafanaPanelDefinition = Object.freeze({
        getPanelLocation,
        getCachedPanelDefinition,
        getPanelDefinition,
        getQuerySignature,
        getQueryScopeSignature,
        queryMatchesConfiguredTarget,
        getPanelQuerySignaturesAsync
    });
})(globalThis);
