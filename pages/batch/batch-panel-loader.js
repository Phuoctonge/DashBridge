// Batch navigation and renderer readiness in the temporary Grafana tab.
function createBatchPanelLoader({ log }) {
    const waitForPanelInMainWorld = (panelId, panelTools, timeoutMs = 25_000, collectDiagnostics = false) => new Promise(resolve => {
        const normalizePanelReference = value => String(value ?? '').replace(/^panel-/i, '');
        const findPanel = () => {
            const exact = window.DashBridgeGrafanaDom?.findPanelById(panelId);
            if (exact) return exact;
            const route = new URL(location.href);
            const requested = route.searchParams.get('viewPanel') || route.searchParams.get('panelId');
            // Legacy fullscreen panels can omit their DOM id. Only the exact
            // single-panel route may use the runtime's active-panel fallback.
            return normalizePanelReference(requested) === normalizePanelReference(panelId)
                ? window.DashBridgeGrafanaDom?.findPanel({ panelId }) : null;
        };
        let previousRect = null;
        let stableFrames = 0;
        let frame = 0;
        let timeout = null;
        let observer = null;
        let resizeObserver = null;
        let observedPanel = null;
        let settled = false;
        let preparingCapture = false;
        const history = [];
        const inspectSnapshot = (panel, reason = '') => {
            if (!collectDiagnostics) return;
            const rect = panel?.getBoundingClientRect?.();
            const rendererKinds = panel ? {
                canvas: panel.querySelectorAll('canvas').length,
                svg: panel.querySelectorAll('svg').length,
                uplot: panel.querySelectorAll('.uplot').length,
                flot: panel.querySelectorAll('.flot-base').length,
            } : {};
            history.push({
                reason, readyState: document.readyState,
                panelFound: !!panel,
                width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0),
                rendererKinds,
                loadingMarkers: document.querySelectorAll('.panel-loading,[data-testid="spinner"]').length,
                activeRequests: Number(window.__dashbridgeDataInterceptorDiagnostic?.activeRequests) || 0,
                responseKind: String(window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.kind || ''),
                responseText: String(window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.text || '').slice(0, 240),
                at: Date.now(),
            });
        };
        const cleanup = () => {
            clearTimeout(timeout);
            if (frame) cancelAnimationFrame(frame);
            observer?.disconnect();
            resizeObserver?.disconnect();
        };
        const finish = value => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const schedule = () => {
            if (settled || frame) return;
            frame = requestAnimationFrame(inspect);
        };
        const inspect = () => {
            frame = 0;
            if (preparingCapture) return;
            const panel = findPanel() || null;
            inspectSnapshot(panel, 'inspect');
            const loading = Array.from((panel || document).querySelectorAll('.panel-loading, [data-testid="spinner"]'))
                .some(element => {
                    const style = getComputedStyle(element);
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
                });
            if (loading || !panel) {
                stableFrames = 0;
                previousRect = null;
                if (collectDiagnostics) history[history.length - 1].reason = loading ? 'loading' : 'panel-not-found';
                schedule();
                return;
            }
            const filterMayProduceEmpty = panelTools?.cpuCapacityFilterEnabled === true
                || panelTools?.seriesQueryFilterEnabled === true;
            const visibleNoData = /\bno\s+data\b|нет\s+данных/i.test(String(panel.innerText || panel.textContent || ''));
            if (visibleNoData && collectDiagnostics) history[history.length - 1].reason = 'no-data';
            if (observedPanel !== panel) {
                resizeObserver?.disconnect();
                observedPanel = panel;
                resizeObserver?.observe(panel);
            }
            const rect = panel.getBoundingClientRect();
            if (panelTools?.thresholdEnabled) {
                const threshold = window.__dashbridgeThresholdDiagnostic;
                if (!threshold?.status?.enabled || threshold.suppressedReason
                    || String(threshold.panelId).replace(/^panel-/, '') !== String(panelId).replace(/^panel-/, '')
                    || Number(threshold.requested?.rawValue) !== Number(panelTools.thresholdRawValue)) {
                    stableFrames = 0; schedule(); return;
                }
            }
            if (rect.width <= 5 || rect.height <= 10) {
                stableFrames = 0;
                if (collectDiagnostics) history[history.length - 1].reason = 'zero-size';
                schedule();
                return;
            }
            // Header/menu SVG icons may precede the visualization. Choosing a
            // sized element here does not establish data readiness below.
            const renderer = panel.querySelector('.flot-base, .uplot canvas, .graph-panel__chart canvas, canvas')
                || Array.from(panel.querySelectorAll('svg')).find(svg => svg.getBoundingClientRect().height > 1) || panel;
            if (renderer.getBoundingClientRect().height <= 1) {
                stableFrames = 0;
                if (collectDiagnostics) history[history.length - 1].reason = 'renderer-zero-size';
                schedule();
                return;
            }
            const interceptor = window.__dashbridgeDataInterceptorDiagnostic;
            // Every panel must provide either renderer evidence or an explicit
            // Grafana "No data" state. A sized outer container alone is not
            // sufficient: it produces the white Memory captures seen in Batch.
            const requiresDataEvidence = true;
            if (requiresDataEvidence && !visibleNoData) {
                // Some Grafana transports do not publish our optional
                // request-complete diagnostic event. activeRequests reaching
                // zero is the authoritative settlement signal; renderer
                // evidence below still prevents empty white containers.
                const requestSettled = interceptor != null
                    && Number(interceptor.activeRequests) === 0;
                const chart = window.DashBridgeGrafanaVisualEngine?.findUPlot?.(panel);
                const chartHasPoints = Array.isArray(chart?.data)
                    && chart.data.some(values => Array.isArray(values) && values.length > 0);
                const flotHasPoints = typeof window.jQuery === 'function'
                    && (window.jQuery(renderer).data('plot')?.getData?.() || [])
                        .some(series => Array.isArray(series?.data) && series.data.length > 0);
                // Native Table/Data Grid has no canvas or series SVG. Reuse the
                // table adapter, but never treat a chart's legend as its data.
                const tableHasRows = [...panel.querySelectorAll('table, [role="table"], [role="grid"]')].some(table => {
                    if (table.closest('.graph-legend, .u-legend, [class*="legend" i]')) return false;
                    const bounds = table.getBoundingClientRect();
                    if (bounds.width <= 1 || bounds.height <= 1) return false;
                    const data = window.DashBridgeGrafanaTableReport?.collectGrafanaTableData?.(table);
                    return data?.columns?.length >= 2 && data.rows?.length > 0;
                });
                const svgHasGeometry = [...panel.querySelectorAll('svg path, svg polyline, svg rect')].some(element => {
                    // Axes, background rectangles and menu icons have geometry
                    // too. Require a renderer-owned series, not an arbitrary SVG.
                    const series = element.closest('.series, .line-series, .area-series, .bar-series, '
                        + '.recharts-line, .recharts-area, .recharts-bar, .trace.scatter, .trace.bars, .highcharts-series');
                    if (!series || element.closest('.axis, .axes, .tick, .legend, [role="button"]')) return false;
                    try {
                        const svgRect = element.closest('svg')?.getBoundingClientRect();
                        const bounds = element.getBBox();
                        return svgRect?.width > 50 && svgRect.height > 50
                            && bounds.width > 0 && bounds.height > 0;
                    }
                    catch { return false; }
                });
                const canvasHasGeometry = [...panel.querySelectorAll('canvas')].some(canvas => {
                    const canvasRect = canvas.getBoundingClientRect();
                    return (Number(canvas.width) > 1 && Number(canvas.height) > 1)
                        || (canvasRect.width > 1 && canvasRect.height > 1);
                }) || (renderer !== panel && renderer.getBoundingClientRect().width > 1);
                const canvasHasPaint = [...panel.querySelectorAll('canvas')].some(canvas => {
                    try {
                        const context = canvas.getContext?.('2d', { willReadFrequently: true });
                        const width = Math.min(256, Math.max(1, Number(canvas.width) || 1));
                        const height = Math.min(256, Math.max(1, Number(canvas.height) || 1));
                        const pixels = context?.getImageData?.(0, 0, width, height)?.data;
                        if (!pixels?.length) return false;
                        for (let index = 3; index < pixels.length; index += 4) {
                            if (pixels[index] > 0) {
                                const red = pixels[index - 3];
                                const green = pixels[index - 2];
                                const blue = pixels[index - 1];
                                if (red < 245 || green < 245 || blue < 245) return true;
                            }
                        }
                    } catch { /* tainted or unsupported canvas is not evidence */ }
                    return false;
                });
                const filteredEmpty = filterMayProduceEmpty
                    && window.__dashbridgePanelToolsVisualMetadata?.responseFilterEmptyIsNormal === true
                    && window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.kind === 'filtered_empty';
                if (!requestSettled || !(chartHasPoints || flotHasPoints || tableHasRows || svgHasGeometry
                    || (canvasHasGeometry && canvasHasPaint) || filteredEmpty)) {
                    stableFrames = 0;
                    if (collectDiagnostics) history[history.length - 1].reason = !requestSettled ? 'requests-active' : 'empty-renderer';
                    schedule();
                    return;
                }
            }
            const currentRect = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10);
            if (previousRect && currentRect.every((value, index) => value === previousRect[index])) stableFrames++;
            else stableFrames = 0;
            previousRect = currentRect;
            if (stableFrames < 1) {
                schedule();
                return;
            }
            preparingCapture = true;
            let style = document.getElementById('dashbridge-batch-capture-style');
            if (!style) {
                style = document.createElement('style');
                style.id = 'dashbridge-batch-capture-style';
                style.textContent = `
                    .graph-tooltip,#flotTip,.grafana-tooltip,.u-tooltip,[role="tooltip"],
                    .panel-info-corner,.dashbridge-panel-menu-host,
                    .u-cursor-x,.u-cursor-y,.u-cursor-pt {
                        display:none!important;opacity:0!important;visibility:hidden!important
                    }
                    *{cursor:none!important}
                    #dashbridge-batch-pointer-shield {
                        position:fixed;inset:0;z-index:2147483647;background:transparent;
                        cursor:none!important;pointer-events:auto;touch-action:none
                    }
                `;
                document.head.appendChild(style);
            }
            // The capture window is temporary and not interactive. A transparent
            // top-level shield keeps the physical pointer away from Grafana even
            // when the user moves the mouse during a long Batch run. This avoids
            // native hover queries, crosshairs and tooltip portals in screenshots.
            let pointerShield = document.getElementById('dashbridge-batch-pointer-shield');
            if (!pointerShield) {
                pointerShield = document.createElement('div');
                pointerShield.id = 'dashbridge-batch-pointer-shield';
                pointerShield.setAttribute('aria-hidden', 'true');
                document.body.appendChild(pointerShield);
            }
            const hoverTargets = new Set([
                ...document.querySelectorAll(':hover'),
                ...document.querySelectorAll('.flot-overlay,.u-over,canvas')
            ]);
            hoverTargets.forEach(element => {
                element.dispatchEvent(new MouseEvent('mouseout', {
                    bubbles: true, clientX: -1, clientY: -1, relatedTarget: pointerShield
                }));
                element.dispatchEvent(new MouseEvent('mouseleave', {
                    bubbles: false, clientX: -1, clientY: -1, relatedTarget: pointerShield
                }));
                if (typeof PointerEvent === 'function') {
                    element.dispatchEvent(new PointerEvent('pointerleave', {
                        bubbles: false, clientX: -1, clientY: -1, relatedTarget: pointerShield
                    }));
                }
            });
            document.activeElement?.blur?.();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const finalPanel = findPanel() || null;
                if (!finalPanel) return finish(null);
                const finalRect = finalPanel.getBoundingClientRect();
                const result = { x: finalRect.x, y: finalRect.y, w: finalRect.width, h: finalRect.height, dpr: window.devicePixelRatio };
                if (collectDiagnostics) result.readinessHistory = history;
                finish(result);
            }));
        };
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'width', 'height']
        });
        resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        timeout = setTimeout(() => finish(
            collectDiagnostics
                ? { __diagnosticTimeout: true, readinessHistory: history }
                : null,
        ), timeoutMs);
        schedule();
    });

    const isTransientFrameRemoval = error => /\bframe with id \d+ was removed\b/i.test(String(error?.message || error));
    const wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));
    const withoutCacheBust = value => {
        const normalized = new URL(value);
        normalized.searchParams.delete('_t');
        return normalized.toString();
    };
    const withoutRuntimeBootstrap = value => {
        const normalized = new URL(withoutCacheBust(value));
        normalized.searchParams.delete('dashbridgeCpuCapacityFilter');
        for (const key of ['viewPanel', 'panelId']) {
            const panel = normalized.searchParams.get(key);
            if (panel && /^\d+$/.test(panel)) normalized.searchParams.set(key, `panel-${panel}`);
        }
        normalized.searchParams.sort();
        return normalized.toString();
    };
    const normalizePanelReference = value => {
        const normalized = String(value ?? '').trim().replace(/^panel-/i, '');
        return normalized || null;
    };
    const canonicalTime = value => {
        const raw = String(value ?? '');
        if (/^\d{10}$/.test(raw)) return String(Number(raw) * 1000);
        if (/^\d{13}$/.test(raw)) return raw;
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? String(parsed) : raw;
    };
    const documentIdentity = value => {
        try {
            const parsed = new URL(value);
            const panel = normalizePanelReference(parsed.searchParams.get('viewPanel') || parsed.searchParams.get('panelId'));
            const ignored = new Set(['_t', 'dashbridgeCpuCapacityFilter', 'dashbridgePanelTransforms']);
            const params = [];
            for (const [key, item] of parsed.searchParams.entries()) {
                if (ignored.has(key) || key === 'viewPanel' || key === 'panelId') continue;
                params.push([key, key === 'from' || key === 'to' ? canonicalTime(item) : item]);
            }
            params.sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
            return { origin: parsed.origin, pathname: parsed.pathname.replace(/\/$/, ''), panel, query: JSON.stringify(params) };
        } catch {
            return null;
        }
    };
    const sameDocumentIdentity = (actualValue, expectedValue) => {
        const actual = documentIdentity(actualValue);
        const expected = documentIdentity(expectedValue);
        if (!actual || !expected || actual.origin !== expected.origin || actual.pathname !== expected.pathname) return false;
        return actual.panel === expected.panel && actual.query === expected.query;
    };

    return async (tabId, url, panelId, _seriesFilter, previousSeriesFilter = null, panelTools = null, signal = null, panelTitle = '', recordDiagnostic = null) => {
        const context = () => `panelId=${String(panelId)}${panelTitle ? ` title="${String(panelTitle)}"` : ''} url=${url}`;
        const trace = (stage, detail = '') => log(`[Batch ${stage}] ${context()}${detail ? ` ${detail}` : ''}`);
        const record = (stage, event, details = {}, actualUrl = null) => recordDiagnostic?.({
            stage, event, panelId, panelTitle, requestedUrl: url, actualUrl, details,
        });
        log(previousSeriesFilter ? 'Быстрое переключение на серию…' : `Загрузка панели ${panelId}…`);
        trace(previousSeriesFilter ? 'series-switch' : 'load-start');
        record('run', previousSeriesFilter ? 'series-switch' : 'load-start');
        if (signal?.aborted) return false;

        // The early runtime is needed only when a panel's active tools actually
        // transform response data. Ordinary panels are read from their rendered DOM.
        const targetUrl = new URL(url);
        // View/solo routes often do not expose Grafana's dashboard Refresh
        // button. Bootstrap the CPU transform before the first datasource
        // request so Batch remains independent from that UI affordance.
        if (panelTools?.cpuCapacityFilterEnabled === true) {
            targetUrl.searchParams.set('dashbridgeCpuCapacityFilter', JSON.stringify({
                enabled: true,
                coefficient: Number(panelTools.cpuCapacityFilterCoefficient) > 0
                    ? Number(panelTools.cpuCapacityFilterCoefficient) : 0.8,
                mode: panelTools.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
                highlightEnabled: panelTools.cpuCapacityFilterHighlightEnabled !== false,
                load1: panelTools.cpuCapacityFilterLoad1 !== false,
                load5: panelTools.cpuCapacityFilterLoad5 === true,
                load15: panelTools.cpuCapacityFilterLoad15 === true
            }));
        }
        if (panelTools?.forceMemByteUnit === true) {
            const hashParams = new URLSearchParams(targetUrl.hash.slice(1));
            hashParams.set('dashbridgePanelTransforms', JSON.stringify({ forceMemByteUnit: true }));
            targetUrl.hash = hashParams.toString();
        }
        // Install MAIN runtime for every Batch dashboard URL. Ordinary panels
        // need the same request/render diagnostics even when no transform is enabled.
        try {
            const registration = await ensureEarlyGrafanaRuntimeForUrl(targetUrl.toString());
            record('runtime', 'registered', { ok: registration.ok, reason: registration.reason || null });
            if (!registration.ok) {
                trace('runtime-error', `reason=${registration.reason || 'unknown'}`);
                record('runtime', 'failed', { reason: registration.reason || 'unknown' });
                log(`Не удалось подготовить runtime панели ${panelId}: ${registration.reason || 'неизвестная ошибка'}`, true);
                return null;
            }
        } catch (error) {
            trace('runtime-error', `reason=${error.message}`);
            record('runtime', 'failed', { reason: error.message });
            log(`Не удалось подготовить runtime панели ${panelId}: ${error.message}`, true);
            return null;
        }
        if (signal?.aborted) return false;

        return new Promise(resolve => {
            let settled = false;
            let readinessTimeout = null;
            let preparing = false;
            let navigationGeneration = 0;
            let expectedUrl = null;
            const getTab = () => new Promise(resolveTab => {
                chrome.tabs.get(tabId, tab => resolveTab(chrome.runtime.lastError ? null : tab || null));
            });
            const matchesExpectedUrl = tab => !!tab && !!expectedUrl
                && sameDocumentIdentity(tab.url, expectedUrl);
            const isCurrentAttempt = (generation, tab) => !settled && !signal?.aborted
                && generation === navigationGeneration && matchesExpectedUrl(tab);
            const finish = value => {
                if (settled) return;
                settled = true;
                clearTimeout(readinessTimeout);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                signal?.removeEventListener('abort', abort);
                resolve(value);
            };
            const abort = () => finish(false);
            const prepareCompleteTab = async (currentTab, generation) => {
                if (settled || preparing || currentTab?.status !== 'complete'
                    || !isCurrentAttempt(generation, currentTab)) {
                    if (currentTab?.status === 'complete' && !isCurrentAttempt(generation, currentTab)) {
                        trace('navigation-rejected', `actualUrl=${currentTab.url || ''}`);
                        record('navigation', 'rejected', { reason: 'url-or-generation-mismatch' }, currentTab.url || null);
                    }
                    return;
                }
                preparing = true;
                try {
                    for (let attempt = 0; attempt < 2; attempt++) {
                        const activeTab = await getTab();
                        if (!isCurrentAttempt(generation, activeTab)) {
                            trace('navigation-rejected', `actualUrl=${activeTab?.url || ''}`);
                            record('navigation', 'rejected', { reason: 'url-or-generation-mismatch' }, activeTab?.url || null);
                            return finish(false);
                        }
                        const effectivePanelTools = panelTools ? {
                            ...panelTools,
                            targetPanelId: String(panelId).replace(/^panel-/, ''),
                            targetPanelType: 'active'
                        } : null;
                        if (panelTools) {
                            const refresh = panelTools.invertIdle === true || panelTools.convertMemToUsed === true
                                || panelTools.seriesQueryFilterEnabled === true;
                            // A Batch URL is a single-panel route. Tell MAIN the
                            // exact panel explicitly so its scoped response guard
                            // cannot fall back to an arbitrary visible canvas.
                            const applied = await applySharedGrafanaPanelTools(effectivePanelTools, { tabId, refresh });
                            const afterToolsTab = await getTab();
                            if (!isCurrentAttempt(generation, afterToolsTab)) {
                                trace('navigation-rejected', `actualUrl=${afterToolsTab?.url || ''}`);
                                record('navigation', 'rejected', { reason: 'url-or-generation-mismatch', stage: 'panel-tools' }, afterToolsTab?.url || null);
                                return finish(false);
                            }
                            if (!applied?.ok) {
                                record('panel-tools', 'failed', { reason: applied?.reason || 'unknown' }, afterToolsTab?.url || null);
                                // A View/solo route may have no dashboard
                                // Refresh control. The page still has a valid
                                // first render; let readiness decide whether it
                                // can be captured instead of discarding it here.
                                if (applied.reason === 'refresh-unavailable') {
                                trace('panel-tools-refresh-unavailable');
                                log(`Обновление панели ${panelId} недоступно, использую текущий рендер`, true);
                                } else {
                                trace('panel-tools-error', `reason=${applied?.reason || 'unknown'}`);
                                log(`Не удалось применить настройки панели ${panelId}: ${applied?.reason || 'неизвестная ошибка'}`, true);
                                return finish(null);
                                }
                            }
                        }
                        try {
                            await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['js/content/grafana-dom.js'] });
                            const afterDomTab = await getTab();
                            if (!isCurrentAttempt(generation, afterDomTab)) {
                                trace('navigation-rejected', `actualUrl=${afterDomTab?.url || ''}`);
                                record('navigation', 'rejected', { reason: 'url-or-generation-mismatch', stage: 'dom-runtime' }, afterDomTab?.url || null);
                                return finish(false);
                            }
                            const results = await chrome.scripting.executeScript({
                                target: { tabId }, world: 'MAIN', func: waitForPanelInMainWorld,
                                args: [panelId, effectivePanelTools, 25_000, !!recordDiagnostic]
                            });
                            const afterReadyTab = await getTab();
                            if (!isCurrentAttempt(generation, afterReadyTab)) {
                                trace('navigation-rejected', `actualUrl=${afterReadyTab?.url || ''}`);
                                record('navigation', 'rejected', { reason: 'url-or-generation-mismatch', stage: 'readiness' }, afterReadyTab?.url || null);
                                return finish(false);
                            }
                            const rawResult = results?.[0]?.result || null;
                            const result = rawResult?.__diagnosticTimeout ? null : rawResult;
                            record('readiness', result ? 'ready' : 'timeout', {
                                reason: result ? null : (rawResult?.__diagnosticTimeout ? 'readiness-deadline' : 'panel-not-found-or-empty'),
                                result: result ? { width: result.w, height: result.h, readinessHistory: result.readinessHistory || [] }
                                    : (rawResult?.__diagnosticTimeout ? { readinessHistory: rawResult.readinessHistory || [] } : null),
                            }, afterReadyTab?.url || null);
                            if (!result) trace('readiness-failed', 'reason=timeout-or-panel-not-found');
                            else trace('ready', `rect=${result.w}x${result.h}`);
                            return finish(result);
                        } catch (error) {
                            if (!isTransientFrameRemoval(error) || attempt === 1) throw error;
                            // A Grafana navigation can replace frame 0 just after its
                            // complete event. Retry once, bounded, within this load only.
                            await wait(150);
                        }
                    }
                } catch (error) {
                    if (!signal?.aborted) {
                        trace('prepare-error', `reason=${error.message}`);
                        log(`Не удалось подготовить панель ${panelId}: ${error.message}`, true);
                    }
                    finish(signal?.aborted ? false : null);
                } finally {
                    preparing = false;
                }
            };
            const onUpdated = (updatedTabId, changeInfo, currentTab) => {
                if (updatedTabId !== tabId || settled || changeInfo.status !== 'complete') return;
                record('navigation', 'complete', { generation: navigationGeneration }, currentTab?.url || null);
                void prepareCompleteTab(currentTab, navigationGeneration);
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
            readinessTimeout = setTimeout(() => {
                trace('timeout', 'reason=readiness-deadline');
                record('readiness', 'timeout', { reason: 'readiness-deadline' });
                finish(false);
            }, 30_000);
            signal?.addEventListener('abort', abort, { once: true });

            chrome.tabs.get(tabId, async tab => {
                if (chrome.runtime.lastError || !tab || signal?.aborted) return finish(false);
                const currentBaseUrl = withoutCacheBust(tab.url || 'http://localhost');
                const targetBaseUrl = withoutCacheBust(targetUrl.toString());
                navigationGeneration++;
                if (currentBaseUrl !== targetBaseUrl) {
                    targetUrl.searchParams.set('_t', Date.now());
                    expectedUrl = targetUrl.toString();
                    record('navigation', 'requested', {}, expectedUrl);
                    try {
                        const updatedTab = await chrome.tabs.update(tabId, { url: expectedUrl });
                        if (updatedTab?.status === 'complete') void prepareCompleteTab(updatedTab, navigationGeneration);
                    } catch (error) {
                        if (!signal?.aborted) log(`Не удалось открыть панель ${panelId}: ${error.message}`, true);
                        finish(false);
                    }
                    return;
                }
                expectedUrl = tab.url;
                record('navigation', 'already-at-target', { status: tab.status }, tab.url || null);
                void prepareCompleteTab(tab, navigationGeneration);
            });
        });
    };
}
