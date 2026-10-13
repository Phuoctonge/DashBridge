(function initConfluenceReportPreview(root) {
    'use strict';

    const norm = value => String(value ?? '').normalize('NFKC').replace(/[_\s]+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    const basename = value => {
        const last = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
        try { return decodeURIComponent(last); } catch { return last; }
    };
    const metricFromReference = reference => norm(basename(reference?.filename || reference?.src || '')
        .replace(/\.[a-z0-9]{2,8}(?:\?.*)?$/i, '')
        .replace(/_\d+_\d{8,}$/i, ''));
    const records = snapshot => (snapshot?.tests || []).flatMap(test => (test.groups || []).flatMap(group => (group.images || []).map(image => ({ test, group, image, metric: norm(image.explicitKey || image.captionLead) || metricFromReference(image.imageReference), captionFingerprint: image.captionFingerprint || norm(image.captionLead) }))));
    const sourceRecords = archive => (archive?.manifest?.captures || []).map((capture, index) => ({
        capture,
        index,
        source: archive?.sources?.get?.(capture.file) || null,
        searchable: norm(capture.seriesName || capture.panelTitle),
    })).filter(item => item.source);

    function metricOptions(snapshot) {
        const values = new Map();
        for (const item of records(snapshot)) {
            if (!item.metric) continue;
            const key = `${item.group.normalizedGroupFamily || norm(item.group.title)}\0${item.metric}`;
            const current = values.get(key) || { metricGroup: item.group.title, metric: item.metric, groupFamily: item.group.normalizedGroupFamily || norm(item.group.title), count: 0 };
            current.count += 1;
            values.set(key, current);
        }
        return Object.freeze([...values.values()].sort((left, right) => left.metric.localeCompare(right.metric, 'ru')).map(Object.freeze));
    }

    function structuredCandidate(sources, target, selection) {
        const candidates = sources.filter(item => {
            const capture = item.capture;
            return capture.testKey && norm(capture.testKey) === norm(target.test.testKey)
                && (!capture.metricGroup || norm(capture.metricGroup) === norm(target.group.title) || norm(capture.metricGroup) === norm(target.group.normalizedGroupFamily))
                && (!capture.metric || norm(capture.metric) === norm(selection.metric || target.metric))
                && (capture.occurrence == null || capture.occurrence === target.image.occurrence);
        });
        return candidates.length === 1 ? candidates[0] : null;
    }

    function plan(snapshot, archive, selection = {}) {
        const metric = norm(selection.metric);
        const group = norm(selection.metricGroup);
        const targetKeys = new Set(Array.isArray(selection.targetKeys) ? selection.targetKeys : []);
        if (!metric && !targetKeys.size) return Object.freeze([]);
        const targets = records(snapshot).filter(item => (!targetKeys.size || targetKeys.has(`${item.test.testKey}:${item.group.title}:${item.image.occurrence}`)) && (!metric || item.metric === metric) && (!group || norm(item.group.title) === group || norm(item.group.normalizedGroupFamily) === group));
        const sources = sourceRecords(archive);
        const panelMappings = selection.panelMappings || {};
        return Object.freeze(targets.map((target, index) => {
            const structured = structuredCandidate(sources, target, selection);
            const mappedPanel = norm(panelMappings[target.metric] || '');
            const legacy = sources.filter(item => { const wanted = mappedPanel || target.metric; return !wanted || item.searchable.includes(wanted); }).sort((left, right) => left.capture.file.localeCompare(right.capture.file, 'ru'));
            const occurrenceCandidate = legacy.filter(item => item.capture.occurrence == null || item.capture.occurrence === target.image.occurrence);
            const candidate = structured || (occurrenceCandidate.length === 1 ? occurrenceCandidate[0] : (legacy.length === targets.length ? legacy[index] : null));
            const status = candidate ? 'exact' : (occurrenceCandidate.length || legacy.length ? 'ambiguous' : 'not-found');
            return Object.freeze({
                operation: 'replace',
                status,
                target: Object.freeze({ testKey: target.test.testKey, testTitle: target.test.title, metricGroup: target.group.title, metric: target.metric, occurrence: target.image.occurrence, image: target.image }),
                source: candidate?.source || null,
                capture: candidate ? candidate.capture : null,
                candidates: Object.freeze((occurrenceCandidate.length ? occurrenceCandidate : legacy).map(item => item.source)),
            });
        }));
    }

    root.DashBridgeConfluenceReportPreview = Object.freeze({ metricOptions, plan, metricFromReference });
})(globalThis);
