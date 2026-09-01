'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'),
    'utf8'
);
const visualEngineSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'),
    'utf8'
) + fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-threshold-visuals.js'),
    'utf8'
);
const seriesStylesSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-series-styles.js'),
    'utf8'
);

assert(source.includes('const delays = [0, 80, 180, 350]'),
    'visual settings must be reapplied across the post-query renderer settling window');
assert(source.includes('visualStyleReapplyFrame = requestAnimationFrame(async () =>')
    && !source.includes('visualStyleReapplyFrame = requestAnimationFrame(() => requestAnimationFrame(async () =>'),
    'the first style-only refresh repair must run before Grafana can paint one native-fill frame');
assert(source.includes('waitForCommittedVisualState')
    && source.includes("recordVisualReapply(rendererChanged ? 'renderer-replaced' : 'style-drift'")
    && source.includes("recordVisualReapply('adaptive-completed'"),
    'late Grafana renderer replacement must trigger an adaptive style reapply before settlement');
assert(source.includes('superseded-by-newer-query'),
    'an older refresh burst must yield to the newest query');
assert(source.includes('generation !== visualStyleReapplyGeneration'),
    'rapid refreshes must not let stale retries overwrite current settings');
assert(source.includes('getLocalStyleDebug?.({') && source.includes('styleState,'),
    'each retry must report the renderer state it actually produced');
assert(seriesStylesSource.includes('rendererInstanceId: getUPlotDiagnosticId(uplot)')
    && seriesStylesSource.includes('evaluatedFillValues:'),
    'style diagnostics must identify renderer remounts and report evaluated fill values');
assert(source.includes('visualReapplyDiagnostic.pending = true')
    && source.includes('visualReapplyDiagnostic.pending = false'),
    'the runner must be able to distinguish a completed call from a completed reapply generation');
assert(source.includes("const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true")
    && source.includes("reason: 'visual-only-observed'")
    && source.includes("? 'query-signature' : 'none'"),
    'E2E resets must retain target-scoped query evidence while the production idle fast path remains intact');
assert(source.includes("recordVisualReapply('command-post-resize'"),
    'the command acknowledgement must follow a semantic apply on the post-resize renderer');
assert(visualEngineSource.includes('outerPanel.__dashBridgeObserverRaf = requestAnimationFrame')
    && visualEngineSource.includes('cancelAnimationFrame(node.__dashBridgeObserverRaf)'),
    'disconnecting the legacy painter must also cancel its already queued paint callback');
assert(visualEngineSource.includes('const legacyVisualObserverOwners = new Set()')
    && visualEngineSource.includes('legacyVisualObserverOwners.forEach(owner => nodes.add(owner))')
    && visualEngineSource.includes("document.querySelectorAll?.('*').forEach(node => nodes.add(node))"),
    'style-only commands must disconnect stale observers owned by previous roots or runtime generations');
assert(visualEngineSource.includes('s._originalFill = hasPublicOriginalFill')
    && visualEngineSource.includes('? s.__dashbridgeOriginalAreaFill')
    && visualEngineSource.includes('s._originalFill = s.__dashbridgeOriginalAreaFill;'),
    'legacy visual routing must reuse and repair the public native-fill baseline after removeFill');
assert(visualEngineSource.includes('__dashBridgeLegendOriginalXAxisIncrement')
    && visualEngineSource.includes('xAxis._incrs = () => [savedXAxisIncrement]')
    && visualEngineSource.includes('xAxis._incrs = originalXAxisIncrements'),
    'restoring the native legend layout must preserve the original time-grid increment for one redraw');
assert(source.includes('let legendVisibilityRestoreAfterNextQuery = false;')
    && source.includes('seriesQueryFilterWasEnabled && !tools.seriesQueryFilterEnabled')
    && source.includes('cpuCapacityFilterWasEnabled && !tools.cpuCapacityFilterEnabled')
    && source.includes('hasExplicitLegendVisibilityWork() || legendVisibilityRestoreAfterNextQuery')
    && source.includes("recordVisualReapply('legend-visibility-restore-consumed'"),
    'source-filter OFF must restore visibility again after the complete native legend returns');
assert(source.includes('const invertIdleWasEnabled = !!tools.invertIdle;')
    && source.includes('const responseLabelTransformWasDisabled = invertIdleWasEnabled && !tools.invertIdle')
    && source.includes('convertMemWasEnabled && !tools.convertMemToUsed')
    && source.includes('if (responseLabelTransformWasDisabled && legendVisibilityRequested)')
    && source.includes('legendVisibilityRestoreAfterNextQuery = true;'),
    'turning off a label-changing response transform must restore visibility after native labels return');
assert(source.includes('const legendVisibilityPayloadProvided = Object.prototype.hasOwnProperty.call(commandTools, \'legendVisibility\');')
    && source.includes('visibilityHasHiddenEntries(commandTools.legendVisibility)')
    && source.includes('visibilityHasHiddenEntries(tools.legendVisibility)')
    && source.includes('commandTools.legendVisibility === null'),
    'an empty generated visibility map must be a no-op unless it restores a previously hidden series');
assert(source.includes('const resolveLegendVisibilityDesired = (visibility, key) =>')
    && source.includes("const separatorIndex = key.lastIndexOf('\\u0000');")
    && source.includes("const loadPattern = /load\\s*\\(calc\\)/gi;")
    && source.includes('desired: resolveLegendVisibilityDesired(visibility, key), nativeDisabled'),
    'key-aware visibility must follow the reversible idle to load (calc) response transform');
assert(source.includes('const memoryIdentity = candidate =>')
    && source.includes('const calculatedPattern = /used\\s*%\\s*\\(calc\\)/gi;')
    && source.includes('memoryIdentity(candidate) === currentMemoryIdentity'),
    'key-aware visibility must follow Total/Available fields into the calculated RAM series for the same server');
assert(source.includes("visualMetadata.responseDataStatus?.kind === 'filtered_empty'")
    && source.includes("getLegendItems().length === 0")
    && source.includes('&& (legendVisibilityRestoreAfterNextQuery')
    && source.includes("tools.seriesQueryFilterEnabled === true")
    && source.includes("tools.cpuCapacityFilterEnabled === true")
    && source.includes('!legendVisibilityApplied && !filteredEmptyLegendCanReturnAfterQuery')
    && source.includes('deferredLegendVisibilityRestored')
    && source.includes("recordVisualReapply('legend-visibility-restore-pending'"),
    'an intentional filtered-empty reset may defer legend restore, but the next full-data render must prove it before consuming the request');
assert(source.includes('let thresholdRestoreAfterNextQuery = false;')
    && source.includes('if (thresholdRestoreAfterNextQuery && tools.thresholdEnabled)')
    && source.includes("status?.enabled === true && status.engine && status.engine !== 'unknown'")
    && source.includes("visualMetadata.responseDataStatus?.kind === 'filtered_empty'")
    && source.includes('if (tools.thresholdEnabled && !thresholdRestoreAfterNextQuery) await applyThresholdWhenChartReady();'),
    'an enabled threshold must wait for the first full renderer after an intentionally empty response filter is disabled');
assert(source.includes('commandDiagnostic.legendVisibilityDeferred = !legendVisibilityApplied')
    && source.includes('legendVisibilityDeferred: legendVisibilityRequested')
    && source.includes('!!commandDiagnostic.legendVisibilityDeferred'),
    'the command acknowledgement must distinguish a proven legend failure from a filtered-empty restore deferred to the causal refresh');
assert(source.includes('if (overlay.textContent !== status.text) overlay.textContent = status.text;')
    && !/\n\s*overlay\.textContent = status\.text;/.test(source),
    'the document-wide title observer must not create a self-sustaining panel-status mutation loop');
assert(seriesStylesSource.includes('const configureLocalSeriesStyleGuard =')
    && seriesStylesSource.includes("attributeFilter: ['width', 'height', 'class']")
    && seriesStylesSource.includes('applyLocalSeriesStyles({ root, ...guard.settings })'),
    'style-only state must be restored in the renderer replacement mutation before paint');
assert(visualEngineSource.includes('const completeLegacyStyleApply = legacyResult =>')
    && visualEngineSource.includes('return completeLegacyStyleApply(legacyResult);')
    && visualEngineSource.match(/return completeLegacyStyleApply\(legacyResult\);/g)?.length === 2
    && visualEngineSource.includes('root, removeFill, thickenLines, thickenLinesValue,'),
    'legend layout and visibility routes must reassert fill/width on the current Flot renderer');
assert(visualEngineSource.includes('layoutAlreadyApplied')
    && visualEngineSource.includes('layoutChanged: false')
    && visualEngineSource.includes('if (legendLayout?.layoutChanged || uplotResizedAfterLegendLayout)'),
    'an unchanged persistent legend layout must not jiggle the iframe width on every refresh retry');
assert(visualEngineSource.includes('Math.max(position.topMin, Math.min(position.topMax, position.top))')
    && visualEngineSource.includes('topMin: plotOffset.top')
    && visualEngineSource.includes('topMax: plotOffset.top + plotHeight')
    && visualEngineSource.includes('topMin: bbox.top / pxRatio')
    && visualEngineSource.includes('topMax: (bbox.top + bbox.height) / pxRatio'),
    'threshold lines above or below the current Flot/uPlot scale must stay inside the drawable plot area');
assert(visualEngineSource.includes("aboveScale ? 'top:3px;' : 'bottom:3px;'")
    && visualEngineSource.includes("aboveScale ? '↑ ' : belowScale ? '↓ ' : ''")
    && visualEngineSource.includes('(выше текущей шкалы)'),
    'an out-of-scale threshold must be identified without placing its label outside the plot');

const stalePanelIdRoute = "panelId: targetPanel?.getAttribute?.('data-panelid') || targetPanel?.dataset?.panelid || null";
assert(!source.includes(stalePanelIdRoute),
    'Grafana 12 data-viz-panel-key panels must not fall back to an unrelated visible panel');
assert((source.match(/panelId: getPanelStateKey\(targetPanel\) \|\| tools\.targetPanelId \|\| null/g) || []).length >= 4,
    'every direct and refresh visual apply must retain the normalized target panel key');
assert(source.includes('panelVisualState?.set(panel, nextState)')
    && !source.includes('panelVisualState.persist(panel, nextState)')
    && !source.includes("'dashbridgeGrafanaPanelStateRestored'"),
    'native Grafana keeps modal changes only in the current document');

console.log('PASS Grafana panel visual persistence routing');
