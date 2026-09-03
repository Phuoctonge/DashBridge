(() => {
    'use strict';

    const create = context => {
        const {
            isDashboardIframe, extensionOrigin, isPanelMenuDomainAllowed,
            registerRuntimeCleanup, getPanelStateKey, restorePanelVisualState,
            refreshSelectedPanelData, openPanelSettings,
            readPanelCaptureState, syncPanelCaptureToggle, setPanelCapturePrepared,
            getPanelCaptureTitle, runPanelCapture
        } = context;

        // BUG-H fix: сохраняем ссылку на MutationObserver меню, чтобы отключать его при removePanelMenus.
        let panelMenuObserver = null;
        let panelMenuFrame = 0;
        const removePanelMenus = () => {
            document.querySelectorAll('.dashbridge-panel-menu-host').forEach(host => host.remove());
            panelMenuObserver?.disconnect();
            panelMenuObserver = null;
            if (panelMenuFrame) cancelAnimationFrame(panelMenuFrame);
            panelMenuFrame = 0;
        };
        let placePanelMenus = null;
        const panelMenuExcludedPluginIds = new Set(['stat', 'michaeldmoore-multistat-panel']);
        const getPanelPluginId = (panel, header = null) => {
            const candidates = [
                panel,
                header,
                ...Array.from(header?.querySelectorAll?.('button,[data-testid],h1,h2,h6') || []).slice(0, 40)
            ].filter(Boolean);
            const pluginIds = [];
            const add = value => {
                const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
                if (id && !pluginIds.includes(id)) pluginIds.push(id);
            };
    
            for (const element of candidates) {
                const fiberKey = Object.getOwnPropertyNames(element).find(key =>
                    key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
                );
                for (let fiber = fiberKey && element[fiberKey], depth = 0;
                    fiber && depth < 40; depth += 1, fiber = fiber.return) {
                    const props = fiber.memoizedProps || fiber.pendingProps;
                    if (!props || typeof props !== 'object') continue;
                    add(props.panel?.type);
                    add(props.panel?.pluginId);
                    add(props.plugin?.meta?.id);
                    add(props.panelPlugin?.meta?.id);
                    add(props.model?.type);
                    add(props.pluginId);
                }
            }
            return pluginIds.find(id => panelMenuExcludedPluginIds.has(id)) || pluginIds[0] || '';
        };
        const getPanelAnalysisTitle = (panel, header) => {
            const selector = '[data-testid="panel title"], .panel-title-text, [class*="panel-title" i], h6[title], h2[title], h6, h2';
            const title = header?.querySelector?.(selector) || panel?.querySelector?.(selector);
            return title?.getAttribute?.('title') || title?.textContent?.trim() || '';
        };
        const readPanelAnalysisSettings = () => {
            try {
                const parsed = JSON.parse(document.documentElement.dataset.dashbridgeGrafanaAnalysisSettings || '{}');
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return {};
            }
        };
        const { analysisThreshold, formatPanelAnalysisCopy } = window.DashBridgeGrafanaPanelAnalysis;
        const startEmbeddedPanelAnalysis = (panel, type, title, requestId) => {
            const analysis = window.DashBridgeGrafanaPanelAnalysis;
            if (!isDashboardIframe || !analysis || !panel || !['cpu', 'ram'].includes(type) || !requestId) return;
            const settings = readPanelAnalysisSettings();
            const postUpdate = payload => {
                if (session.cancelled) return;
                window.parent.postMessage({
                    action: 'dashbridgePanelAnalysisUpdate', requestId, type, title, ...payload
                }, extensionOrigin);
            };
            const prepareItems = items => (Array.isArray(items) ? items : []).slice(0, 5000).map(item => ({
                server: String(item?.server || '').substring(0, 500),
                value: Number(item?.value)
            })).filter(item => item.server && Number.isFinite(item.value));
            const prepareSnapshot = snapshot => {
                const prepareMode = items => {
                    const safeItems = prepareItems(items);
                    return {
                        items: safeItems,
                        copyAll: formatPanelAnalysisCopy(safeItems, type, false, settings),
                        copyTop: formatPanelAnalysisCopy(safeItems, type, true, settings)
                    };
                };
                return {
                    period: prepareMode(snapshot?.period),
                    latest: prepareMode(snapshot?.latest),
                    warning: analysisThreshold(settings, type, 'warning'),
                    critical: analysisThreshold(settings, type, 'critical')
                };
            };
            const acceptSnapshot = snapshot => {
                if (!snapshot?.ok || session.cancelled) return;
                postUpdate({ status: 'ready', snapshot: prepareSnapshot(snapshot), notice: '' });
            };
            const publishCurrentPanel = () => {
                if (session.cancelled) return;
                const period = analysis.analyzePanel({ panel, type, mode: 'period', settings });
                const latest = analysis.analyzePanel({ panel, type, mode: 'latest', settings });
                if (!period.ok && !latest.ok) {
                    postUpdate({ status: 'empty', notice: '' });
                    return;
                }
                postUpdate({
                    status: 'ready',
                    notice: '',
                    snapshot: prepareSnapshot({
                        period: period.ok ? period.items : [],
                        latest: latest.ok ? latest.items : []
                    })
                });
            };
            const session = {
                requestId,
                type,
                settings,
                signatures: [],
                acceptAfter: performance.now(),
                cancelled: false,
                onSnapshot: acceptSnapshot,
                cancel() {
                    this.cancelled = true;
                    if (window.__dashbridgePanelAnalysisCaptureSession === this) {
                        window.__dashbridgePanelAnalysisCaptureSession = null;
                    }
                }
            };
            window.__dashbridgePanelAnalysisCaptureSession?.cancel?.('replaced');
            window.__dashbridgePanelAnalysisCaptureSession = session;
            publishCurrentPanel();
        };
        const openPanelAnalysis = (panel, type, title) => {
            const analysis = window.DashBridgeGrafanaPanelAnalysis;
            if (!analysis || !panel || !['cpu', 'ram'].includes(type)) return;
            document.dispatchEvent(new CustomEvent('dashbridgeAnalyticsDirectAction', {
                detail: { action: 'analysis_opened' }
            }));
            window.__dashbridgePanelAnalysisCaptureSession?.cancel?.('replaced');
            window.__dashbridgePanelAnalysisCaptureSession = null;
            document.querySelector('.dashbridge-panel-analysis-overlay')?.remove();
            const settings = readPanelAnalysisSettings();
            const create = (tag, className = '', text = '') => {
                const node = document.createElement(tag);
                if (className) node.className = className;
                if (text) node.textContent = text;
                return node;
            };
            const overlay = create('div', 'dashbridge-panel-analysis-overlay');
            const themeRoot = document.documentElement;
            const themeBody = document.body;
            const darkTheme = themeRoot?.getAttribute('data-theme') === 'dark'
                || themeBody?.getAttribute('data-theme') === 'dark'
                || themeRoot?.classList?.contains('theme-dark')
                || themeBody?.classList?.contains('theme-dark');
            overlay.classList.toggle('dashbridge-panel-analysis-dark', darkTheme);
            const dialog = create('section', 'dashbridge-panel-analysis-dialog');
            dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
            const header = create('header', 'dashbridge-panel-analysis-header');
            const heading = create('h3', '', `Анализ ${type.toUpperCase()} — ${analysis.baseTitle(title)}`);
            const close = create('button', 'dashbridge-panel-analysis-close');
            close.type = 'button'; close.title = 'Закрыть'; close.setAttribute('aria-label', close.title);
            const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            closeIcon.setAttribute('viewBox', '0 0 20 20');
            closeIcon.setAttribute('aria-hidden', 'true');
            closeIcon.setAttribute('focusable', 'false');
            const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            closePath.setAttribute('d', 'M5 5l10 10M15 5L5 15');
            closeIcon.appendChild(closePath);
            close.appendChild(closeIcon);
            header.append(heading, close);
            const modes = create('div', 'dashbridge-panel-analysis-modes');
            const period = create('button', 'active', 'Максимум за период');
            const latest = create('button', '', 'Последнее значение');
            period.type = latest.type = 'button';
            modes.append(period, latest);
            const status = create('div', 'dashbridge-panel-analysis-status');
            const output = create('div', 'dashbridge-panel-analysis-output');
            const actions = create('div', 'dashbridge-panel-analysis-copy-actions');
            const copyAll = create('button', '', 'Скопировать список');
            const copyTop = create('button', '', 'Скопировать TOP-3');
            copyAll.type = copyTop.type = 'button'; actions.append(copyAll, copyTop); actions.hidden = true;
            dialog.append(header, modes, status, output, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
            let currentItems = [];
            let selectedMode = 'period';
            let snapshot = null;
            let loading = true;
            let notice = '';
            let captureTimeout = 0;
            let session = null;
            const metricNotFoundText = () => type === 'cpu'
                ? 'Серии Idle или Load (calc) в этой панели не найдены.'
                : 'Серии Total/Available или Used % (calc) в этой панели не найдены.';
            const render = () => {
                period.classList.toggle('active', selectedMode === 'period');
                latest.classList.toggle('active', selectedMode === 'latest');
                period.setAttribute('aria-pressed', String(selectedMode === 'period'));
                latest.setAttribute('aria-pressed', String(selectedMode === 'latest'));
                output.replaceChildren(); status.textContent = '';
                currentItems = snapshot?.[selectedMode] || [];
                actions.hidden = !currentItems.length;
                if (!snapshot) {
                    status.textContent = loading ? 'Загрузка данных выбранной панели…' : (notice || metricNotFoundText());
                    return;
                }
                if (!currentItems.length) {
                    status.textContent = notice || metricNotFoundText();
                    return;
                }
                const table = create('table', 'dashbridge-panel-analysis-table');
                const head = create('thead'); const headRow = create('tr');
                headRow.append(create('th', '', 'Сервер'), create('th', '', `${type.toUpperCase()} (%)`)); head.appendChild(headRow);
                const body = create('tbody');
                const warn = analysisThreshold(settings, type, 'warning');
                const critical = analysisThreshold(settings, type, 'critical');
                currentItems.forEach(item => {
                    const row = create('tr'); const serverCell = create('td'); const valueCell = create('td');
                    serverCell.textContent = item.server;
                    valueCell.textContent = `${item.value.toFixed(2)}%`;
                    valueCell.className = item.value >= critical ? 'critical' : (item.value >= warn ? 'warning' : 'normal');
                    row.append(serverCell, valueCell); body.appendChild(row);
                });
                table.append(head, body); output.appendChild(table);
                const progress = loading ? ' Обновление данных…' : '';
                status.textContent = `Найдено серверов: ${currentItems.length}.${progress}${notice ? ` ${notice}` : ''}`;
            };
            const useDomFallback = message => {
                if (!overlay.isConnected) return;
                const periodResult = analysis.analyzePanel({ panel, type, mode: 'period', settings });
                const latestResult = analysis.analyzePanel({ panel, type, mode: 'latest', settings });
                loading = false;
                notice = message;
                if (periodResult.ok || latestResult.ok) {
                    snapshot = {
                        ok: true,
                        type,
                        receivedAt: Date.now(),
                        period: periodResult.ok ? periodResult.items : [],
                        latest: latestResult.ok ? latestResult.items : [],
                        source: 'dom'
                    };
                } else if (snapshot) {
                    notice = 'Не удалось получить новые данные; оставлены предыдущие.';
                }
                render();
            };
            const acceptSnapshot = nextSnapshot => {
                if (!overlay.isConnected || !nextSnapshot?.ok) return;
                clearTimeout(captureTimeout);
                snapshot = nextSnapshot;
                loading = false;
                notice = '';
                render();
            };
            const loadSnapshot = () => {
                if (!session || session.cancelled || !overlay.isConnected) return;
                clearTimeout(captureTimeout);
                loading = true;
                notice = '';
                session.acceptAfter = performance.now();
                render();
                captureTimeout = setTimeout(() => {
                    if (loading) useDomFallback('Источник ответа Grafana недоступен; показаны данные панели.');
                }, 10000);
                let refreshMethod = '';
                try { refreshMethod = refreshSelectedPanelData(panel); } catch { refreshMethod = 'refresh-failed'; }
                if (/unavailable|failed/.test(refreshMethod)) {
                    clearTimeout(captureTimeout);
                    useDomFallback('Локальное обновление панели недоступно; показаны текущие данные панели.');
                }
            };
            const copy = async (button, topOnly) => {
                if (!currentItems.length) return;
                const original = button.textContent;
                try {
                    await navigator.clipboard.writeText(formatPanelAnalysisCopy(currentItems, type, topOnly, settings));
                    document.dispatchEvent(new CustomEvent('dashbridgeAnalyticsDirectAction', {
                        detail: { action: topOnly ? 'analysis_copy_top3' : 'analysis_copy_all' }
                    }));
                    button.textContent = 'Скопировано';
                } catch {
                    button.textContent = 'Ошибка копирования';
                }
                setTimeout(() => { if (button.isConnected) button.textContent = original; }, 2000);
            };
            const publishMode = mode => {
                document.dispatchEvent(new CustomEvent('dashbridgeAnalyticsDirectAction', {
                    detail: { action: 'analysis_mode_changed', mode }
                }));
            };
            period.addEventListener('click', () => {
                selectedMode = 'period'; render(); publishMode('period');
            });
            latest.addEventListener('click', () => {
                selectedMode = 'latest'; render(); publishMode('latest');
            });
            copyAll.addEventListener('click', () => { void copy(copyAll, false); });
            copyTop.addEventListener('click', () => { void copy(copyTop, true); });
            const dispose = () => {
                clearTimeout(captureTimeout);
                if (session) session.cancel('dialog-closed');
                if (window.__dashbridgePanelAnalysisCaptureSession === session) {
                    window.__dashbridgePanelAnalysisCaptureSession = null;
                }
                overlay.remove();
            };
            close.addEventListener('click', dispose);
            overlay.addEventListener('click', event => { if (event.target === overlay) dispose(); });
            render();
            void (async () => {
                let signatures = [];
                try {
                    const root = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
                    signatures = await window.DashBridgeGrafanaVisualEngine?.getPanelQuerySignaturesAsync?.({
                        root,
                        panelId: getPanelStateKey(panel) || null
                    }) || [];
                } catch { signatures = []; }
                if (!overlay.isConnected) return;
                if (!isDashboardIframe && !signatures.length) {
                    useDomFallback('Не удалось определить запрос выбранной панели; показаны текущие данные панели.');
                    return;
                }
                session = {
                    type,
                    settings,
                    signatures,
                    acceptAfter: performance.now(),
                    cancelled: false,
                    onSnapshot: acceptSnapshot,
                    cancel() { this.cancelled = true; }
                };
                window.__dashbridgePanelAnalysisCaptureSession?.cancel?.('replaced');
                window.__dashbridgePanelAnalysisCaptureSession = session;
                loadSnapshot();
            })();
        };
    
        const installPanelMenu = () => {
            if (!isPanelMenuDomainAllowed()) return;
            if (placePanelMenus) {
                placePanelMenus();
                return;
            }
            let style = document.getElementById('dashbridge-panel-menu-style');
            if (!style) {
                style = document.createElement('style');
                style.id = 'dashbridge-panel-menu-style';
                style.textContent = `
                .dashbridge-panel-menu-host { position: relative !important; display: inline-flex !important; align-items: center !important; }
                .dashbridge-panel-menu-trigger,.dashbridge-panel-capture-action,.dashbridge-panel-save-action,.dashbridge-panel-analysis-action { display:none; height:32px; padding:0; border:0; border-radius:4px; background:transparent; color:inherit; cursor:pointer; line-height:1; transition:background-color .12s ease,color .12s ease,box-shadow .12s ease; }
                .dashbridge-panel-menu-trigger { width:28px; height:32px; }
                .dashbridge-panel-capture-action,.dashbridge-panel-save-action,.dashbridge-panel-analysis-action { width:30px; }
                [data-viz-panel-key]:hover .dashbridge-panel-menu-trigger,[data-viz-panel-key]:hover .dashbridge-panel-capture-action,[data-viz-panel-key]:hover .dashbridge-panel-save-action,[data-viz-panel-key]:hover .dashbridge-panel-analysis-action,.react-grid-item:hover .dashbridge-panel-menu-trigger,.react-grid-item:hover .dashbridge-panel-capture-action,.react-grid-item:hover .dashbridge-panel-save-action,.react-grid-item:hover .dashbridge-panel-analysis-action,.panel-container:hover .dashbridge-panel-menu-trigger,.panel-container:hover .dashbridge-panel-capture-action,.panel-container:hover .dashbridge-panel-save-action,.panel-container:hover .dashbridge-panel-analysis-action { display: inline-flex; align-items: center; justify-content: center; }
                .dashbridge-panel-capture-action:hover,.dashbridge-panel-save-action:hover,.dashbridge-panel-analysis-action:hover { background:rgba(127,127,127,.16); }
                .dashbridge-panel-capture-action:focus-visible,.dashbridge-panel-save-action:focus-visible,.dashbridge-panel-analysis-action:focus-visible { outline:2px solid #5794f2; outline-offset:-2px; }
                .dashbridge-panel-capture-icon { display:block; width:20px; height:20px; overflow:visible; }
                .dashbridge-panel-capture-toggle-active { color:#5794f2 !important; background:transparent !important; box-shadow:none !important; }
                .dashbridge-panel-capture-toggle-active:hover { background:rgba(127,127,127,.16) !important; }
                .dashbridge-panel-capture-action:disabled { opacity:.55; cursor:progress; }
                .dashbridge-panel-capture-success { color:#10b981 !important; }
                .dashbridge-panel-capture-error { color:#ef4444 !important; }
                .dashbridge-panel-capture-hidden { opacity:0 !important; pointer-events:none !important; }
                html.dashbridge-panel-capture-mode [role="tooltip"],html.dashbridge-panel-capture-mode .graph-tooltip,html.dashbridge-panel-capture-mode .u-tooltip,html.dashbridge-panel-capture-mode .u-cursor-x,html.dashbridge-panel-capture-mode .u-cursor-y,html.dashbridge-panel-capture-mode .u-cursor-pt { visibility:hidden !important; opacity:0 !important; }
                html.dashbridge-panel-capture-mode [data-dashbridge-threshold-highlights] { z-index:2147483646 !important; }
                .dashbridge-panel-menu { display: none; }
                .dashbridge-panel-menu.open { display: block; }
                .dashbridge-panel-menu button { display: block; width: 100%; padding: 7px 9px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
                .dashbridge-panel-menu button:hover { background: rgba(127,127,127,.16); }
                .dashbridge-panel-analysis-overlay { --analysis-bg:#f8fafc; --analysis-card:#fff; --analysis-raised:#f1f5f9; --analysis-text:#182033; --analysis-muted:#667085; --analysis-border:#cbd5e1; --analysis-border-soft:#e2e8f0; --analysis-primary:#4361e8; --analysis-primary-hover:#3452cf; --analysis-success:#15803d; --analysis-warning:#b45309; --analysis-danger:#dc2626; position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; background:rgba(15,23,42,.58); color:var(--analysis-text); font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
                .dashbridge-panel-analysis-overlay.dashbridge-panel-analysis-dark { --analysis-bg:#0f172a; --analysis-card:#1e293b; --analysis-raised:#334155; --analysis-text:#f1f5f9; --analysis-muted:#cbd5e1; --analysis-border:#475569; --analysis-border-soft:#334155; --analysis-primary:#60a5fa; --analysis-primary-hover:#3b82f6; --analysis-success:#4ade80; --analysis-warning:#fbbf24; --analysis-danger:#f87171; }
                .dashbridge-panel-analysis-dialog,.dashbridge-panel-analysis-dialog * { box-sizing:border-box; }
                .dashbridge-panel-analysis-dialog { width:min(620px,calc(100vw - 40px)); max-height:calc(100dvh - 40px); min-height:0; display:flex; flex-direction:column; gap:14px; overflow:hidden; padding:20px; border:1px solid var(--analysis-border); border-radius:8px; background:var(--analysis-bg); color:var(--analysis-text); box-shadow:0 20px 25px -5px rgba(0,0,0,.28),0 8px 10px -6px rgba(0,0,0,.18); }
                .dashbridge-panel-analysis-header { min-height:34px; display:flex !important; align-items:center; justify-content:space-between; gap:16px; }
                .dashbridge-panel-analysis-header h3 { min-width:0; margin:0; overflow:hidden; color:var(--analysis-text); font:700 18px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif; text-overflow:ellipsis; white-space:nowrap; }
                .dashbridge-panel-analysis-close { width:32px; height:32px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; padding:0; border:1px solid var(--analysis-border); border-radius:6px; background:transparent; color:var(--analysis-muted); cursor:pointer; transition:background-color .15s,border-color .15s,color .15s; }
                .dashbridge-panel-analysis-close svg { width:17px; height:17px; display:block; fill:none; stroke:currentColor; stroke-width:1.75; stroke-linecap:round; }
                .dashbridge-panel-analysis-close:hover { border-color:var(--analysis-primary); background:var(--analysis-raised); color:var(--analysis-primary); }
                .dashbridge-panel-analysis-close:focus-visible,.dashbridge-panel-analysis-modes button:focus-visible,.dashbridge-panel-analysis-copy-actions button:focus-visible { outline:2px solid var(--analysis-primary); outline-offset:2px; }
                .dashbridge-panel-analysis-modes { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding-bottom:14px; border-bottom:1px solid var(--analysis-border); }
                .dashbridge-panel-analysis-copy-actions { display:flex; justify-content:flex-end; gap:8px; padding-top:14px; border-top:1px solid var(--analysis-border); }
                .dashbridge-panel-analysis-modes button,.dashbridge-panel-analysis-copy-actions button { min-height:36px; padding:8px 12px; border:1px solid var(--analysis-border); border-radius:6px; background:var(--analysis-card); color:var(--analysis-text); font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif; cursor:pointer; transition:background-color .15s,border-color .15s,color .15s; }
                .dashbridge-panel-analysis-modes button:hover,.dashbridge-panel-analysis-copy-actions button:hover { border-color:var(--analysis-primary); color:var(--analysis-primary); }
                .dashbridge-panel-analysis-modes button:disabled { opacity:.55; cursor:progress; }
                .dashbridge-panel-analysis-modes button.active { border-color:var(--analysis-primary); background:var(--analysis-primary); color:#fff; }
                .dashbridge-panel-analysis-modes button.active:hover { background:var(--analysis-primary-hover); color:#fff; }
                .dashbridge-panel-analysis-status { min-height:18px; color:var(--analysis-muted); font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
                .dashbridge-panel-analysis-output { min-height:0; overflow:auto; border:1px solid var(--analysis-border); border-radius:8px; background:var(--analysis-card); }
                .dashbridge-panel-analysis-output:empty { display:none; }
                .dashbridge-panel-analysis-table { width:100%; border-collapse:collapse; color:var(--analysis-text); }
                .dashbridge-panel-analysis-table th,.dashbridge-panel-analysis-table td { padding:9px 12px; border-bottom:1px solid var(--analysis-border-soft); text-align:left; }
                .dashbridge-panel-analysis-table th { position:sticky; top:0; z-index:1; background:var(--analysis-raised); color:var(--analysis-muted); font-size:11.5px; font-weight:700; letter-spacing:.025em; }
                .dashbridge-panel-analysis-table tbody tr:hover { background:color-mix(in srgb,var(--analysis-primary) 7%,transparent); }
                .dashbridge-panel-analysis-table tbody tr:last-child td { border-bottom:0; }
                .dashbridge-panel-analysis-table th:last-child,.dashbridge-panel-analysis-table td:last-child { text-align:right; font-weight:700; }
                .dashbridge-panel-analysis-table .normal { color:var(--analysis-success); } .dashbridge-panel-analysis-table .warning { color:var(--analysis-warning); } .dashbridge-panel-analysis-table .critical { color:var(--analysis-danger); }
                @media (max-width:560px) { .dashbridge-panel-analysis-overlay { padding:12px; }.dashbridge-panel-analysis-dialog { width:calc(100vw - 24px); max-height:calc(100dvh - 24px); padding:16px; }.dashbridge-panel-analysis-copy-actions button { flex:1 1 0; } }
                `;
                document.documentElement.appendChild(style);
            }
            const createPanelCaptureIcon = kind => {
                const svgNamespace = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNamespace, 'svg');
                Object.entries({
                    class: 'dashbridge-panel-capture-icon', viewBox: '0 0 24 24', fill: 'none',
                    stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round',
                    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
                }).forEach(([name, value]) => svg.setAttribute(name, value));
                const shapes = {
                    compact: [
                        ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
                        ['path', { d: 'M8.5 15.5l7-7', 'stroke-width': '2.25' }],
                        ['polygon', { points: '12,7.25 17,7.25 17,12.25', fill: 'currentColor', stroke: 'none' }],
                        ['polygon', { points: '12,16.75 7,16.75 7,11.75', fill: 'currentColor', stroke: 'none' }]
                    ],
                    download: [
                        ['path', { d: 'M4.25 3h12.5L21 7.25v12.5A1.25 1.25 0 0 1 19.75 21H4.25A1.25 1.25 0 0 1 3 19.75V4.25A1.25 1.25 0 0 1 4.25 3Z' }],
                        ['path', { d: 'M7 3v6.25h9.5V3M7.25 21v-7.25h9.5V21' }],
                        ['path', { d: 'M14 5.25v2', 'stroke-width': '2.25' }]
                    ],
                    copy: [
                        ['path', { d: 'M16.5 6V4.75A1.75 1.75 0 0 0 14.75 3h-10A1.75 1.75 0 0 0 3 4.75v10a1.75 1.75 0 0 0 1.75 1.75H6' }],
                        ['rect', { x: '6.5', y: '6.5', width: '14.5', height: '14.5', rx: '2' }],
                        ['circle', { cx: '11', cy: '11', r: '1.25' }],
                        ['path', { d: 'm8 18 3.5-3.5 2.5 2.25 1.8-1.75 3.2 3' }]
                    ],
                    analysis: [
                        ['path', { d: 'M4 19V9M10 19V5M16 19v-7M3 19h18' }],
                        ['circle', { cx: '19', cy: '6', r: '2.5' }]
                    ],
                    bridge: [
                        ['rect', { x: '3.5', y: '3.5', width: '7', height: '7', rx: '1' }],
                        ['rect', { x: '13.5', y: '3.5', width: '7', height: '7', rx: '1' }],
                        ['rect', { x: '3.5', y: '13.5', width: '7', height: '7', rx: '1' }],
                        ['path', { d: 'M17 14v6M14 17h6', 'stroke-width': '2' }]
                    ]
                };
                (shapes[kind] || []).forEach(([tag, attributes]) => {
                    const shape = document.createElementNS(svgNamespace, tag);
                    Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
                    svg.appendChild(shape);
                });
                return svg;
            };
            const syncPanelAnalysisAction = (host, panel, header) => {
                const analysis = window.DashBridgeGrafanaPanelAnalysis;
                const type = analysis?.classifyTitle(getPanelAnalysisTitle(panel, header), readPanelAnalysisSettings()) || null;
                const existing = host.querySelector('.dashbridge-panel-analysis-action');
                if (!type) {
                    existing?.remove();
                    return;
                }
                const button = existing || document.createElement('button');
                button.className = 'dashbridge-panel-analysis-action';
                button.type = 'button'; button.dataset.analysisType = type;
                button.title = `Анализ ${type.toUpperCase()}`; button.setAttribute('aria-label', button.title);
                if (!existing) {
                    button.appendChild(createPanelCaptureIcon('analysis'));
                    button.onclick = event => {
                        event.stopPropagation();
                        const currentType = button.dataset.analysisType;
                        openPanelAnalysis(panel, currentType, getPanelAnalysisTitle(panel, header));
                    };
                    host.insertBefore(button, host.querySelector('.dashbridge-panel-menu-trigger'));
                }
            };
            placePanelMenus = () => {
                if (!isPanelMenuDomainAllowed()) return;
                const headersByPanel = new Map();
                document.querySelectorAll('[data-testid*="Panel header"], .panel-header, [class*="panel-header"]').forEach(header => {
                    const panel = header.closest('[data-viz-panel-key], [data-panelid], .react-grid-item, .panel-container');
                    if (!panel) return;
                    const candidates = headersByPanel.get(panel) || [];
                    candidates.push(header);
                    headersByPanel.set(panel, candidates);
                });
                headersByPanel.forEach((candidates, panel) => {
                    // Loading controls such as Grafana's "Cancel query" can add a
                    // nested element whose generated class also contains
                    // "panel-header". Treat it as part of the same panel header,
                    // not as a second toolbar mount point.
                    const panelHosts = [...panel.querySelectorAll('.dashbridge-panel-menu-host')];
                    const deepest = nodes => nodes.reduce((selected, candidate) =>
                        selected.contains(candidate) ? candidate : selected, nodes[0]);
                    const mountedHeader = candidates.find(candidate =>
                        panelHosts.some(host => candidate.contains(host)));
                    const explicitHeaders = candidates.filter(candidate =>
                        /panel header/i.test(candidate.getAttribute('data-testid') || ''));
                    const header = mountedHeader || deepest(explicitHeaders.length ? explicitHeaders : candidates);
                    const existingHost = panelHosts.find(host => header.contains(host)) || null;
                    panelHosts.forEach(host => { if (host !== existingHost) host.remove(); });
                    if (panelMenuExcludedPluginIds.has(getPanelPluginId(panel, header))) {
                        existingHost?.remove();
                        return;
                    }
                    if (existingHost) {
                        syncPanelCaptureToggle(existingHost.querySelector('.dashbridge-panel-capture-toggle'), !!readPanelCaptureState(panel).capturePrepared);
                        syncPanelAnalysisAction(existingHost, panel, header);
                        restorePanelVisualState(panel);
                        return;
                    }
                    const host = document.createElement('span');
                    host.className = 'dashbridge-panel-menu-host';
                    const trigger = document.createElement('button');
                    trigger.className = 'dashbridge-panel-menu-trigger';
                    trigger.type = 'button'; trigger.title = 'DashBridge';
                    const iconUrl = document.documentElement.dataset.dashbridgeIconUrl;
                    if (iconUrl) {
                        const icon = document.createElement('img');
                        icon.src = iconUrl; icon.alt = ''; icon.width = 16; icon.height = 16;
                        icon.style.cssText = 'display:block;width:16px;height:16px;';
                        trigger.append(icon);
                    } else trigger.textContent = '✦';
                    trigger.onclick = event => { event.stopPropagation(); openPanelSettings(panel); };
                    const preparedToggle = document.createElement('button');
                    preparedToggle.className = 'dashbridge-panel-capture-action dashbridge-panel-capture-toggle';
                    preparedToggle.type = 'button';
                    preparedToggle.appendChild(createPanelCaptureIcon('compact'));
                    syncPanelCaptureToggle(preparedToggle, !!readPanelCaptureState(panel).capturePrepared);
                    preparedToggle.onclick = event => {
                        event.stopPropagation();
                        const enabled = setPanelCapturePrepared(panel, !readPanelCaptureState(panel).capturePrepared);
                        syncPanelCaptureToggle(preparedToggle, enabled);
                    };
                    const download = document.createElement('button');
                    download.className = 'dashbridge-panel-capture-action'; download.type = 'button';
                    download.title = 'Сохранить снимок панели в PNG'; download.setAttribute('aria-label', download.title); download.appendChild(createPanelCaptureIcon('download'));
                    download.onclick = event => { event.stopPropagation(); void runPanelCapture(panel, 'download', download, host); };
                    const copy = document.createElement('button');
                    copy.className = 'dashbridge-panel-capture-action'; copy.type = 'button';
                    copy.title = 'Скопировать снимок панели в буфер'; copy.setAttribute('aria-label', copy.title); copy.appendChild(createPanelCaptureIcon('copy'));
                    copy.onclick = event => { event.stopPropagation(); void runPanelCapture(panel, 'copy', copy, host); };
                    const saveToDashBridge = document.createElement('button');
                    saveToDashBridge.className = 'dashbridge-panel-save-action'; saveToDashBridge.type = 'button';
                    saveToDashBridge.title = 'Сохранить в DashBridge'; saveToDashBridge.setAttribute('aria-label', saveToDashBridge.title);
                    saveToDashBridge.appendChild(createPanelCaptureIcon('bridge'));
                    saveToDashBridge.onclick = event => {
                        event.stopPropagation();
                        let panelId = String(getPanelStateKey(panel) || '').replace(/^panel-/, '');
                        if (!/^\d+$/.test(panelId)) {
                            try {
                                const pageUrl = new URL(location.href);
                                panelId = String(pageUrl.searchParams.get('viewPanel')
                                    || pageUrl.searchParams.get('panelId') || '').replace(/^panel-/i, '');
                            } catch { panelId = ''; }
                        }
                        if (!/^\d+$/.test(panelId)) return;
                        document.dispatchEvent(new CustomEvent('dashbridgeSavePanelRequest', {
                            detail: { panelId, title: getPanelCaptureTitle(panel) }
                        }));
                    };
                    host.append(preparedToggle, download, copy);
                    if (!isDashboardIframe) host.append(saveToDashBridge);
                    host.append(trigger);
                    syncPanelAnalysisAction(host, panel, header);
                    const nativeMenu = Array.from(header.querySelectorAll('button')).find(button => /menu|more|options/i.test(button.getAttribute('aria-label') || button.title || ''));
                    if (nativeMenu?.parentElement) nativeMenu.parentElement.insertBefore(host, nativeMenu); else header.appendChild(host);
                    restorePanelVisualState(panel);
                });
            };
            placePanelMenus();
            // BUG-H fix: сохраняем observer чтобы его можно было отключить позже.
            panelMenuObserver = new MutationObserver(() => {
                if (panelMenuFrame) return;
                panelMenuFrame = requestAnimationFrame(() => {
                    panelMenuFrame = 0;
                    placePanelMenus();
                });
            });
            panelMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
            const closePanelMenus = () => document.querySelectorAll('.dashbridge-panel-menu.open')
                .forEach(menu => menu.classList.remove('open'));
            document.addEventListener('click', closePanelMenus);
            registerRuntimeCleanup(() => {
                panelMenuObserver?.disconnect();
                panelMenuObserver = null;
                if (panelMenuFrame) cancelAnimationFrame(panelMenuFrame);
                panelMenuFrame = 0;
                document.removeEventListener('click', closePanelMenus);
                document.querySelectorAll('.dashbridge-panel-menu-host').forEach(host => host.remove());
            });
        };
        const syncPanelMenuScope = () => {
            if (isPanelMenuDomainAllowed()) installPanelMenu();
            else removePanelMenus();
        };
        document.addEventListener('dashbridgeGrafanaMenuScopeChanged', syncPanelMenuScope);
        registerRuntimeCleanup(() => document.removeEventListener('dashbridgeGrafanaMenuScopeChanged', syncPanelMenuScope));
        const syncPanelFeatureSettings = () => placePanelMenus?.();
        document.addEventListener('dashbridgeGrafanaAnalysisSettingsChanged', syncPanelFeatureSettings);
        registerRuntimeCleanup(() => document.removeEventListener('dashbridgeGrafanaAnalysisSettingsChanged', syncPanelFeatureSettings));
        syncPanelMenuScope();
    

        return Object.freeze({ startEmbeddedPanelAnalysis });
    };

    window.DashBridgeGrafanaPanelMenuRuntime = Object.freeze({ create });
})();

