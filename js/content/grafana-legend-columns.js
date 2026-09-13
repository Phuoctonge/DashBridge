// Raw-series legend column statistics. MAIN-world, pure computation facade.
(() => {
    if (window.DashBridgeGrafanaLegendColumns) return;
    const finiteValues = values => Array.from(values || []).map(Number).filter(Number.isFinite);
    const summarize = values => {
        const finite = finiteValues(values);
        if (!finite.length) return { mean: null, max: null, min: null, total: null, last: null };
        const total = finite.reduce((sum, value) => sum + value, 0);
        return { mean: total / finite.length, max: Math.max(...finite), min: Math.min(...finite), total, last: finite[finite.length - 1] };
    };
    const normalizeColumns = columns => Object.fromEntries(Object.entries(columns || {}).filter(([name, enabled]) =>
        typeof name === 'string' && name.trim() && name.length <= 128 && typeof enabled === 'boolean'));
    const compute = ({ series = [], columns = {} } = {}) => {
        const selected = normalizeColumns(columns);
        return series.map(item => ({ label: String(item?.label || ''), stats: summarize(item?.values), columns: Object.fromEntries(Object.entries(summarize(item?.values)).filter(([name]) => selected[name] !== false)) }));
    };
    window.DashBridgeGrafanaLegendColumns = Object.freeze({ compute, normalizeColumns, summarize });
})();
