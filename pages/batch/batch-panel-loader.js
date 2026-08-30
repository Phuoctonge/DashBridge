// Batch navigation and renderer readiness in the temporary Grafana tab.
function createBatchPanelLoader({ log }) {
    const waitForPanelInMainWorld = panelId => new Promise(resolve => {
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
            const panel = window.DashBridgeGrafanaDom?.findPanelById(panelId) || null;
            const loading = document.querySelectorAll('.panel-loading, [data-testid="spinner"]').length > 0;
            if (loading || !panel) {
                stableFrames = 0;
                previousRect = null;
                return;
            }
            if (observedPanel !== panel) {
                resizeObserver?.disconnect();
                observedPanel = panel;
                resizeObserver?.observe(panel);
            }
            const rect = panel.getBoundingClientRect();
            if (rect.width <= 5 || rect.height <= 10) return;
            const renderer = panel.querySelector('canvas,svg,.flot-base') || panel;
            if (renderer.getBoundingClientRect().height <= 1) return;
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
                const finalPanel = window.DashBridgeGrafanaDom?.findPanelById(panelId) || null;
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
        timeout = setTimeout(() => finish(null), 30_000);
        schedule();
    });

    return async (tabId, url, panelId, _seriesFilter, previousSeriesFilter = null, panelTools = null, signal = null) => {
        log(previousSeriesFilter ? 'Быстрое переключение на серию…' : `Загрузка панели ${panelId}…`);
        if (signal?.aborted) return false;

        // A complete-hide selection must be installed at document_start: an
        // ordinary /d/ viewPanel page can issue its first datasource request
        // before the post-load command bridge is available. Register the MAIN
        // runtime explicitly instead of relying on the preceding discovery tab
        // to have registered it as a side effect.
        const targetUrl = new URL(url);
        const hashParams = new URLSearchParams(targetUrl.hash.slice(1));
        if (hashParams.has('dashbridgeLegendSelection')) {
            try {
                const registration = await ensureEarlyGrafanaRuntimeForUrl(targetUrl.toString());
                if (!registration.ok) {
                    log(`Не удалось подготовить ранний фильтр панели ${panelId}: ${registration.reason || 'неизвестная ошибка'}`, true);
                    return null;
                }
            } catch (error) {
                log(`Не удалось подготовить ранний фильтр панели ${panelId}: ${error.message}`, true);
                return null;
            }
        }

        return new Promise(resolve => {
            let settled = false;
            let readinessTimeout = null;
            let preparing = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                clearTimeout(readinessTimeout);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                signal?.removeEventListener('abort', abort);
                resolve(value);
            };
            const abort = () => finish(false);
            const prepareCompleteTab = async currentTab => {
                if (settled || preparing || currentTab?.status !== 'complete') return;
                preparing = true;
                try {
                    if (panelTools) {
                        const refresh = panelTools.invertIdle === true || panelTools.convertMemToUsed === true;
                        const applied = await applySharedGrafanaPanelTools(panelTools, { tabId, refresh });
                        if (!applied?.ok) {
                            log(`Не удалось применить настройки панели ${panelId}: ${applied?.reason || 'неизвестная ошибка'}`, true);
                            finish(null);
                            return;
                        }
                    }
                    if (signal?.aborted) return finish(false);
                    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['js/content/grafana-dom.js'] });
                    const results = await chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: waitForPanelInMainWorld,
                        args: [panelId]
                    });
                    finish(results?.[0]?.result || null);
                } catch (error) {
                    if (!signal?.aborted) log(`Не удалось подготовить панель ${panelId}: ${error.message}`, true);
                    finish(null);
                }
            };
            const onUpdated = (updatedTabId, changeInfo, currentTab) => {
                if (updatedTabId !== tabId || settled) return;
                if (changeInfo.status === 'complete' || currentTab?.status === 'complete') {
                    void prepareCompleteTab(currentTab);
                }
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
            readinessTimeout = setTimeout(() => finish(false), 30_000);
            signal?.addEventListener('abort', abort, { once: true });

            chrome.tabs.get(tabId, async tab => {
                if (chrome.runtime.lastError || !tab || signal?.aborted) return finish(false);
                const current = new URL(tab.url || 'http://localhost');
                const target = targetUrl;
                current.searchParams.delete('_t');
                target.searchParams.delete('_t');
                if (current.toString() !== target.toString()) {
                    target.searchParams.set('_t', Date.now());
                    try {
                        const updatedTab = await chrome.tabs.update(tabId, { url: target.toString() });
                        void prepareCompleteTab(updatedTab);
                    } catch {
                        finish(false);
                    }
                    return;
                }
                void prepareCompleteTab(tab);
            });
        });
    };
}
