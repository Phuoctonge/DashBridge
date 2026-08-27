// Shared capture primitive.  It deliberately returns an image instead of
// downloading it, so Popup and Batch can choose their own output workflow.
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
    tabId, windowId, panelId = null, settleMs = 800,
    prepared = false, outputWidth = 1000, outputHeight = 520
}) {
    let rect = null;
    let preparedSessionId = null;
    const targetSize = prepared ? {
        width: Math.min(4096, Math.max(100, Math.round(Number(outputWidth) || 1000))),
        height: Math.min(4096, Math.max(100, Math.round(Number(outputHeight) || 520)))
    } : null;
    try {
        if (prepared) {
            if (typeof ensureGrafanaRuntime !== 'function') return null;
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
                if (!runtime?.ok) return null;
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
            if (!preparedResult?.ok || !preparedResult.rect) return null;
            rect = preparedResult.rect;
        } else {
            if (!await scrollGrafanaPanelIntoView({ tabId, panelId })) return null;
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
            if (!rect) return null;
        }
        await new Promise(resolve => setTimeout(resolve, settleMs));
        const source = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        if (!source) return null;
        const dataUrl = await new Promise(resolve => {
            const image = new Image();
            image.onload = () => {
                const dpr = rect.dpr || 1;
                const x = Math.max(0, Math.round(rect.x * dpr));
                const y = Math.max(0, Math.round(rect.y * dpr));
                const width = Math.min(Math.round(rect.width * dpr), image.naturalWidth - x);
                const height = Math.min(Math.round(rect.height * dpr), image.naturalHeight - y);
                if (width <= 0 || height <= 0) return resolve(null);
                const canvas = document.createElement('canvas');
                canvas.width = targetSize?.width || width;
                canvas.height = targetSize?.height || height;
                canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            };
            image.onerror = () => resolve(null);
            image.src = source;
        });
        return dataUrl ? { dataUrl, rect, width: targetSize?.width || null, height: targetSize?.height || null } : null;
    } finally {
        if (preparedSessionId) {
            await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [preparedSessionId],
                func: sessionId => window.DashBridgeGrafanaBatchCapture?.restore(sessionId)
            }).catch(() => undefined);
        }
    }
}
