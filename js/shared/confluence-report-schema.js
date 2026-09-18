(function initConfluenceReportSchema(root) {
    'use strict';
    const text = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const keyText = value => text(value).toLocaleLowerCase('ru-RU');
    const safePath = value => {
        const file = text(value).replace(/\\/g, '/');
        if (!file || file.startsWith('/') || file.includes('\0') || file.split('/').some(part => part === '..' || part === '.')) {
            throw new Error(`Unsafe archive path: ${file || '<empty>'}`);
        }
        return file;
    };
    const optionalText = value => text(value) || null;
    const normalizeCapture = raw => {
        if (!raw || typeof raw !== 'object') throw new Error('Capture record must be an object');
        return Object.freeze({
            file: safePath(raw.file),
            testKey: optionalText(raw.testKey)?.toLocaleLowerCase('ru-RU') || null,
            testTitle: optionalText(raw.testTitle), metricGroup: optionalText(raw.metricGroup),
            metric: optionalText(raw.metric)?.toLocaleLowerCase('ru-RU') || null,
            panelId: raw.panelId == null ? null : text(raw.panelId), panelTitle: optionalText(raw.panelTitle),
            from: optionalText(raw.from), to: optionalText(raw.to),
            sha256: optionalText(raw.sha256)?.toLocaleLowerCase('en-US') || null,
            occurrence: Number.isInteger(raw.occurrence) && raw.occurrence >= 0 ? raw.occurrence : null,
        });
    };
    const normalizeManifest = raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Manifest must be an object');
        const captures = Array.isArray(raw.captures) ? raw.captures.map(normalizeCapture) : [];
        const seen = new Set(); captures.forEach(item => { if (seen.has(item.file)) throw new Error(`Duplicate capture path: ${item.file}`); seen.add(item.file); });
        return Object.freeze({
            schemaVersion: raw.schemaVersion === 2 ? 2 : 1,
            kind: raw.kind === 'series' ? 'series' : 'panels', generatedAt: optionalText(raw.generatedAt),
            dashboard: raw.dashboard && typeof raw.dashboard === 'object' ? Object.freeze({
                origin: optionalText(raw.dashboard.origin), basePath: optionalText(raw.dashboard.basePath) || '',
                uid: optionalText(raw.dashboard.uid), orgId: optionalText(raw.dashboard.orgId),
            }) : null,
            captures: Object.freeze(captures),
            errors: Object.freeze(Array.isArray(raw.errors) ? raw.errors.slice(0, 500).map(item => Object.freeze({ file: optionalText(item?.file) || '', reason: optionalText(item?.reason) || 'unknown' })) : []),
        });
    };
    const logicalKey = record => { const item = normalizeCapture(record); return [keyText(item.testKey || item.testTitle || ''), keyText(item.metricGroup || ''), keyText(item.metric || item.panelTitle || ''), item.occurrence == null ? '' : String(item.occurrence)].join('\0'); };
    root.DashBridgeConfluenceReportSchema = Object.freeze({ normalizeManifest, logicalKey, normalizeCapture });
})(globalThis);
