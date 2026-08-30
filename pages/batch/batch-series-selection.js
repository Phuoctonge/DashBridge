// Batch resolves series for one exact Grafana time slice.
window.BatchSeriesSelection = (() => {
    const entries = available => {
        const occurrences = new Map();
        return (available || []).map(value => {
            const name = String(value?.name ?? value);
            const occurrence = occurrences.get(name) || 0;
            occurrences.set(name, occurrence + 1);
            return { name, key: `${name}\u0000${occurrence}` };
        });
    };
    const resolveExact = (selectedNames, available) => {
        const selected = new Set((selectedNames || []).map(String));
        const matches = entries(available).filter(series => selected.has(series.name));
        const present = new Set(matches.map(series => series.name));
        return { matches, missing: [...selected].filter(name => !present.has(name)) };
    };
    const resolveKeys = (selectedKeys, available) => {
        const selected = new Set((selectedKeys || []).map(String));
        const matches = entries(available).filter(series => selected.has(series.key));
        const present = new Set(matches.map(series => series.key));
        return { matches, missing: [...selected].filter(key => !present.has(key)) };
    };
    const parsePattern = value => String(value || '').toLowerCase()
        .split('|')
        .map(term => term.trim())
        .filter(Boolean);
    const resolvePatterns = (available, include, ignore) => {
        const includeTerms = parsePattern(include);
        const ignoreTerms = parsePattern(ignore);
        const matches = entries(available).filter(series => {
            const name = series.name.toLowerCase();
            return (!includeTerms.length || includeTerms.some(term => name.includes(term)))
                && !ignoreTerms.some(term => name.includes(term));
        });
        return { matches, missing: [] };
    };
    const resolveAll = available => ({ matches: entries(available), missing: [] });
    return { entries, resolveExact, resolveKeys, resolvePatterns, resolveAll };
})();
