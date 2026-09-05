// Captures Grafana's own datasource response for one Batch Series request.
(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('dashbridgeSeriesCapture');
    if (!token) return;
    // Защита от двойного патча при повторном executeScript на той же странице.
    // Без этого fetch/XHR оборачиваются дважды и state.names перезаписывается
    // вторым проходом перехватчика.
    if (window.__dashBridgeSeriesCaptureToken === token) return;
    window.__dashBridgeSeriesCaptureToken = token;

    let configured;
    try {
        const parsed = JSON.parse(params.get('dashbridgeSeriesTargets') || '[]');
        if (!Array.isArray(parsed) || parsed.length > 1000) return;
        configured = parsed.map(value => JSON.parse(value));
    } catch { return; }
    const identity = query => `${query?.refId || ''}\u0000${query?.alias || ''}`;
    const expectedIdentities = new Set(configured.map(identity));
    const namesFrom = data => {
        const names = [];
        Object.values(data?.results || {}).forEach(result => {
            (result.frames || []).forEach(frame => {
                const frameName = String(frame.schema?.name || '').trim();
                (frame.schema?.fields || []).forEach(field => {
                    if (field.type === 'time' || field.name === 'Time') return;
                    const values = [field.config?.displayName, field.config?.displayNameFromDS, frameName, field.name, ...Object.values(field.labels || {})]
                        .map(value => String(value || '').trim()).filter(Boolean);
                    const name = values.find(value => value !== 'Value' && value !== 'value') || values[0];
                    if (name) names.push(name);
                });
            });
        });
        return names;
    };
    window.__dashBridgeSeriesCapture = {
        token,
        names: null,
        expectedCount: expectedIdentities.size,
        lastMatchAt: 0,
        matchedIdentities: [],
        batches: {},
        debug: { requests: 0, matched: 0 }
    };
    const capture = (body, data) => {
        const queries = body?.queries || [];
        const state = window.__dashBridgeSeriesCapture;
        state.debug.requests++;
        const matcher = window.DashBridgeGrafanaPanelDefinition?.queryMatchesConfiguredTarget;
        const matchedQueries = queries.filter(query => typeof matcher === 'function'
            && configured.some(target => matcher(target, { ...query, alias: query.alias ?? '' })));
        const matchingIdentities = matchedQueries.map(identity);
        if (!matchingIdentities.length) return;
        state.debug.matched++;
        const datasourceKeys = queries.map(query => String(query?.datasource?.uid || query?.datasource?.type || query?.datasourceId || '')).sort();
        const batchKey = JSON.stringify([matchingIdentities.sort(), datasourceKeys]);
        const refs = new Set(matchedQueries.map(query => String(query.refId)));
        state.batches[batchKey] = namesFrom({ results: Object.fromEntries(
            Object.entries(data?.results || {}).filter(([ref]) => refs.has(ref))
        ) });
        state.matchedIdentities = [...new Set([...state.matchedIdentities, ...matchingIdentities])];
        state.names = Object.keys(state.batches).sort().flatMap(key => state.batches[key]);
        state.lastMatchAt = Date.now();
        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('dashbridgeSeriesCaptureUpdated', {
                detail: { token }
            }));
        }
    };
    const parseBody = body => { try { return JSON.parse(body || '{}'); } catch { return {}; } };
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const [input, init] = args;
        const url = typeof input === 'string' ? input : input?.url || '';
        let requestBody = '';
        if (url.includes('api/ds/query')) {
            try { requestBody = init?.body ?? (input instanceof Request ? await input.clone().text() : ''); } catch { /* Native fetch owns body errors. */ }
        }
        const response = await originalFetch(...args);
        if (url.includes('api/ds/query')) response.clone().json().then(data => capture(parseBody(requestBody), data)).catch(() => undefined);
        return response;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        this.__dashBridgeSeriesUrl = String(url);
        return originalOpen.call(this, method, url, ...args);
    };
    XMLHttpRequest.prototype.send = function (body) {
        if (this.__dashBridgeSeriesUrl?.includes('api/ds/query')) {
            const request = parseBody(body);
            this.addEventListener('load', () => { try { capture(request, JSON.parse(this.responseText)); } catch { } }, { once: true });
        }
        return originalSend.call(this, body);
    };
})();
