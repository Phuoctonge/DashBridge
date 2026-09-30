// Shared capture primitive.  It deliberately returns an image instead of
// downloading it, so Popup and Batch can choose their own output workflow.
async function captureGrafanaVisibleTab(tabId, expectedUrl) {
    const initial = await chrome.tabs.get(tabId);
    let invalidated = false;
    const onActivated = info => { if (info.windowId === initial.windowId) invalidated = true; };
    const onUpdated = (id, change) => {
        if (id === tabId && change.url && change.url !== expectedUrl) invalidated = true;
    };
    const onRemoved = id => { if (id === tabId) invalidated = true; };
    const check = async () => {
        const tab = await chrome.tabs.get(tabId);
        const active = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (invalidated || tab.windowId !== initial.windowId || active[0]?.id !== tabId
            || (tab.pendingUrl && tab.pendingUrl !== expectedUrl)
            || !expectedUrl || tab.url !== expectedUrl) {
            throw new Error('capture-target-changed');
        }
        return tab;
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    try {
        const tab = await check();
        const source = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        await check();
        return source;
    } finally {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
    }
}

async function scrollGrafanaPanelIntoView({ tabId, panelId = null, title = '', type = 'active' }) {
    await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['js/content/grafana-dom.js']
    });
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [panelId, title, type],
        func: (targetPanelId, panelTitle, panelType) => {
            let panel = window.DashBridgeGrafanaDom?.findPanel({ panelId: targetPanelId, title: panelTitle, type: panelType });
            if (!panel && targetPanelId === null) {
                const panels = [...document.querySelectorAll('.react-grid-item, .panel-container, [data-panelid], [data-viz-panel-key^="panel-"]')]
                    .filter(item => item.offsetHeight > 100);
                if (panelType !== 'active' && panelTitle) {
                    panel = panels.find(item => item.innerText?.includes(panelTitle));
                    if (!panel) {
                        const markers = panelType === 'mem' ? ['mem', 'ram', 'memory', 'память'] : ['load', 'idle', 'cpu'];
                        panel = panels.find(item => markers.some(marker => item.innerText?.toLowerCase().includes(marker)));
                    }
                }
                panel ||= panels.length === 1 ? panels[0] : (panels.find(item => item.querySelector('canvas')) || panels[0]);
            }
            if (!panel) return false;
            panel.scrollIntoView({ block: 'center' });
            return true;
        }
    });
    return !!results?.[0]?.result;
}

async function captureGrafanaPanelImage({
    tabId, windowId, panelId = null, settleMs = 0,
    prepared = false, outputWidth = 1000, outputHeight = 520,
    onDiagnostic = null,
}) {
    let rect = null;
    let preparedSessionId = null;
    const startedAt = Date.now();
    const targetSize = prepared ? {
        width: Math.min(4096, Math.max(100, Math.round(Number(outputWidth) || 1000))),
        height: Math.min(4096, Math.max(100, Math.round(Number(outputHeight) || 520)))
    } : null;
    const collectFailureContext = async () => {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [panelId],
                func: targetPanelId => {
                    const candidates = [...document.querySelectorAll(
                        '.react-grid-item, .panel-container, [data-panelid], [data-viz-panel-key^="panel-"]'
                    )].slice(0, 40);
                    const panel = window.DashBridgeGrafanaDom?.findPanelById?.(targetPanelId)
                        || window.DashBridgeGrafanaDom?.findPanel?.({ panelId: targetPanelId });
                    const describe = node => {
                        const rect = node?.getBoundingClientRect?.();
                        return {
                            tag: node?.tagName || null,
                            panelId: node?.getAttribute?.('data-panelid') || null,
                            title: node?.querySelector?.('h1,h2,h3,h4,h5,h6,[data-testid="panel title"]')?.textContent?.trim()?.slice(0, 160) || null,
                            width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0),
                            visible: !!rect && rect.width > 1 && rect.height > 1,
                            canvas: node?.querySelectorAll?.('canvas').length || 0,
                            svg: node?.querySelectorAll?.('svg').length || 0,
                            uplot: node?.querySelectorAll?.('.uplot').length || 0,
                            flot: node?.querySelectorAll?.('.flot-base').length || 0,
                        };
                    };
                    return {
                        searchedSelectors: [
                            '.react-grid-item', '.panel-container', '[data-panelid]',
                            '[data-viz-panel-key^="panel-"]', 'canvas', 'svg', '.uplot', '.flot-base'
                        ],
                        readyState: document.readyState,
                        loadingMarkers: document.querySelectorAll('.panel-loading,[data-testid="spinner"]').length,
                        target: describe(panel), candidateCount: candidates.length,
                        candidates: candidates.slice(0, 8).map(describe),
                        network: {
                            activeRequests: Number(window.__dashbridgeDataInterceptorDiagnostic?.activeRequests) || 0,
                            responseKind: String(window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.kind || '').slice(0, 80),
                        },
                    };
                }
            });
            return results?.[0]?.result || null;
        } catch (contextError) {
            return { contextError: String(contextError?.message || contextError).slice(0, 240) };
        }
    };
    const reportFailure = async (stage, reason, error = null) => {
        const detail = {
            stage, reason: String(reason || 'unknown'),
            error: error?.message ? String(error.message) : null,
            category: /not-found|empty|lookup/i.test(`${stage} ${reason}`) ? 'not-found'
                : /timeout|deadline/i.test(`${stage} ${reason}`) ? 'timeout'
                    : /cancel/i.test(`${stage} ${reason}`) ? 'cancelled'
                        : /restore/i.test(`${stage} ${reason}`) ? 'restore' : 'capture',
            elapsedMs: Date.now() - startedAt, panelId: String(panelId ?? ''),
            context: await collectFailureContext(),
        };
        try { onDiagnostic?.(detail); } catch { /* diagnostics must not break capture cleanup */ }
        return null;
    };
    try {
        const expectedUrl = (await chrome.tabs.get(tabId)).url;
        if (prepared) {
            if (typeof ensureGrafanaRuntime !== 'function') {
                return reportFailure('runtime', 'ensure-runtime-unavailable');
            }
            // Applying Batch panel tools already installs the MAIN-world runtime.
            // Reinjecting it here would tear down and recreate its observers and
            // can race an in-flight capture restore. Reuse the live capture API
            // and backfill the runtime only for panels captured without tools.
            const runtimeProbe = await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN',
                func: () => window.__dashbridgePanelToolsRuntimeLoaded === true
                    && typeof window.DashBridgeGrafanaBatchCapture?.prepare === 'function'
                    && typeof window.DashBridgeGrafanaBatchCapture?.restore === 'function'
            }).catch(() => []);
            const runtimeReady = runtimeProbe.length > 0 && runtimeProbe.every(item => item.result === true);
            if (!runtimeReady) {
                const runtime = await ensureGrafanaRuntime(tabId);
                if (!runtime?.ok) return reportFailure('runtime', runtime?.reason || 'runtime-not-ready');
            }
            preparedSessionId = `batch-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const preparedResults = await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN',
                args: [panelId, preparedSessionId, targetSize.width, targetSize.height],
                func: (targetPanelId, sessionId, width, height) => window.DashBridgeGrafanaBatchCapture?.prepare({
                    panelId: targetPanelId, sessionId, outputWidth: width, outputHeight: height
                }) || { ok: false, reason: 'batch-capture-runtime-unavailable' }
            });
            const preparedResult = preparedResults?.[0]?.result;
            if (!preparedResult?.ok || !preparedResult.rect) {
                return reportFailure('prepare', preparedResult?.reason || 'panel-preparation-failed');
            }
            rect = preparedResult.rect;
        } else {
            if (!await scrollGrafanaPanelIntoView({ tabId, panelId })) {
                return reportFailure('panel-lookup', 'panel-not-found');
            }
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                args: [panelId],
                func: (targetPanelId) => {
                    let panel = window.DashBridgeGrafanaDom?.findPanel({ panelId: targetPanelId });
                    if (!panel && targetPanelId === null) {
                        const panels = [...document.querySelectorAll('.react-grid-item, .panel-container, [data-panelid], [data-viz-panel-key^="panel-"]')]
                            .filter(item => item.offsetHeight > 100);
                        panel = panels.length === 1 ? panels[0] : (panels.find(item => item.querySelector('canvas')) || panels[0]);
                    }
                    if (!panel) return null;
                    panel = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
                    const panelRect = panel.getBoundingClientRect();
                    if (panelRect.width <= 1 || panelRect.height <= 1) return null;
                    return { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height, dpr: window.devicePixelRatio };
                }
            });
            rect = results?.[0]?.result;
            if (!rect) return reportFailure('panel-geometry', 'panel-empty-or-zero-size');
        }
        // Batch uses the same renderer-aware checkpoint as direct Grafana and
        // DashBridge. The legacy settleMs option remains accepted for callers
        // but no longer controls screenshot readiness.
        await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN', files: ['js/shared/grafana-capture-output.js']
        }).catch(() => undefined);
        await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN', args: [panelId],
            func: async targetPanelId => {
                const panel = window.DashBridgeGrafanaDom?.findPanelById?.(targetPanelId)
                    || window.DashBridgeGrafanaDom?.findPanel?.({ panelId: targetPanelId });
                return window.DashBridgeGrafanaCaptureOutput?.waitForStableLayout?.(panel, { watchdogMs: 8000 })
                    || { status: 'unavailable' };
            }
        }).catch(() => undefined);
        if (prepared) {
            await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [panelId],
                func: async targetPanelId => {
                    const state = window.__dashbridgeThresholdDiagnostic;
                    if (!state?.enabled || !state.status?.enabled || state.suppressedReason
                        || String(state.panelId).replace(/^panel-/, '') !== String(targetPanelId).replace(/^panel-/, '')) return;
                    const panel = window.DashBridgeGrafanaDom?.findPanel({ panelId: targetPanelId });
                    if (!panel) return;
                    // Prepared layout changes chart coordinates after threshold
                    // observers ran. Repaint against the settled capture geometry.
                    window.DashBridgeGrafanaVisualEngine?.setThreshold?.({
                        root: document.querySelector('.dashbridge-panel-capture-frame') || window.DashBridgeGrafanaDom.outerPanel(panel), enabled: true,
                        value: state.requested.value, rawValue: state.requested.rawValue
                    });
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                }
            });
        }
        let source;
        try {
            source = await captureGrafanaVisibleTab(tabId, expectedUrl);
        } catch (error) {
            return reportFailure('capture-visible-tab', error?.message || 'capture-failed', error);
        }
        if (!source) return reportFailure('capture-visible-tab', 'empty-result');
        const dataUrl = await new Promise(resolve => {
            const image = new Image();
            image.onload = () => {
                const dpr = rect.dpr || 1;
                const x = Math.max(0, Math.round(rect.x * dpr));
                const y = Math.max(0, Math.round(rect.y * dpr));
                const width = Math.min(Math.round(rect.width * dpr), image.naturalWidth - x);
                const height = Math.min(Math.round(rect.height * dpr), image.naturalHeight - y);
                if (width <= 0 || height <= 0) return resolve({ dataUrl: null, reason: 'crop-outside-image' });
                const canvas = document.createElement('canvas');
                canvas.width = targetSize?.width || width;
                canvas.height = targetSize?.height || height;
                canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
                try { resolve({ dataUrl: canvas.toDataURL('image/png'), reason: null }); }
                catch (error) { resolve({ dataUrl: null, reason: error?.message || 'canvas-export-failed' }); }
            };
            image.onerror = () => resolve({ dataUrl: null, reason: 'image-decode-failed' });
            image.src = source;
        });
        if (!dataUrl?.dataUrl) return reportFailure('crop', dataUrl?.reason || 'crop-failed');
        return { dataUrl: dataUrl.dataUrl, rect, width: targetSize?.width || null, height: targetSize?.height || null };
    } finally {
        if (preparedSessionId) {
            await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [preparedSessionId],
                func: sessionId => {
                    const frame = document.querySelector('.dashbridge-panel-capture-frame');
                    if (frame) window.DashBridgeGrafanaVisualEngine?.setThreshold?.({ root: frame, enabled: false });
                    return window.DashBridgeGrafanaBatchCapture?.restore(sessionId);
                }
            }).catch(async error => {
                const detail = {
                    stage: 'restore', reason: 'restore-failed', category: 'restore',
                    panelId: String(panelId ?? ''), elapsedMs: Date.now() - startedAt,
                    error: String(error?.message || error).slice(0, 500),
                };
                try { onDiagnostic?.(detail); } catch { /* diagnostics must not break cleanup */ }
            });
        }
    }
}
