"""Static contract checks for the causal DashBridge Grafana E2E runner."""
from pathlib import Path
import re
import sys
from support.smoke import run_checks

# Keep failure output readable on Windows consoles configured with a legacy code page.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

ROOT = Path(__file__).resolve().parent.parent
SUITE = "\n".join((ROOT / f"pages/test-runner/{name}").read_text(encoding="utf-8") for name in [
    "test-runner-diagnostics.js", "test-runner-diagnostic-diff.js",
    "test-runner-transitions.js", "test-runner-suite.js"
])
CORE = (ROOT / "pages/test-runner/test-runner-core.js").read_text(encoding="utf-8")
UI = "\n".join((ROOT / f"pages/test-runner/{name}").read_text(encoding="utf-8") for name in [
    "test-runner-artifact-serialization.js", "test-runner-spool.js", "test-runner-ui.js"
])
REPORT = (ROOT / "pages/test-runner/test-runner-report.js").read_text(encoding="utf-8")
PANEL_TOOLS = (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-panel-data-transforms.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-panel-data-runtime.js").read_text(encoding="utf-8")
GRAFANA_DOM = (ROOT / "js/content/grafana-dom.js").read_text(encoding="utf-8")
VISUAL_ENGINE = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visibility-adapters.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visuals.js").read_text(encoding="utf-8")
SERIES_STYLES = (ROOT / "js/content/grafana-series-styles.js").read_text(encoding="utf-8")
HTML = (ROOT / "pages/test-runner/test-runner.html").read_text(encoding="utf-8")


def references_local(attribute, target):
    page = ROOT / "pages/test-runner/test-runner.html"
    return any(
        page.parent.joinpath(reference).resolve() == (ROOT / target).resolve()
        for reference in re.findall(rf'{attribute}\s*=\s*["\']([^"\']+)["\']', HTML, re.IGNORECASE)
    )

checks = {
    "captureState keeps visual and DOM evidence": (
        "async function captureState(tabId, panelId)" in SUITE
        and "const [canvas, dom] = await Promise.all([" in SUITE
        and "return { canvas, dom };" in SUITE
    ),
    "interceptor keeps a full serializable request journal": (
        "nextEventId: 0, activeRequests: 0, events: []" in PANEL_TOOLS
        and "const pushEvent = (stage, details = {}) =>" in PANEL_TOOLS
        and "diagnostics.events.splice" not in PANEL_TOOLS
        and "const beginRequest = (transport, url) =>" in PANEL_TOOLS
        and "const completeRequest = (requestId, transport, outcome, details = {}) =>" in PANEL_TOOLS
    ),
    "interceptor records query lifecycle terminal states": all(token in PANEL_TOOLS for token in [
        "pushEvent('request-start'", "pushEvent('response'", "pushEvent('query-error'",
        "pushEvent('decode-error'", "pushEvent('scope-mismatch'", "pushEvent('transform'",
        "pushEvent('transform-skipped'", "pushEvent('request-complete'",
    ]),
    "fetch and XHR observe visual-only target requests": (
        "reason: 'visual-only-observed'" in PANEL_TOOLS
        and "const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true" in PANEL_TOOLS
        and "? 'query-signature' : 'none'" in PANEL_TOOLS
        and "if (!transformActive)" in PANEL_TOOLS
        and "const decoded = window.DashBridgeGrafanaNetwork.readXhrJson(this);" in PANEL_TOOLS
        and "originalResponseText = await response.text();" in PANEL_TOOLS
        and "const data = transform(decoded, requestBody" in PANEL_TOOLS
    ),
    "visual-only target observations satisfy the strict lifecycle": (
        "['transform', 'transform-skipped'].includes(event.stage)" in SUITE
        and "['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)" in SUITE
    ),
    "retired single-toggle generator is absent from the active matrix": (
        "generateSingleToggleTests" not in SUITE
        and "makeOffSettings" not in SUITE
        and "function generateLifecycleMatrixTests()" in SUITE
    ),
      "runner reads journal and waits for a selected-panel response": (
        "async function readQueryLifecycle(tabId, afterEventId = 0)" in SUITE
        and "async function waitForTargetQueryLifecycle(tabId, afterEventId, timeoutMs = 12000)" in SUITE
        and "status: 'target-complete'" in SUITE
        and "status: httpError ? 'query-error' : (started ? 'target-not-matched' : 'request-not-started')" in SUITE
        and "status: 'decode-error'" in SUITE
    ),
    "settings application captures scope and uses causal refresh evidence": (
        "async function applySettingsAndWait(tabId, panelId, settings, { refresh = true, verifyPersistence = false } = {})" in SUITE
        and "const targetScope = await captureTargetDataScope(tabId, panelId);" in SUITE
        and "const cursor = (await readQueryLifecycle(tabId)).nextEventId;" in SUITE
        and "const lifecycle = await waitForTargetQueryLifecycle(tabId, cursor);" in SUITE
        and "await sleep(needsDataRefresh ? 1800 : (needsRenderRefresh ? 1600 : 800));" not in SUITE
    ),
    "runner waits for observable panel stability after the target response": (
        "async function waitForPanelStability(tabId, panelId" in SUITE
        and "sampleCap = 64" in SUITE
        and "samplePolicy: 'first-and-newest-bounded/v1'" in SUITE
        and "schema: 'dashbridge-e2e-panel-settlement/v1'" in SUITE
        and "requiredQuietMs: options.quietMs" in SUITE
        and "consecutiveStableFrames >= options.stableFrames" in SUITE
        and "const fingerprint = JSON.stringify(observableFacts);" in SUITE
        and "const visualReapplyIdle = facts.visualReapply.pending === false;" in SUITE
        and "visual-reapply-pending" in SUITE
        and "const dataLayoutReflowIdle = facts.dataLayoutReflow.pending === false;" in SUITE
        and "data-layout-reflow-pending" in SUITE
        and "mutationSummary:" in SUITE
        and "command.settlement?.status === 'stable'" in SUITE
        and "const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;" in SUITE
        and SUITE.index("const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;")
            < SUITE.index("const result = await applyPanelTools(tabId, command);")
        and SUITE.index("const cursor = (await readQueryLifecycle(tabId)).nextEventId;")
            > SUITE.index("const result = await applyPanelTools(tabId, command);")
    ),
    "active matrix states survive a second refresh without another command": (
        "const verifyPersistence = activeIds.length > 0 && !persistenceProvenFor.has(persistenceKey);" in SUITE
        and "applySettingsAndWait(tabId, panelId, resolvedSettings, { verifyPersistence })" in SUITE
        and "persistence.beforeRefresh = await captureRuntimeDiagnostic(tabId, panelId, {" in SUITE
        and "persistence.refresh = await triggerRefresh(tabId);" in SUITE
        and "persistence.lifecycle = await waitForTargetQueryLifecycle(tabId, persistence.cursor);" in SUITE
        and "persistencePassed: command.persistence?.passed" not in SUITE
        and "persistencePassed," in SUITE
        and "persistenceHealth" in REPORT
        and "after-first-refresh" in REPORT
    ),
    "source-filter reset defers legend restoration until native series return": (
        "let legendVisibilityRestoreAfterNextQuery = false;" in PANEL_TOOLS
        and "seriesQueryFilterWasEnabled && !tools.seriesQueryFilterEnabled" in PANEL_TOOLS
        and "cpuCapacityFilterWasEnabled && !tools.cpuCapacityFilterEnabled" in PANEL_TOOLS
        and "hasExplicitLegendVisibilityWork() || legendVisibilityRestoreAfterNextQuery" in PANEL_TOOLS
        and "legend-visibility-restore-consumed" in PANEL_TOOLS
    ),
    "panel tool commands are serialized when UI changes arrive rapidly": (
        "const processPanelToolsMessage = async event =>" in PANEL_TOOLS
        and "window.__dashbridgePanelToolsCommandSequence" in PANEL_TOOLS
        and "window.__dashbridgePanelToolsCommandQueue" in PANEL_TOOLS
        and "previous.catch(() => undefined).then(async () =>" in PANEL_TOOLS
        and "commandStatus: 'error'" in PANEL_TOOLS
        and "queue: event.data.__dashbridgeCommandQueue || null" in PANEL_TOOLS
    ),
    "visual settings are reapplied after every manual or automatic graph refresh": (
        "const hasPersistentVisualWork" in PANEL_TOOLS
        and "window.__dashbridgeVisualReapplyDiagnostic" in PANEL_TOOLS
        and "visualReapplyDiagnostic.completed += 1;" in PANEL_TOOLS
        and "await window.DashBridgeGrafanaVisualEngine?.apply" in PANEL_TOOLS
        and "legendVisibilityApplied = await applyLegendVisibilityByKey(tools.legendVisibility || {});" in PANEL_TOOLS
        and "const consumeVisualStylesAfterQuery" in PANEL_TOOLS
        and "reapplyVisualStylesAfterDataTransform();" in PANEL_TOOLS
        and "visualReapplyDiagnostic:" in SUITE
    ),
    "fresh Grafana renderers count as clean when DashBridge baseline markers are absent": (
        "if (series.originalFill === '[undefined]') return true;" in SUITE
        and "!Number.isFinite(series.originalWidth) || series.width === series.originalWidth" in SUITE
        and "series.fillDisabled === true || series.fill === false || transparent(series.evaluatedFill)" in SUITE
    ),
    "transitions require command acknowledgement and target lifecycle": (
        "const lifecyclePassed = command.status === 'applied'" in SUITE
        and "lifecycle?.status === 'target-complete'" in SUITE
        and "const stepSkipped = !!(checkResult.skip || checkResult.reason?.startsWith('SKIP:'));" in SUITE
        and "if (!stepPassed && !stepSkipped) break;" in SUITE
        and "reset.lifecycle?.status === 'target-complete'" in SUITE
        and "schema: 'dashbridge-e2e-transition-evidence/v1'" in SUITE
        and "semanticInvariantPassed: !!checkResult.pass," in SUITE
    ),
    "reset verifies the all-OFF semantic state before reusing a panel": (
        "const resetInvariant = resetLifecyclePassed" in SUITE
        and "activeSetInvariant([], null)(baseline, afterState, env)" in SUITE
        and "semanticInvariantPassed: !!resetInvariant.pass," in SUITE
        and "Сброс семантически подтвердил исходное состояние всех функций" in SUITE
        and "const inactiveIds = activeIds.length === 0" in SUITE
        and "E2E_FEATURE_REGISTRY.map(feature => feature.id)" in SUITE
    ),
    "failed reset quarantines the remaining URL tests": (
        "diagnostic.environmentUnsafe = true;" in SUITE
        and "environmentUnsafe: diagnostic.environmentUnsafe === true," in SUITE
        and "let environmentUnsafe = false;" in CORE
        and "if (runnerState.aborted || environmentUnsafe) break;" in CORE
        and "Не доказан откат настроек выбранной панели" in CORE
        and "environmentUnsafe," in CORE
    ),
    "source filter preserves an honest empty result and semantic accounting": (
        "An empty result is a valid outcome" in PANEL_TOOLS
        and "thresholdMatchedSeries: 0," in PANEL_TOOLS
        and "safetyRetainedSeries: 0," in PANEL_TOOLS
        and "removedSeries: 0," in PANEL_TOOLS
        and "responseFilterEmptyIsNormal" in PANEL_TOOLS
        and "sourceFilter = filterSeriesByThreshold(scopedData).metrics;" in PANEL_TOOLS
        and "beforeSeries, afterSeries, sourceFilter," in PANEL_TOOLS
        and "metrics.removedSeries = Math.max(0, metrics.beforeSeries - metrics.afterSeries);" in PANEL_TOOLS
        and "Drop time-only drafts before turning them back into Grafana frames." in PANEL_TOOLS
        and ".filter(item => !item?.frame || (item.tableShape" in PANEL_TOOLS
        and "item.keptIndexes.length > item.timeIndexes.length))" in PANEL_TOOLS
    ),
    "series-filter invariants use target interceptor evidence rather than canvas state": (
        "const metrics = transform?.sourceFilter;" in SUITE
        and "metrics.removedSeries > 0" in SUITE
        and "sourceFilterEnabled === false" in SUITE
        and "targetEvent.afterSeries === targetEvent.beforeSeries" in SUITE
        and "restoredByNativeBypass" in SUITE
        and "targetEvent.reason === 'visual-only-observed'" in SUITE
        and "current.diagnostic?.tools?.seriesQueryFilterEnabled === false" in SUITE
        and "SKIP: в целевом ответе нет серий, которые можно безопасно убрать" in SUITE
        and "Ожидалось уменьшение числа серий" not in SUITE
    ),
    "threshold invariant requires panel-specific semantic engine evidence": (
        "thresholdOn: (baseline, current, env) =>" in SUITE
        and "const threshold = current.diagnostic?.thresholdDiagnostic || {};" in SUITE
        and "threshold.panelFound === true" in SUITE
        and "['uplot', 'flot'].includes(status.engine)" in SUITE
        and "Number.isFinite(Number(status.rawThreshold))" in SUITE
        and "threshold.enabled === false && threshold.status?.enabled === false" in SUITE
        and "requested: {" in PANEL_TOOLS
        and "includeHidden" not in PANEL_TOOLS
    ),
    "runtime evidence fails only DashBridge-originated errors and reports Grafana warnings": (
        "function classifyRuntimeEvidence(runtime)" in CORE
        and "policy: 'dashbridge-and-targeted-query-errors-fail/v1'" in CORE
        and "const dashBridgeErrors = runtimeErrors.filter" in CORE
        and "const grafanaWarnings = runtimeErrors.filter" in CORE
        and "pass: dashBridgeErrors.length === 0," in CORE
        and "const finalPass = functionalPass && runtimeEvidence.pass;" in CORE
        and "dashBridgeErrorCount" in UI
        and "Предупреждения Grafana (не влияют на PASS/FAIL)" in UI
    ),
    "generated matrix composes active-set invariants and bounded vectors": (
        "const E2E_FEATURE_REGISTRY = [" in SUITE
        and "const E2E_FEATURES_BY_ID = Object.fromEntries" in SUITE
        and "function combineInvariantResults(results)" in SUITE
        and "function activeSetInvariant(activeIds, changedId = null)" in SUITE
        and "function makeMatrixTransitions(states)" in SUITE
        and "function generateLifecycleMatrixTests()" in SUITE
        and "const E2E_PAIRWISE_VECTORS = [" in SUITE
        and "function generatePairwiseMatrixTests()" in SUITE
        and "const E2E_HIGH_RISK_SEQUENCES = [" in SUITE
        and "function generateHighRiskMatrixTests()" in SUITE
        and "...generateLifecycleMatrixTests()," in SUITE
        and "...generatePairwiseMatrixTests()," in SUITE
        and "...generateHighRiskMatrixTests()," in SUITE
    ),
    "lifecycle generator repeats both ON and OFF before reset": (
        "OFF→ON→ON→OFF→OFF→ON (идемпотентность)" in SUITE
        and "[[feature.id], [feature.id], [], [], [feature.id]]" in SUITE
        and "`${id}_3`" in SUITE
    ),
    "pairwise generator covers directed partial-OFF paths": (
        "function pairwiseStates(first, second, reverse = false)" in SUITE
        and "return [[], [left], [left, right], [right], [left, right], []];" in SUITE
        and "снять ${first}, сохранив ${second}" in SUITE
        and "снять ${second}, сохранив ${first}" in SUITE
        and "pairwiseStates(first, second, true)" in SUITE
    ),
    "risk matrix removes and reactivates each active feature semantically": (
        "function highRiskStates(features)" in SUITE
        and "states.push(unique.filter(id => id !== feature), unique);" in SUITE
        and "states.push([]);" in SUITE
        and "['invertLegend', 'thickenLines', 'invertLegend', 'thickenLines']" in SUITE
        and "activeSetInvariant(activeIds, changedId)" in SUITE
    ),
    "matrix resolves dynamic settings before capability skips": (
        "const resolvedTransitions = await Promise.all(transitions.map(async step => ({" in SUITE
        and "settings: typeof step.settings === 'function'" in SUITE
        and "const skippedReason = resolvedTransitions.map(step => transitionSkipReason(step.settings, env)).find(Boolean);" in SUITE
        and "for (let i = 0; i < resolvedTransitions.length; i++)" in SUITE
        and "isolationReset = await resetAllSettings(tabId, panelId);" in SUITE
        and "status: i === 0 ? isolationReset.status : 'not-repeated'" in SUITE
        and "inactive.filter(result => !result?.skip)" in SUITE
    ),
    "CPU inversion accepts causal Flot legend evidence after plot replacement": (
        "Grafana 10/Flot can replace its plot object" in SUITE
        and "current.diagnostic?.markers?.visibilityEntries" in SUITE
        and "event.invertIdle === true" in SUITE
        and "const nativeResponse = targetEvent?.stage === 'transform-skipped'" in SUITE
        and "CPU Idle → Load подтверждён серией load (calc)" in SUITE
    ),
    "series visibility is causal, target-specific, and resettable": (
        "if (settings?.legendVisibility && !env.hasVisibilitySeries)" in SUITE
        and "seriesVisibilityOn: (baseline, current, env) =>" in SUITE
        and "seriesVisibilityOff: (baseline, current, env) =>" in SUITE
        and "const visibilityEntries = legendEntries.map(entry => {" in SUITE
        and "key: `${label}\\u0000${occurrence}`" in SUITE
        and "const targetEntry = findEquivalentVisibilityEntry(markers.visibilityEntries || [], target, current);" in SUITE
        and "function findEquivalentVisibilityEntry(entries, target, current)" in SUITE
        and "const calculatedKey = target.key.replace(new RegExp(escapedIdle, 'gi'), 'load (calc)');" in SUITE
        and "if (runtimeTools.convertMemToUsed !== true) return null;" in SUITE
        and ".replace(/used\\s*%\\s*\\(calc\\)/gi, '')" in SUITE
        and "targetEntry.hidden || targetEntry.dimmed || targetEntry.nativeHidden || targetEntry.visuallyHidden" in SUITE
        and "entry?.nativeDisabled === !desired && entry.current === desired" in PANEL_TOOLS
        and "resetSeriesVisibility?.({ root });" in PANEL_TOOLS
        and "не доказано скрытие выбранной серии" in SUITE
        and "legendVisibility: {}," in SUITE
        and "const visibilitySettings = env =>" in SUITE
        and "id: 'seriesVisibility'," in SUITE
        and "const legendOccurrences = new Map();" in CORE
        and "const visibilityCandidates = legendLabels.map(label => {" in CORE
        and "key: `${label}\\u0000${occurrence}`" in CORE
        and "const legendLabel = item => item?.querySelector(" in GRAFANA_DOM
        and "legendItems, legendLabel, legendSeriesNames };" in GRAFANA_DOM
        and ".map(item => (dom?.legendLabel?.(item) || item).textContent?.trim())" in CORE
        and "const labelNode = dom?.legendLabel?.(entry) || entry;" in SUITE
        and "const getLegendLabel = item => window.DashBridgeGrafanaDom?.legendLabel?.(item) || item;" in PANEL_TOOLS
    ),
    "style invariants inspect renderer state instead of incidental canvas repaint": (
        "const matrixInvariants = {" in SUITE
        and "rendererSeries: current =>" in SUITE
        and "item.__dashbridgeFillDisabled === true ? false : display(item.fill)" in SUITE
        and "series.fill === false" in SUITE
        and "series.fill === series.originalFill" in SUITE
        and "const fillDisabled = !!removeFill;" in SERIES_STYLES
        and "series.__dashbridgeFillDisabled = fillDisabled;" in SERIES_STYLES
        and "const fnFill = makeFn(targetFill);" in VISUAL_ENGINE
        and "const moveToBottom = originalDirection === 'row';" in VISUAL_ENGINE
        and "series.width > series.originalWidth" in SUITE
        and "series.width === series.originalWidth" in SUITE
        and "const imageCapture = await capturePanelDiagnosticImage(tabId, panelId, {" in SUITE
        and "diagnostic.panelImage = imageCapture;" in SUITE
    ),
    "legend relocation inverts native direction and restores it after OFF": (
        "const legendPosition = {" in SUITE
        and "const sharedLegendAncestor = () => {" in SUITE
        and "let candidate = legendEntries[0];" in SUITE
        and "|| sharedLegendAncestor();" in SUITE
        and "const expectedDirection = before.direction === 'right' ? 'bottom' : 'right';" in SUITE
        and "const applied = after.direction === expectedDirection && allEntriesMoved && markerMatchesDirection;" in SUITE
        and "after?.direction === before.direction" in SUITE
        and "originalDirection: root?.__dashBridgeLegendOriginalDirection || null," in SUITE
        and "const moveToBottom = originalDirection === 'row';" in VISUAL_ENGINE
        and "if (!Object.prototype.hasOwnProperty.call(outerPanel, legendOriginalDirectionKey))" in VISUAL_ENGINE
        and "const dashBridgeLayoutActive = !!root" in SUITE
        and "const direction = dashBridgeDirection || grafanaDirection" in SUITE
        and "dashbridge-active-layout" in SUITE
        and "debugLog('legend layout decision'" in VISUAL_ENGINE
    ),
    "active suite excludes deprecated timing-based categories": (
        "const DASHBRIDGE_TEST_SUITE = [...suiteF, ...suiteA, ...suiteH].map(test =>" in SUITE
        and "...suiteB" not in SUITE.split("const DASHBRIDGE_TEST_SUITE =", 1)[1]
        and "...suiteC" not in SUITE.split("const DASHBRIDGE_TEST_SUITE =", 1)[1]
        and "...suiteD" not in SUITE.split("const DASHBRIDGE_TEST_SUITE =", 1)[1]
        and "...suiteE" not in SUITE.split("const DASHBRIDGE_TEST_SUITE =", 1)[1]
        and "...suiteG" not in SUITE.split("const DASHBRIDGE_TEST_SUITE =", 1)[1]
    ),
    "core tracks planned started completed and aborted-not-run work": all(token in CORE for token in [
        "planned: 0,", "scheduled: 0,", "started: 0,", "completed: 0,", "abortedNotRun: 0,",
        "planned: runnerState.planned,", "completed: runnerState.completed,",
        "abortedNotRun: runnerState.abortedNotRun,",
    ]),
    "aborted tests are not successful skips": (
        "aborted: true," in CORE
        and "details: `Не запущен: ${reason}`" in CORE
        and "runnerState.abortedNotRun += pending.length;" in CORE
        and "pass: false,\n        skip: false,\n        aborted: true," in CORE
    ),
    "UI separates skips from aborted-not-run outcomes": (
        "const rowClass = test.aborted ? 'tr-skip'" in UI
        and "function statusIcon(test)" in UI
        and "if (test.aborted) return `<svg" in UI
        and "⊘ ${aborted} не запущено" in UI
        and "const status = test.aborted ? 'NOT RUN'" in UI
        and "aria-label=\"${test.aborted ? 'Не запущен'" in UI
    ),
    "test runner shares the extension theme and diagnostic viewer follows it": (
        references_local('href', 'pages/shared/theme.css')
        and references_local('href', 'pages/test-runner/test-runner.css')
        and 'id="themeToggle"' not in HTML
        and 'id="themeToggleBtn"' not in HTML
        and "const popupTheme = document.documentElement.getAttribute('data-theme') || 'light';" in UI
        and "window.addEventListener('dashbridge-theme-change', syncPopupTheme);" in UI
        and "data-theme=\"${esc(popupTheme)}\"" in UI
    ),
    "Fast and Full profiles filter planned work and persist in diagnostics": (
        "keepTab = false, mode = 'fast'" in CORE
        and "t.runModes.includes(mode)" in CORE
        and "mode: runnerState.mode || 'fast'," in CORE
        and "runModes = ['full']" in SUITE
        and "['fast', 'full']" in SUITE
        and "const mode = elRunMode?.value === 'full' ? 'full' : 'fast';" in UI
        and "trRunMode" in UI
        and "trLastUrls: cleanedUrls, trRunMode: mode, trTestSelection: testSelection" in UI
        and "mode: snapshot.mode || 'fast'," in REPORT
        and 'id="trRunMode"' in HTML
    ),
    "label-transform reset restores visibility after native series return": (
        "const invertIdleWasEnabled = !!tools.invertIdle;" in PANEL_TOOLS
        and "const responseLabelTransformWasDisabled = invertIdleWasEnabled && !tools.invertIdle" in PANEL_TOOLS
        and "convertMemWasEnabled && !tools.convertMemToUsed" in PANEL_TOOLS
        and "if (responseLabelTransformWasDisabled && legendVisibilityRequested)" in PANEL_TOOLS
        and "legendVisibilityRestoreAfterNextQuery = true;" in PANEL_TOOLS
    ),
    "selected scenarios are explicit, persisted and auditable": (
        "selectedTestIds = null" in CORE
        and "const selectionMatch = !selectedIds || selectedIds.has(t.id);" in CORE
        and "selection: runnerState.selection || { scope: 'all', ids: [] }," in CORE
        and "selectedTestIds," in UI
        and "trTestSelection" in UI
        and 'id="trSelectTestsBtn"' in HTML
    ),
    "verified scenario boundaries remove only duplicate reset refreshes": (
        "const verifiedBoundary = env.__dashbridgeVerifiedCleanBoundary || null;" in SUITE
        and "activeSetInvariant([], null)(verifiedBoundary.state || baseline, baseline, env)" in SUITE
        and "status: isolationResetPassed ? 'reused-verified-reset' : 'reused-reset-drifted'" in SUITE
        and "if (!verifiedBoundary?.pass || verifiedBoundary.panelId !== panelId || !isolationResetPassed)" in SUITE
        and "env.__dashbridgeVerifiedCleanBoundary = resetPassed ?" in SUITE
    ),
    "diagnostic export has lifecycle accounting schema": (
        "dashbridge-e2e-diagnostics/v4" in REPORT
        and "DashBridgeTestReport.createArtifactStreamPlan" in UI
        and "serializeSpoolArtifact(lastSnapshot, diagnosticSpool, exportMetadata," in UI
        and "reconciliation" in REPORT
        and "primaryFailure" in REPORT
        and "failureClusters" in REPORT
        and "abortedNotRun" in REPORT
    ),
    "runner retains watchdog timeout only at test boundary": (
        "const timeoutPromise = coreSleeep(testTimeoutMs)" in CORE
        and "Math.max(CORE_TEST_TIMEOUT_MS, Number(test.timeoutMs))" in CORE
        and "const refreshCount = states.reduce(" in SUITE
        and "timeoutMs: Math.max(30_000, refreshCount * 10_000 + 30_000)" in SUITE
        and "expectedRefreshCount: refreshCount" in SUITE
        and "timeoutProgress" in CORE
        and "await Promise.race([resultPromise, timeoutPromise])" in CORE
    ),
    "HTML retains result-state styles and dynamic suite count": (
        ".tr-count-skip" in HTML
        and ".tr-skip td" in HTML
        and 'id="trHeaderSub"' in HTML
    ),
}

run_checks(checks)
print(f"[OK] All {len(checks)} causal lifecycle checks passed")
print("  - request journal: start/response/scope/transform/completion")
print("  - causal target-query wait with watchdog-only deadline")
print("  - strict command + lifecycle + semantic transition contract")
print("  - generated lifecycle, pairwise, and high-risk active-set coverage")
print("  - Fast/Full profile accounting and persisted selection")
