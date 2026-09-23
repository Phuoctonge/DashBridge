// Batch navigation and renderer readiness in the temporary Grafana tab.
function createBatchPanelLoader({ log }) {
    const waitForPanelInMainWorld = (panelId, panelTools, timeoutMs = 25_000) => new Promise(resolve => {
        const findPanel = () => {
            const exact = window.DashBridgeGrafanaDom?.findPanelById(panelId);
            if (exact) return exact;
            const route = new URL(location.href);
            const requested = route.searchParams.get('viewPanel') || route.searchParams.get('panelId');
            // Legacy fullscreen panels can omit their DOM id. Only the exact
            // single-panel route may use the runtime's active-panel fallback.
            return String(requested) === String(panelId)
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
            const loading = Array.from((panel || document).querySelectorAll('.panel-loading, [data-testid="spinner"]'))
                .some(element => {
                    const style = getComputedStyle(element);
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
                });
            if (loading || !panel) {
                stableFrames = 0;
                previousRect = null;
                schedule();
                return;
            }
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
                schedule();
                return;
            }
            // Header/menu SVG icons may precede the visualization and can be hidden.
            // A rendered panel itself is enough for the ordinary capture path: Grafana
            // may render valid no-data, table, stat, canvas and plugin panels without
            // uPlot/Flot points or any observed data request.
            const renderer = panel.querySelector('.flot-base, .uplot canvas, .graph-panel__chart canvas, canvas')
                || Array.from(panel.querySelectorAll('svg')).find(svg => svg.getBoundingClientRect().height > 1) || panel;
            if (renderer.getBoundingClientRect().height <= 1) {
                stableFrames = 0;
                schedule();
                return;
            }
            const requiresDataEvidence = panelTools?.invertIdle === true
                || panelTools?.convertMemToUsed === true
                || panelTools?.forceMemByteUnit === true
                || panelTools?.trimDomainEnabled === true
                || panelTools?.seriesQueryFilterEnabled === true
                || panelTools?.cpuCapacityFilterEnabled === true
                || (panelTools?.legendMode === 'fast_complete_hide'
                    && (panelTools.legendFilter?.length > 0 || panelTools.legendVisibleSeries?.length > 0));
            if (requiresDataEvidence) {
                const interceptor = window.__dashbridgeDataInterceptorDiagnostic;
                const requestSettled = interceptor?.activeRequests === 0
                    && interceptor.events?.some(event => event.stage === 'request-complete');
                const chart = window.DashBridgeGrafanaVisualEngine?.findUPlot?.(panel);
                const chartHasPoints = Array.isArray(chart?.data)
                    && chart.data.some(values => Array.isArray(values) && values.length > 0);
                const flotHasPoints = typeof window.jQuery === 'function'
                    && (window.jQuery(renderer).data('plot')?.getData?.() || [])
                        .some(series => Array.isArray(series?.data) && series.data.length > 0);
                const svgHasGeometry = [...panel.querySelectorAll('svg path, svg polyline, svg rect')].some(element => {
                    try { return element.getBBox().width > 0 && element.getBBox().height > 0; }
                    catch { return false; }
                });
                const filteredEmpty = window.__dashbridgePanelToolsVisualMetadata?.responseFilterEmptyIsNormal === true
                    && window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.kind === 'filtered_empty';
                if (!requestSettled || !(chartHasPoints || flotHasPoints || svgHasGeometry || filteredEmpty)) {
                    stableFrames = 0;
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
                finish({ x: finalRect.x, y: finalRect.y, w: finalRect.width, h: finalRect.height, dpr: window.devicePixelRatio });
            }));
        };
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'width', 'height']
        });
        resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        timeout = setTimeout(() => finish(null), timeoutMs);
        schedule();
    });

    const isTransientFrameRemoval = error => /\bframe with id \d+ was removed\b/i.test(String(error?.message || error));
    const wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));
    const withoutCacheBust = value => {
        const normalized = new URL(value);
        normalized.searchParams.delete('_t');
        return normalized.toString();
    };

    return async (tabId, url, panelId, _seriesFilter, previousSeriesFilter = null, panelTools = null, signal = null) => {
        log(previousSeriesFilter ? 'Быстрое переключение на серию…' : `Загрузка панели ${panelId}…`);
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
        const requiresDataRuntime = panelTools?.invertIdle === true
            || panelTools?.convertMemToUsed === true
            || panelTools?.forceMemByteUnit === true
            || panelTools?.trimDomainEnabled === true
            || panelTools?.seriesQueryFilterEnabled === true
            || panelTools?.cpuCapacityFilterEnabled === true
            || (panelTools?.legendMode === 'fast_complete_hide'
                && (panelTools.legendFilter?.length > 0 || panelTools.legendVisibleSeries?.length > 0));
        if (requiresDataRuntime) {
            try {
                const registration = await ensureEarlyGrafanaRuntimeForUrl(targetUrl.toString());
                if (!registration.ok) {
                    log(`Не удалось подготовить runtime панели ${panelId}: ${registration.reason || 'неизвестная ошибка'}`, true);
                    return null;
                }
            } catch (error) {
                log(`Не удалось подготовить runtime панели ${panelId}: ${error.message}`, true);
                return null;
            }
            if (signal?.aborted) return false;
        }

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
                && !tab.pendingUrl && tab.url === expectedUrl;
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
                    || !isCurrentAttempt(generation, currentTab)) return;
                preparing = true;
                try {
                    for (let attempt = 0; attempt < 2; attempt++) {
                        if (!isCurrentAttempt(generation, await getTab())) return finish(false);
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
                            if (!isCurrentAttempt(generation, await getTab())) return finish(false);
                            if (!applied?.ok) {
                                log(`Не удалось применить настройки панели ${panelId}: ${applied?.reason || 'неизвестная ошибка'}`, true);
                                return finish(null);
                            }
                        }
                        try {
                            await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['js/content/grafana-dom.js'] });
                            if (!isCurrentAttempt(generation, await getTab())) return finish(false);
                            const results = await chrome.scripting.executeScript({
                                target: { tabId }, world: 'MAIN', func: waitForPanelInMainWorld,
                                args: [panelId, effectivePanelTools, 25_000]
                            });
                            if (!isCurrentAttempt(generation, await getTab())) return finish(false);
                            return finish(results?.[0]?.result || null);
                        } catch (error) {
                            if (!isTransientFrameRemoval(error) || attempt === 1) throw error;
                            // A Grafana navigation can replace frame 0 just after its
                            // complete event. Retry once, bounded, within this load only.
                            await wait(150);
                        }
                    }
                } catch (error) {
                    if (!signal?.aborted) log(`Не удалось подготовить панель ${panelId}: ${error.message}`, true);
                    finish(signal?.aborted ? false : null);
                } finally {
                    preparing = false;
                }
            };
            const onUpdated = (updatedTabId, changeInfo, currentTab) => {
                if (updatedTabId !== tabId || settled || changeInfo.status !== 'complete') return;
                void prepareCompleteTab(currentTab, navigationGeneration);
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
            readinessTimeout = setTimeout(() => finish(false), 30_000);
            signal?.addEventListener('abort', abort, { once: true });

            chrome.tabs.get(tabId, async tab => {
                if (chrome.runtime.lastError || !tab || signal?.aborted) return finish(false);
                const currentBaseUrl = withoutCacheBust(tab.url || 'http://localhost');
                const targetBaseUrl = withoutCacheBust(targetUrl.toString());
                navigationGeneration++;
                if (currentBaseUrl !== targetBaseUrl) {
                    targetUrl.searchParams.set('_t', Date.now());
                    expectedUrl = targetUrl.toString();
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
                void prepareCompleteTab(tab, navigationGeneration);
            });
        });
    };
}
