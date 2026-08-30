// URL and time-range helpers shared by Grafana tools.
function parseGrafanaDashboardUrl(value) {
    try {
        const url = new URL(value);
        const parts = url.pathname.split('/');
        const dashboardIndex = parts.indexOf('d');
        if (dashboardIndex === -1 || !parts[dashboardIndex + 1]) return null;
        const orgId = url.searchParams.get('orgId');
        const basePath = parts.slice(0, dashboardIndex).join('/').replace(/\/$/, '');
        return {
            baseUrl: `${url.origin}${basePath}`,
            origin: url.origin,
            basePath,
            uid: parts[dashboardIndex + 1],
            orgId
        };
    } catch {
        return null;
    }
}

function parseGrafanaTimePoint(value) {
    const source = String(value || '').trim();
    if (!source) return null;

    // Grafana-relative expressions are already a valid and more useful form.
    if (/^now(?:[+-]\d+(?:ms|s|m|h|d|w|M|y))?(?:\/[a-zA-Z]+)?$/i.test(source)) return source;

    // Grafana accepts Unix time in milliseconds. Seconds are a frequent input
    // format, so distinguish them by length rather than relying on Date.parse.
    if (/^(?:\d{10}|\d{13})$/.test(source)) {
        let timestamp = Number(source);
        if (source.length === 10) timestamp *= 1000;
        return Number.isFinite(timestamp) ? String(timestamp) : null;
    }

    // Parse numeric dates explicitly. This avoids browser-dependent handling of
    // 01/02/2026 and treats it as the usual Russian dd/mm/yyyy format.
    const match = source.match(/^(?:(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}))(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/);
    if (match) {
        const year = Number(match[1] || match[6]);
        const month = Number(match[2] || match[5]);
        const day = Number(match[3] || match[4]);
        const hour = Number(match[7] || 0);
        const minute = Number(match[8] || 0);
        const second = Number(match[9] || 0);
        const millisecond = Number(String(match[10] || 0).padEnd(3, '0'));
        const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
            && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second) {
            return String(date.getTime());
        }
        return null;
    }

    // ISO 8601 (including an explicit UTC offset) and textual browser-supported
    // formats are useful fallbacks. Invalid dates intentionally return null.
    const timestamp = Date.parse(source);
    return Number.isFinite(timestamp) ? String(timestamp) : null;
}

function normalizeGrafanaTimeRanges(value) {
    const ranges = [];
    const errors = [];
    String(value || '').split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        const [from, to, ...rest] = line.split(',').map(item => item.trim());
        const normalizedFrom = rest.length === 0 ? parseGrafanaTimePoint(from) : null;
        const normalizedTo = rest.length === 0 ? parseGrafanaTimePoint(to) : null;
        if (normalizedFrom && normalizedTo) ranges.push({ from: normalizedFrom, to: normalizedTo });
        else errors.push(index + 1);
    });
    return { ranges, errors };
}

function applyGrafanaCaptureTheme(value, theme = 'current') {
    const url = new URL(value);
    if (theme === 'light' || theme === 'dark') url.searchParams.set('theme', theme);
    else url.searchParams.delete('theme');
    return url.toString();
}

function applyGrafanaCompleteHideSelection(value, visibleSeries, targetQuerySignatures = []) {
    const url = new URL(value);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const visible = [...new Set((visibleSeries || [])
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(Boolean))];
    const signatures = [...new Set((targetQuerySignatures || [])
        .filter(signature => typeof signature === 'string' && signature))];
    hashParams.set('dashbridgeLegendSelection', JSON.stringify({ version: 2, visibleSeries: visible }));
    if (signatures.length) hashParams.set('dashbridgeTargetQuerySignatures', JSON.stringify(signatures));
    else hashParams.delete('dashbridgeTargetQuerySignatures');
    hashParams.delete('dashbridgeLegendFilter');
    url.hash = hashParams.toString();
    url.searchParams.delete('dashbridgeLegendSelection');
    url.searchParams.delete('dashbridgeTargetQuerySignatures');
    url.searchParams.delete('dashbridgeLegendFilter');
    return url.toString();
}

function buildGrafanaPanelUrl(value, panelId, { from = null, to = null, theme = 'current' } = {}) {
    const url = new URL(value);
    url.searchParams.set('viewPanel', panelId);
    if (from === null) url.searchParams.delete('from');
    else url.searchParams.set('from', from);
    if (to === null) url.searchParams.delete('to');
    else url.searchParams.set('to', to);
    return applyGrafanaCaptureTheme(url.toString(), theme);
}

function buildGrafanaSoloPanelUrl(value, panelId, { from = null, to = null, theme = 'current' } = {}) {
    const url = new URL(value);
    const parts = url.pathname.split('/');
    const dashboardIndex = parts.indexOf('d');
    if (dashboardIndex !== -1) parts[dashboardIndex] = 'd-solo';
    url.pathname = parts.join('/');
    url.searchParams.delete('viewPanel');
    url.searchParams.set('panelId', panelId);
    if (from === null) url.searchParams.delete('from');
    else url.searchParams.set('from', from);
    if (to === null) url.searchParams.delete('to');
    else url.searchParams.set('to', to);
    return applyGrafanaCaptureTheme(url.toString(), theme);
}
