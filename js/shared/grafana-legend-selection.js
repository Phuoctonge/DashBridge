(() => {
    'use strict';

    if (globalThis.DashBridgeGrafanaLegendSelection) return;

    const VERSION = 2;
    const normalizeNames = values => [...new Set((Array.isArray(values) ? values : [])
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean))];
    const isAllowlistState = state => Number(state?.legendSelectionVersion) === VERSION
        && Array.isArray(state?.legendVisibleSeries);
    const isCompleteHideActive = state => state?.legendMode === 'fast_complete_hide'
        && (isAllowlistState(state) || !!state?.legendFilter?.length);
    const createVisibilityMatcher = state => {
        if (isAllowlistState(state)) {
            const visible = new Set(normalizeNames(state.legendVisibleSeries));
            return candidates => normalizeNames(candidates).some(name => visible.has(name));
        }
        const hidden = new Set(normalizeNames(state?.legendFilter));
        return candidates => !normalizeNames(candidates).some(name => hidden.has(name));
    };
    const isSeriesVisible = (state, candidates) => createVisibilityMatcher(state)(candidates);
    const filterDataFrames = (data, state, getLegendNames) => {
        if (!data?.results || !isCompleteHideActive(state) || typeof getLegendNames !== 'function') return data;
        const isVisible = createVisibilityMatcher(state);
        Object.values(data.results).forEach(result => {
            result.frames = (result.frames || []).map(frame => {
                const fields = frame.schema?.fields || [];
                const hasTimeField = fields.some(field => field.type === 'time' || field.name === 'Time');
                if (!hasTimeField) return frame;
                const indexes = fields.map((field, index) => {
                    const isTime = field.type === 'time' || field.name === 'Time';
                    return isTime || isVisible(getLegendNames(frame, field)) ? index : -1;
                }).filter(index => index >= 0);
                return {
                    ...frame,
                    schema: { ...frame.schema, fields: indexes.map(index => fields[index]) },
                    data: { ...frame.data, values: indexes.map(index => frame.data?.values?.[index]) }
                };
            }).filter(frame => {
                const fields = frame.schema?.fields || [];
                const hasTimeField = fields.some(field => field.type === 'time' || field.name === 'Time');
                return !hasTimeField || fields.length > 1;
            });
        });
        return data;
    };

    globalThis.DashBridgeGrafanaLegendSelection = Object.freeze({
        VERSION,
        normalizeNames,
        isAllowlistState,
        isCompleteHideActive,
        createVisibilityMatcher,
        isSeriesVisible,
        filterDataFrames
    });
})();
