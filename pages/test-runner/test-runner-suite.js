// Test Runner scenario catalog, invariants and generated matrix.
// Runtime diagnostics and transition execution are loaded separately by the runner page.
const matrixInvariants = {
    // Canvas is diagnostic evidence only: Grafana may repaint an identical
    // image after a real response. Style checks therefore inspect the renderer
    // state that production code mutates, and skip only when it is unavailable.
    rendererSeries: current => (current.diagnostic?.series || []).filter(series => series && series.label !== undefined),
    unavailableRenderer: current => !current.diagnostic?.panelFound || !current.diagnostic?.renderer || current.diagnostic.renderer === 'unknown',
    skipUnsupportedRenderer: current => ({
        pass: true,
        skip: true,
        reason: 'SKIP: рендерер графика не предоставляет состояние серий',
        debug: `renderer=${current.diagnostic?.renderer || 'unknown'}`,
    }),
    everyRendererSeries: (current, predicate) => {
        const series = matrixInvariants.rendererSeries(current);
        return series.length > 0 && series.every(predicate);
    },

    // ── removeFill ──────────────────────────────────────────────────
    removeFillOn: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const transparent = value => typeof value === 'string'
            && (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value)
                || /transparent/i.test(value));
        const applied = matrixInvariants.everyRendererSeries(current, series => series.originalFill !== '[undefined]'
            && (series.fill === false || (series.fillDisabled === true && transparent(series.evaluatedFill))));
        const styleStateApplied = current.diagnostic?.visualStyleState?.fillMatchesExpected === true;
        return {
            pass: applied && styleStateApplied,
            reason: applied && styleStateApplied ? 'заливка отключена в состоянии всех серий'
                : 'состояние заливки серий не отключено или потеряно после замены renderer',
            debug: applied && styleStateApplied ? '' : JSON.stringify({
                styleState: current.diagnostic?.visualStyleState || null,
                series: matrixInvariants.rendererSeries(current),
            }),
        };
    },
    removeFillOff: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const transparent = value => typeof value === 'string'
            && (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value)
                || /transparent/i.test(value));
        const restored = matrixInvariants.everyRendererSeries(current, series => {
            if (series.fillDisabled === true || series.fill === false || transparent(series.evaluatedFill)) return false;
            // Grafana can replace uPlot while restoring native visibility or
            // source data. A fresh renderer has no DashBridge baseline fields;
            // that is a clean state, not a failed restore, when its live fill
            // is native and no disabled marker survived.
            if (series.originalFill === '[undefined]') return true;
            return series.fill === series.originalFill
                && series.evaluatedFill === series.evaluatedOriginalFill;
        });
        const styleStateRestored = current.diagnostic?.visualStyleState?.fillMatchesExpected === true;
        return {
            pass: restored && styleStateRestored,
            reason: restored && styleStateRestored ? 'заливка серий восстановлена до исходного значения'
                : 'заливка серий не восстановлена или восстановлена в другом renderer',
            debug: restored && styleStateRestored ? '' : JSON.stringify({
                styleState: current.diagnostic?.visualStyleState || null,
                series: matrixInvariants.rendererSeries(current),
            }),
        };
    },

    // ── thickenLines ────────────────────────────────────────────────
    thickenLinesOn: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const applied = matrixInvariants.everyRendererSeries(current, series => Number.isFinite(series.width)
            && Number.isFinite(series.originalWidth) && series.width > series.originalWidth);
        return {
            pass: applied,
            reason: applied ? 'толщина всех серий увеличена в renderer state' : 'толщина серий не увеличена',
            debug: applied ? '' : JSON.stringify(matrixInvariants.rendererSeries(current)),
        };
    },
    thickenLinesOff: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const restored = matrixInvariants.everyRendererSeries(current, series => Number.isFinite(series.width)
            && (!Number.isFinite(series.originalWidth) || series.width === series.originalWidth));
        return {
            pass: restored,
            reason: restored ? 'толщина серий восстановлена до исходной' : 'толщина серий не восстановлена',
            debug: restored ? '' : JSON.stringify(matrixInvariants.rendererSeries(current)),
        };
    },

    // ── invertLegend ─────────────────────────────────────────────────
    invertLegendOn: (baseline, current, env) => {
        if (!env.hasLegend) return { pass: true, skip: true, reason: 'SKIP: нет легенды' };
        const before = baseline.diagnostic?.legend?.position;
        const after = current.diagnostic?.legend?.position;
        if (!before || !after || !['right', 'bottom'].includes(before.direction)) {
            return {
                pass: false,
                reason: 'исходное положение легенды не определено однозначно',
                debug: JSON.stringify({ before, after }),
            };
        }
        const expectedDirection = before.direction === 'right' ? 'bottom' : 'right';
        const allEntriesMoved = after.direction === 'bottom'
            ? current.diagnostic?.legend?.entries > 0 && current.diagnostic.legend.bottomEntries === current.diagnostic.legend.entries
            : true;
        const markerMatchesDirection = after.direction === 'bottom'
            ? current.dom.legendBottom === true
            : current.dom.legendBottom === false;
        const applied = after.direction === expectedDirection && allEntriesMoved && markerMatchesDirection;
        return {
            pass: applied,
            reason: applied
                ? `легенда инвертирована: ${before.direction} → ${after.direction}`
                : `ожидалась инверсия ${before.direction} → ${expectedDirection}, получено ${after.direction}`,
            debug: applied ? '' : JSON.stringify({ before, after, expectedDirection, allEntriesMoved, markerMatchesDirection }),
        };
    },
    invertLegendOff: (baseline, current, env) => {
        if (!env.hasLegend) return { pass: true, skip: true, reason: 'SKIP: нет легенды' };
        const before = baseline.diagnostic?.legend?.position;
        const after = current.diagnostic?.legend?.position;
        const restored = !!before
            && before.direction !== 'unknown'
            && after?.direction === before.direction
            && !current.dom.legendBottom
            && !current.diagnostic?.legend?.bottomContainer
            && current.diagnostic?.legend?.bottomEntries === 0;
        return {
            pass: restored,
            reason: restored
                ? `легенда восстановлена: ${after.direction}`
                : `легенда не восстановлена в исходное положение ${before?.direction || 'unknown'}`,
            debug: restored ? '' : JSON.stringify({ before, after, marker: current.dom.legendBottom, legend: current.diagnostic?.legend }),
        };
    },
    removeFillLegendThresholdOff: (baseline, current, env) => {
        const fill = matrixInvariants.removeFillOff(baseline, current);
        const legend = matrixInvariants.invertLegendOff(baseline, current, env);
        const threshold = matrixInvariants.thresholdOff(baseline, current);
        const pass = fill.pass && legend.pass && threshold.pass;
        return {
            pass,
            skip: fill.skip || legend.skip || threshold.skip,
            reason: `заливка: ${fill.reason}; легенда: ${legend.reason}; порог: ${threshold.reason}`,
            debug: pass ? '' : [fill.debug, legend.debug, threshold.debug].filter(Boolean).join(' | '),
        };
    },

    // ── invertIdle (CPU) ─────────────────────────────────────────────
    // These assertions deliberately inspect Grafana's calculated series label,
    // rather than treating a canvas redraw as proof of a data transformation.
    // `applySettingsAndWait()` forces a real query before this snapshot.
    invertIdleOn: (baseline, current, env) => {
        if (!env.hasCPU) return { pass: true, skip: true, reason: 'SKIP: нет CPU-панели' };
        // Grafana 10/Flot can replace its plot object after a transformed
        // response. `getPlot()` may still expose the previous idle series while
        // the live legend already renders the calculated load series. Require
        // both causal network evidence and a user-visible label, accepting the
        // renderer or the keyed legend as equivalent observations.
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.invertIdle === true);
        const transformed = !!transform && labels.some(label => /load\s*\(calc\)/i.test(label));
        return {
            pass: transformed,
            reason: transformed ? 'CPU Idle → Load подтверждён серией load (calc)' : 'CPU Load (calc) не получен после refresh',
            debug: transformed ? '' : JSON.stringify({
                transform: transform || null,
                labels,
            }),
        };
    },
    invertIdleOff: (baseline, current, env) => {
        if (!env.hasCPU) return { pass: true, skip: true, reason: 'SKIP: нет CPU-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const nativeResponse = targetEvent?.stage === 'transform-skipped'
            || (targetEvent?.stage === 'transform' && targetEvent.invertIdle === false);
        const restored = nativeResponse && !labels.some(label => /load\s*\(calc\)/i.test(label));
        return {
            pass: restored,
            reason: restored ? 'CPU восстановлен после refresh без преобразования' : 'CPU всё ещё содержит load (calc)',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null, labels }),
        };
    },

    // ── convertMemToUsed (RAM) ───────────────────────────────────────
    convertMemOn: (baseline, current, env) => {
        if (!env.hasRAM) return { pass: true, skip: true, reason: 'SKIP: нет RAM-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.convertMemToUsed === true
                && event.memoryTransform?.applied === true);
        const transformed = !!transform && labels.some(label => /used\s*%\s*\(calc\)/i.test(label));
        return {
            pass: transformed,
            reason: transformed ? 'RAM → % Used подтверждён серией Used % (calc)' : 'RAM Used % (calc) не получен после refresh',
            debug: transformed ? '' : JSON.stringify({ transform: transform || null, labels }),
        };
    },
    convertMemOff: (baseline, current, env) => {
        if (!env.hasRAM) return { pass: true, skip: true, reason: 'SKIP: нет RAM-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const nativeResponse = targetEvent?.stage === 'transform-skipped'
            || (targetEvent?.stage === 'transform' && targetEvent.convertMemToUsed === false);
        const restored = nativeResponse && !labels.some(label => /used\s*%\s*\(calc\)/i.test(label));
        return {
            pass: restored,
            reason: restored ? 'RAM восстановлен после refresh без преобразования' : 'RAM всё ещё содержит Used % (calc)',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null, labels }),
        };
    },

    // ── seriesQueryFilterEnabled ─────────────────────────────────────
    seriesFilterOn: (baseline, current, env) => {
        if (!env.hasSeries) return { pass: true, skip: true, reason: 'SKIP: нет серий для фильтра' };
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.sourceFilterEnabled);
        const metrics = transform?.sourceFilter;
        if (!metrics) {
            return {
                pass: false,
                reason: 'фильтр не предоставил семантический отчёт',
                debug: 'В target transform отсутствует sourceFilter с количеством удалённых серий',
            };
        }
        if (metrics.removedSeries > 0) {
            return {
                pass: true,
                reason: `источник отфильтрован: удалено ${metrics.removedSeries} из ${metrics.beforeSeries} серий`,
            };
        }
        return {
            pass: true,
            skip: true,
            reason: 'SKIP: в целевом ответе нет серий, которые можно безопасно убрать',
            debug: JSON.stringify(metrics),
        };
    },
    seriesFilterOff: (baseline, current) => {
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const restoredByTransform = targetEvent?.stage === 'transform'
            && targetEvent.sourceFilterEnabled === false
            && targetEvent.sourceFilter?.enabled === false
            && targetEvent.afterSeries === targetEvent.beforeSeries;
        // With every data transform OFF, the interceptor intentionally avoids
        // decoding or cloning the response. A target-scoped transform-skipped
        // event is therefore direct proof that Grafana received native data.
        const restoredByNativeBypass = targetEvent?.stage === 'transform-skipped'
            && targetEvent.reason === 'visual-only-observed'
            && current.diagnostic?.tools?.seriesQueryFilterEnabled === false;
        const restored = restoredByTransform || restoredByNativeBypass;
        return {
            pass: restored,
            reason: restored
                ? (restoredByNativeBypass
                    ? 'source-фильтр отключён: целевой ответ возвращён Grafana без преобразования'
                    : `source-фильтр отключён: восстановлено ${targetEvent.afterSeries} серий`)
                : 'не доказано отключение source-фильтра в ответе целевой панели',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null }),
        };
    },

    // ── pairwise transform reset ─────────────────────────────────────
    // A canvas bitmap is deliberately not used here: returning the same source
    // data may still produce a different raster. The selected response journal
    // proves source filtering is disabled, while the threshold marker proves
    // the visual calculation is removed.
    thresholdAndSeriesFilterOff: (baseline, current) => {
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const filterDisabled = (targetEvent?.stage === 'transform'
            && targetEvent.sourceFilterEnabled === false
            && targetEvent.sourceFilter?.enabled === false
            && targetEvent.afterSeries === targetEvent.beforeSeries)
            || (targetEvent?.stage === 'transform-skipped'
                && targetEvent.reason === 'visual-only-observed'
                && current.diagnostic?.tools?.seriesQueryFilterEnabled === false);
        const thresholdDisabled = !current.dom.thresholdApplied;
        const restored = filterDisabled && thresholdDisabled;
        return {
            pass: restored,
            reason: restored ? 'порог снят, а ответ выбранной панели восстановлен без source-фильтра' : 'не доказан полный сброс пары порог + source-фильтр',
            debug: restored ? '' : JSON.stringify({
                thresholdApplied: current.dom.thresholdApplied,
                targetEvent: targetEvent || null,
            }),
        };
    },

    // ── thresholdEnabled ────────────────────────────────────────────
    thresholdOn: (baseline, current, env) => {
        const threshold = current.diagnostic?.thresholdDiagnostic || {};
        const status = threshold.status || {};
        const expectedPanel = String(env.panelId || '');
        const panelMatches = !expectedPanel || String(threshold.panelId || '') === expectedPanel;
        const deferredForIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.thresholdEnabled === true
            && threshold.enabled === true
            && threshold.panelFound === true
            && panelMatches
            && status.enabled === true
            && status.exceeded === false
            && current.dom.thresholdApplied === false;
        const semanticApplied = current.dom.thresholdApplied
            && threshold.enabled === true
            && threshold.panelFound === true
            && panelMatches
            && ['uplot', 'flot'].includes(status.engine)
            && Number.isFinite(Number(status.rawThreshold))
            && Number.isFinite(Number(status.threshold));
        return {
            pass: semanticApplied || deferredForIntentionalEmpty,
            reason: semanticApplied
                ? `порог вычислен для ${status.seriesName || 'серии'} (${status.engine})`
                : (deferredForIntentionalEmpty
                    ? 'порог сохранён в filtered_empty без ложной линии и ложного превышения'
                    : 'не доказано вычисление порога для выбранной панели'),
            debug: semanticApplied || deferredForIntentionalEmpty ? '' : JSON.stringify({
                thresholdApplied: current.dom.thresholdApplied,
                expectedPanel,
                threshold,
            }),
        };
    },
    thresholdOff: (baseline, current) => {
        const threshold = current.diagnostic?.thresholdDiagnostic || {};
        const baselineWasInactive = baseline.dom.thresholdApplied === false
            && baseline.diagnostic?.tools?.thresholdEnabled === false;
        const currentIsInactive = !current.dom.thresholdApplied
            && current.diagnostic?.tools?.thresholdEnabled === false;
        const explicitRemoval = threshold.enabled === false && threshold.status?.enabled === false;
        const removed = currentIsInactive && (explicitRemoval || baselineWasInactive);
        return {
            pass: removed,
            reason: removed
                ? (explicitRemoval
                    ? 'порог семантически отключён и маркер снят'
                    : 'порог остался выключен относительно чистого baseline')
                : 'не доказано отключение порога',
            debug: removed ? '' : JSON.stringify({
                baselineThresholdApplied: baseline.dom.thresholdApplied,
                baselineThresholdEnabled: baseline.diagnostic?.tools?.thresholdEnabled,
                thresholdApplied: current.dom.thresholdApplied,
                thresholdEnabled: current.diagnostic?.tools?.thresholdEnabled,
                threshold,
            }),
        };
    },

    // ── seriesVisibility ─────────────────────────────────────────────
    seriesVisibilityOn: (baseline, current, env) => {
        if (!env.hasVisibilitySeries) return { pass: true, skip: true, reason: 'SKIP: нет двух управляемых серий легенды' };
        const markers = current.diagnostic?.markers || {};
        const target = env.visibilityTarget;
        const targetEntry = findEquivalentVisibilityEntry(markers.visibilityEntries || [], target, current);
        const targetHidden = !!targetEntry && (targetEntry.hidden || targetEntry.dimmed || targetEntry.nativeHidden || targetEntry.visuallyHidden);
        const deferredForIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.legendVisibility?.[target?.key] === false
            && !targetEntry;
        return {
            pass: targetHidden || deferredForIntentionalEmpty,
            reason: targetHidden
                ? `серия ${target?.key} скрыта через легенду`
                : (deferredForIntentionalEmpty
                    ? `видимость серии ${target?.key} сохранена и будет применена после выхода из filtered_empty`
                    : `не доказано скрытие выбранной серии ${target?.key || ''}`),
            debug: targetHidden || deferredForIntentionalEmpty ? '' : JSON.stringify({ target, targetEntry, visibilityEntries: markers.visibilityEntries || [] }),
        };
    },
    seriesVisibilityOff: (baseline, current, env) => {
        if (!env.hasVisibilitySeries) return { pass: true, skip: true, reason: 'SKIP: нет двух управляемых серий легенды' };
        const markers = current.diagnostic?.markers || {};
        const target = env.visibilityTarget;
        const targetEntry = findEquivalentVisibilityEntry(markers.visibilityEntries || [], target, current);
        const targetStillHidden = !!targetEntry && (targetEntry.hidden || targetEntry.dimmed || targetEntry.nativeHidden || targetEntry.visuallyHidden);
        const clearedDuringIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.legendVisibility?.[target?.key] !== false
            && !targetEntry;
        const restored = (!!targetEntry && !targetStillHidden) || clearedDuringIntentionalEmpty;
        return {
            pass: restored,
            reason: restored
                ? (clearedDuringIntentionalEmpty
                    ? `отложенное скрытие серии ${target?.key} снято в состоянии filtered_empty`
                    : `видимость серии ${target?.key} восстановлена`)
                : `после отключения видимость серии ${target?.key || ''} не восстановлена`,
            debug: restored ? '' : JSON.stringify({ target, targetEntry, visibilityEntries: markers.visibilityEntries || [] }),
        };
    },

    // ── canvasChanged (универсальный) ────────────────────────────────
    canvasChanged: (baseline, current) => {
        const changed = baseline.canvas !== current.canvas;
        return {
            pass: changed,
            reason: changed ? 'canvas изменился' : 'canvas не изменился',
            debug: changed ? '' : 'Ожидалось изменение canvas после применения настроек',
        };
    },
    canvasReverted: (baseline, current) => {
        const reverted = baseline.canvas === current.canvas;
        return {
            pass: reverted,
            reason: reverted ? 'canvas вернулся к базе' : 'canvas не соответствует базе',
            debug: reverted ? '' : 'Ожидалось восстановление canvas после сброса настроек',
        };
    },
};

// ─── Генераторы матричных переходов ────────────────────────────────

// ─── Декларативная причинная E2E-матрица ─────────────────────────────

const mergeMatrixSettings = (...settings) => settings.reduce((result, value) => {
    if (!value) return result;
    for (const [key, item] of Object.entries(value)) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            result[key] = { ...(result[key] || {}), ...item };
        } else {
            result[key] = item;
        }
    }
    return result;
}, {});

function combineInvariantResults(results) {
    const relevant = results.filter(Boolean);
    const failed = relevant.filter(result => !result.pass && !result.skip);
    const skipped = relevant.filter(result => result.skip);
    return {
        pass: failed.length === 0,
        skip: failed.length === 0 && skipped.length > 0,
        reason: relevant.map(result => result.reason).filter(Boolean).join('; '),
        debug: failed.map(result => result.debug).filter(Boolean).join(' | '),
    };
}

const visibilitySettings = env => {
    const target = env.visibilityTarget;
    return target ? { legendVisibility: { [target.key]: false } } : { legendVisibility: {} };
};

function findEquivalentVisibilityEntry(entries, target, current) {
    const exact = entries.find(entry => entry.key === target?.key);
    if (exact || !target?.key) return exact;
    const runtimeTools = current.diagnostic?.tools || {};
    if (runtimeTools.invertIdle === true) {
        const idleKeyword = String(runtimeTools.idleKeyword || 'idle');
        const escapedIdle = idleKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const calculatedKey = target.key.replace(new RegExp(escapedIdle, 'gi'), 'load (calc)');
        const calculatedEntry = entries.find(entry => entry.key === calculatedKey);
        if (calculatedEntry) return calculatedEntry;
    }
    if (runtimeTools.convertMemToUsed !== true) return null;
    const sourceLabel = String(target.label || target.key.split('\u0000')[0]);
    const totalKeyword = String(runtimeTools.totalKeyword || 'total');
    const availableKeyword = String(runtimeTools.availKeyword || 'available');
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sourceServer = sourceLabel
        .replace(new RegExp(escape(totalKeyword), 'gi'), '')
        .replace(new RegExp(escape(availableKeyword), 'gi'), '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    return entries.find(entry => {
        const calculatedServer = String(entry.label || '')
            .replace(/used\s*%\s*\(calc\)/gi, '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        return calculatedServer === sourceServer && entry.occurrence === target.occurrence;
    });
}

const E2E_FEATURE_REGISTRY = [
    {
        id: 'removeFill', name: 'Заливка графика', description: 'Убирает цветную заливку под линиями и проверяет её точное восстановление.',
        sourceFile: 'js/content/grafana-series-styles.js', sourceSymbol: 'applyLocalSeriesStyles',
        on: { visualSettings: { removeFill: true } }, off: { visualSettings: { removeFill: false } },
        invariant: matrixInvariants.removeFillOn, inactive: matrixInvariants.removeFillOff,
    },
    {
        id: 'thickenLines', name: 'Толщина линий', description: 'Утолщает все линии графика и проверяет возврат исходной толщины.',
        sourceFile: 'js/content/grafana-series-styles.js', sourceSymbol: 'applyLocalSeriesStyles',
        on: { visualSettings: { thickenLines: true, thickenLinesValue: 3 } }, off: { visualSettings: { thickenLines: false, thickenLinesValue: 3 } },
        invariant: matrixInvariants.thickenLinesOn, inactive: matrixInvariants.thickenLinesOff,
    },
    {
        id: 'invertLegend', name: 'Положение легенды', description: 'Перемещает легенду справа вниз или снизу вправо и проверяет восстановление.',
        sourceFile: 'js/content/grafana-legend-visuals.js', sourceSymbol: 'applyPopupLegendAndVisuals',
        on: { visualSettings: { invertLegend: true } }, off: { visualSettings: { invertLegend: false } },
        invariant: matrixInvariants.invertLegendOn, inactive: matrixInvariants.invertLegendOff,
    },
    {
        id: 'seriesVisibility', name: 'Видимость отдельных серий', description: 'Скрывает выбранную строку легенды, сохраняет остальные серии и затем восстанавливает её.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'applySeriesVisibility',
        on: visibilitySettings, off: { legendVisibility: {} }, invariant: matrixInvariants.seriesVisibilityOn, inactive: matrixInvariants.seriesVisibilityOff,
    },
    {
        id: 'invertIdle', name: 'CPU Idle → Load', description: 'Преобразует CPU Idle в вычисленную загрузку и проверяет исходные данные после выключения.',
        sourceFile: 'js/content/grafana-panel-data-transforms.js', sourceSymbol: 'transformCpuData',
        on: { transformSettings: { invertIdle: true } }, off: { transformSettings: { invertIdle: false } },
        invariant: matrixInvariants.invertIdleOn, inactive: matrixInvariants.invertIdleOff,
    },
    {
        id: 'convertMemToUsed', name: 'RAM → % Used', description: 'Пересчитывает память в процент использования и проверяет возврат исходных серий.',
        sourceFile: 'js/content/grafana-panel-data-transforms.js', sourceSymbol: 'transformMemData',
        on: { transformSettings: { convertMemToUsed: true } }, off: { transformSettings: { convertMemToUsed: false } },
        invariant: matrixInvariants.convertMemOn, inactive: matrixInvariants.convertMemOff,
    },
    {
        id: 'seriesQueryFilter', name: 'Фильтр отображаемых серий', description: 'Фильтрует данные до renderer, включая допустимый пустой результат, и проверяет возврат полного ответа.',
        sourceFile: 'js/content/grafana-panel-data-transforms.js', sourceSymbol: 'filterSeriesByThreshold',
        on: { transformSettings: { seriesQueryFilterEnabled: true, seriesQueryFilterValue: Number.MAX_SAFE_INTEGER, seriesQueryFilterRawValue: Number.MAX_SAFE_INTEGER, seriesQueryFilterMode: 'max' } },
        off: { transformSettings: { seriesQueryFilterEnabled: false } }, invariant: matrixInvariants.seriesFilterOn, inactive: matrixInvariants.seriesFilterOff,
    },
    {
        id: 'thresholdEnabled', name: 'Порог на графике', description: 'Добавляет пороговую линию, проверяет расчёт для выбранной панели и безопасное снятие.',
        sourceFile: 'js/content/grafana-threshold-visuals.js', sourceSymbol: 'setThreshold',
        on: { transformSettings: { thresholdEnabled: true } }, off: { transformSettings: { thresholdEnabled: false } },
        invariant: matrixInvariants.thresholdOn, inactive: matrixInvariants.thresholdOff,
    },
];
const E2E_FEATURES_BY_ID = Object.fromEntries(E2E_FEATURE_REGISTRY.map(feature => [feature.id, feature]));

function featureSettings(activeIds, env) {
    return mergeMatrixSettings(...E2E_FEATURE_REGISTRY.map(feature => {
        const source = activeIds.includes(feature.id) ? feature.on : feature.off;
        return typeof source === 'function' ? source(env) : source;
    }));
}

function activeSetInvariant(activeIds, changedId = null) {
    return (baseline, current, env) => {
        const active = activeIds.map(id => E2E_FEATURES_BY_ID[id]?.invariant(baseline, current, env));
        // The all-OFF state and final reset must prove restoration of every
        // feature, not merely the last one that happened to change.
        const inactiveIds = activeIds.length === 0
            ? E2E_FEATURE_REGISTRY.map(feature => feature.id)
            : (changedId && !activeIds.includes(changedId) ? [changedId] : []);
        const inactive = inactiveIds.map(id => E2E_FEATURES_BY_ID[id]?.inactive(baseline, current, env));
        // Unsupported inactive features (for example CPU on a non-CPU panel)
        // must not turn an otherwise valid visual OFF/reset transition into SKIP.
        // Capability checks already skip a scenario when such a feature is active.
        return combineInvariantResults([...active, ...inactive.filter(result => !result?.skip)]);
    };
}

function makeMatrixTransitions(states) {
    let previous = [];
    const persistenceProvenFor = new Set();
    return states.map(activeIds => {
        const changedId = [...previous, ...activeIds].find(id => previous.includes(id) !== activeIds.includes(id)) || null;
        const persistenceKey = [...activeIds].sort().join('|');
        const verifyPersistence = activeIds.length > 0 && !persistenceProvenFor.has(persistenceKey);
        if (verifyPersistence) persistenceProvenFor.add(persistenceKey);
        previous = activeIds;
        return {
            label: activeIds.length ? `активны: ${activeIds.join(', ')}` : 'все функции выключены',
            activeIds: [...activeIds],
            verifyPersistence,
            settings: env => featureSettings(activeIds, env),
            invariant: activeSetInvariant(activeIds, changedId),
        };
    });
}

const humanFeatureList = featureIds => featureIds
    .map(featureId => E2E_FEATURES_BY_ID[featureId]?.name || featureId)
    .join(' + ');

function describeMatrixScenario(id, featureIds, states) {
    const uniqueFeatureIds = [...new Set(featureIds)];
    const featureNames = humanFeatureList(uniqueFeatureIds);
    if (/^HP/.test(id)) {
        return {
            name: `${featureNames}: совместная работа`,
            description: `Проверяет обе функции вместе и по очереди выключает каждую, не нарушая оставшуюся активную функцию. Затем повторно включает комбинацию и выполняет полный сброс.`,
        };
    }
    if (/^HR/.test(id)) {
        return {
            name: `${featureNames}: рискованная последовательность`,
            description: `Последовательно наращивает комбинацию «${featureNames}», по одному удаляет активные компоненты, собирает комбинацию заново и доказывает чистый финальный reset.`,
        };
    }
    const suffix = id.split('_')[1];
    if (suffix === '1') return {
        name: `${featureNames}: включение`,
        description: `Включает функцию «${featureNames}», обновляет выбранный график и повторным Refresh доказывает, что настройка сохранилась без повторной команды.`,
    };
    if (suffix === '2') return {
        name: `${featureNames}: включение и выключение`,
        description: `Включает функцию «${featureNames}», затем выключает её и проверяет возврат исходного состояния Grafana.`,
    };
    return {
        name: `${featureNames}: повторные ON/OFF`,
        description: `Повторяет включение и выключение функции «${featureNames}», чтобы обнаружить накопление обработчиков, потерю состояния и неидемпотентный reset.`,
    };
}

function matrixTest(id, technicalName, states, runModes = ['full'], featureIds = []) {
    // Each transition performs one graph Refresh. The first occurrence of
    // every distinct active set performs a second Refresh to prove persistence
    // without resending the command. Repeated identical active sets still run
    // their command/Refresh/invariant, but reuse that exact persistence proof.
    // Isolation and final cleanup contribute one refresh each.
    const persistenceSets = new Set();
    const refreshCount = states.reduce((count, activeIds) => {
        const persistenceKey = [...activeIds].sort().join('|');
        const needsPersistence = activeIds.length > 0 && !persistenceSets.has(persistenceKey);
        if (needsPersistence) persistenceSets.add(persistenceKey);
        return count + 1 + (needsPersistence ? 1 : 0);
    }, 2);
    const metadata = describeMatrixScenario(id, featureIds, states);
    return {
        id, category: 'H', name: metadata.name, technicalName, description: metadata.description,
        featureIds: [...new Set(featureIds)], tags: [/^HR/.test(id) ? 'risk' : (/^HP/.test(id) ? 'pair' : 'lifecycle')], runModes,
        steps: states.map((activeIds, index) => `${index + 1}. ${activeIds.length ? `Активны: ${humanFeatureList(activeIds)}` : 'Все функции выключены'}`),
        expectedRefreshCount: refreshCount,
        timeoutBudgetModel: 'max(30s, expectedRefreshCount * 10s + 30s)',
        // This is only the outer emergency ceiling; successful scenarios end
        // immediately. Live Flot evidence shows threshold/layout refreshes can
        // legitimately take 9–23 seconds per transition while every inner
        // command, target-query and settlement watchdog remains healthy.
        timeoutMs: Math.max(30_000, refreshCount * 10_000 + 30_000),
        async run(tabId, env) {
            return runTransitionTest(tabId, env, makeMatrixTransitions(states));
        }
    };
}

// Each lifecycle explicitly repeats both commands. Repeated ON/OFF calls are not
// cosmetic: Grafana may replace renderer objects between applications, so the
// current active-set invariant must hold after every acknowledgement and refresh.
function generateLifecycleMatrixTests() {
    return E2E_FEATURE_REGISTRY.flatMap((feature, index) => {
        const id = `H${index + 1}`;
        return [
            matrixTest(`${id}_1`, `${feature.id} OFF→ON`, [[feature.id]], ['fast', 'full'], [feature.id]),
            matrixTest(`${id}_2`, `${feature.id} ON→OFF`, [[feature.id], []], ['full'], [feature.id]),
            matrixTest(
                `${id}_3`,
                `${feature.id} OFF→ON→ON→OFF→OFF→ON (идемпотентность)`,
                [[feature.id], [feature.id], [], [], [feature.id]],
                ['full'],
                [feature.id]
            ),
        ];
    });
}

// Deterministic pair coverage. Every vector is traversed in both directions:
//   00 → 10 → 11 → 01 → 11 → 00
//   00 → 01 → 11 → 10 → 11 → 00
// The partial-OFF states are mandatory: they catch a feature restoring or
// destroying renderer state while its neighbour remains active.
const E2E_PAIRWISE_VECTORS = [
    ['removeFill', 'thickenLines'], ['removeFill', 'seriesVisibility'],
    ['thickenLines', 'invertLegend'], ['seriesVisibility', 'invertLegend'],
    ['seriesVisibility', 'thresholdEnabled'], ['seriesVisibility', 'seriesQueryFilter'],
    ['invertIdle', 'invertLegend'], ['convertMemToUsed', 'seriesVisibility'],
    ['seriesQueryFilter', 'thresholdEnabled'], ['removeFill', 'thresholdEnabled'],
];

function pairwiseStates(first, second, reverse = false) {
    const [left, right] = reverse ? [second, first] : [first, second];
    return [[], [left], [left, right], [right], [left, right], []];
}

function generatePairwiseMatrixTests() {
    return E2E_PAIRWISE_VECTORS.flatMap(([first, second], index) => [
        matrixTest(
            `HP${index + 1}_1`,
            `${first} + ${second}: снять ${first}, сохранив ${second}`,
            pairwiseStates(first, second),
            ['full'],
            [first, second]
        ),
        matrixTest(
            `HP${index + 1}_2`,
            `${first} + ${second}: снять ${second}, сохранив ${first}`,
            pairwiseStates(first, second, true),
            ['full'],
            [first, second]
        ),
    ]);
}

// These chains cover shared renderer routes and data/visual interactions that
// are more failure-prone than arbitrary triples. Each chain contains a partial
// removal and a repeat activation; every command already waits for a target
// refresh in runTransitionTest().
const E2E_HIGH_RISK_SEQUENCES = [
    ['invertLegend', 'thickenLines', 'invertLegend', 'thickenLines'],
    ['removeFill', 'thickenLines', 'seriesVisibility', 'invertLegend'],
    ['seriesVisibility', 'thresholdEnabled', 'seriesQueryFilter'],
    ['removeFill', 'invertLegend', 'thresholdEnabled'],
    ['invertIdle', 'seriesVisibility', 'invertLegend'],
];

function highRiskStates(features) {
    const unique = [...new Set(features)];
    const states = unique.map((_, position) => unique.slice(0, position + 1));
    // Remove every feature once while keeping the rest active, then rebuild the
    // complete set. This exposes stale baseline caches and destructive cleanup.
    unique.forEach(feature => {
        states.push(unique.filter(id => id !== feature), unique);
    });
    states.push([]);
    return states;
}

function generateHighRiskMatrixTests() {
    return E2E_HIGH_RISK_SEQUENCES.map((features, index) => matrixTest(
        `HR${index + 1}`,
        `рискованная цепочка: ${features.join(' → ')}`,
        highRiskStates(features),
        index === 0 ? ['fast', 'full'] : ['full'],
        features
    ));
}

const suiteH = [
    ...generateLifecycleMatrixTests(),
    ...generatePairwiseMatrixTests(),
    ...generateHighRiskMatrixTests(),
];

// --- Категория A: Обнаружение окружения ---

const suiteA = [
    {
        id: 'A1',
        category: 'A',
        name: 'Grafana Runtime Detection',
        async run(tabId, env) {
            const version = env.probe?.grafanaVersion;
            if (!version) return { pass: false, details: 'grafanaBootData.settings.buildInfo.version не найден' };
            return { pass: true, details: `v${version}` };
        },
    },
    {
        id: 'A2',
        category: 'A',
        name: 'Route Type Detection',
        async run(tabId, env) {
            const rt = env.probe?.routeType;
            if (!rt) return { pass: false, details: 'routeType не определён' };
            return { pass: true, details: rt.toUpperCase() };
        },
    },
    {
        id: 'A3',
        category: 'A',
        name: 'Engine Detection',
        async run(tabId, env) {
            const engine = env.probe?.engine;
            if (!engine || engine === 'none') return { pass: false, details: 'canvas не найден — движок не определён' };
            return { pass: true, details: engine === 'flot' ? 'Flot (canvas.flot-base)' : 'uPlot (canvas)' };
        },
    },
    {
        id: 'A4',
        category: 'A',
        name: 'Panel Count',
        async run(tabId, env) {
            const count = env.probe?.allPanelCount ?? 0;
            if (count < 1) return { pass: false, details: 'Панели не найдены в DOM' };
            const vis = env.probe?.visiblePanelCount ?? 0;
            return { pass: true, details: `Всего в DOM: ${count}, видимых: ${vis}` };
        },
    },
    {
        id: 'A5',
        category: 'A',
        name: 'Content Script Injection',
        async run(tabId, env) {
            const ok = env.probe?.contentScript === true;
            return {
                pass: ok,
                details: ok ? 'data-dashbridge-icon-url присутствует' : 'Маркер content script не найден на <html>',
            };
        },
    },
    {
        id: 'A6',
        category: 'A',
        name: 'MAIN World Runtime: panelToolsState',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.panelToolsState === true;
            return {
                pass: ok,
                details: ok ? 'window.__dashbridgePanelToolsState загружен' : 'window.__dashbridgePanelToolsState не найден',
            };
        },
    },
    {
        id: 'A7',
        category: 'A',
        name: 'MAIN World Runtime: VisualEngine',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.visualEngine === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaVisualEngine загружен' : 'window.DashBridgeGrafanaVisualEngine не найден',
            };
        },
    },
    {
        id: 'A8',
        category: 'A',
        name: 'MAIN World Runtime: PanelState',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.panelState === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaPanelState загружен' : 'window.DashBridgeGrafanaPanelState не найден',
            };
        },
    },
    {
        id: 'A9',
        category: 'A',
        name: 'MAIN World Runtime: GrafanaDom',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.grafanaDom === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaDom загружен' : 'window.DashBridgeGrafanaDom не найден',
            };
        },
    },
];

// --- Категория F: Storage и Background ---

const suiteF = [
    {
        id: 'F1',
        category: 'F',
        name: 'chrome.storage.local read/write',
        async run(_tabId, _env) {
            const key = '__dashbridge_test_probe_' + Date.now();
            const value = 'ok_' + Math.random();
            try {
                await chrome.storage.local.set({ [key]: value });
                const result = await chrome.storage.local.get(key);
                await chrome.storage.local.remove(key);
                const pass = result[key] === value;
                return { pass, details: pass ? 'read/write успешно' : `Записано: ${value}, прочитано: ${result[key]}` };
            } catch (e) {
                return { pass: false, details: `Ошибка: ${e.message}` };
            }
        },
    },
    {
        id: 'F2',
        category: 'F',
        name: 'chrome.storage.sync read',
        async run(_tabId, _env) {
            try {
                await chrome.storage.sync.get(null);
                return { pass: true, details: 'chrome.storage.sync доступен' };
            } catch (e) {
                return { pass: false, details: `Ошибка: ${e.message}` };
            }
        },
    },
];

// ─── Человекочитаемый каталог тестов ──────────────────────────────────
const STATIC_TEST_METADATA = {
    F1: ['Локальное хранилище: запись и чтение', 'Записывает уникальное тестовое значение в chrome.storage.local, читает его и удаляет без изменения пользовательских данных.'],
    F2: ['Синхронизируемое хранилище: доступность', 'Проверяет, что chrome.storage.sync доступно расширению для чтения настроек.'],
    A1: ['Версия Grafana', 'Определяет фактическую версию Grafana из runtime страницы.'],
    A2: ['Тип страницы Grafana', 'Проверяет распознавание обычного дашборда, View или одиночной панели.'],
    A3: ['Движок графика: uPlot или Flot', 'Находит фактически работающий renderer, от которого зависят дальнейшие проверки.'],
    A4: ['Панели дашборда', 'Проверяет, что панели Grafana найдены в DOM и хотя бы одна доступна для тестирования.'],
    A5: ['Загрузка DashBridge в Grafana', 'Проверяет маркер isolated content script на открытой странице Grafana.'],
    A6: ['Контроллер настроек панели', 'Проверяет загрузку MAIN-world владельца команд, фильтров и lifecycle панели.'],
    A7: ['Движок оформления графика', 'Проверяет загрузку MAIN-world движка заливки, линий, легенды, видимости и порога.'],
    A8: ['Состояние выбранной панели', 'Проверяет загрузку владельца сохранения и восстановления состояния панели.'],
    A9: ['Поиск панели в DOM Grafana', 'Проверяет загрузку общего адаптера поиска панели и её renderer-узлов.'],
};

const STATIC_TEST_SOURCES = {
    A6: ['js/content/grafana-panel-tools.js', 'window.__dashbridgePanelToolsState'],
    A7: ['js/content/grafana-visual-engine.js', 'window.DashBridgeGrafanaVisualEngine'],
    A8: ['js/content/grafana-panel-state.js', 'window.DashBridgeGrafanaPanelState'],
    A9: ['js/content/grafana-dom.js', 'window.DashBridgeGrafanaDom'],
};

const DASHBRIDGE_TEST_SUITE = [...suiteF, ...suiteA, ...suiteH].map(test => {
    const metadata = STATIC_TEST_METADATA[test.id];
    return metadata ? { ...test, name: metadata[0], technicalName: test.name, description: metadata[1], tags: ['environment'] } : test;
});

function getTestFeatureReference(testOrId) {
    const test = typeof testOrId === 'object'
        ? testOrId
        : DASHBRIDGE_TEST_SUITE.find(item => item.id === String(testOrId || ''));
    if (!test) return null;
    const features = (test.featureIds || []).map(id => E2E_FEATURES_BY_ID[id]).filter(Boolean);
    const staticSource = STATIC_TEST_SOURCES[test.id] || [];
    return {
        label: test.name,
        description: test.description || 'Выполняет причинную проверку DashBridge в живой Grafana.',
        steps: Array.isArray(test.steps) ? test.steps : [],
        sourceFile: features[0]?.sourceFile || staticSource[0] || '',
        sourceSymbol: features[0]?.sourceSymbol || staticSource[1] || '',
        technicalName: test.technicalName || '',
    };
}
