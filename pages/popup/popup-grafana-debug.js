// === Grafana debugging diagnostics ===
// Read-only page inspection for support reports. No cookies, query payloads or series data are collected.

document.addEventListener('DOMContentLoaded', () => {
    const fullReportButton = document.getElementById('grafanaDebugFullBtn');
    const status = document.getElementById('grafanaDebugStatus');

    const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.display = 'block';
        status.style.color = isError ? 'var(--danger, #dc2626)' : 'var(--text-muted)';
    };

    chrome.storage.local.get('guiCaptureStatus', ({ guiCaptureStatus }) => {
        if (!guiCaptureStatus || !guiCaptureStatus.message) return;
        setStatus(guiCaptureStatus.message, guiCaptureStatus.state === 'error');
    });

    const copyText = async (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Браузер запретил запись в буфер обмена');
    };

    async function collectGuiScreenshots() {
        chrome.storage.local.set({ guiCaptureStatus: { state: 'running', message: 'Сбор скриншотов запущен', updatedAt: Date.now() } });
        chrome.runtime.sendMessage({ type: 'dashbridge-capture-gui' }).catch(error => {
            console.error('GUI screenshot background start error:', error);
        });
        return 13;
    }

    const collectDiagnostics = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Откройте дашборд Grafana в активной вкладке');

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                const round = (value) => Math.round(Number(value || 0) * 100) / 100;
                const rect = (element) => {
                    const box = element.getBoundingClientRect();
                    return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
                };
                const className = (element) => typeof element.className === 'string' ? element.className.slice(0, 240) : '';
                const elementIdentity = element => element ? {
                    tag: element.tagName,
                    id: String(element.id || '').slice(0, 120) || null,
                    className: className(element),
                    role: element.getAttribute('role'),
                    testId: element.getAttribute('data-testid'),
                    panelId: element.getAttribute('data-panelid') || element.getAttribute('data-panel-id'),
                    vizPanelKey: element.getAttribute('data-viz-panel-key')
                } : null;
                const safeUrl = () => {
                    const url = new URL(location.href);
                    for (const key of [...url.searchParams.keys()]) {
                        if (/(token|auth|password|secret|apikey|api_key)/i.test(key)) url.searchParams.set(key, '[redacted]');
                        else if (key.startsWith('var-')) url.searchParams.set(key, '[present]');
                    }
                    return url.toString();
                };
                const panelSelectors = '[data-panelid], [data-panel-id], [data-viz-panel-key^="panel-"], .react-grid-item, .panel-container';
                const panels = Array.from(document.querySelectorAll(panelSelectors))
                    .map(panel => panel.closest('.react-grid-item, .panel-container') || panel);
                const uniquePanels = [];
                const seen = new Set();
                panels.forEach(panel => {
                    const key = panel.getAttribute('data-panelid') || `${rect(panel).x}:${rect(panel).y}:${rect(panel).width}:${rect(panel).height}`;
                    if (seen.has(key) || panel.offsetHeight < 40 || panel.offsetWidth < 40) return;
                    seen.add(key);
                    uniquePanels.push(panel);
                });
                const titleOf = (panel) => {
                    const title = panel.querySelector('[data-testid*="title" i], .panel-title, [class*="panel-title" i], h1, h2, h3');
                    return title ? title.textContent.trim().replace(/\s+/g, ' ').slice(0, 240) : '';
                };
                const panelMarkers = panel => {
                    const selector = '[data-panelid], [data-panel-id], [data-viz-panel-key], [id^="panel-"]';
                    const candidates = [panel, ...panel.querySelectorAll(selector)]
                        .filter(element => element?.matches?.(selector));
                    return [...new Set(candidates)].slice(0, 12).map(elementIdentity);
                };
                const panelKeyOf = panel => {
                    const shared = window.DashBridgeGrafanaDom?.panelKey?.(panel);
                    if (shared) return shared;
                    const marker = panelMarkers(panel).find(item => item.vizPanelKey || item.panelId || /^panel-/.test(item.id || ''));
                    const raw = marker?.vizPanelKey || marker?.panelId || marker?.id || '';
                    return raw ? (String(raw).startsWith('panel-') ? String(raw) : `panel-${raw}`) : null;
                };
                const panelInfo = (panel) => {
                    const canvases = Array.from(panel.querySelectorAll('canvas'));
                    const legacy = canvases.some(canvas => canvas.classList.contains('flot-base') || canvas.classList.contains('flot-overlay'));
                    const modern = canvases.some(canvas => !canvas.classList.contains('flot-base') && !canvas.classList.contains('flot-overlay'));
                    const legendRows = Array.from(panel.querySelectorAll('tr[class*="LegendRow"], .graph-legend-series'))
                        .filter(row => row.getBoundingClientRect().width > 1 && row.getBoundingClientRect().height > 1);
                    const panelKey = panelKeyOf(panel);
                    return {
                        panelId: panel.getAttribute('data-panelid') || panel.getAttribute('data-panel-id')
                            || (panelKey ? panelKey.replace(/^panel-/, '') : null),
                        panelKey,
                        identifiers: panelMarkers(panel),
                        title: titleOf(panel),
                        tag: panel.tagName,
                        className: className(panel),
                        rect: rect(panel),
                        visible: panel.getClientRects().length > 0 && getComputedStyle(panel).visibility !== 'hidden',
                        chartType: legacy ? 'Flot' : modern ? 'canvas/uPlot-or-plugin' : 'no-canvas',
                        canvasCount: canvases.length,
                        canvas: canvases.slice(0, 6).map(canvas => ({ tag: canvas.tagName, className: className(canvas), rect: rect(canvas), width: canvas.width, height: canvas.height })),
                        legend: {
                            visibleRows: legendRows.length,
                            structureSample: legendRows.slice(0, 3).map(row => ({
                                ...elementIdentity(row), childCount: row.children.length,
                                textLength: String(row.textContent || '').trim().length
                            }))
                        },
                        dashbridgeMenu: {
                            hosts: panel.querySelectorAll('.dashbridge-panel-menu-host').length,
                            captureActions: panel.querySelectorAll('.dashbridge-panel-capture-action').length,
                            compactToggles: panel.querySelectorAll('.dashbridge-panel-capture-toggle').length
                        }
                    };
                };
                const pageUrl = new URL(location.href);
                const requestedPanel = pageUrl.searchParams.get('viewPanel') || pageUrl.searchParams.get('panelId');
                const requestedPanelKey = requestedPanel
                    ? (requestedPanel.startsWith('panel-') ? requestedPanel : `panel-${requestedPanel}`) : null;
                const requestedPanelElement = requestedPanelKey && uniquePanels.find(panel => panelKeyOf(panel) === requestedPanelKey);
                const activePanel = document.querySelector('.react-grid-item--fullscreen, .panel-in-fullscreen, .panel-fullscreen, [class*="fullscreen"]')
                    || requestedPanelElement
                    || uniquePanels.find(panel => panel.querySelector('canvas'))
                    || null;
                const graphStructure = () => {
                    if (!activePanel) return { error: 'Панель с графиком не найдена' };
                    const canvas = activePanel.querySelector('canvas');
                    const chain = [];
                    for (let element = canvas; element && chain.length < 10; element = element.parentElement) {
                        const style = getComputedStyle(element);
                        chain.push({ ...elementIdentity(element), rect: rect(element), display: style.display, position: style.position, overflow: style.overflow, padding: style.padding });
                    }
                    return { panel: panelInfo(activePanel), ancestorChain: chain };
                };
                const boot = window.grafanaBootData || window.__grafanaBootData || {};
                const environment = {
                    generatedAt: new Date().toISOString(),
                    url: safeUrl(),
                    documentTitle: document.title,
                    readyState: document.readyState,
                    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
                    browser: navigator.userAgent,
                    secureContext: window.isSecureContext,
                    language: navigator.language,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    grafana: {
                        version: boot.settings && boot.settings.buildInfo ? boot.settings.buildInfo.version || null : null,
                        edition: boot.settings && boot.settings.buildInfo ? boot.settings.buildInfo.edition || null : null,
                        theme: document.documentElement.getAttribute('data-theme') || (boot.user && boot.user.lightTheme === false ? 'dark' : null),
                        hasBootData: Object.keys(boot).length > 0
                    }
                };
                const dashboard = {
                    panelCount: uniquePanels.length,
                    visiblePanelCount: uniquePanels.filter(panel => panel.getClientRects().length > 0).length,
                    panels: uniquePanels.map(panelInfo)
                };
                const selectorInventory = selector => ({
                    count: document.querySelectorAll(selector).length,
                    sample: Array.from(document.querySelectorAll(selector)).slice(0, 12).map(elementIdentity)
                });
                return {
                    reportType: 'full', reportSchema: 'dashbridge-grafana-debug/v2',
                    environment,
                    route: {
                        pathname: location.pathname,
                        requestedPanel: requestedPanel || null,
                        requestedPanelKey,
                        topLevel: window.top === window,
                        dashboardRoute: /(?:^|\/)d(?:-solo)?(?:\/|$)/.test(location.pathname),
                        queryKeys: [...pageUrl.searchParams.keys()].slice(0, 100)
                    },
                    dashbridge: {
                        menuScopeEnabled: document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true',
                        capturePrepared: document.documentElement.dataset.dashbridgeCapturePrepared === 'true',
                        captureWidth: Number(document.documentElement.dataset.dashbridgeCaptureWidth) || null,
                        captureHeight: Number(document.documentElement.dataset.dashbridgeCaptureHeight) || null,
                        runtimeLoaded: window.__dashbridgePanelToolsRuntimeLoaded === true,
                        runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration || null,
                        domAdapterAvailable: typeof window.DashBridgeGrafanaDom?.panelKey === 'function',
                        captureRuntimeAvailable: typeof window.DashBridgeGrafanaPanelCaptureRuntime?.create === 'function',
                        captureOutputAvailable: typeof window.DashBridgeGrafanaCaptureOutput?.crop === 'function',
                        lastCapture: window.__dashbridgeLastPanelCaptureDiagnostic || null
                    },
                    domInventory: {
                        reactGridItems: selectorInventory('.react-grid-item'),
                        panelContainers: selectorInventory('.panel-container, [class*="panel-container"]'),
                        vizPanelKeys: selectorInventory('[data-viz-panel-key]'),
                        numericPanelIds: selectorInventory('[data-panelid], [data-panel-id]'),
                        panelHeaders: selectorInventory('[data-testid*="Panel header"], .panel-header, [class*="panel-header"]'),
                        fullscreenCandidates: selectorInventory('.react-grid-item--fullscreen, .panel-in-fullscreen, .panel-fullscreen, [class*="fullscreen"]'),
                        dashbridgeMenuHosts: selectorInventory('.dashbridge-panel-menu-host')
                    },
                    activePanel: activePanel ? panelInfo(activePanel) : null,
                    dashboard,
                    graph: graphStructure()
                };
            }
        });
        if (!results[0] || !results[0].result) throw new Error('Grafana не вернула диагностические данные');
        const report = results[0].result;
        const manifest = chrome.runtime.getManifest();
        const configured = await chrome.storage.sync.get('grafanaIframeDomains');
        const activeUrl = new URL(tab.url);
        const hosts = Array.isArray(configured.grafanaIframeDomains) ? configured.grafanaIframeDomains : [];
        report.extension = {
            version: manifest.version,
            manifestVersion: manifest.manifest_version,
            incognitoTab: tab.incognito === true,
            configuredHostMatch: hosts.some(host => {
                const normalized = String(host || '').trim().toLowerCase();
                return normalized === activeUrl.host.toLowerCase() || normalized === activeUrl.hostname.toLowerCase();
            }),
            configuredHostCount: hosts.length
        };
        return report;
    };

    fullReportButton?.addEventListener('click', async () => {
        try {
            fullReportButton.disabled = true;
            setStatus('Сбор диагностических данных…');
            const report = await collectDiagnostics();
            const text = JSON.stringify(report, null, 2);
            await copyText(text);
            setStatus(`Скопировано в буфер: ${Math.ceil(new Blob([text]).size / 1024)} КБ`);
        } catch (error) {
            console.error('Grafana diagnostics error:', error);
            setStatus(error.message || 'Не удалось собрать диагностику', true);
        } finally {
            fullReportButton.disabled = false;
        }
    });

    const guiCaptureButton = document.getElementById('grafanaDebugGuiCaptureBtn');
    const fullResetButton = document.createElement('button');
    fullResetButton.id = 'dashbridgeFullResetBtn';
    fullResetButton.className = 'btn btn-outline';
    fullResetButton.textContent = 'Полная очистка DashBridge';
    fullResetButton.style.cssText = 'border-color: var(--danger, #dc2626); color: var(--danger, #dc2626);';
    guiCaptureButton?.parentElement?.appendChild(fullResetButton);
    fullResetButton.addEventListener('click', async () => {
        const confirmed = await new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.6);padding:16px;';
            overlay.innerHTML = `
                <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="dashbridgeResetTitle" style="width:min(420px,100%);border:1px solid var(--text,#111827);">
                    <div class="modal-header"><h4 id="dashbridgeResetTitle">Полная очистка DashBridge</h4></div>
                    <p style="margin:0;color:var(--text-muted);line-height:1.45;">Будут удалены все настройки, профили, ссылки и Jira worklogs. Это действие нельзя отменить.</p>
                    <div class="modal-actions" style="justify-content:flex-end;">
                        <button type="button" class="btn" data-action="confirm" style="background:var(--danger,#dc2626);border:1px solid #991b1b;color:var(--text-on-primary,#fff);">Полная очистка</button>
                        <button type="button" class="btn btn-cancel" data-action="cancel" style="border:1px solid var(--border,#cbd5e1);">Отмена</button>
                    </div>
                </div>`;
            const close = value => { overlay.remove(); resolve(value); };
            overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
            overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
            overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
            document.body.appendChild(overlay);
            overlay.querySelector('[data-action="cancel"]').focus();
        });
        if (!confirmed) return;
        try {
            fullResetButton.disabled = true;
            await Promise.all([
                chrome.storage.sync.clear(),
                chrome.storage.local.clear(),
                chrome.storage.session ? chrome.storage.session.clear() : Promise.resolve()
            ]);
            localStorage.clear();
            await chrome.storage.sync.set(getGrafanaSettingsDefaults());
            location.reload();
        } catch (error) {
            console.error('DashBridge full reset failed:', error);
            setStatus('Не удалось очистить данные расширения', true);
            fullResetButton.disabled = false;
        }
    });
    if (guiCaptureButton) {
        guiCaptureButton.addEventListener('click', async () => {
            try {
                guiCaptureButton.disabled = true;
                const count = await collectGuiScreenshots();
                setStatus(`Готово: ${count} снимков упакованы в ZIP.`);
            } catch (error) {
                console.error('GUI screenshot collection error:', error);
                setStatus(error.message || 'Не удалось собрать скриншоты интерфейса', true);
            } finally {
                guiCaptureButton.disabled = false;
            }
        });
    }

    const testRunnerButton = document.getElementById('grafanaDebugTestRunnerBtn');
    if (testRunnerButton) {
        testRunnerButton.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('pages/test-runner/test-runner.html') });
        });
    }
});
