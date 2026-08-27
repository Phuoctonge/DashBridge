(function initDashBridgeGrafanaPanelAnalysis(root) {
    'use strict';

    const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizeText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const baseTitle = value => normalizeText(value).replace(/\s+calculated$/i, '').trim();
    const classifyPanelTitle = (value, settings = {}) => {
        const title = baseTitle(value).toLowerCase();
        const configured = {
            cpu: normalizeText(settings.grafanaCpuPanelTitle || 'CPU Usage').toLowerCase(),
            ram: normalizeText(settings.grafanaMemPanelTitle || 'Memory').toLowerCase(),
            load: normalizeText(settings.grafanaLoadPanelTitle || 'Load Average').toLowerCase()
        };
        if (configured.cpu && title === configured.cpu) return 'cpu';
        if (configured.ram && title === configured.ram) return 'ram';
        if (configured.load && title === configured.load) return 'load';
        return null;
    };
    const classifyTitle = (value, settings = {}) => {
        const type = classifyPanelTitle(value, settings);
        return type === 'cpu' || type === 'ram' ? type : null;
    };

    const normalizeSettings = settings => {
        const availKeyword = normalizeText(settings?.availKeyword || settings?.grafanaMemAvailKeyword || 'Available').toLowerCase();
        const configuredMode = settings?.memCalcMode ?? settings?.grafanaMemCalcMode;
        const memCalcMode = configuredMode === 'used' || configuredMode === 'available'
            ? configuredMode
            : (availKeyword.includes('used') ? 'used' : 'available');
        return {
            idleKeyword: normalizeText(settings?.idleKeyword || settings?.grafanaIdleKeyword || 'idle').toLowerCase(),
            totalKeyword: normalizeText(settings?.totalKeyword || settings?.grafanaMemTotalKeyword || 'Total').toLowerCase(),
            availKeyword,
            memCalcMode,
            trimDomain: normalizeText(settings?.trimDomain || settings?.grafanaTrimDomain || '.passport.local:9182'),
            trimDomainEnabled: settings?.trimDomainEnabled ?? settings?.grafanaTrimDomainEnabled ?? true
        };
    };
    const parsePercent = value => {
        const parsed = Number.parseFloat(String(value ?? '').replace(',', '.').replace('%', ''));
        return Number.isFinite(parsed) ? parsed : NaN;
    };
    const parseMemory = value => {
        const text = String(value ?? '');
        let parsed = Number.parseFloat(text.replace(/,/g, '.').replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(parsed)) return NaN;
        const lower = text.toLowerCase();
        if (lower.includes('ki') || lower.includes('kb')) parsed *= 1024;
        else if (lower.includes('mi') || lower.includes('mb')) parsed *= 1024 ** 2;
        else if (lower.includes('gi') || lower.includes('gb')) parsed *= 1024 ** 3;
        else if (lower.includes('ti') || lower.includes('tb')) parsed *= 1024 ** 4;
        else if (lower.includes('k')) parsed *= 1000;
        else if (lower.includes('m')) parsed *= 1000 ** 2;
        else if (lower.includes('g')) parsed *= 1000 ** 3;
        else if (lower.includes('t')) parsed *= 1000 ** 4;
        return parsed;
    };
    const cleanServerName = (value, keywords, trimDomain, trimDomainEnabled = true) => {
        let result = normalizeText(value);
        keywords.filter(Boolean).forEach(keyword => {
            result = result.replace(new RegExp(escapeRegExp(keyword), 'ig'), '');
        });
        if (trimDomainEnabled && trimDomain) result = result.replace(new RegExp(escapeRegExp(trimDomain), 'ig'), '');
        return normalizeText(result);
    };
    const serverNameForCopy = (value, settings = {}) => {
        const server = normalizeText(value);
        const trimDomain = normalizeText(settings?.trimDomain || settings?.grafanaTrimDomain || '.passport.local:9182');
        if (!server || !trimDomain) return server;
        return normalizeText(server.replace(new RegExp(`${escapeRegExp(trimDomain)}$`, 'i'), ''));
    };
    const recordValues = (record, mode) => mode === 'latest'
        ? [record?.current].filter(value => value !== null && value !== undefined && value !== '')
        : (Array.isArray(record?.values) ? record.values : []);
    const result = (type, mode, items) => {
        const sorted = items.filter(item => item.server && Number.isFinite(item.value))
            .sort((left, right) => right.value - left.value);
        return sorted.length
            ? { ok: true, type, mode, items: sorted }
            : { ok: false, type, mode, items: [], reason: 'metrics-not-found' };
    };

    const analyzeCpuRecords = (records, mode, settings) => {
        const items = [];
        for (const record of records || []) {
            const name = normalizeText(record?.name);
            const lower = name.toLowerCase();
            const isIdle = !!settings.idleKeyword && lower.includes(settings.idleKeyword);
            const isCalculated = lower.includes('load (calc)');
            if (!isIdle && !isCalculated) continue;
            const values = recordValues(record, mode).map(parsePercent).filter(Number.isFinite);
            if (!values.length) continue;
            const value = mode === 'latest'
                ? (isCalculated ? values[0] : 100 - values[0])
                : (isCalculated ? Math.max(...values) : 100 - Math.min(...values));
            items.push({
                server: cleanServerName(name, [settings.idleKeyword, 'load (calc)'], settings.trimDomain, settings.trimDomainEnabled),
                value
            });
        }
        return result('cpu', mode, items);
    };

    const analyzeRamRecords = (records, mode, settings) => {
        const calculated = [];
        const servers = new Map();
        for (const record of records || []) {
            const name = normalizeText(record?.name);
            const lower = name.toLowerCase();
            const isCalculated = lower.includes('used % (calc)');
            const isTotal = !!settings.totalKeyword && lower.includes(settings.totalKeyword);
            const isAvailable = !!settings.availKeyword && lower.includes(settings.availKeyword);
            if (!isCalculated && !isTotal && !isAvailable) continue;
            const rawValues = recordValues(record, mode);
            if (isCalculated) {
                const values = rawValues.map(parsePercent).filter(Number.isFinite);
                if (!values.length) continue;
                calculated.push({
                    server: cleanServerName(name, ['used % (calc)'], settings.trimDomain, settings.trimDomainEnabled),
                    value: mode === 'latest' ? values[0] : Math.max(...values)
                });
                continue;
            }
            const values = rawValues.map(parseMemory).filter(Number.isFinite);
            if (!values.length) continue;
            const server = cleanServerName(name, [settings.totalKeyword, settings.availKeyword], settings.trimDomain, settings.trimDomainEnabled);
            const entry = servers.get(server) || {};
            if (isTotal) entry.total = mode === 'latest' ? values[0] : Math.max(...values, entry.total ?? Number.NEGATIVE_INFINITY);
            if (isAvailable) entry.available = mode === 'latest' ? values[0] : Math.min(...values, entry.available ?? Number.POSITIVE_INFINITY);
            servers.set(server, entry);
        }
        if (calculated.length) return result('ram', mode, calculated);
        const items = [];
        for (const [server, entry] of servers) {
            if (Number.isFinite(entry.total) && Number.isFinite(entry.available) && entry.total > 0) {
                const ratio = settings.memCalcMode === 'used'
                    ? entry.available / entry.total
                    : (entry.total - entry.available) / entry.total;
                items.push({ server, value: Math.max(0, ratio) * 100 });
            } else if (!Number.isFinite(entry.total) && Number.isFinite(entry.available)
                && entry.available >= 0 && entry.available <= 100) {
                items.push({ server, value: settings.memCalcMode === 'used' ? entry.available : 100 - entry.available });
            }
        }
        return result('ram', mode, items);
    };

    const analyzeRecords = ({ type, mode = 'period', records = [], settings = {} } = {}) => {
        const normalizedMode = mode === 'latest' ? 'latest' : 'period';
        const normalizedSettings = normalizeSettings(settings);
        if (type === 'cpu') return analyzeCpuRecords(records, normalizedMode, normalizedSettings);
        if (type === 'ram') return analyzeRamRecords(records, normalizedMode, normalizedSettings);
        return { ok: false, type: null, mode: normalizedMode, items: [], reason: 'unsupported-panel' };
    };

    const fieldNames = (frame, field) => [
        field?.config?.displayName,
        field?.config?.displayNameFromDS,
        field?.name,
        ...Object.values(field?.labels || {}),
        frame?.schema?.name
    ].filter(Boolean).map(normalizeText);
    const fieldText = (frame, field) => fieldNames(frame, field).join(' ').toLowerCase();
    const serverLabel = field => ['instance', 'server', 'host', 'node', 'pod']
        .map(key => field?.labels?.[key]).find(Boolean);
    const seriesServer = (frame, field, keywords, settings) => cleanServerName(
        serverLabel(field) || field?.config?.displayName || field?.config?.displayNameFromDS
            || (field?.name && !/^value$/i.test(field.name) ? field.name : '') || frame?.schema?.name || '',
        keywords,
        settings.trimDomain,
        settings.trimDomainEnabled
    );
    const vector = value => {
        if (Array.isArray(value)) return value;
        if (value && typeof value[Symbol.iterator] === 'function') return Array.from(value);
        if (value && typeof value.length === 'number') return Array.from(value);
        return [];
    };
    const responseFrames = (data, targetRefIds) => {
        const allowed = targetRefIds === null || targetRefIds === undefined
            ? null
            : new Set(Array.from(targetRefIds, String));
        return Object.entries(data?.results || {}).flatMap(([refId, entry]) => {
            if (allowed && !allowed.has(String(refId))) return [];
            return Array.isArray(entry?.frames) ? entry.frames : [];
        });
    };
    const sortItems = items => items.filter(item => item.server && Number.isFinite(item.value))
        .sort((left, right) => right.value - left.value || left.server.localeCompare(right.server));
    const snapshotResult = (type, period, latest) => {
        const sortedPeriod = sortItems(period);
        const sortedLatest = sortItems(latest);
        return sortedPeriod.length || sortedLatest.length
            ? { ok: true, type, receivedAt: Date.now(), period: sortedPeriod, latest: sortedLatest }
            : { ok: false, type, receivedAt: Date.now(), period: [], latest: [], reason: 'metrics-not-found' };
    };
    const timeValuePairs = (times, values, convert = value => Number(value)) => {
        const result = new Map();
        const timeVector = vector(times);
        vector(values).forEach((rawValue, index) => {
            const timestamp = timeVector[index];
            const value = convert(rawValue);
            if (timestamp !== null && timestamp !== undefined && Number.isFinite(value)) result.set(String(timestamp), value);
        });
        return result;
    };
    const summarizeSeries = samples => {
        const values = [...samples.values()].filter(Number.isFinite);
        if (!values.length) return null;
        const entries = [...samples.entries()].filter(([, value]) => Number.isFinite(value));
        const timestampRank = timestamp => {
            const numeric = Number(timestamp);
            if (Number.isFinite(numeric)) return numeric;
            const parsed = Date.parse(timestamp);
            return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
        };
        const latest = entries.reduce((selected, entry) =>
            timestampRank(entry[0]) >= timestampRank(selected[0]) ? entry : selected, entries[0]);
        return { period: Math.max(...values), latest: latest[1] };
    };
    const analyzeCpuResponse = (frames, settings) => {
        const servers = new Map();
        for (const frame of frames) {
            const fields = frame?.schema?.fields || [];
            const timeIndex = fields.findIndex(field => field?.type === 'time' || field?.name === 'Time');
            if (timeIndex < 0) continue;
            fields.forEach((field, index) => {
                if (index === timeIndex) return;
                const text = fieldText(frame, field);
                const calculated = text.includes('load (calc)');
                const idle = !!settings.idleKeyword && text.includes(settings.idleKeyword);
                if (!calculated && !idle) return;
                const server = seriesServer(frame, field, [settings.idleKeyword, 'load (calc)'], settings);
                const samples = timeValuePairs(frame.data?.values?.[timeIndex], frame.data?.values?.[index], value => {
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? (calculated ? parsed : 100 - parsed) : NaN;
                });
                const summary = summarizeSeries(samples);
                if (!server || !summary) return;
                const current = servers.get(server);
                if (!current || calculated || !current.calculated) servers.set(server, { ...summary, calculated });
            });
        }
        return snapshotResult('cpu',
            [...servers].map(([server, item]) => ({ server, value: item.period })),
            [...servers].map(([server, item]) => ({ server, value: item.latest })));
    };
    const analyzeRamResponse = (frames, settings) => {
        const calculated = new Map();
        const pairs = new Map();
        for (const frame of frames) {
            const fields = frame?.schema?.fields || [];
            const timeIndex = fields.findIndex(field => field?.type === 'time' || field?.name === 'Time');
            if (timeIndex < 0) continue;
            fields.forEach((field, index) => {
                if (index === timeIndex) return;
                const text = fieldText(frame, field);
                const isCalculated = text.includes('used % (calc)');
                const isTotal = !!settings.totalKeyword && text.includes(settings.totalKeyword);
                const isAvailable = !!settings.availKeyword && text.includes(settings.availKeyword);
                if (!isCalculated && !isTotal && !isAvailable) return;
                const server = seriesServer(frame, field,
                    [settings.totalKeyword, settings.availKeyword, 'used % (calc)'], settings);
                if (!server) return;
                const samples = timeValuePairs(frame.data?.values?.[timeIndex], frame.data?.values?.[index]);
                if (isCalculated) {
                    const summary = summarizeSeries(samples);
                    if (summary) calculated.set(server, summary);
                    return;
                }
                const entry = pairs.get(server) || {};
                if (isTotal) entry.total = samples;
                if (isAvailable) entry.available = samples;
                pairs.set(server, entry);
            });
        }
        const summaries = new Map(calculated);
        for (const [server, pair] of pairs) {
            if (summaries.has(server) || !pair.total?.size || !pair.available?.size) continue;
            const used = new Map();
            pair.total.forEach((total, timestamp) => {
                if (!pair.available.has(timestamp) || total <= 0) return;
                const available = pair.available.get(timestamp);
                const value = (settings.memCalcMode === 'used' ? available / total : (total - available) / total) * 100;
                if (Number.isFinite(value)) used.set(timestamp, Math.max(0, value));
            });
            const summary = summarizeSeries(used);
            if (summary) summaries.set(server, summary);
        }
        return snapshotResult('ram',
            [...summaries].map(([server, item]) => ({ server, value: item.period })),
            [...summaries].map(([server, item]) => ({ server, value: item.latest })));
    };
    const analyzeResponse = ({ type, data, targetRefIds, settings = {} } = {}) => {
        const normalizedSettings = normalizeSettings(settings);
        const frames = responseFrames(data, targetRefIds);
        if (type === 'cpu') return analyzeCpuResponse(frames, normalizedSettings);
        if (type === 'ram') return analyzeRamResponse(frames, normalizedSettings);
        return { ok: false, type: null, receivedAt: Date.now(), period: [], latest: [], reason: 'unsupported-panel' };
    };

    const readTooltipRecords = panel => [...(panel?.querySelectorAll?.('.graph-tooltip-list-item') || [])].map(item => ({
        name: item.querySelector('.graph-tooltip-series-name')?.textContent || '',
        current: item.querySelector('.graph-tooltip-value')?.textContent || ''
    })).filter(record => record.name && record.current);
    const readLegendRecords = panel => {
        const adapterItems = root.DashBridgeGrafanaDom?.legendItems?.(panel);
        const rows = adapterItems?.length ? [...adapterItems] : [...(panel?.querySelectorAll?.(
            'tr.graph-legend-series, .u-legend tbody tr, tbody tr[class*="LegendRow"]'
        ) || [])];
        return rows.map(row => {
            const label = root.DashBridgeGrafanaDom?.legendLabel?.(row)
                || row.querySelector?.('.graph-legend-alias, [class*="LegendLabel"], [class*="legend-label" i]');
            const nativeValues = [...(row.querySelectorAll?.('td.graph-legend-value') || [])];
            const fallbackValues = nativeValues.length ? nativeValues : [...(row.querySelectorAll?.('td') || [])]
                .filter(cell => cell !== label && !cell.contains?.(label));
            const current = row.querySelector?.('td.graph-legend-value.current, td.graph-legend-value.last, td.graph-legend-value.min')
                || fallbackValues.at(-1);
            return {
                name: normalizeText(label?.textContent),
                current: normalizeText(current?.textContent),
                values: fallbackValues.map(cell => normalizeText(cell.textContent)).filter(Boolean)
            };
        }).filter(record => record.name);
    };
    const analyzePanel = ({ panel, type, mode = 'period', settings = {} } = {}) => {
        if (!panel) return { ok: false, type, mode, items: [], reason: 'panel-not-found' };
        if (mode === 'latest') {
            const tooltipResult = analyzeRecords({ type, mode, records: readTooltipRecords(panel), settings });
            if (tooltipResult.ok) return tooltipResult;
        }
        return analyzeRecords({ type, mode, records: readLegendRecords(panel), settings });
    };

    root.DashBridgeGrafanaPanelAnalysis = Object.freeze({
        baseTitle,
        classifyPanelTitle,
        classifyTitle,
        serverNameForCopy,
        analyzeRecords,
        analyzeResponse,
        analyzePanel,
        readLegendRecords
    });
})(globalThis);
