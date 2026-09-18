(function initConfluenceReportMatcher(root) {
    'use strict';
    const norm = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    const imageRecords = snapshot => (snapshot?.tests || []).flatMap(test => (test.groups || []).flatMap(group => (group.images || []).map(image => ({ test, group, image }))));
    const selectedTests = selection => Array.isArray(selection?.testKeys) && selection.testKeys.length ? new Set(selection.testKeys.map(norm)) : null;
    function match(snapshot, archive, selection = {}) {
        const selected = selectedTests(selection); const sources = Array.isArray(archive?.manifest?.captures) ? archive.manifest.captures : [];
        return imageRecords(snapshot).filter(({ test, group, image }) => {
            if (selected && !selected.has(norm(test.testKey))) return false;
            if (selection.metricGroup && norm(group.title) !== norm(selection.metricGroup)) return false;
            if (selection.caption && norm(image.caption) !== norm(selection.caption)) return false;
            return true;
        }).map(({ test, group, image }) => {
            const candidates = sources.filter(source => norm(source.testKey) === norm(test.testKey)
                && norm(source.metricGroup) === norm(group.title)
                && (selection.metric ? norm(source.metric) === norm(selection.metric) : true)
                && (source.occurrence == null || source.occurrence === image.occurrence));
            const source = candidates.length === 1 ? candidates[0] : null;
            return Object.freeze({ operation: 'replace', status: candidates.length === 1 ? 'exact' : (candidates.length ? 'ambiguous' : 'not-found'), target: { testKey: test.testKey, group: group.title, occurrence: image.occurrence, image }, source, candidates: Object.freeze(candidates) });
        });
    }
    root.DashBridgeConfluenceReportMatcher = Object.freeze({ match });
})(globalThis);
