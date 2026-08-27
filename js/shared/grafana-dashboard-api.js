// Grafana dashboard metadata helpers shared by Batch tools.
function grafanaApiUrl(dashboard, path) {
    const apiUrl = new URL(`${dashboard.baseUrl}${path}`);
    if (dashboard.orgId) apiUrl.searchParams.set('orgId', dashboard.orgId);
    return apiUrl;
}

async function fetchGrafanaDashboardDefinition(dashboardUrl) {
    const dashboard = parseGrafanaDashboardUrl(dashboardUrl);
    if (!dashboard) throw new Error('Invalid Grafana dashboard URL');
    const response = await fetch(grafanaApiUrl(dashboard, `/api/dashboards/uid/${dashboard.uid}`).toString(), {
        credentials: 'include'
    });
    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url || '';
    const redirectedToLogin = response.redirected && /\/(?:login|signin)(?:[/?#]|$)/i.test(finalUrl);
    if (!response.ok || redirectedToLogin || !contentType.toLowerCase().includes('json')) {
        const error = new Error(!response.ok ? `HTTP Error ${response.status}` : 'Grafana authorization is required');
        error.status = response.status;
        error.code = redirectedToLogin || !contentType.toLowerCase().includes('json') ? 'GRAFANA_AUTH_REQUIRED' : 'GRAFANA_HTTP_ERROR';
        error.finalUrl = finalUrl;
        throw error;
    }
    let payload;
    try {
        payload = await response.json();
    } catch {
        const error = new Error('Grafana returned an invalid dashboard response');
        error.status = response.status;
        error.code = 'GRAFANA_INVALID_RESPONSE';
        throw error;
    }
    return { dashboard, payload };
}

function findGrafanaDashboardPanel(dashboard, panelId) {
    const queue = [...(dashboard?.panels || [])];
    while (queue.length) {
        const panel = queue.shift();
        if (String(panel?.id) === String(panelId)) return panel;
        if (Array.isArray(panel?.panels)) queue.push(...panel.panels);
    }
    return null;
}

const grafanaQuerySignatureKeys = [
    'refId', 'alias', 'measurement', 'policy', 'rawQuery', 'rawSql', 'query',
    'select', 'groupBy', 'where', 'orderByTime', 'resultFormat', 'dsType'
];

function stableGrafanaValue(value) {
    if (Array.isArray(value)) return value.map(stableGrafanaValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableGrafanaValue(value[key])]));
    }
    return value;
}

function getGrafanaQuerySignature(query) {
    const source = query || {};
    const selected = Object.fromEntries(grafanaQuerySignatureKeys
        .filter(key => Object.hasOwn(source, key))
        .map(key => [key, source[key]]));
    return JSON.stringify(stableGrafanaValue(selected));
}

function getGrafanaPanelQuerySignatures(panel) {
    return [...new Set((panel?.targets || [])
        .filter(target => !target?.hide)
        .map(getGrafanaQuerySignature))];
}

async function fetchGrafanaDashboardPanels(dashboardUrl) {
    const { dashboard, payload } = await fetchGrafanaDashboardDefinition(dashboardUrl);
    const panels = {};
    const panelList = [];
    const queue = (payload.dashboard?.panels || []).map((panel, index) => ({ panel, path: [index] }));
    while (queue.length) {
        const { panel, path } = queue.shift();
        if (Array.isArray(panel?.panels)) {
            queue.push(...panel.panels.map((child, index) => ({ panel: child, path: [...path, index] })));
        } else if (panel?.id !== undefined && panel?.id !== null) {
            const item = {
                id: String(panel.id),
                title: panel.title || `Panel_${panel.id}`,
                type: panel.type || '',
                gridPos: panel.gridPos || null,
                path,
                targets: panel.targets || [],
                libraryPanel: panel.libraryPanel || null
            };
            panelList.push(item);
            panels[item.id] = item.title;
        }
    }
    panelList.sort((left, right) => {
        const ly = Number(left.gridPos?.y);
        const ry = Number(right.gridPos?.y);
        const lx = Number(left.gridPos?.x);
        const rx = Number(right.gridPos?.x);
        if (Number.isFinite(ly) && Number.isFinite(ry) && ly !== ry) return ly - ry;
        if (Number.isFinite(lx) && Number.isFinite(rx) && lx !== rx) return lx - rx;
        return left.path.join('.').localeCompare(right.path.join('.'), undefined, { numeric: true });
    });
    return { dashboard, payload, panels, panelList };
}
