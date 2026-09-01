(function initGrafanaReportSnapshot(root) {
    'use strict';
    if (root.DashBridgeGrafanaReportSnapshot) return;

    function create({ mergeAxisAndPanelUnit, inferUnitFromAxisTicks, getCachedPanelDefinition,
        unitFromPanelDefinition, collectGrafanaTableRecords, findUPlot,
        getUPlotYScaleKey, getUPlotUnitDetails } = {}) {
        const dependencies = [
            mergeAxisAndPanelUnit, inferUnitFromAxisTicks, getCachedPanelDefinition,
            unitFromPanelDefinition, collectGrafanaTableRecords, findUPlot,
            getUPlotYScaleKey, getUPlotUnitDetails,
        ];
        if (dependencies.some(dependency => typeof dependency !== 'function')) {
            throw new TypeError('Grafana report snapshot dependencies are incomplete');
        }

        const collectPanelReportSnapshot = ({ root = document, sla = {} } = {}) => {
            const evaluation = ['period_max', 'latest', 'period_min', 'period_avg', 'period_sum'].includes(sla.evaluation)
                ? sla.evaluation : 'period_max';
            const operator = ['gt', 'gte', 'lt', 'lte'].includes(sla.operator) ? sla.operator : 'gt';
            const source = ['graph', 'custom', 'cpu_capacity', 'none'].includes(sla.source) ? sla.source : 'none';
            let engine = 'unknown';
            let unit = '';
            let factor = 1;
            let records = [];
            const responseDataStatus = window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus
                || { kind: 'unknown', text: '' };
            const parseLegendCalculation = value => {
                const normalized = String(value || '').replace(/[\u00a0\u202f\s]/g, '').replace(',', '.');
                const match = normalized.match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
                const parsed = match ? Number(match[0]) : null;
                return Number.isFinite(parsed) ? parsed : null;
            };
            const legendMaxByName = () => {
                const result = new Map();
                const rows = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(root) || []);
                for (const row of rows) {
                    const label = window.DashBridgeGrafanaDom?.legendLabel?.(row);
                    const name = String(label?.textContent || '').trim();
                    if (!name || /^(?:name|series|имя|серия)$/i.test(name)) continue;
                    let valueCell = row.querySelector?.(
                        'td.graph-legend-value.max, [data-field="max"], [data-testid*="max" i]'
                    );
                    if (!valueCell) {
                        const table = row.closest?.('table');
                        const headers = Array.from(table?.querySelectorAll?.('thead th, thead td') || []);
                        const maxIndex = headers.findIndex(header => /^(?:max|maximum|макс\.?)$/i.test(String(header.textContent || '').trim()));
                        const cells = Array.from(row.cells || row.querySelectorAll?.(':scope > td, :scope > th') || []);
                        if (maxIndex >= 0) valueCell = cells[maxIndex];
                    }
                    const value = parseLegendCalculation(valueCell?.textContent);
                    if (value !== null && !result.has(name)) result.set(name, value);
                }
                return result;
            };
            const legendMaximums = evaluation === 'period_max' ? legendMaxByName() : new Map();
            const reportLegendNames = expectedCount => {
                const names = window.DashBridgeGrafanaDom?.legendSeriesNames?.(root, { unique: false });
                // A complete legend is still only a fallback for series whose
                // native label is missing. Grafana can sort legend rows by a
                // calculation (for example Max) without reordering plot data, so
                // positional legend names must never replace native series labels.
                return Array.isArray(names) && names.length === expectedCount ? names : [];
            };
            const isGenericSeriesName = value => /^(?:value|series|metric|значение|серия|метрика)$/iu
                .test(String(value || '').trim());
            const reportSeriesName = (nativeName, legendName, index) => {
                const native = String(nativeName || '').trim();
                const legend = String(legendName || '').trim();
                return !native || isGenericSeriesName(native)
                    ? (legend || native || `Серия ${index + 1}`)
                    : native;
            };
            const $ = window.jQuery || window.$;
            const plotHost = $ && $(root).find('.graph-panel__chart').toArray().find(el => !!$(el).data('plot'));
            if (plotHost) {
                engine = 'flot';
                const plot = $(plotHost).data('plot');
                const details = mergeAxisAndPanelUnit(inferUnitFromAxisTicks(plot.getAxes?.().yaxis?.ticks), getCachedPanelDefinition());
                unit = details.unit || '';
                factor = Number(details.factor) || 1;
                const plotSeries = plot.getData?.() || [];
                const legendNames = reportLegendNames(plotSeries.length);
                records = plotSeries.map((item, index) => ({
                    name: reportSeriesName(item.label, legendNames[index], index),
                    visible: item.lines?.show !== false || item.points?.show !== false,
                    values: (item.data || []).map(point => Number(point?.[1])).filter(Number.isFinite),
                    legendMaximum: legendMaximums.get(reportSeriesName(item.label, legendNames[index], index))
                }));
            } else {
                const uplot = findUPlot(root);
                if (uplot) {
                    engine = 'uplot';
                    const yScaleKey = getUPlotYScaleKey(uplot);
                    const details = mergeAxisAndPanelUnit(getUPlotUnitDetails(uplot, yScaleKey, uplot.scales?.[yScaleKey]), getCachedPanelDefinition());
                    unit = details.unit || '';
                    factor = Number(details.factor) || 1;
                    const plotSeries = (uplot.series || []).slice(1);
                    const legendNames = reportLegendNames(plotSeries.length);
                    records = plotSeries.map((item, offset) => ({
                        name: reportSeriesName(item.label, legendNames[offset], offset),
                        visible: item.show !== false,
                        values: Array.from(uplot.data?.[offset + 1] || []).map(Number).filter(Number.isFinite),
                        legendMaximum: legendMaximums.get(reportSeriesName(item.label, legendNames[offset], offset))
                    }));
                } else {
                    const responseTableRecords = Array.isArray(window.__dashbridgePanelToolsVisualMetadata?.responseTableRecords)
                        ? window.__dashbridgePanelToolsVisualMetadata.responseTableRecords : [];
                    const tableRecords = responseTableRecords.length
                        ? responseTableRecords.map(item => ({
                            name: String(item?.name || ''), visible: true,
                            values: [Number(item?.value)].filter(Number.isFinite)
                        })).filter(item => item.name && item.values.length)
                        : collectGrafanaTableRecords(root);
                    if (!records.length && tableRecords.length) {
                        engine = responseTableRecords.length ? 'table-response' : 'table-dom';
                        const details = unitFromPanelDefinition(getCachedPanelDefinition());
                        unit = details.unit || '';
                        factor = 1;
                        records = tableRecords;
                    }
                }
            }
            const summarizeValues = values => {
                let count = 0;
                let min = Infinity;
                let max = -Infinity;
                let sum = 0;
                let latest = null;
                for (const rawValue of values || []) {
                    const value = Number(rawValue);
                    if (!Number.isFinite(value)) continue;
                    count += 1;
                    min = Math.min(min, value);
                    max = Math.max(max, value);
                    sum += value;
                    latest = value;
                }
                return count ? { count, min, max, sum, latest } : null;
            };
            records = records.map(record => ({ ...record, stats: record.stats || summarizeValues(record.values) }))
                .filter(record => record.visible && record.stats?.count > 0);
            if (!records.length) {
                const visualMetadata = window.__dashbridgePanelToolsVisualMetadata;
                const dataStatus = visualMetadata?.responseDataStatus || { kind: 'unknown', text: '' };
                if (visualMetadata?.responseFilterEmptyIsNormal === true) {
                    const configuredValue = sla.value !== null && sla.value !== '' && Number.isFinite(Number(sla.value))
                        ? Number(sla.value) : null;
                    const configuredRawValue = sla.rawValue !== null && sla.rawValue !== '' && Number.isFinite(Number(sla.rawValue))
                        ? Number(sla.rawValue) : null;
                    return {
                        state: 'ok', source, evaluation, operator, engine,
                        unit: String(sla.unit || unit || '').slice(0, 64),
                        threshold: configuredValue ?? (configuredRawValue === null ? null : configuredRawValue / factor),
                        criticalThreshold: configuredValue ?? (configuredRawValue === null ? null : configuredRawValue / factor),
                        warningThreshold: sla.warningValue !== null && sla.warningValue !== '' && Number.isFinite(Number(sla.warningValue))
                            ? Number(sla.warningValue) : null,
                        aggregateValue: null,
                        series: [],
                        filteredEmpty: true,
                        dataStatus: 'filtered_empty',
                        dataStatusText: dataStatus.text || 'Нет превышений по заданному фильтру'
                    };
                }
                const failureKinds = new Set(['http_error', 'network_error', 'decode_error', 'aborted']);
                const isFailure = failureKinds.has(dataStatus.kind);
                const failureText = dataStatus.text || (isFailure
                    ? (dataStatus.kind === 'aborted' ? 'Запрос Grafana был отменён' : 'Ошибка при получении данных')
                    : 'Источник вернул пустой набор данных');
                return {
                    state: isFailure ? 'error' : 'no_data',
                    source, evaluation, operator, engine, unit, series: [],
                    dataStatus: dataStatus.kind === 'unknown' ? 'empty_source' : dataStatus.kind,
                    dataStatusText: failureText,
                    error: failureText
                };
            }
            const configuredValue = sla.value !== null && sla.value !== '' && Number.isFinite(Number(sla.value))
                ? Number(sla.value) : null;
            const configuredRawValue = sla.rawValue !== null && sla.rawValue !== '' && Number.isFinite(Number(sla.rawValue))
                ? Number(sla.rawValue) : null;
            const configuredWarningValue = sla.warningValue !== null && sla.warningValue !== '' && Number.isFinite(Number(sla.warningValue))
                ? Number(sla.warningValue) : null;
            const configuredWarningRawValue = sla.warningRawValue !== null && sla.warningRawValue !== '' && Number.isFinite(Number(sla.warningRawValue))
                ? Number(sla.warningRawValue) : null;
            if (!['none', 'cpu_capacity'].includes(source) && configuredValue === null && configuredRawValue === null) {
                return {
                    state: 'configuration_error', source, evaluation, operator, engine, unit, series: [],
                    dataStatus: 'configuration_error',
                    dataStatusText: 'Не задан порог SLA для панели',
                    error: 'Не задан порог SLA для панели'
                };
            }
            const rawThreshold = source === 'cpu_capacity' ? null : (configuredRawValue ?? (configuredValue * factor));
            const threshold = ['none', 'cpu_capacity'].includes(source) ? null : rawThreshold / factor;
            const rawWarningThreshold = configuredWarningRawValue ?? (configuredWarningValue === null ? null : configuredWarningValue * factor);
            const warningThreshold = source === 'none' || rawWarningThreshold === null ? null : rawWarningThreshold / factor;
            const compare = (value, target) => !['none', 'cpu_capacity'].includes(source) && Number.isFinite(target) && ({
                gt: value > target, gte: value >= target,
                lt: value < target, lte: value <= target
            })[operator];
            const evaluateStats = stats => {
                if (evaluation === 'latest') return stats.latest;
                if (evaluation === 'period_min') return stats.min;
                if (evaluation === 'period_avg') return stats.sum / stats.count;
                if (evaluation === 'period_sum') return stats.sum;
                return stats.max;
            };
            const allSeries = records.map(record => {
                const rawValue = evaluateStats(record.stats);
                const hasLegendMaximum = evaluation === 'period_max' && Number.isFinite(record.legendMaximum);
                const value = hasLegendMaximum ? record.legendMaximum : (rawValue === null ? null : rawValue / factor);
                const critical = value !== null && !!compare(
                    hasLegendMaximum ? value : rawValue,
                    hasLegendMaximum ? threshold : rawThreshold
                );
                const warning = !critical && value !== null && !!compare(
                    hasLegendMaximum ? value : rawValue,
                    hasLegendMaximum ? warningThreshold : rawWarningThreshold
                );
                return {
                    name: record.name.slice(0, 500),
                    value,
                    exceeded: critical,
                    level: critical ? 'critical' : (warning ? 'warning' : 'normal')
                };
            }).filter(record => record.value !== null);
            const series = allSeries.slice(0, 5000);
            const omittedSeries = allSeries.length - series.length;
            const evaluated = allSeries.map(record => record.value).filter(Number.isFinite);
            const totalCount = records.reduce((sum, record) => sum + record.stats.count, 0);
            const totalSum = records.reduce((sum, record) => sum + record.stats.sum, 0);
            const rawMinimum = Math.min(...records.map(record => record.stats.min));
            const rawMaximum = Math.max(...records.map(record => record.stats.max));
            const lastValues = records.map(record => record.stats.latest / factor).filter(Number.isFinite);
            const aggregateValue = evaluation === 'period_min' ? Math.min(...evaluated)
                : evaluation === 'period_avg' ? evaluated.reduce((sum, value) => sum + value, 0) / evaluated.length
                    : evaluation === 'period_sum' ? evaluated.reduce((sum, value) => sum + value, 0)
                        : Math.max(...evaluated);
            const resolvedUnit = String(sla.unit || unit || '').slice(0, 64);
            const hasCritical = allSeries.some(record => record.level === 'critical');
            const hasWarning = allSeries.some(record => record.level === 'warning');
            return {
                state: ['none', 'cpu_capacity'].includes(source) ? 'no_threshold' : (hasCritical ? 'critical' : (hasWarning ? 'warning' : 'ok')),
                source, evaluation, operator, engine, unit: resolvedUnit, threshold,
                criticalThreshold: threshold, warningThreshold,
                aggregateValue,
                maxValue: evaluation === 'period_max' ? Math.max(...evaluated) : rawMaximum / factor,
                minValue: rawMinimum / factor,
                lastValue: lastValues.length ? Math.max(...lastValues) : null,
                averageValue: totalCount ? totalSum / totalCount / factor : null,
                sumValue: totalSum / factor,
                series,
                omittedSeries
            };
        };
    

        return Object.freeze({ collectPanelReportSnapshot });
    }

    root.DashBridgeGrafanaReportSnapshot = Object.freeze({ create });
})(window);
