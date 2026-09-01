// ─── Transition matrix executor ────────────────────────────────────

/**
 * Снимает текущее визуальное состояние: canvas data URL + DOM-маркеры.
 * @param {number} tabId
 * @param {string} panelId
 * @returns {Promise<{canvas: string|null, dom: object}>}
 */
async function captureState(tabId, panelId) {
    // Keep canvas and DOM snapshots in one MAIN-world operation so both refer
    // to the same resolved panel branch.
    const [canvas, dom] = await Promise.all([
        execMain(tabId, pid => {
            const shared = window.DashBridgeGrafanaDom;
            const panel = shared?.findPanelById?.(pid);
            let root = shared?.outerPanel?.(panel) || panel;
            while (root && !root.classList?.contains('react-grid-item')
                && !root.classList?.contains('panel-container') && root.parentElement) root = root.parentElement;
            if (!root) return null;
            // Flot uses layered canvases; serialize all layers to observe redraws.
            const image = [...root.querySelectorAll('canvas')].map(cnv => {
                try { return cnv.toDataURL(); } catch (_) { return ''; }
            }).join('|');
            return image || null;
        }, [panelId]),
        execMain(tabId, pid => {
            const shared = window.DashBridgeGrafanaDom;
            const panel = shared?.findPanelById?.(pid);
            let root = shared?.outerPanel?.(panel) || panel;
            while (root && !root.classList?.contains('react-grid-item')
                && !root.classList?.contains('panel-container') && root.parentElement) root = root.parentElement;
            if (!root) return { legendBottom: false, hidden: false, dimmed: false, seriesCount: 0, thresholdApplied: false, hasCanvas: false };
            const thresholdHost = root.matches?.('[data-dashbridge-threshold-engine]')
                ? root : root.querySelector('[data-dashbridge-threshold-engine]');
            return {
                legendBottom: !!root.querySelector('.dashbridge-legend-bottom'),
                hidden: !!root.querySelector('.dashbridge-uplot-fast-hidden'),
                dimmed: !!root.querySelector('.dashbridge-uplot-fast-dimmed'),
                seriesCount: root.querySelectorAll('.dashbridge-uplot-fast-hidden').length
                    + root.querySelectorAll('.dashbridge-uplot-fast-dimmed').length,
                // The overlay line can be clipped when a threshold is outside
                // the current Y range. The engine marker proves computation and
                // application without requiring an incidental canvas repaint.
                thresholdApplied: !!thresholdHost?.getAttribute('data-dashbridge-threshold-engine'),
                thresholdEngine: thresholdHost?.getAttribute('data-dashbridge-threshold-engine') || '',
                hasCanvas: root.querySelectorAll('canvas').length > 0,
            };
        }, [panelId]),
    ]);
    return { canvas, dom };
}

/**
 * Waits until the selected panel has reached a real, observable steady state.
 * A command acknowledgement and a terminal query event are not sufficient:
 * panel-tools can still have a two-frame visual reapply queued, while React or
 * uPlot can repaint the canvas shortly afterwards. The returned frame journal
 * is retained in the JSON report so fast changes remain diagnosable.
 */
async function waitForPanelStability(tabId, panelId, {
    timeoutMs = 8000,
    quietMs = 300,
    stableFrames = 4,
    sampleCap = 64,
} = {}) {
    return execMain(tabId, (pid, options) => new Promise(resolve => {
        const dom = window.DashBridgeGrafanaDom;
        const startedAt = performance.now();
        const startedWallAt = Date.now();
        const samples = [];
        let observedFrames = 0;
        let droppedSamples = 0;
        let lastFingerprint = null;
        let stableSince = null;
        let consecutiveStableFrames = 0;
        let mutationVersion = 0;
        let lastSampleMutationVersion = 0;
        let rootGeneration = 0;
        let observedRoot = null;
        let observer = null;
        const mutationCounts = {
            childList: 0,
            attributes: 0,
            characterData: 0,
            attributesByName: {},
            targets: {},
        };

        const hashText = value => {
            const text = String(value || '');
            let hash = 2166136261;
            for (let i = 0; i < text.length; i++) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
        };
        const serialisableTools = () => {
            const state = window.__dashbridgePanelToolsState || {};
            return {
                removeFill: !!state.removeFill,
                thickenLines: !!state.thickenLines,
                thickenLinesValue: state.thickenLinesValue ?? null,
                invertLegend: !!state.invertLegend,
                legendVisibility: state.legendVisibility ?? null,
                invertIdle: !!state.invertIdle,
                convertMemToUsed: !!state.convertMemToUsed,
                seriesQueryFilterEnabled: !!state.seriesQueryFilterEnabled,
                thresholdEnabled: !!state.thresholdEnabled,
            };
        };
        const attachObserver = root => {
            if (root === observedRoot) return;
            observer?.disconnect();
            observedRoot = root;
            rootGeneration += 1;
            if (!root) return;
            observer = new MutationObserver(records => {
                mutationVersion += records.length || 1;
                records.forEach(record => {
                    mutationCounts[record.type] = (mutationCounts[record.type] || 0) + 1;
                    if (record.attributeName) {
                        mutationCounts.attributesByName[record.attributeName]
                            = (mutationCounts.attributesByName[record.attributeName] || 0) + 1;
                    }
                    const target = record.target;
                    const signature = `${target?.tagName || target?.nodeName || 'unknown'}${target?.id ? `#${target.id}` : ''}${target?.className && typeof target.className === 'string' ? `.${target.className.replace(/\s+/g, '.').slice(0, 160)}` : ''}`;
                    mutationCounts.targets[signature] = (mutationCounts.targets[signature] || 0) + 1;
                });
            });
            observer.observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
                attributeFilter: ['class', 'style', 'width', 'height', 'aria-checked', 'aria-selected'],
            });
        };
        const finish = (status, reason) => {
            observer?.disconnect();
            const topMutationTargets = Object.entries(mutationCounts.targets)
                .map(([target, count]) => ({ target, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 100);
            resolve({
                schema: 'dashbridge-e2e-panel-settlement/v1',
                status,
                reason,
                panelId: pid,
                startedAt: startedWallAt,
                finishedAt: Date.now(),
                elapsedMs: Math.round(performance.now() - startedAt),
                requiredQuietMs: options.quietMs,
                requiredStableFrames: options.stableFrames,
                observedFrames,
                retainedSamples: samples.length,
                droppedSamples,
                samplePolicy: 'first-and-newest-bounded/v1',
                observedMutations: mutationVersion,
                observedRootGenerations: rootGeneration,
                mutationSummary: {
                    childList: mutationCounts.childList,
                    attributes: mutationCounts.attributes,
                    characterData: mutationCounts.characterData,
                    attributesByName: mutationCounts.attributesByName,
                    topTargets: topMutationTargets,
                },
                samples,
            });
        };
        const geometry = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const round = value => Math.round(Number(value || 0) * 100) / 100;
            return {
                x: round(rect.x), y: round(rect.y),
                width: round(rect.width), height: round(rect.height),
                top: round(rect.top), right: round(rect.right),
                bottom: round(rect.bottom), left: round(rect.left),
            };
        };
        const sample = () => {
            const panel = dom?.findPanelById?.(pid);
            const root = dom?.outerPanel?.(panel) || panel;
            let evidenceRoot = root;
            while (evidenceRoot && !evidenceRoot.classList?.contains('react-grid-item')
                && !evidenceRoot.classList?.contains('panel-container') && evidenceRoot.parentElement) {
                evidenceRoot = evidenceRoot.parentElement;
            }
            attachObserver(evidenceRoot);
            const now = performance.now();
            const canvases = evidenceRoot ? [...evidenceRoot.querySelectorAll('canvas')] : [];
            const canvas = canvases.map((item, index) => {
                let dataUrl = '';
                try { dataUrl = item.toDataURL(); } catch (_) { dataUrl = '[unavailable]'; }
                return {
                    index,
                    width: item.width,
                    height: item.height,
                    clientWidth: item.clientWidth,
                    clientHeight: item.clientHeight,
                    hash: hashText(dataUrl),
                };
            });
            const legend = root ? (dom?.legendItems?.(panel) || []).map((item, index) => ({
                index,
                label: (dom?.legendLabel?.(item)?.textContent || item.textContent || '').replace(/\s+/g, ' ').trim(),
                className: item.className || '',
                opacity: getComputedStyle(item).opacity,
                ariaChecked: item.getAttribute('aria-checked'),
                ariaSelected: item.getAttribute('aria-selected'),
                geometry: geometry(item),
            })) : [];
            const query = window.__dashbridgeDataInterceptorDiagnostic || {};
            const threshold = window.__dashbridgeThresholdDiagnostic || null;
            const visualReapply = window.__dashbridgeVisualReapplyDiagnostic || {};
            const dataLayoutReflow = window.__dashbridgeDataLayoutReflowDiagnostic || {};
            const visualMetadata = window.__dashbridgePanelToolsVisualMetadata || {};
            const dataStatusKind = visualMetadata.responseDataStatus?.kind || 'unknown';
            const intentionalEmpty = visualMetadata.responseFilterEmptyIsNormal === true
                && dataStatusKind === 'filtered_empty'
                && (window.__dashbridgePanelToolsState?.seriesQueryFilterEnabled === true
                    || window.__dashbridgePanelToolsState?.cpuCapacityFilterEnabled === true);
            const facts = {
                rootFound: !!evidenceRoot,
                rootConnected: !!evidenceRoot?.isConnected,
                rootGeneration,
                rootGeometry: geometry(evidenceRoot),
                canvas,
                legend,
                markers: evidenceRoot ? {
                    hidden: evidenceRoot.querySelectorAll('.dashbridge-uplot-fast-hidden').length,
                    dimmed: evidenceRoot.querySelectorAll('.dashbridge-uplot-fast-dimmed').length,
                    legendBottom: evidenceRoot.querySelectorAll('.dashbridge-legend-bottom').length,
                    thresholdEngine: evidenceRoot.getAttribute('data-dashbridge-threshold-engine') || '',
                } : null,
                tools: serialisableTools(),
                dataStatus: {
                    kind: dataStatusKind,
                    intentionalEmpty,
                },
                query: {
                    activeRequests: Number(query.activeRequests) || 0,
                    nextEventId: Number(query.nextEventId) || 0,
                    lastStage: query.last?.stage || null,
                    lastScope: query.last?.scope || null,
                },
                visualReapply: {
                    pending: visualReapply.pending === true,
                    activeGeneration: Number(visualReapply.activeGeneration) || 0,
                    attemptsPlanned: Number(visualReapply.attemptsPlanned) || 0,
                    attemptsFinished: Number(visualReapply.attemptsFinished) || 0,
                    lastCompletedAt: visualReapply.lastCompletedAt || null,
                    finishedAt: visualReapply.finishedAt || null,
                    errors: Number(visualReapply.errors) || 0,
                },
                dataLayoutReflow: {
                    pending: dataLayoutReflow.pending === true,
                    activeGeneration: Number(dataLayoutReflow.activeGeneration) || 0,
                    attemptsPlanned: Number(dataLayoutReflow.attemptsPlanned) || 0,
                    attemptsFinished: Number(dataLayoutReflow.attemptsFinished) || 0,
                    lastCompletedAt: dataLayoutReflow.lastCompletedAt || null,
                    finishedAt: dataLayoutReflow.finishedAt || null,
                    errors: Number(dataLayoutReflow.errors) || 0,
                },
                threshold: threshold ? {
                    enabled: !!threshold.enabled,
                    panelFound: !!threshold.panelFound,
                    engine: threshold.status?.engine || threshold.unitEngine || '',
                    applied: threshold.status?.applied ?? null,
                    exceeded: threshold.status?.exceeded ?? null,
                } : null,
                mutationVersion,
                mutationsSincePreviousFrame: mutationVersion - lastSampleMutationVersion,
            };
            // MutationObserver is diagnostic evidence, not the definition of a
            // visible state. Grafana virtualized legends rewrite identical style
            // attributes every frame. Include resulting geometry/semantics in
            // the fingerprint, while retaining raw mutation activity separately.
            const { mutationVersion: _mutationVersion, mutationsSincePreviousFrame: _mutationDelta, ...observableFacts } = facts;
            const fingerprint = JSON.stringify(observableFacts);
            const same = fingerprint === lastFingerprint;
            if (same) consecutiveStableFrames += 1;
            else {
                lastFingerprint = fingerprint;
                consecutiveStableFrames = 1;
                stableSince = now;
            }
            observedFrames += 1;
            samples.push({
                frame: observedFrames,
                at: Date.now(),
                elapsedMs: Math.round(now - startedAt),
                sameAsPrevious: same,
                consecutiveStableFrames,
                stableForMs: Math.round(now - stableSince),
                ...facts,
            });
            if (samples.length > options.sampleCap) {
                const removeCount = samples.length - options.sampleCap;
                // Preserve the first baseline frame and the newest bounded
                // window. Every frame still participates in the live verdict;
                // only repetitive report evidence is discarded.
                samples.splice(1, removeCount);
                droppedSamples += removeCount;
            }
            lastSampleMutationVersion = mutationVersion;

            const quietLongEnough = now - stableSince >= options.quietMs;
            const queryIdle = facts.query.activeRequests === 0;
            const visualReapplyIdle = facts.visualReapply.pending === false;
            const dataLayoutReflowIdle = facts.dataLayoutReflow.pending === false;
            const renderStateReady = canvas.length > 0 || facts.dataStatus.intentionalEmpty;
            if (facts.rootFound && facts.rootConnected && renderStateReady
                && queryIdle && visualReapplyIdle && dataLayoutReflowIdle && quietLongEnough
                && consecutiveStableFrames >= options.stableFrames) {
                finish('stable', facts.dataStatus.intentionalEmpty
                    ? 'The source filter produced a confirmed intentional empty state and panel lifecycle remained unchanged for the required window'
                    : 'Observable panel geometry, legend, canvas, query activity and visual reapply lifecycle remained unchanged for the required window');
                return;
            }
            if (now - startedAt >= options.timeoutMs) {
                const blockers = [];
                if (!facts.rootFound || !facts.rootConnected) blockers.push('panel-not-connected');
                if (!renderStateReady) blockers.push('canvas-missing');
                if (!queryIdle) blockers.push('query-still-active');
                if (!visualReapplyIdle) blockers.push('visual-reapply-pending');
                if (!dataLayoutReflowIdle) blockers.push('data-layout-reflow-pending');
                if (!quietLongEnough) blockers.push('panel-still-changing');
                if (consecutiveStableFrames < options.stableFrames) blockers.push('insufficient-stable-frames');
                finish('timeout', blockers.join(', ') || 'stability-timeout');
                return;
            }
            requestAnimationFrame(sample);
        };
        sample();
    }), [panelId, { timeoutMs, quietMs, stableFrames, sampleCap }]);
}

/**
 * Получает привязку сетевого преобразования непосредственно перед командой.
 * Подписи из popup не существуют в E2E-командах, поэтому без этого шага
 * перехватчик намеренно считает все ответы чужими для выбранной панели.
 */
async function captureTargetDataScope(tabId, panelId) {
    return execMain(tabId, async pid => {
        const dom = window.DashBridgeGrafanaDom;
        const visual = window.DashBridgeGrafanaVisualEngine;
        const panel = dom?.findPanelById?.(pid);
        const root = dom?.outerPanel?.(panel) || panel;
        if (!root) return { targetQuerySignatures: [], targetLegendSeries: [] };
        const legendItems = dom?.legendItems?.(panel) || [];
        const seen = new Set();
        const targetLegendSeries = legendItems.map(item => (item.textContent || '').trim())
            .filter(name => name && !seen.has(name) && seen.add(name));
        const targetQuerySignatures = await visual?.getPanelQuerySignaturesAsync?.({ root, panelId: pid }) || [];
        return { targetQuerySignatures, targetLegendSeries };
    }, [panelId]);
}

/**
 * Применяет настройки к панели через applyPanelTools и ждёт применения.
 * @param {number} tabId
 * @param {string} panelId
 * @param {object} settings — visualSettings и/или transformSettings
 */
async function applySettingsAndWait(tabId, panelId, settings, { refresh = true, verifyPersistence = false } = {}) {
    const transform = { ...(settings?.transformSettings || {}) };
    // Реальный UI всегда хранит числовое значение порога. E2E включает флаг
    // отдельно, поэтому задаём тот же валидный нулевой порог, если значения нет.
    if (transform.thresholdEnabled && !Object.prototype.hasOwnProperty.call(transform, 'thresholdValue')) {
        transform.thresholdValue = 0;
        transform.thresholdRawValue = null;
    }
    // Target scope is captured for every lifecycle command. This lets a visual
    // setting prove persistence against the selected panel's real response too.
    const targetScope = await captureTargetDataScope(tabId, panelId);
    const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;
    // `panelId` is retained for the matrix's compact call contract; the
    // top-level command also receives targetPanelId for panel-tools routing.
    const command = { panelId, targetPanelId: panelId, ...settings, ...targetScope, transformSettings: transform };
    const result = await applyPanelTools(tabId, command);
    // A command and a graph Refresh are separate user-visible actions. Capture
    // the exact intermediate state so failures in immediate application can be
    // distinguished from failures in refresh persistence.
    const afterCommandBeforeRefresh = await captureRuntimeDiagnostic(tabId, panelId, {
        captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
        captureReason: 'after-command-before-refresh-semantic-proof',
    });
    if (result?.status !== 'applied') return {
        ...result,
        afterCommandBeforeRefresh,
        refresh: null,
        lifecycle: null,
        settlement: null,
        cursor: commandCursor,
        commandCursor,
    };
    if (!refresh) {
        const settlement = await waitForPanelStability(tabId, panelId);
        return { ...result, afterCommandBeforeRefresh, refresh: null, lifecycle: null, settlement, cursor: commandCursor, commandCursor };
    }
    // Establish the causal cursor immediately before the refresh. Events emitted
    // while the command itself was applying must not satisfy the refresh wait.
    const cursor = (await readQueryLifecycle(tabId)).nextEventId;
    const refreshResult = await triggerRefresh(tabId);
    const lifecycle = await waitForTargetQueryLifecycle(tabId, cursor);
    const settlement = lifecycle?.status === 'target-complete'
        ? await waitForPanelStability(tabId, panelId)
        : null;
    const persistence = {
        required: !!verifyPersistence,
        status: verifyPersistence ? 'not-run' : 'not-required',
        reason: verifyPersistence ? 'Initial refresh or settlement was not proven' : 'No active feature requires persistence proof',
        beforeRefresh: null,
        cursor: null,
        refresh: null,
        lifecycle: null,
        settlement: null,
        passed: !verifyPersistence,
    };
    if (verifyPersistence && lifecycle?.status === 'target-complete' && settlement?.status === 'stable') {
        // This is a distinct user-visible action. Capture the state after the
        // command's first refresh, then refresh again without resending tools.
        // The final transition invariant therefore proves persistence rather
        // than merely proving that the command's immediate reapply succeeded.
        persistence.beforeRefresh = await captureRuntimeDiagnostic(tabId, panelId, {
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'first-refresh-persistence-semantic-proof',
        });
        persistence.cursor = (await readQueryLifecycle(tabId)).nextEventId;
        persistence.refresh = await triggerRefresh(tabId);
        persistence.lifecycle = await waitForTargetQueryLifecycle(tabId, persistence.cursor);
        persistence.settlement = persistence.lifecycle?.status === 'target-complete'
            ? await waitForPanelStability(tabId, panelId)
            : null;
        persistence.passed = persistence.lifecycle?.status === 'target-complete'
            && persistence.settlement?.status === 'stable';
        persistence.status = persistence.passed ? 'proven' : 'failed';
        persistence.reason = persistence.passed
            ? 'Active feature state survived a second refresh without another applyPanelTools command'
            : (persistence.lifecycle?.status !== 'target-complete'
                ? `Second refresh lifecycle was not proven: ${persistence.lifecycle?.status || 'unknown'}`
                : `Panel did not settle after second refresh: ${persistence.settlement?.reason || persistence.settlement?.status || 'unknown'}`);
    }
    return { ...result, afterCommandBeforeRefresh, refresh: refreshResult, lifecycle, settlement, persistence, cursor, commandCursor };
}

/**
 * Сброс всех визуальных и трансформационных настроек к исходному состоянию.
 * Всегда вызывается в блоке finally для гарантированного отката.
 */
async function resetAllSettings(tabId, panelId) {
    return applySettingsAndWait(tabId, panelId, {
        // Send an explicit empty map rather than null. It is a structured
        // command to restore every native legend item and cannot be mistaken
        // for an omitted optional property while crossing the MAIN-world
        // message bridge.
        legendVisibility: {},
        visualSettings: {
            removeFill: false,
            thickenLines: false,
            thickenLinesValue: 0.5,
            invertLegend: false,
        },
        transformSettings: {
            invertIdle: false,
            convertMemToUsed: false,
            seriesQueryFilterEnabled: false,
            seriesQueryFilterValue: 0,
            seriesQueryFilterRawValue: null,
            seriesQueryFilterMode: 'max',
            thresholdEnabled: false,
        },
    });
}

/**
 * Запускает последовательность переходов и проверяет инварианты на каждом шаге.
 * В блоке finally гарантированно сбрасывает настройки.
 *
 * @param {number} tabId
 * @param {object} env — тестовое окружение (env.panelId, env.hasLegend, env.hasCPU, …)
 * @param {Array<{label: string, settings: object|function, invariant: function}>} transitions
 * @returns {Promise<{pass: boolean, skip?: boolean, details: string[]}>}
 */
function transitionSkipReason(settings, env) {
    const visual = settings?.visualSettings || {};
    const transform = settings?.transformSettings || {};
    if (visual.invertLegend && !env.hasLegend) return 'нет легенды';
    if (transform.invertIdle && !env.hasCPU) return 'нет CPU-панели';
    if (transform.convertMemToUsed && !env.hasRAM) return 'нет RAM-панели';
    if (transform.seriesQueryFilterEnabled && !env.hasSeries) return 'нет серий для фильтра';
    if (settings?.legendVisibility && !env.hasVisibilitySeries) return 'нет двух управляемых серий легенды';
    return '';
}

async function runTransitionTest(tabId, env, transitions) {
    const liveProgress = {
        schema: 'dashbridge-e2e-transition-progress/v1',
        startedAt: Date.now(),
        phase: 'resolve-transitions',
        totalTransitions: transitions.length,
        completedTransitions: 0,
        current: null,
        steps: [],
    };
    env.__dashbridgeTransitionProgress = liveProgress;
    // Resolve generated commands before checking preconditions. This keeps
    // dynamic feature settings (for example duplicate-safe legend keys)
    // subject to the same causal skip contract as static settings.
    const resolvedTransitions = await Promise.all(transitions.map(async step => ({
        ...step,
        settings: typeof step.settings === 'function'
            ? await step.settings(env)
            : step.settings,
    })));
    const skippedReason = resolvedTransitions.map(step => transitionSkipReason(step.settings, env)).find(Boolean);
    if (skippedReason) {
        const capturedAt = Date.now();
        const baseline = await captureRuntimeDiagnostic(tabId, env.panelId, {
            reuseVisualFrom: env.__dashbridgeCapabilitySnapshot || env.__dashbridgeCurrentOuterBefore || null,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'capability-skip-semantic-proof',
        });
        env.__dashbridgeCapabilitySnapshot = baseline;
        return {
            pass: true, skip: true, details: `SKIP: ${skippedReason}`,
            diagnostic: {
                kind: 'transition',
                skipReason: skippedReason,
                transitions: [],
                baseline,
                actionTimeline: [{
                    schema: 'dashbridge-e2e-action-event/v1',
                    sequence: 1,
                    action: 'scenario-skipped',
                    description: 'Сценарий не запускался: проверяемая возможность отсутствует в текущем окружении',
                    startedAt: capturedAt,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - capturedAt,
                    input: { resolvedTransitions, skippedReason },
                    output: { status: 'skip', reason: skippedReason },
                    snapshotRefs: { observed: runtimeSnapshotRef('diagnostic.baseline', baseline) },
                    diffs: [],
                }],
            },
        };
    }

    const panelId = env.panelId;
    const testStartedAt = Date.now();
    let baseline = null;
    const diagnostic = {
        kind: 'transition',
        schema: 'dashbridge-e2e-scenario-diagnostic/v2',
        startedAt: testStartedAt,
        baseline: null,
        opened: null,
        transitions: [],
        actionTimeline: [],
    };
    const appendAction = action => diagnostic.actionTimeline.push({
        schema: 'dashbridge-e2e-action-event/v1',
        sequence: diagnostic.actionTimeline.length + 1,
        relativeStartedMs: Math.max(0, (action.startedAt || Date.now()) - testStartedAt),
        relativeFinishedMs: Math.max(0, (action.finishedAt || Date.now()) - testStartedAt),
        ...action,
    });
    const nativeLegendResetVerified = runtimeDiagnostic => {
        const entries = runtimeDiagnostic?.markers?.visibilityEntries || [];
        const nativeHiddenEntries = entries.filter(entry => entry.nativeHidden === true);
        const commandState = runtimeDiagnostic?.tools || null;
        const staleVisibility = commandState?.legendVisibility
            && Object.entries(commandState.legendVisibility).some(([, visible]) => visible === false);
        return {
            pass: entries.length > 0 && nativeHiddenEntries.length === 0 && !staleVisibility,
            entries: entries.length,
            nativeHidden: nativeHiddenEntries.map(entry => entry.key),
            staleVisibility: !!staleVisibility,
        };
    };
    const details = [];
    let allPassed = true;
    let anySkipped = false;

    // First preserve exactly what was visible when the scenario opened. This
    // is deliberately captured before isolation so a contaminated incoming
    // state can be reconstructed from JSON and screenshots.
    const openedAt = Date.now();
    const openedSnapshot = await captureRuntimeDiagnostic(tabId, panelId, {
        reuseVisualFrom: env.__dashbridgeCurrentOuterBefore || null,
        captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
        captureReason: 'scenario-opened-semantic-bookmark',
    });
    diagnostic.opened = openedSnapshot;

    // Isolate once, then preserve state across the complete user sequence.
    // A preceding matrix scenario already ends with a causal reset + Refresh.
    // Reuse that proof only after confirming the current semantic snapshot is
    // still clean; this removes a duplicate network cycle without weakening
    // the boundary between scenarios.
    const isolationStartedAt = Date.now();
    liveProgress.phase = 'isolation-reset';
    const verifiedBoundary = env.__dashbridgeVerifiedCleanBoundary || null;
    env.__dashbridgeVerifiedCleanBoundary = null;
    const isolationRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
    let isolationReset;
    let isolationSnapshot;
    let isolationRuntimeEvents;
    let isolationNativeReset;
    let isolationResetPassed;
    if (verifiedBoundary?.pass && verifiedBoundary.panelId === panelId) {
        baseline = await captureState(tabId, panelId);
        baseline.diagnostic = openedSnapshot;
        isolationNativeReset = nativeLegendResetVerified(openedSnapshot);
        const cleanInvariant = isolationNativeReset.pass
            ? activeSetInvariant([], null)(verifiedBoundary.state || baseline, baseline, env)
            : { pass: false, reason: 'Нативная видимость легенды изменилась после доказанного reset' };
        isolationResetPassed = isolationNativeReset.pass && cleanInvariant.pass;
        isolationSnapshot = openedSnapshot;
        isolationRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, isolationRuntimeCursor);
        isolationReset = {
            status: isolationResetPassed ? 'reused-verified-reset' : 'reused-reset-drifted',
            acknowledgement: verifiedBoundary.reset?.command?.acknowledgement || null,
            lifecycle: verifiedBoundary.reset?.lifecycle || null,
            settlement: verifiedBoundary.reset?.settlement || null,
            afterCommandBeforeRefresh: null,
            reusedFromTestId: verifiedBoundary.testId || null,
            cleanInvariant,
        };
    }
    if (!verifiedBoundary?.pass || verifiedBoundary.panelId !== panelId || !isolationResetPassed) {
        isolationReset = await resetAllSettings(tabId, panelId);
        isolationSnapshot = await captureRuntimeDiagnostic(tabId, panelId, {
            captureMode: DIAGNOSTIC_CAPTURE_MODES.PANEL,
            captureReason: 'canonical-isolated-baseline',
        });
        isolationRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, isolationRuntimeCursor);
        isolationNativeReset = nativeLegendResetVerified(isolationSnapshot);
        isolationResetPassed = isolationReset.status === 'applied'
            && isolationReset.lifecycle?.status === 'target-complete'
            && isolationReset.settlement?.status === 'stable'
            && isolationNativeReset.pass;
        baseline = await captureState(tabId, panelId);
    }
    diagnostic.baseline = isolationSnapshot;
    baseline.diagnostic = diagnostic.baseline;
    diagnostic.isolation = {
        status: isolationReset.status,
        lifecycle: isolationReset.lifecycle || null,
        settlement: isolationReset.settlement || null,
        acknowledgement: isolationReset.acknowledgement || null,
        queue: isolationReset.acknowledgement?.queue || null,
        refresh: isolationReset.refresh || null,
        commandCursor: isolationReset.commandCursor ?? null,
        refreshCursor: isolationReset.cursor ?? null,
        nativeLegend: isolationNativeReset,
        reusedVerifiedReset: isolationReset.status === 'reused-verified-reset',
        reusedFromTestId: isolationReset.reusedFromTestId || null,
        cleanInvariant: isolationReset.cleanInvariant || null,
        afterCommandBeforeRefresh: isolationReset.afterCommandBeforeRefresh || null,
        passed: isolationResetPassed,
    };
    const isolationFinishedAt = Date.now();
    liveProgress.phase = 'transitions';
    liveProgress.isolationDurationMs = isolationFinishedAt - isolationStartedAt;
    appendAction({
        action: 'isolate-scenario-baseline',
        description: isolationReset.status === 'reused-verified-reset'
            ? 'Текущее состояние сверено с доказанным финальным reset предыдущего сценария без дублирующего Refresh'
            : 'Зафиксировано входное состояние страницы, затем все функции явно сброшены и график обновлён',
        startedAt: openedAt,
        finishedAt: isolationFinishedAt,
        durationMs: isolationFinishedAt - openedAt,
        input: {
            panelId,
            intent: 'restore-all-features-to-native-baseline',
            resolvedTransitions,
        },
        output: {
            status: isolationReset.status,
            passed: isolationResetPassed,
            acknowledgement: isolationReset.acknowledgement || null,
            lifecycle: isolationReset.lifecycle || null,
            settlement: isolationReset.settlement || null,
            nativeLegend: isolationNativeReset,
            runtimeEvents: isolationRuntimeEvents,
        },
        snapshotRefs: {
            pageOpened: runtimeSnapshotRef('diagnostic.opened', openedSnapshot),
            afterCommandBeforeRefresh: runtimeSnapshotRef('diagnostic.isolation.afterCommandBeforeRefresh', isolationReset.afterCommandBeforeRefresh),
            afterIsolationReset: runtimeSnapshotRef('diagnostic.baseline', isolationSnapshot),
        },
        diffs: [
            {
                phase: 'page-opened-to-after-reset-command-before-refresh',
                ...buildRuntimeDiagnosticDiff(openedSnapshot, isolationReset.afterCommandBeforeRefresh || isolationSnapshot),
            },
            {
                phase: 'after-reset-command-to-isolated-baseline-after-refresh',
                ...buildRuntimeDiagnosticDiff(isolationReset.afterCommandBeforeRefresh || openedSnapshot, isolationSnapshot),
            },
            {
                phase: 'page-opened-to-isolated-baseline',
                ...buildRuntimeDiagnosticDiff(openedSnapshot, isolationSnapshot),
            },
        ],
    });

    let reusableStableSnapshot = isolationSnapshot;
    let previousActiveIds = [];
    try {
        for (let i = 0; i < resolvedTransitions.length; i++) {
            const {
                label, settings: resolvedSettings, invariant, activeIds = [],
                verifyPersistence = activeIds.length > 0,
            } = resolvedTransitions[i];
            const changedIds = [...new Set([...previousActiveIds, ...activeIds])]
                .filter(id => previousActiveIds.includes(id) !== activeIds.includes(id));
            const actionStartedAt = Date.now();
            liveProgress.phase = 'transition';
            liveProgress.current = {
                index: i + 1,
                label,
                activeIds: [...activeIds],
                startedAt: actionStartedAt,
            };
            const actionRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
            const before = await captureRuntimeDiagnostic(tabId, panelId, {
                reuseVisualFrom: reusableStableSnapshot,
                captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
                captureReason: 'transition-before-semantic-proof',
            });
            const command = isolationResetPassed
                ? await applySettingsAndWait(tabId, panelId, resolvedSettings, { verifyPersistence })
                : {
                    status: 'isolation-reset-failed',
                    lifecycle: isolationReset.lifecycle || null,
                    reset: isolationReset,
                };
            const afterState = await captureState(tabId, panelId);
            let after = await captureRuntimeDiagnostic(tabId, panelId, {
                reuseVisualFrom: activeIds.length ? reusableStableSnapshot : baseline,
                captureMode: diagnosticCaptureModeForTransition(resolvedSettings, activeIds, changedIds),
                captureReason: 'settled-user-visible-transition-state',
            });
            previousActiveIds = [...activeIds];
            reusableStableSnapshot = after;
            const actionRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, actionRuntimeCursor);
            // Invariants normally compare compact canvas/DOM state. Attach the
            // richer renderer-series snapshot for response-transform checks.
            afterState.diagnostic = after;
            const lifecycle = command.lifecycle;
            const visualPersistenceFeatures = ['removeFill', 'thickenLines', 'invertLegend', 'seriesVisibility'];
            const intentionalEmpty = after?.dataStatus?.intentionalEmpty === true;
            // A source filter may intentionally remove every series. The
            // visibility intent is then proven by tools+transport invariants;
            // requiring a renderer repaint would demand a legend that must not
            // exist until the filter is disabled and full data returns.
            const requiresVisualReapply = !intentionalEmpty
                && activeIds.some(id => visualPersistenceFeatures.includes(id));
            const reapplyBefore = Number(command.persistence?.beforeRefresh?.visualReapplyDiagnostic?.completed) || 0;
            const reapplyAfter = Number(after?.visualReapplyDiagnostic?.completed) || 0;
            const reapplyErrorsBefore = Number(command.persistence?.beforeRefresh?.visualReapplyDiagnostic?.errors) || 0;
            const reapplyErrorsAfter = Number(after?.visualReapplyDiagnostic?.errors) || 0;
            const visualReapplyProof = {
                required: requiresVisualReapply,
                deferredByIntentionalEmpty: intentionalEmpty,
                completedBeforeSecondRefresh: reapplyBefore,
                completedAfterSecondRefresh: reapplyAfter,
                completedDelta: reapplyAfter - reapplyBefore,
                errorsBeforeSecondRefresh: reapplyErrorsBefore,
                errorsAfterSecondRefresh: reapplyErrorsAfter,
                errorDelta: reapplyErrorsAfter - reapplyErrorsBefore,
                passed: !requiresVisualReapply || (reapplyAfter > reapplyBefore && reapplyErrorsAfter === reapplyErrorsBefore),
            };
            if (command.persistence?.required) {
                command.persistence.visualReapply = visualReapplyProof;
                if (!visualReapplyProof.passed) {
                    command.persistence.passed = false;
                    command.persistence.status = 'failed';
                    command.persistence.reason = 'After the second graph refresh no successful causal visual-style reapply was recorded';
                }
            }
            const persistencePassed = command.persistence?.required !== true || command.persistence?.passed === true;
            const lifecyclePassed = command.status === 'applied'
                && lifecycle?.status === 'target-complete'
                && command.settlement?.status === 'stable'
                && persistencePassed;
            const checkResult = lifecyclePassed
                ? invariant(baseline, afterState, env)
                : {
                    pass: false,
                    reason: command.status !== 'applied'
                        ? `команда не подтверждена: ${command.status || 'unknown'}`
                        : (lifecycle?.status !== 'target-complete'
                            ? `обновление целевой панели не доказано: ${lifecycle?.status || 'unknown'}`
                            : (command.settlement?.status !== 'stable'
                                ? `панель не стабилизировалась: ${command.settlement?.reason || command.settlement?.status || 'unknown'}`
                                : `функция не пережила повторный refresh: ${command.persistence?.reason || 'unknown'}`)),
                    debug: JSON.stringify({ lifecycle: lifecycle || null, settlement: command.settlement || null, persistence: command.persistence || null }),
                };
            const stepPassed = checkResult.pass;
            const stepSkipped = !!(checkResult.skip || checkResult.reason?.startsWith('SKIP:'));

            if (!stepPassed && !stepSkipped) {
                after = await captureRuntimeDiagnostic(tabId, panelId, {
                    captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                    captureReason: 'automatic-forensic-transition-failure',
                });
                afterState.diagnostic = after;
                reusableStableSnapshot = after;
            }

            if (stepSkipped) anySkipped = true;
            else allPassed = allPassed && stepPassed;

            diagnostic.transitions.push({
                schema: 'dashbridge-e2e-transition-evidence/v1',
                index: i + 1,
                label,
                settings: resolvedSettings,
                activeIds,
                changedIds,
                visualEvidenceRequirement: after.visualCapture?.requestedMode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC
                    ? 'forensic'
                    : (after.visualCapture?.requestedMode === DIAGNOSTIC_CAPTURE_MODES.PANEL ? 'panel' : 'canvas'),
                command,
                before,
                after,
                lifecycle,
                settlement: command.settlement || null,
                persistence: command.persistence || null,
                visualReapplyProof,
                isolationReset: {
                    status: i === 0 ? isolationReset.status : 'not-repeated',
                    lifecycle: i === 0 ? (isolationReset.lifecycle || null) : null,
                    nativeLegend: i === 0 ? isolationNativeReset : null,
                    passed: isolationResetPassed,
                    reason: i === 0
                        ? 'Чистый baseline установлен до последовательности'
                        : 'Состояние предыдущего шага сохранено для последовательного перехода',
                },
                invariant: {
                    pass: stepPassed,
                    skip: stepSkipped,
                    reason: checkResult.reason || '',
                    debug: checkResult.debug || '',
                },
                verdict: {
                    outcome: stepSkipped ? 'skip' : (stepPassed ? 'pass' : 'fail'),
                    commandApplied: command.status === 'applied',
                    targetLifecyclePassed: lifecycle?.status === 'target-complete',
                    panelSettled: command.settlement?.status === 'stable',
                    persistenceRequired: command.persistence?.required === true,
                    persistencePassed,
                    semanticInvariantPassed: !!checkResult.pass,
                    reason: checkResult.reason || '',
                },
            });
            const afterFirstRefresh = command.persistence?.beforeRefresh || null;
            const actionFinishedAt = Date.now();
            liveProgress.steps.push({
                index: i + 1,
                label,
                activeIds: [...activeIds],
                durationMs: actionFinishedAt - actionStartedAt,
                commandStatus: command.status || null,
                lifecycleStatus: command.lifecycle?.status || null,
                settlementStatus: command.settlement?.status || null,
                persistenceStatus: command.persistence?.status || null,
                invariantPassed: !!stepPassed,
            });
            liveProgress.completedTransitions = i + 1;
            liveProgress.current = null;
            appendAction({
                action: 'apply-transition',
                transitionIndex: i + 1,
                description: `Шаг ${i + 1}: ${label}`,
                startedAt: actionStartedAt,
                finishedAt: actionFinishedAt,
                durationMs: actionFinishedAt - actionStartedAt,
                input: {
                    panelId,
                    label,
                    settings: resolvedSettings,
                    activeIds,
                    persistenceRefreshRequired: activeIds.length > 0,
                    expected: 'command acknowledgement, target query completion, stable panel, semantic invariant',
                },
                output: {
                    status: command.status,
                    acknowledgement: command.acknowledgement || null,
                    commandDiagnostic: command.commandDiagnostic || null,
                    lifecycle: command.lifecycle || null,
                    settlement: command.settlement || null,
                    persistence: command.persistence || null,
                    visualReapplyProof,
                    invariant: {
                        pass: stepPassed,
                        skip: stepSkipped,
                        reason: checkResult.reason || '',
                        debug: checkResult.debug || '',
                    },
                    runtimeEvents: actionRuntimeEvents,
                },
                checkpoints: [
                    { stage: 'before-captured', at: before.at || null },
                    { stage: 'command-acknowledged', at: command.acknowledgement?.completedAt || null },
                    { stage: 'after-command-before-refresh-captured', at: command.afterCommandBeforeRefresh?.at || null },
                    { stage: 'first-target-query-complete', at: command.lifecycle?.target?.at || null },
                    { stage: 'first-panel-settled', at: command.settlement?.finishedAt || null },
                    { stage: 'after-first-refresh-captured', at: afterFirstRefresh?.at || null },
                    { stage: 'second-target-query-complete', at: command.persistence?.lifecycle?.target?.at || null },
                    { stage: 'second-panel-settled', at: command.persistence?.settlement?.finishedAt || null },
                    { stage: 'final-state-captured', at: after.at || null },
                ],
                snapshotRefs: {
                    before: runtimeSnapshotRef(`diagnostic.transitions[${i}].before`, before),
                    afterCommandBeforeRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].command.afterCommandBeforeRefresh`, command.afterCommandBeforeRefresh),
                    afterFirstRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].persistence.beforeRefresh`, afterFirstRefresh),
                    afterSecondRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].after`, after),
                },
                diffs: [
                    {
                        phase: 'before-to-after-command-before-refresh',
                        ...buildRuntimeDiagnosticDiff(before, command.afterCommandBeforeRefresh || afterFirstRefresh || after),
                    },
                    {
                        phase: 'after-command-before-refresh-to-after-first-refresh',
                        ...buildRuntimeDiagnosticDiff(command.afterCommandBeforeRefresh || before, afterFirstRefresh || after),
                    },
                    {
                        phase: 'before-to-after-first-refresh',
                        ...buildRuntimeDiagnosticDiff(before, afterFirstRefresh || after),
                    },
                    ...(afterFirstRefresh ? [{
                        phase: 'after-first-refresh-to-after-second-refresh',
                        ...buildRuntimeDiagnosticDiff(afterFirstRefresh, after),
                    }] : []),
                    {
                        phase: 'complete-action-before-to-after',
                        ...buildRuntimeDiagnosticDiff(before, after),
                    },
                ],
            });
            details.push(`${i + 1}. ${label}: ${stepPassed ? '✓' : '✗'} ${checkResult.reason || ''}`);
            // Structured lifecycle evidence already lives in diagnostic.transitions.
            // Do not duplicate its full JSON inside the human-readable details.
            // A hard causal failure invalidates all following states. Do not
            // fabricate further evidence after the selected query was absent.
            if (!stepPassed && !stepSkipped) break;
        }
    } finally {
        const resetStartedAt = Date.now();
        liveProgress.phase = 'final-reset';
        liveProgress.current = { startedAt: resetStartedAt };
        const resetRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
        const beforeReset = await captureRuntimeDiagnostic(tabId, panelId, {
            reuseVisualFrom: reusableStableSnapshot,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'before-reset-semantic-proof',
        });
        const reset = await resetAllSettings(tabId, panelId);
        const afterState = await captureState(tabId, panelId);
        let after = await captureRuntimeDiagnostic(tabId, panelId, {
            reuseVisualFrom: baseline,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.PANEL,
            captureReason: 'restored-baseline-proof',
        });
        const resetRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, resetRuntimeCursor);
        afterState.diagnostic = after;
        const resetLifecyclePassed = reset.status === 'applied'
            && reset.lifecycle?.status === 'target-complete'
            && reset.settlement?.status === 'stable';
        const resetNativeLegend = nativeLegendResetVerified(after);
        diagnostic.beforeReset = beforeReset;
        // A reset acknowledgement alone is insufficient. Verify every declared
        // feature is semantically OFF, including native Grafana legend state,
        // before allowing the next test to reuse this panel.
        const resetInvariant = resetLifecyclePassed && resetNativeLegend.pass
            ? activeSetInvariant([], null)(baseline, afterState, env)
            : {
                pass: false,
                reason: resetLifecyclePassed
                    ? 'Нативная видимость легенды не восстановлена'
                    : (reset.lifecycle?.status !== 'target-complete'
                        ? `Сброс не доказан: ${reset.lifecycle?.status || reset.status || 'unknown'}`
                        : `Панель не стабилизировалась после сброса: ${reset.settlement?.reason || reset.settlement?.status || 'unknown'}`),
                debug: JSON.stringify({ lifecycle: reset.lifecycle || null, settlement: reset.settlement || null, nativeLegend: resetNativeLegend }),
            };
        const resetPassed = resetLifecyclePassed && resetNativeLegend.pass && resetInvariant.pass;
        if (!resetPassed) {
            after = await captureRuntimeDiagnostic(tabId, panelId, {
                captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                captureReason: 'automatic-forensic-reset-failure',
            });
            afterState.diagnostic = after;
        }
        diagnostic.reset = {
            schema: 'dashbridge-e2e-transition-evidence/v1',
            command: reset,
            after,
            lifecycle: reset.lifecycle,
            settlement: reset.settlement || null,
            nativeLegend: resetNativeLegend,
            invariant: resetInvariant,
            pass: resetPassed,
            verdict: {
                outcome: resetPassed ? 'pass' : 'fail',
                commandApplied: reset.status === 'applied',
                targetLifecyclePassed: reset.lifecycle?.status === 'target-complete',
                panelSettled: reset.settlement?.status === 'stable',
                semanticInvariantPassed: !!resetInvariant.pass,
                reason: resetPassed ? 'Сброс семантически подтвердил исходное состояние всех функций' : resetInvariant.reason,
            },
        };
        env.__dashbridgeVerifiedCleanBoundary = resetPassed ? {
            pass: true,
            panelId,
            testId: env.__dashbridgeCurrentTestId || null,
            state: afterState,
            snapshot: after,
            reset: diagnostic.reset,
        } : null;
        const resetFinishedAt = Date.now();
        appendAction({
            action: 'restore-after-scenario',
            description: 'После сценария все функции явно выключены, выполнен Refresh и доказан безопасный baseline для следующего теста',
            startedAt: resetStartedAt,
            finishedAt: resetFinishedAt,
            durationMs: resetFinishedAt - resetStartedAt,
            input: { panelId, intent: 'restore-all-features-to-native-baseline' },
            output: {
                status: reset.status,
                pass: resetPassed,
                acknowledgement: reset.acknowledgement || null,
                lifecycle: reset.lifecycle || null,
                settlement: reset.settlement || null,
                nativeLegend: resetNativeLegend,
                invariant: resetInvariant,
                runtimeEvents: resetRuntimeEvents,
            },
            checkpoints: [
                { stage: 'before-reset-captured', at: beforeReset.at || null },
                { stage: 'reset-command-acknowledged', at: reset.acknowledgement?.completedAt || null },
                { stage: 'after-reset-command-before-refresh-captured', at: reset.afterCommandBeforeRefresh?.at || null },
                { stage: 'reset-target-query-complete', at: reset.lifecycle?.target?.at || null },
                { stage: 'reset-panel-settled', at: reset.settlement?.finishedAt || null },
                { stage: 'after-reset-captured', at: after.at || null },
            ],
            snapshotRefs: {
                beforeReset: runtimeSnapshotRef('diagnostic.beforeReset', beforeReset),
                afterResetCommandBeforeRefresh: runtimeSnapshotRef('diagnostic.reset.command.afterCommandBeforeRefresh', reset.afterCommandBeforeRefresh),
                afterReset: runtimeSnapshotRef('diagnostic.reset.after', after),
            },
            diffs: [
                {
                    phase: 'before-reset-to-after-reset-command-before-refresh',
                    ...buildRuntimeDiagnosticDiff(beforeReset, reset.afterCommandBeforeRefresh || after),
                },
                {
                    phase: 'after-reset-command-before-refresh-to-after-reset-refresh',
                    ...buildRuntimeDiagnosticDiff(reset.afterCommandBeforeRefresh || beforeReset, after),
                },
                {
                    phase: 'before-reset-to-restored-baseline',
                    ...buildRuntimeDiagnosticDiff(beforeReset, after),
                },
            ],
        });
        diagnostic.finishedAt = resetFinishedAt;
        diagnostic.durationMs = resetFinishedAt - testStartedAt;
        liveProgress.phase = 'complete';
        liveProgress.current = null;
        liveProgress.finishedAt = resetFinishedAt;
        liveProgress.durationMs = resetFinishedAt - liveProgress.startedAt;
        if (!resetPassed) {
            allPassed = false;
            // A subsequent test would have no trustworthy baseline. The core
            // turns this explicit signal into aborted/not-run results for the
            // rest of this URL instead of spreading a destructive state.
            diagnostic.environmentUnsafe = true;
            details.push(`Сброс: ✗ ${resetInvariant.reason || 'исходное состояние не доказано'}`);
        }
    }

    return {
        pass: allPassed,
        skip: anySkipped && allPassed,
        environmentUnsafe: diagnostic.environmentUnsafe === true,
        details: anySkipped && allPassed ? `SKIP: ${details.join(' | ')}` : details.join(' | '),
        diagnostic,
    };
}

// ─── Строгие инвариантные проверки для каждого переключателя ───────

/**
 * Каждый инвариант принимает (baseline, current, env) и возвращает
 * { pass: boolean, reason?: string, debug?: string }
 */
