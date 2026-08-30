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
                const safeUrl = () => {
                    const url = new URL(location.href);
                    for (const key of [...url.searchParams.keys()]) {
                        if (/(token|auth|password|secret|apikey|api_key)/i.test(key)) url.searchParams.set(key, '[redacted]');
                    }
                    return url.toString();
                };
                const panelSelectors = '[data-panelid], [data-viz-panel-key], .react-grid-item, .panel-container';
                const panels = Array.from(document.querySelectorAll(panelSelectors));
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
                const panelInfo = (panel) => {
                    const canvases = Array.from(panel.querySelectorAll('canvas'));
                    const legacy = canvases.some(canvas => canvas.classList.contains('flot-base') || canvas.classList.contains('flot-overlay'));
                    const modern = canvases.some(canvas => !canvas.classList.contains('flot-base') && !canvas.classList.contains('flot-overlay'));
                    const legendRows = Array.from(panel.querySelectorAll('tr[class*="LegendRow"], .graph-legend-series'))
                        .filter(row => row.getBoundingClientRect().width > 1 && row.getBoundingClientRect().height > 1);
                    return {
                        panelId: panel.getAttribute('data-panelid') || null,
                        title: titleOf(panel),
                        tag: panel.tagName,
                        className: className(panel),
                        rect: rect(panel),
                        visible: panel.getClientRects().length > 0 && getComputedStyle(panel).visibility !== 'hidden',
                        chartType: legacy ? 'Flot' : modern ? 'canvas/uPlot-or-plugin' : 'no-canvas',
                        canvasCount: canvases.length,
                        canvas: canvases.slice(0, 6).map(canvas => ({ tag: canvas.tagName, className: className(canvas), rect: rect(canvas), width: canvas.width, height: canvas.height })),
                        legend: { visibleRows: legendRows.length, sample: legendRows.slice(0, 3).map(row => row.textContent.trim().replace(/\s+/g, ' ').slice(0, 240)) }
                    };
                };
                const activePanel = document.querySelector('.react-grid-item--fullscreen, .panel-in-fullscreen, .panel-fullscreen, [class*="fullscreen"]')
                    || uniquePanels.find(panel => panel.querySelector('canvas'))
                    || null;
                const graphStructure = () => {
                    if (!activePanel) return { error: 'Панель с графиком не найдена' };
                    const canvas = activePanel.querySelector('canvas');
                    const chain = [];
                    for (let element = canvas; element && chain.length < 10; element = element.parentElement) {
                        const style = getComputedStyle(element);
                        chain.push({ tag: element.tagName, className: className(element), rect: rect(element), display: style.display, position: style.position, overflow: style.overflow, padding: style.padding });
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
                return {
                    reportType: 'full',
                    environment,
                    activePanel: activePanel ? panelInfo(activePanel) : null,
                    dashboard,
                    graph: graphStructure()
                };
            }
        });
        if (!results[0] || !results[0].result) throw new Error('Grafana не вернула диагностические данные');
        return results[0].result;
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
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.6);padding:16px;';
            overlay.innerHTML = `
                <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="dashbridgeResetTitle" style="width:min(420px,100%);border:1px solid var(--text,#111827);">
                    <div class="modal-header"><h4 id="dashbridgeResetTitle">Полная очистка DashBridge</h4></div>
                    <p style="margin:0;color:var(--text-muted);line-height:1.45;">Будут удалены все настройки, профили, ссылки и Jira worklogs. Это действие нельзя отменить.</p>
                    <div class="modal-actions" style="justify-content:flex-end;">
                        <button type="button" class="btn btn-cancel" data-action="cancel" style="border:1px solid var(--border,#cbd5e1);">Отмена</button>
                        <button type="button" class="btn" data-action="confirm" style="background:var(--danger,#dc2626);border:1px solid #991b1b;color:var(--text-on-primary,#fff);">Полная очистка</button>
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
