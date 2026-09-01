// Runs in Grafana's MAIN world.  The Dashboard sends commands only to the
// iframe that owns a specific card, so these changes never leak to neighbours.
(() => {
    const isDashboardIframe = window.name === 'dashbridge-iframe';
    // The extension's MAIN-world bundle is registered on <all_urls> so it can
    // support user-configured Grafana domains. Do not install fetch/XHR hooks
    // unless this document is an actual Grafana dashboard route.
    const isGrafanaDashboardRoute = /(?:^|\/)d(?:-solo)?(?:\/|$)/.test(location.pathname);
    if (!isGrafanaDashboardRoute && !isDashboardIframe) return;
    // Explicit hot injection is used for Grafana tabs that were already open
    // when their domain was added. Dispose closure-owned resources from the
    // previous generation before installing the current one.
    window.__dashbridgePanelToolsLifecycle?.cleanup?.();
    const runtimeCleanups = new Set();
    const registerRuntimeCleanup = cleanup => {
        runtimeCleanups.add(cleanup);
        return () => runtimeCleanups.delete(cleanup);
    };
    window.__dashbridgePanelToolsLifecycle = {
        cleanup() {
            [...runtimeCleanups].forEach(cleanup => {
                try { cleanup(); } catch (_) { /* Detached Grafana trees are safe to ignore. */ }
            });
            runtimeCleanups.clear();
        }
    };
    registerRuntimeCleanup(() => {
        window.__dashbridgeThresholdReadyObserver?.disconnect();
        window.__dashbridgeThresholdReadyObserver = null;
        window.__dashbridgeChartReadyObserver?.disconnect();
        window.__dashbridgeChartReadyObserver = null;
        window.__dashbridgeChartReadyCancel?.();
        window.__dashbridgeChartReadyCancel = null;
        window.__dashbridgeCalculatedTitleObserver?.disconnect();
        window.__dashbridgeCalculatedTitleObserver = null;
        if (typeof window.__dashbridgeThresholdDataListener === 'function') {
            window.removeEventListener('dashbridgeThresholdDataUpdated', window.__dashbridgeThresholdDataListener);
            window.__dashbridgeThresholdDataListener = null;
        }
        document.querySelector('.dashbridge-panel-settings-overlay')?.remove();
        document.querySelector('.dashbridge-panel-analysis-overlay')?.remove();
        window.__dashbridgePanelAnalysisCaptureSession?.cancel?.('runtime-cleanup');
        window.__dashbridgePanelAnalysisCaptureSession = null;
    });
    // Re-evaluate this module after an extension reload. The document can remain
    // alive while the extension bundle changes; keeping the first closure would
    // leave its old command listener and make a current E2E reset acknowledge
    // stale state. Long-lived network hooks remain idempotent below.
    window.__dashbridgePanelToolsRuntimeLoaded = true;

    const extensionOrigin = new URL(location.ancestorOrigins?.[0] || document.referrer || location.href).origin;

    // Grafana Live cannot establish its WebSocket reliably inside the embedded
    // corporate iframe.  Block only that endpoint in the page's MAIN world so
    // Grafana does not repeatedly log failed connection attempts.
    const NativeWebSocket = window.WebSocket;
    if (isDashboardIframe && NativeWebSocket && !window.__dashbridgeLiveSocketBlocked) {
        window.__dashbridgeLiveSocketBlocked = true;
        const DashBridgeWebSocket = function (url, protocols) {
            if (typeof url === 'string' && url.includes('/api/live/ws')) {
                const socket = new EventTarget();
                Object.assign(socket, {
                    CONNECTING: 0,
                    OPEN: 1,
                    CLOSING: 2,
                    CLOSED: 3,
                    readyState: 0,
                    url,
                    protocol: '',
                    extensions: '',
                    bufferedAmount: 0,
                    binaryType: 'blob',
                    send() { },
                    close() { }
                });
                return socket;
            }
            return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        };
        DashBridgeWebSocket.prototype = NativeWebSocket.prototype;
        Object.setPrototypeOf(DashBridgeWebSocket, NativeWebSocket);
        window.WebSocket = DashBridgeWebSocket;
    }

    // Collects diagnostics in E2E environments
    const debugLog = (...args) => {
        if (window.__dashbridgeDebugLogs) {
            window.__dashbridgeDebugLogs.push(`[${new Date().toISOString()}] [PanelTools] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
        }
    };

    const pushBoundedDiagnosticEvent = (journal, event, limit) => {
        if (window.DashBridgeBoundedJournal?.pushEvent) {
            return window.DashBridgeBoundedJournal.pushEvent(journal, event, limit);
        }
        journal.events = Array.isArray(journal.events) ? journal.events : [];
        journal.totalEvents = Math.max(Number(journal.totalEvents) || 0, journal.events.length) + 1;
        journal.events.push(event);
        if (journal.events.length > limit) {
            const removed = journal.events.length - limit;
            journal.events.splice(0, removed);
            journal.droppedEvents = (Number(journal.droppedEvents) || 0) + removed;
        }
        journal.eventLimit = limit;
        return event;
    };
    const capDiagnosticJournal = (journal, limit) => {
        if (window.DashBridgeBoundedJournal?.capExisting) {
            window.DashBridgeBoundedJournal.capExisting(journal, limit);
            return;
        }
        journal.events = Array.isArray(journal.events) ? journal.events.slice(-limit) : [];
        journal.totalEvents = Math.max(Number(journal.totalEvents) || 0, journal.events.length);
        journal.eventLimit = limit;
    };
    const setRecentDiagnosticRecord = (records, key, value, limit) => {
        if (window.DashBridgeBoundedJournal?.setRecentRecord) {
            return window.DashBridgeBoundedJournal.setRecentRecord(records, key, value, limit);
        }
        if (!Object.prototype.hasOwnProperty.call(records, key)) {
            while (Object.keys(records).length >= limit) delete records[Object.keys(records)[0]];
        }
        records[key] = value;
        return value;
    };

    // This file may be injected more than once. Keep state on `window` so
    // the already-installed fetch/XHR interceptor receives later commands.
    const tools = window.__dashbridgePanelToolsState || (window.__dashbridgePanelToolsState = {
        removeFill: false, thickenLines: false, thickenLinesValue: 1.5, invertLegend: false,
        legendFilter: [], legendSelectionVersion: null, legendVisibleSeries: [], legendMode: 'fast_complete_hide',
        forceMemByteUnit: false
    });
    const bootstrapPanelTransforms = window.DashBridgeGrafanaPanelBootstrap?.readFromUrl(location.href);
    if (bootstrapPanelTransforms) Object.assign(tools, bootstrapPanelTransforms);
    if (tools.legendMode !== 'fast_complete_hide' && !tools.legendVisibility) {
        tools.legendMode = 'fast_complete_hide';
        tools.legendFilter = [];
        tools.legendSelectionVersion = null;
        tools.legendVisibleSeries = [];
        tools.legendSelectFilter = '';
        tools.legendIgnoreFilter = '';
    }
    const legendSelection = window.DashBridgeGrafanaLegendSelection;
    const ensureDashBridgeRightLegendStyles = () => {
        if (!isDashboardIframe || document.getElementById('dashbridge-right-legend-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-right-legend-style';
        style.textContent = `
            .graph-panel--legend-right .graph-legend {
                min-width:0 !important;
                max-width:50% !important;
                flex:0 1 auto !important;
                overflow-x:hidden !important;
            }
        `;
        const styleRoot = document.head || document.documentElement;
        styleRoot?.appendChild(style);
    };
    ensureDashBridgeRightLegendStyles();
    const readBootstrapLegendFilter = () => {
        try {
            const url = new URL(location.href);
            const raw = new URLSearchParams(url.hash.slice(1)).get('dashbridgeLegendFilter')
                || url.searchParams.get('dashbridgeLegendFilter');
            const parsed = raw ? JSON.parse(raw) : null;
            if (!Array.isArray(parsed)) return [];
            return [...new Set(parsed.filter(name => typeof name === 'string')
                .map(name => name.trim()).filter(Boolean))];
        } catch {
            return [];
        }
    };
    const readBootstrapLegendSelection = () => {
        try {
            const url = new URL(location.href);
            const raw = new URLSearchParams(url.hash.slice(1)).get('dashbridgeLegendSelection')
                || url.searchParams.get('dashbridgeLegendSelection');
            const parsed = raw ? JSON.parse(raw) : null;
            if (Number(parsed?.version) !== 2 || !Array.isArray(parsed?.visibleSeries)) return null;
            return { legendSelectionVersion: 2, legendVisibleSeries: legendSelection.normalizeNames(parsed.visibleSeries) };
        } catch {
            return null;
        }
    };
    const readBootstrapTargetQuerySignatures = () => {
        try {
            const url = new URL(location.href);
            const raw = new URLSearchParams(url.hash.slice(1)).get('dashbridgeTargetQuerySignatures')
                || url.searchParams.get('dashbridgeTargetQuerySignatures');
            const parsed = raw ? JSON.parse(raw) : null;
            if (!Array.isArray(parsed)) return [];
            return [...new Set(parsed.filter(signature => typeof signature === 'string' && signature))];
        } catch {
            return [];
        }
    };
    const bootstrapLegendSelection = readBootstrapLegendSelection();
    const bootstrapLegendFilter = readBootstrapLegendFilter();
    const bootstrapTargetQuerySignatures = readBootstrapTargetQuerySignatures();
    if (bootstrapTargetQuerySignatures.length) tools.targetQuerySignatures = bootstrapTargetQuerySignatures;
    if (bootstrapLegendSelection) {
        tools.legendMode = 'fast_complete_hide';
        Object.assign(tools, bootstrapLegendSelection);
    } else if (bootstrapLegendFilter.length) {
        tools.legendMode = 'fast_complete_hide';
        tools.legendFilter = bootstrapLegendFilter;
    }
    // Older URLs used query parameters. Remove either format before Grafana
    // issues datasource requests so it cannot reach the same-origin Referer.
    const bootstrapUrl = new URL(location.href);
    if (bootstrapUrl.searchParams.has('dashbridgeLegendFilter') || bootstrapUrl.searchParams.has('dashbridgeLegendSelection')
        || bootstrapUrl.searchParams.has('dashbridgeTargetQuerySignatures')) {
        bootstrapUrl.searchParams.delete('dashbridgeLegendFilter');
        bootstrapUrl.searchParams.delete('dashbridgeLegendSelection');
        bootstrapUrl.searchParams.delete('dashbridgeTargetQuerySignatures');
        history.replaceState(history.state, '', bootstrapUrl.toString());
    }
    const readBootstrapSeriesFilter = (parameter = 'dashbridgeSeriesQueryFilter') => {
        try {
            const raw = new URL(location.href).searchParams.get(parameter);
            const parsed = raw ? JSON.parse(raw) : null;
            const value = Number(parsed?.value);
            if (!parsed?.enabled || !Number.isFinite(value)) return null;
            const rawCandidate = parsed?.rawValue;
            const hasRawValue = rawCandidate !== null && rawCandidate !== undefined && rawCandidate !== ''
                && Number.isFinite(Number(rawCandidate));
            return { enabled: true, value, rawValue: hasRawValue ? Number(rawCandidate) : null, mode: parsed.mode === 'last' ? 'last' : 'max', highlightEnabled: parsed.highlightEnabled !== false };
        } catch (e) {
            return null;
        }
    };
    const bootstrapSeriesQueryFilter = readBootstrapSeriesFilter();
    if (bootstrapSeriesQueryFilter) {
        tools.seriesQueryFilterEnabled = true;
        tools.seriesQueryFilterValue = bootstrapSeriesQueryFilter.value;
        tools.seriesQueryFilterRawValue = bootstrapSeriesQueryFilter.rawValue;
        tools.seriesQueryFilterMode = bootstrapSeriesQueryFilter.mode;
        tools.seriesQueryFilterHighlightEnabled = bootstrapSeriesQueryFilter.highlightEnabled;
    }
    const readBootstrapCpuCapacityFilter = () => {
        try {
            const raw = new URL(location.href).searchParams.get('dashbridgeCpuCapacityFilter');
            const parsed = raw ? JSON.parse(raw) : null;
            const coefficient = Number(parsed?.coefficient);
            if (!parsed?.enabled || !Number.isFinite(coefficient) || coefficient <= 0) return null;
            return {
                enabled: true, coefficient, mode: parsed.mode === 'last' ? 'last' : 'max', highlightEnabled: parsed.highlightEnabled !== false,
                load1: parsed.load1 !== false, load5: parsed.load5 === true, load15: parsed.load15 === true
            };
        } catch {
            return null;
        }
    };
    const bootstrapCpuCapacityFilter = readBootstrapCpuCapacityFilter();
    if (bootstrapCpuCapacityFilter) {
        tools.cpuCapacityFilterEnabled = true;
        tools.cpuCapacityFilterCoefficient = bootstrapCpuCapacityFilter.coefficient;
        tools.cpuCapacityFilterMode = bootstrapCpuCapacityFilter.mode;
        tools.cpuCapacityFilterHighlightEnabled = bootstrapCpuCapacityFilter.highlightEnabled;
        tools.cpuCapacityFilterLoad1 = bootstrapCpuCapacityFilter.load1;
        tools.cpuCapacityFilterLoad5 = bootstrapCpuCapacityFilter.load5;
        tools.cpuCapacityFilterLoad15 = bootstrapCpuCapacityFilter.load15;
    }
    const enforceSingleResponseSeriesFilter = state => {
        // The generic threshold and dynamic vCPU threshold are alternative
        // selectors. The UI already enforces this; keep the invariant for URL
        // bootstrap and direct commands as well so their pipelines cannot
        // successively filter the same response.
        if (state?.cpuCapacityFilterEnabled && state.seriesQueryFilterEnabled) {
            state.seriesQueryFilterEnabled = false;
        }
        return state;
    };
    enforceSingleResponseSeriesFilter(tools);
    const panelVisualState = window.DashBridgeGrafanaPanelState;
    const getPanelStateKey = panel => panelVisualState?.keyFor(panel)
        || window.DashBridgeGrafanaDom?.panelKey(panel)
        || null;
    const getTargetPanel = () => {
        const sharedPanel = window.DashBridgeGrafanaDom?.findPanel({
            panelId: tools.targetPanelId,
            title: tools.targetPanelTitle,
            type: tools.targetPanelType || 'active'
        });
        if (sharedPanel) return sharedPanel;
        const panels = window.DashBridgeGrafanaDom?.visiblePanels?.() || [];
        return panels.length === 1 ? panels[0] : (panels.find(panel => panel.querySelector('canvas')) || document);
    };
    const nativeThresholdAlerts = new Map();
    const ensureNativeThresholdFeedbackStyles = () => {
        if (document.getElementById('dashbridge-threshold-feedback-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-threshold-feedback-style';
        style.textContent = `
            #dashbridge-threshold-toast { position:fixed; right:18px; bottom:18px; z-index:2147483647; width:min(360px,calc(100vw - 36px)); display:grid; gap:5px; box-sizing:border-box; padding:12px 38px 12px 14px; border:1px solid #e24d42; border-radius:8px; background:var(--background-primary,#fff); color:var(--text-primary,#182033); box-shadow:0 10px 28px rgba(0,0,0,.24); font:500 13px/1.35 system-ui,sans-serif; }
            #dashbridge-threshold-toast strong { font-weight:700; }
            #dashbridge-threshold-toast .dashbridge-threshold-toast-status { color:#e24d42; font-weight:700; }
            #dashbridge-threshold-toast .dashbridge-threshold-toast-close { position:absolute; top:6px; right:8px; border:0; background:transparent; color:var(--text-secondary,#667085); cursor:pointer; font:20px/1 system-ui,sans-serif; }
        `;
        document.documentElement.appendChild(style);
    };
    const showNativeThresholdToast = (title, status) => {
        document.getElementById('dashbridge-threshold-toast')?.remove();
        const toast = document.createElement('div');
        toast.id = 'dashbridge-threshold-toast';
        toast.setAttribute('role', 'alert');
        const heading = document.createElement('strong');
        heading.textContent = title;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'dashbridge-threshold-toast-close';
        close.setAttribute('aria-label', 'Закрыть');
        close.textContent = '×';
        close.addEventListener('click', () => toast.remove());
        const message = document.createElement('span');
        message.className = 'dashbridge-threshold-toast-status';
        message.textContent = `Порог ${status.threshold}${status.unit ? ` ${status.unit}` : ''} превышен`;
        toast.append(heading, close, message);
        document.body.appendChild(toast);
    };
    const renderNativeThresholdFeedback = ({ targetPanel, panelHeader, title, status }) => {
        if (isDashboardIframe) return;
        const key = getPanelStateKey(targetPanel) || tools.targetPanelId || title;
        const previous = nativeThresholdAlerts.get(key);
        if (status?.thresholdNotifyEnabled === false) {
            nativeThresholdAlerts.delete(key);
            document.getElementById('dashbridge-threshold-toast')?.remove();
            return;
        }
        if (!status?.enabled) {
            nativeThresholdAlerts.delete(key);
            return;
        }
        nativeThresholdAlerts.set(key, { wasExceeded: !!status.exceeded });
        if (!status.exceeded) {
            return;
        }
        ensureNativeThresholdFeedbackStyles();
        if (!previous?.wasExceeded) showNativeThresholdToast(title, status);
    };
    const getLegendItems = () => window.DashBridgeGrafanaDom?.legendItems(getTargetPanel()) || [...getTargetPanel().querySelectorAll(
        '.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"], [class*="Legend"] [role="button"], [class*="legend"] [role="button"]'
    )];

    const getLegendLabel = item => window.DashBridgeGrafanaDom?.legendLabel?.(item) || item;

    const getLegendSeries = () => {
        const sharedNames = window.DashBridgeGrafanaDom?.legendSeriesNames?.(getTargetPanel());
        if (Array.isArray(sharedNames)) return sharedNames;
        const seen = new Set();
        return getLegendItems().map(item => (getLegendLabel(item).textContent || '').trim())
            .filter(name => name && !seen.has(name) && seen.add(name));
    };
    const getPanelLegendSeries = panel => {
        const sharedNames = window.DashBridgeGrafanaDom?.legendSeriesNames?.(panel);
        if (Array.isArray(sharedNames)) return sharedNames;
        const seen = new Set();
        return (window.DashBridgeGrafanaDom?.legendItems(panel) || []).map(item => (getLegendLabel(item).textContent || '').trim())
            .filter(name => name && !seen.has(name) && seen.add(name));
    };
    const normalizePanelLegendState = state => {
        if (!state) return state;
        if (state.legendMode === 'fast_complete_hide' || state.legendVisibility) return state;
        return {
            ...state,
            legendMode: 'fast_complete_hide',
            legendFilter: [],
            legendSelectionVersion: null,
            legendVisibleSeries: [],
            legendSelectFilter: '',
            legendIgnoreFilter: ''
        };
    };
    const getVisualLegendFilter = state => state?.legendMode === 'fast_complete_hide'
        ? []
        : (Array.isArray(state?.legendFilter) ? state.legendFilter : []);
    const restorePanelVisualState = panel => {
        const key = getPanelStateKey(panel);
        const state = normalizePanelLegendState(panelVisualState?.get(panel));
        const canvas = panel.querySelector('canvas');
        if (!state || !canvas) return;
        panelVisualState?.set(panel, state);
        const signature = JSON.stringify(state);
        if (panel.__dashbridgeVisualStateSignature === signature && panel.__dashbridgeVisualCanvas === canvas) return;
        panel.__dashbridgeVisualState = state;
        panel.__dashbridgeVisualStateSignature = signature;
        panel.__dashbridgeVisualCanvas = canvas;
        const thresholdRoot = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
        if (key && key === tools.targetPanelId) {
            syncResponseFilterPresentation(thresholdRoot, state);
        }
        const visualLegendFilter = getVisualLegendFilter(state);
        const seriesConfig = Object.fromEntries(getPanelLegendSeries(panel).map(name => [name, !visualLegendFilter.includes(name)]));
        if (hasVisualWork(state)) {
            void window.DashBridgeGrafanaVisualEngine?.apply({ panelId: key, seriesConfig: hasLegendVisibilityWork(state) ? seriesConfig : null, mode: state.legendMode, ...state, legendFilter: visualLegendFilter })
                .catch(() => { panel.__dashbridgeVisualStateSignature = null; });
        }
    };

    const hasLegendVisibilityWork = state => state?.legendMode !== 'fast_complete_hide' && !!state?.legendFilter?.length;
    const hasExplicitLegendVisibilityWork = (state = tools) => !!state?.legendVisibility
        && typeof state.legendVisibility === 'object'
        && Object.values(state.legendVisibility).some(visible => visible === false);
    const hasVisualWork = (state = tools) => hasLegendVisibilityWork(state)
        || !!state.removeFill || !!state.thickenLines || !!state.invertLegend;
    let legendVisibilityRestoreAfterNextQuery = false;
    let thresholdRestoreAfterNextQuery = false;
    const hasPersistentVisualWork = (state = tools) => hasVisualWork(state)
        || hasExplicitLegendVisibilityWork(state)
        || (state === tools && legendVisibilityRestoreAfterNextQuery);
    const visualMetadata = window.__dashbridgePanelToolsVisualMetadata
        || (window.__dashbridgePanelToolsVisualMetadata = {
            seriesThresholdHighlightRules: [],
            seriesCpuCapacityEntries: [],
            responseFilterVisibleNames: [],
            responseFilterReady: false,
            responseFilterEmptyIsNormal: false,
            memoryConversionApplied: null
        });
    visualMetadata.responseFilterVisibleNames ||= [];
    visualMetadata.responseFilterReady ||= false;
    visualMetadata.responseTableRecords ||= [];
    visualMetadata.responseSeriesNames ||= [];
    visualMetadata.responseDataStatus ||= { kind: 'unknown', text: '' };
    if (typeof visualMetadata.memoryConversionApplied !== 'boolean') visualMetadata.memoryConversionApplied = null;
    const PANEL_DATA_STATUS_TEXT = Object.freeze({
        filtered_empty: 'Нет превышений по заданному фильтру',
        empty_source: 'Источник вернул пустой набор данных',
        http_error: 'Ошибка HTTP при получении данных',
        decode_error: 'Ошибка обработки ответа datasource',
        network_error: 'Сетевая ошибка при получении данных'
    });
    const syncPanelDataStatusPresentation = () => {
        const status = visualMetadata.responseDataStatus || { kind: 'unknown' };
        const overlayId = 'dashbridge-panel-data-status';
        const existing = document.getElementById(overlayId);
        const hasCachedData = (visualMetadata.responseTableRecords?.length || 0) > 0;
        const transportFailureWithVisibleData = hasCachedData
            && ['http_error', 'network_error', 'decode_error'].includes(status.kind);
        if (!status.text || ['data', 'unknown'].includes(status.kind) || transportFailureWithVisibleData) {
            document.querySelectorAll?.('[data-dashbridge-native-no-data]').forEach(element => {
                element.style.removeProperty('visibility');
                delete element.dataset.dashbridgeNativeNoData;
            });
            existing?.remove();
            return;
        }
        const panel = window.DashBridgeGrafanaDom?.outerPanel?.(getTargetPanel()) || getTargetPanel() || document.body;
        Array.from(panel?.querySelectorAll?.('div, span') || []).forEach(element => {
            if (element.children.length === 0 && /^No data$/i.test(String(element.textContent || '').trim())) {
                element.dataset.dashbridgeNativeNoData = 'true';
                element.style.setProperty('visibility', 'hidden', 'important');
            }
        });
        const overlay = existing || document.createElement('div');
        if (!existing) overlay.id = overlayId;
        overlay.dataset.kind = status.kind;
        // This function is also called by a document-wide MutationObserver.
        // Replacing the same text node on every callback creates another
        // childList mutation and can turn an empty/error state into a
        // self-sustaining observer loop.
        if (overlay.textContent !== status.text) overlay.textContent = status.text;
        overlay.setAttribute('role', status.kind === 'filtered_empty' ? 'status' : 'alert');
        overlay.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;
            max-width:min(80vw,520px);padding:8px 12px;border-radius:7px;text-align:center;pointer-events:none;
            font:500 14px/1.35 system-ui,sans-serif;color:${status.kind === 'filtered_empty' ? '#1f7a3f' : '#b54708'};
            background:rgba(255,255,255,.92);border:1px solid currentColor;box-shadow:0 3px 12px rgba(0,0,0,.12);`;
        if (!existing) document.body.appendChild(overlay);
    };
    const setPanelDataStatus = (kind, details = {}) => {
        const httpStatus = Number(details.httpStatus);
        const baseText = PANEL_DATA_STATUS_TEXT[kind] || '';
        const text = kind === 'http_error' && Number.isFinite(httpStatus) && httpStatus > 0
            ? `Ошибка HTTP ${httpStatus} при получении данных`
            : baseText;
        visualMetadata.responseDataStatus = { kind, text, at: Date.now(),
            httpStatus: Number.isFinite(httpStatus) && httpStatus > 0 ? httpStatus : null };
        // Loading and transport failures may happen after Grafana has already
        // rendered a successful response (for example, when it aborts a
        // superseded request). Preserve that bounded cache for visual fallback,
        // while responseDataStatus still tells report generation that the most
        // recent request did not complete successfully.
        if (['filtered_empty', 'empty_source'].includes(kind)) {
            visualMetadata.responseTableRecords = [];
            visualMetadata.responseSeriesNames = [];
        }
        requestAnimationFrame(syncPanelDataStatusPresentation);
    };
    let seriesThresholdHighlightRoot = null;
    let seriesThresholdDashboardRoot = null;
    let seriesThresholdWasInView = false;
    const isGrafanaViewRoute = () => {
        try {
            return typeof URL === 'function' && new URL(globalThis.location?.href || '').searchParams.has('viewPanel');
        } catch {
            return false;
        }
    };
    let cpuCapacityLegendRoot = null;
    let flotResponseFilterRoot = null;
    let cpuCapacityLegendSortDirection = null;
    const cpuCapacityLegendControllers = new WeakMap();
    const cpuCapacityLegendOriginalOrders = new WeakMap();
    const isSeriesThresholdHighlightEnabled = (state = tools) => (
        !!state.seriesQueryFilterEnabled && state.seriesQueryFilterHighlightEnabled !== false
    ) || (
        !!state.cpuCapacityFilterEnabled && state.cpuCapacityFilterHighlightEnabled !== false
    );
    const thresholdHighlightRuleIsEnabled = (rule, state = tools) => {
        if (rule?.kind === 'series-query-filter') {
            return !!state.seriesQueryFilterEnabled && state.seriesQueryFilterHighlightEnabled !== false;
        }
        if (rule?.kind === 'cpu-capacity-filter') {
            return !!state.cpuCapacityFilterEnabled && state.cpuCapacityFilterHighlightEnabled !== false;
        }
        return isSeriesThresholdHighlightEnabled(state);
    };
    const getEnabledSeriesThresholdHighlightRules = (state = tools) => visualMetadata.seriesThresholdHighlightRules
        .filter(rule => thresholdHighlightRuleIsEnabled(rule, state));
    const syncThresholdHighlightState = (root, state = tools) => {
        const rules = getEnabledSeriesThresholdHighlightRules(state);
        const viewRoute = isGrafanaViewRoute();
        if (!viewRoute && !seriesThresholdWasInView && root && root !== document) {
            seriesThresholdDashboardRoot = root;
        }
        if (viewRoute) seriesThresholdWasInView = true;
        if (seriesThresholdHighlightRoot && seriesThresholdHighlightRoot !== root) {
            window.DashBridgeGrafanaVisualEngine?.setSeriesThresholdHighlights?.({
                root: seriesThresholdHighlightRoot,
                enabled: false,
                rules: []
            });
        }
        const result = window.DashBridgeGrafanaVisualEngine?.setSeriesThresholdHighlights?.({
            root,
            enabled: rules.length > 0,
            rules
        });
        seriesThresholdHighlightRoot = rules.length > 0 ? root : null;
        return result;
    };
    const discardThresholdHighlightRules = kind => {
        visualMetadata.seriesThresholdHighlightRules = visualMetadata.seriesThresholdHighlightRules
            .filter(rule => rule?.kind !== kind);
    };
    const responseSeriesFilterIsEnabled = (state = tools) => !!state.seriesQueryFilterEnabled
        || !!state.cpuCapacityFilterEnabled;
    const getResponseSeriesFilterConfigKey = (state = tools) => JSON.stringify({
        seriesEnabled: !!state.seriesQueryFilterEnabled,
        seriesValue: state.seriesQueryFilterRawValue ?? state.seriesQueryFilterValue ?? null,
        seriesMode: state.seriesQueryFilterMode || 'max',
        cpuEnabled: !!state.cpuCapacityFilterEnabled,
        cpuCoefficient: state.cpuCapacityFilterCoefficient ?? null,
        cpuMode: state.cpuCapacityFilterMode || 'max',
        load1: state.cpuCapacityFilterLoad1 !== false,
        load5: state.cpuCapacityFilterLoad5 === true,
        load15: state.cpuCapacityFilterLoad15 === true
    });
    const normalizeResponseSeriesName = value => String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const getResponseSeriesLoadKind = value => {
        const match = normalizeResponseSeriesName(value).match(/\bload\s*(1m|5m|15m)\b/);
        return match?.[1] || null;
    };
    const responseSeriesNameIsVisible = (label, visibleNames) => {
        const normalizedLabel = normalizeResponseSeriesName(label);
        if (!normalizedLabel) return false;
        const candidates = (visibleNames || []).map(normalizeResponseSeriesName).filter(Boolean);
        if (candidates.includes(normalizedLabel)) return true;
        const labelLoadKind = getResponseSeriesLoadKind(normalizedLabel);
        return candidates.some(candidate => {
            if (candidate.length < 4) return false;
            const candidateLoadKind = getResponseSeriesLoadKind(candidate);
            if ((labelLoadKind || candidateLoadKind) && labelLoadKind !== candidateLoadKind) return false;
            return normalizedLabel.includes(candidate) || candidate.includes(normalizedLabel);
        });
    };
    const syncFlotResponseFilterState = (root, state = tools) => {
        const engine = window.DashBridgeGrafanaVisualEngine;
        if (flotResponseFilterRoot && flotResponseFilterRoot !== root) {
            engine?.resetFlotSeriesVisibility?.({ root: flotResponseFilterRoot });
            flotResponseFilterRoot = null;
        }
        if (!root || !responseSeriesFilterIsEnabled(state) || !visualMetadata.responseFilterReady) {
            if (root) engine?.resetFlotSeriesVisibility?.({ root });
            window.__dashbridgeFlotResponseFilterDiagnostic = {
                at: Date.now(), enabled: responseSeriesFilterIsEnabled(state),
                ready: !!visualMetadata.responseFilterReady,
                result: 'inactive-or-not-ready'
            };
            return null;
        }
        const labels = engine?.getFlotSeriesLabels?.(root);
        if (!Array.isArray(labels)) {
            window.__dashbridgeFlotResponseFilterDiagnostic = {
                at: Date.now(), enabled: true, ready: true, result: 'not-flot',
                visibleNames: visualMetadata.responseFilterVisibleNames.slice(0, 100)
            };
            return null;
        }
        const seriesConfig = Object.fromEntries(labels.map(label => [
            label,
            responseSeriesNameIsVisible(label, visualMetadata.responseFilterVisibleNames)
        ]));
        const result = engine?.applyFlotSeriesVisibility?.({
            root,
            seriesConfig,
            mode: 'fast_complete_hide'
        }) || null;
        flotResponseFilterRoot = root;
        window.__dashbridgeFlotResponseFilterDiagnostic = {
            at: Date.now(), enabled: true, ready: true, result,
            labels: labels.slice(0, 100),
            visibleNames: visualMetadata.responseFilterVisibleNames.slice(0, 100),
            seriesConfig
        };
        return result;
    };
    const normalizeCpuCapacityLegendName = value => String(value || '').trim().toLowerCase();
    const matchCpuCapacityLegendEntry = label => {
        const normalizedLabel = normalizeCpuCapacityLegendName(label);
        let best = null;
        let bestScore = -1;
        for (const entry of visualMetadata.seriesCpuCapacityEntries) {
            for (const name of entry.sourceNames || []) {
                const candidate = normalizeCpuCapacityLegendName(name);
                if (candidate === 'value' || candidate.length < 4) continue;
                const exact = candidate === normalizedLabel;
                if (!exact && !normalizedLabel.includes(candidate) && !candidate.includes(normalizedLabel)) continue;
                const score = (exact ? 100000 : 0) + candidate.length;
                if (score > bestScore) {
                    best = entry;
                    bestScore = score;
                }
            }
        }
        return best;
    };
    const attachCpuCapacityToReportSnapshot = (snapshot, sla = {}) => {
        if (!snapshot || !Array.isArray(snapshot.series)) return snapshot;
        const attached = {
            ...snapshot,
            series: snapshot.series.map(series => {
                const entry = matchCpuCapacityLegendEntry(series?.name);
                const cpuCapacity = Number(entry?.value);
                return Number.isFinite(cpuCapacity) && cpuCapacity > 0
                    ? { ...series, cpuCapacity }
                    : series;
            })
        };
        if (sla.source !== 'cpu_capacity') return attached;
        const coefficient = Number(sla.coefficient);
        if (!Number.isFinite(coefficient) || coefficient <= 0) {
            return { ...attached, state: 'configuration_error', error: 'Некорректный коэффициент фильтра Load Average по vCPU.' };
        }
        let unknownCapacity = false;
        const series = attached.series.map(item => {
            const cpuCapacity = Number(item?.cpuCapacity);
            if (!Number.isFinite(cpuCapacity) || cpuCapacity <= 0) {
                unknownCapacity = true;
                return { ...item, exceeded: false, level: 'unknown' };
            }
            const threshold = cpuCapacity * coefficient;
            const exceeded = Number(item?.value) > threshold;
            return { ...item, threshold, cpuCapacityThreshold: threshold,
                exceeded, level: exceeded ? 'critical' : 'normal' };
        });
        const hasCritical = series.some(item => item.level === 'critical');
        return {
            ...attached,
            source: 'cpu_capacity',
            cpuCapacityCoefficient: coefficient,
            threshold: null,
            criticalThreshold: null,
            warningThreshold: null,
            state: hasCritical ? 'critical' : (unknownCapacity ? 'no_data' : 'ok'),
            series
        };
    };
    const ensureCpuCapacityLegendStyle = () => {
        if (document.getElementById('dashbridge-vcpu-legend-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-vcpu-legend-style';
        style.textContent = `
            .dashbridge-vcpu-legend-cell {
                box-sizing:border-box !important;
                width:48px !important;
                min-width:48px !important;
                max-width:48px !important;
                padding-left:6px !important;
                padding-right:6px !important;
                text-align:right !important;
                white-space:nowrap !important;
            }
            .dashbridge-vcpu-legend-header { color:inherit; font-weight:inherit; }
            .dashbridge-vcpu-legend-header[data-dashbridge-sort="asc"]::after { content:' ▲'; font-size:.72em; }
            .dashbridge-vcpu-legend-header[data-dashbridge-sort="desc"]::after { content:' ▼'; font-size:.72em; }
        `;
        document.documentElement.appendChild(style);
    };
    const removeCpuCapacityLegendColumn = root => root?.querySelectorAll?.('.dashbridge-vcpu-legend-cell')
        .forEach(element => element.remove());
    const insertCpuCapacityLegendCell = (row, anchor, text, header = false) => {
        let cell = row.querySelector?.(':scope > .dashbridge-vcpu-legend-cell');
        if (!cell) {
            const tableCell = anchor?.closest?.('td,th');
            const nativeValueCell = tableCell?.nextElementSibling;
            const tagName = nativeValueCell?.tagName?.toLowerCase()
                || (row.tagName === 'TR' ? (header ? 'th' : 'td') : 'span');
            cell = document.createElement(tagName);
            const nativeClasses = typeof nativeValueCell?.className === 'string'
                ? nativeValueCell.className.trim()
                : '';
            cell.className = [
                nativeClasses,
                'dashbridge-vcpu-legend-cell',
                header ? 'dashbridge-vcpu-legend-header' : ''
            ].filter(Boolean).join(' ');
            if (tableCell?.parentElement === row) tableCell.after(cell);
            else row.appendChild(cell);
        }
        if (cell.textContent !== text) cell.textContent = text;
        cell.title = header
            ? 'Количество виртуальных CPU'
            : (text === '—' ? 'Количество vCPU не определено' : `${text} vCPU`);
        return cell;
    };
    const sortCpuCapacityLegendRows = (root, { restoreOriginal = false } = {}) => {
        const direction = cpuCapacityLegendSortDirection;
        root?.querySelectorAll?.('.dashbridge-vcpu-legend-header').forEach(header => {
            if (direction) header.dataset.dashbridgeSort = direction;
            else delete header.dataset.dashbridgeSort;
            header.setAttribute('aria-sort', direction === 'asc'
                ? 'ascending'
                : direction === 'desc' ? 'descending' : 'none');
        });
        if (!direction && !restoreOriginal) return 0;
        const groups = new Map();
        root?.querySelectorAll?.('.dashbridge-vcpu-legend-cell:not(.dashbridge-vcpu-legend-header)')
            .forEach(cell => {
                const row = cell.closest?.('tr') || cell.parentElement;
                const parent = row?.parentElement;
                if (!row || !parent) return;
                if (!groups.has(parent)) groups.set(parent, []);
                if (!groups.get(parent).includes(row)) groups.get(parent).push(row);
            });
        let moved = 0;
        for (const [parent, rows] of groups) {
            const originalOrderState = cpuCapacityLegendOriginalOrders.get(parent);
            const sorted = rows.map((row, index) => {
                const cell = row.querySelector?.('.dashbridge-vcpu-legend-cell:not(.dashbridge-vcpu-legend-header)');
                const rawValue = cell?.dataset?.dashbridgeVcpuValue;
                const value = rawValue !== '' && rawValue !== undefined ? Number(rawValue) : null;
                const originalOrder = originalOrderState?.orders?.get(row);
                return {
                    row,
                    index,
                    originalOrder: Number.isFinite(originalOrder) ? originalOrder : index,
                    value: Number.isFinite(value) ? value : null
                };
            }).sort((left, right) => {
                if (!direction) return left.originalOrder - right.originalOrder;
                if (left.value === null && right.value === null) return left.index - right.index;
                if (left.value === null) return 1;
                if (right.value === null) return -1;
                const difference = direction === 'asc'
                    ? left.value - right.value
                    : right.value - left.value;
                return difference || left.index - right.index;
            });
            if (sorted.every((entry, index) => entry.row === rows[index])) continue;
            sorted.forEach(entry => parent.appendChild(entry.row));
            moved += sorted.length;
        }
        return moved;
    };
    const renderCpuCapacityLegendColumn = (root, state = tools) => {
        const enabled = !!state.cpuCapacityFilterEnabled;
        if (!enabled) {
            removeCpuCapacityLegendColumn(root);
            return 0;
        }
        ensureCpuCapacityLegendStyle();
        const rows = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(root) || []);
        const decoratedRows = [];
        let changes = 0;
        for (const row of rows) {
            const labelElement = getLegendLabel(row);
            const label = (labelElement?.textContent || '').trim();
            const header = !!row.closest?.('thead')
                || /^(?:name|series|имя|серия)$/i.test(label);
            if (!label || header) continue;
            const entry = matchCpuCapacityLegendEntry(label);
            const value = Number(entry?.value);
            const text = Number.isFinite(value)
                ? (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100))
                : '—';
            const existingCell = row.querySelector?.(':scope > .dashbridge-vcpu-legend-cell');
            const previousText = existingCell?.textContent;
            const cell = insertCpuCapacityLegendCell(row, labelElement, text);
            if (!existingCell || previousText !== text) changes += 1;
            cell.dataset.dashbridgeVcpuValue = Number.isFinite(value) ? String(value) : '';
            const parent = row.parentElement;
            if (parent) {
                let originalOrderState = cpuCapacityLegendOriginalOrders.get(parent);
                if (!originalOrderState) {
                    originalOrderState = { orders: new WeakMap(), next: 0 };
                    cpuCapacityLegendOriginalOrders.set(parent, originalOrderState);
                }
                if (!originalOrderState.orders.has(row)) {
                    originalOrderState.orders.set(row, originalOrderState.next++);
                }
                row.dataset.dashbridgeVcpuOriginalOrder = String(originalOrderState.orders.get(row));
            }
            decoratedRows.push(row);
        }
        const tables = [...new Set(decoratedRows.map(row => row.closest?.('table')).filter(Boolean))];
        for (const table of tables) {
            const headerRow = table.querySelector('thead tr') || Array.from(table.querySelectorAll('tr'))
                .find(row => /^(?:name|series|имя|серия)$/i.test((row.querySelector('th,td')?.textContent || '').trim()));
            const headerAnchor = headerRow?.querySelector('th,td');
            if (headerRow && headerAnchor) {
                const existingHeader = headerRow.querySelector?.(':scope > .dashbridge-vcpu-legend-header');
                const headerCell = insertCpuCapacityLegendCell(headerRow, headerAnchor, 'vCPU', true);
                if (!existingHeader) changes += 1;
                headerCell.onclick = event => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation?.();
                    cpuCapacityLegendSortDirection = cpuCapacityLegendSortDirection === null
                        ? 'desc'
                        : cpuCapacityLegendSortDirection === 'desc' ? 'asc' : null;
                    sortCpuCapacityLegendRows(root, { restoreOriginal: cpuCapacityLegendSortDirection === null });
                };
            }
        }
        changes += sortCpuCapacityLegendRows(root);
        return changes;
    };
    const stopCpuCapacityLegendController = root => {
        const controller = root && cpuCapacityLegendControllers.get(root);
        controller?.observer?.disconnect?.();
        if (controller?.nativeSortListener) root?.removeEventListener?.('click', controller.nativeSortListener, true);
        if (controller?.frame) cancelAnimationFrame(controller.frame);
        if (root) cpuCapacityLegendControllers.delete(root);
        removeCpuCapacityLegendColumn(root);
    };
    const syncCpuCapacityLegend = (root, state = tools) => {
        if (cpuCapacityLegendRoot && cpuCapacityLegendRoot !== root) {
            stopCpuCapacityLegendController(cpuCapacityLegendRoot);
        }
        const enabled = !!state.cpuCapacityFilterEnabled;
        if (!enabled) {
            stopCpuCapacityLegendController(root);
            cpuCapacityLegendRoot = null;
            cpuCapacityLegendSortDirection = null;
            return 0;
        }
        let controller = cpuCapacityLegendControllers.get(root);
        if (!controller) {
            controller = { observer: null, frame: 0, state, nativeSortListener: null };
            controller.schedule = () => {
                if (controller.frame) return;
                controller.frame = requestAnimationFrame(() => {
                    controller.frame = 0;
                    // This observer is only a remount guard for the vCPU
                    // column. Calling the complete response presentation here
                    // re-armed the Flot controller on every legend mutation;
                    // its draw/reflow then produced another mutation and kept
                    // Chrome in an endless high-CPU render loop.
                    const changes = renderCpuCapacityLegendColumn(root, controller.state);
                    controller.observer?.takeRecords?.();
                    if (changes > 0) {
                        window.DashBridgeGrafanaVisualEngine?.reflowChart?.({ root });
                        syncThresholdHighlightState(root, controller.state);
                    }
                });
            };
            controller.observer = new MutationObserver(controller.schedule);
            controller.observer.observe(root === document ? document.documentElement : root, {
                childList: true,
                subtree: true
            });
            controller.nativeSortListener = event => {
                const header = event.target?.closest?.('th,[role="columnheader"]');
                if (!header || header.classList?.contains('dashbridge-vcpu-legend-header')) return;
                if (!header.closest?.('table')?.querySelector?.('.dashbridge-vcpu-legend-header')) return;
                cpuCapacityLegendSortDirection = null;
                root.querySelectorAll?.('.dashbridge-vcpu-legend-header').forEach(vcpuHeader => {
                    delete vcpuHeader.dataset.dashbridgeSort;
                    vcpuHeader.setAttribute('aria-sort', 'none');
                });
            };
            root.addEventListener?.('click', controller.nativeSortListener, true);
            cpuCapacityLegendControllers.set(root, controller);
        }
        controller.state = state;
        cpuCapacityLegendRoot = root;
        return renderCpuCapacityLegendColumn(root, state);
    };
    const syncResponseFilterPresentation = (root, state = tools) => {
        // Reserve legend space first. Flot can then calculate its final plot
        // rectangle before threshold samples are projected into the overlay.
        const cpuRows = syncCpuCapacityLegend(root, state);
        const flotResult = syncFlotResponseFilterState(root, state);
        if (cpuRows > 0 || flotResult === 'flot') {
            window.DashBridgeGrafanaVisualEngine?.reflowChart?.({ root });
        }
        return syncThresholdHighlightState(root, state);
    };
    let thresholdViewCloseRebindFrame = 0;
    let thresholdViewCloseRebindAttempts = 0;
    let thresholdViewCloseRebindRoot = null;
    const thresholdViewCloseSettleFrames = 24;
    const thresholdRebindRootIsActive = root => !!root && root !== document
        && root.isConnected === true
        && (typeof root.getClientRects !== 'function' || root.getClientRects().length > 0);
    const normalizePanelKey = value => value === null || value === undefined || value === ''
        ? null
        : (String(value).startsWith('panel-') ? String(value) : `panel-${value}`);
    const resolveThresholdDashboardRoot = () => {
        if (thresholdRebindRootIsActive(seriesThresholdDashboardRoot)) return seriesThresholdDashboardRoot;
        const targetKey = normalizePanelKey(tools.targetPanelId);
        const targetTitle = String(tools.targetPanelTitle || '').trim().toLowerCase();
        const visiblePanels = window.DashBridgeGrafanaDom?.visiblePanels?.() || [];
        const panel = visiblePanels.find(candidate => targetKey
            && normalizePanelKey(window.DashBridgeGrafanaDom?.panelKey?.(candidate)) === targetKey)
            || visiblePanels.find(candidate => targetTitle && String(candidate?.innerText || '').toLowerCase().includes(targetTitle));
        const root = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
        return thresholdRebindRootIsActive(root) ? root : null;
    };
    const runThresholdViewCloseRebindFrame = () => {
        thresholdViewCloseRebindFrame = 0;
        thresholdViewCloseRebindAttempts += 1;
        // A click inside View may not be its close action. Wait only for the
        // bounded settling window; never move the overlay while View is active.
        if (!isGrafanaViewRoute()) {
            if (!thresholdRebindRootIsActive(thresholdViewCloseRebindRoot)) {
                thresholdViewCloseRebindRoot = resolveThresholdDashboardRoot();
            }
            if (thresholdViewCloseRebindRoot) {
                if (seriesThresholdHighlightRoot !== thresholdViewCloseRebindRoot) {
                    syncResponseFilterPresentation(thresholdViewCloseRebindRoot, tools);
                } else {
                    // Grafana animates the dashboard grid after View disappears.
                    // Reproject only the SVG while its top/height are settling.
                    syncThresholdHighlightState(thresholdViewCloseRebindRoot, tools);
                }
                seriesThresholdDashboardRoot = thresholdViewCloseRebindRoot;
                seriesThresholdWasInView = false;
            }
        }
        if (thresholdViewCloseRebindAttempts < thresholdViewCloseSettleFrames) {
            thresholdViewCloseRebindFrame = requestAnimationFrame(runThresholdViewCloseRebindFrame);
        } else {
            thresholdViewCloseRebindAttempts = 0;
            thresholdViewCloseRebindRoot = null;
        }
    };
    const rebindThresholdHighlightsAfterViewClose = () => {
        if (thresholdViewCloseRebindFrame) return;
        thresholdViewCloseRebindAttempts = 0;
        thresholdViewCloseRebindRoot = null;
        thresholdViewCloseRebindFrame = requestAnimationFrame(runThresholdViewCloseRebindFrame);
    };
    const thresholdRouteChangeEvent = 'dashbridgeGrafanaRouteChanged';
    const installThresholdRouteChangeBridge = () => {
        for (const method of ['pushState', 'replaceState']) {
            const current = globalThis.history?.[method];
            if (typeof current !== 'function' || current.__dashbridgeRouteChangeBridge) continue;
            const wrapped = function (...args) {
                const before = globalThis.location?.href || '';
                const result = current.apply(this, args);
                if ((globalThis.location?.href || '') !== before) {
                    window.dispatchEvent?.(new Event(thresholdRouteChangeEvent));
                }
                return result;
            };
            Object.defineProperty(wrapped, '__dashbridgeRouteChangeBridge', { value: true });
            try { globalThis.history[method] = wrapped; } catch { /* read-only History implementation */ }
        }
    };
    let thresholdRouteWasView = isGrafanaViewRoute();
    const handleThresholdRouteChange = () => {
        const viewRoute = isGrafanaViewRoute();
        if (thresholdRouteWasView && !viewRoute) {
            const oldRoot = seriesThresholdHighlightRoot;
            if (oldRoot) {
                // Remove the fixed View SVG synchronously with the route change.
                // Rebinding below draws only after Grafana starts restoring the
                // dashboard layout, so stale coordinates cannot cover another panel.
                window.DashBridgeGrafanaVisualEngine?.setSeriesThresholdHighlights?.({
                    root: oldRoot,
                    enabled: false,
                    rules: []
                });
                seriesThresholdHighlightRoot = null;
            }
            rebindThresholdHighlightsAfterViewClose();
        }
        thresholdRouteWasView = viewRoute;
    };
    installThresholdRouteChangeBridge();
    window.addEventListener?.(thresholdRouteChangeEvent, handleThresholdRouteChange);
    window.addEventListener?.('popstate', handleThresholdRouteChange);
    window.addEventListener?.('hashchange', handleThresholdRouteChange);
    if (typeof window.__dashbridgeThresholdHighlightRootDetachedListener === 'function') {
        window.removeEventListener?.('dashbridgeThresholdHighlightRootDetached', window.__dashbridgeThresholdHighlightRootDetachedListener);
    }
    window.__dashbridgeThresholdHighlightRootDetachedListener = rebindThresholdHighlightsAfterViewClose;
    window.addEventListener?.('dashbridgeThresholdHighlightRootDetached', rebindThresholdHighlightsAfterViewClose);
    registerRuntimeCleanup(() => {
        if (thresholdViewCloseRebindFrame) cancelAnimationFrame(thresholdViewCloseRebindFrame);
        thresholdViewCloseRebindFrame = 0;
        thresholdViewCloseRebindAttempts = 0;
        thresholdViewCloseRebindRoot = null;
        window.removeEventListener?.(thresholdRouteChangeEvent, handleThresholdRouteChange);
        window.removeEventListener?.('popstate', handleThresholdRouteChange);
        window.removeEventListener?.('hashchange', handleThresholdRouteChange);
        window.removeEventListener?.('dashbridgeThresholdHighlightRootDetached', rebindThresholdHighlightsAfterViewClose);
        if (window.__dashbridgeThresholdHighlightRootDetachedListener === rebindThresholdHighlightsAfterViewClose) {
            window.__dashbridgeThresholdHighlightRootDetachedListener = null;
        }
    });
    let visualStyleReapplyFrame = null;
    let visualStyleReapplyGeneration = 0;
    const visualReapplyDiagnostic = window.__dashbridgeVisualReapplyDiagnostic
        || (window.__dashbridgeVisualReapplyDiagnostic = {
            requested: 0, completed: 0, cancelled: 0, errors: 0, pending: false,
            activeGeneration: 0, attemptsPlanned: 0, attemptsFinished: 0,
            settleInspections: 0, adaptiveReapplies: 0, rendererReplacements: 0,
            styleDrifts: 0, settleTimeouts: 0, events: [],
        });
    capDiagnosticJournal(visualReapplyDiagnostic, 300);
    for (const [key, fallback] of Object.entries({
        settleInspections: 0,
        adaptiveReapplies: 0,
        rendererReplacements: 0,
        styleDrifts: 0,
        settleTimeouts: 0,
    })) {
        if (!Number.isFinite(visualReapplyDiagnostic[key])) visualReapplyDiagnostic[key] = fallback;
    }
    const recordVisualReapply = (stage, details = {}) => {
        const queryDiagnostic = window.__dashbridgeDataInterceptorDiagnostic || {};
        const compactValues = values => {
            if (!Array.isArray(values)) return null;
            const serialised = JSON.stringify(values);
            let hash = 2166136261;
            for (let index = 0; index < serialised.length; index += 1) {
                hash = Math.imul(hash ^ serialised.charCodeAt(index), 16777619);
            }
            return {
                count: values.length,
                sample: values.slice(0, 4),
                hash: `fnv1a-${(hash >>> 0).toString(16)}`,
            };
        };
        const compactStyleState = styleState => {
            if (!styleState || typeof styleState !== 'object') return styleState || null;
            const compact = { ...styleState };
            compact.evaluatedFillValuesSummary = compactValues(compact.evaluatedFillValues);
            compact.evaluatedOriginalFillValuesSummary = compactValues(compact.evaluatedOriginalFillValues);
            delete compact.evaluatedFillValues;
            delete compact.evaluatedOriginalFillValues;
            return compact;
        };
        const eventDetails = { ...details };
        if (eventDetails.styleState) eventDetails.styleState = compactStyleState(eventDetails.styleState);
        if (eventDetails.committed?.styleState) {
            eventDetails.committed = {
                ...eventDetails.committed,
                styleState: compactStyleState(eventDetails.committed.styleState),
            };
        }
        pushBoundedDiagnosticEvent(visualReapplyDiagnostic, {
            id: (Number(visualReapplyDiagnostic.nextEventId) || 0) + 1,
            at: Date.now(),
            stage,
            queryEventId: Number(queryDiagnostic.nextEventId) || 0,
            queryRequestId: queryDiagnostic.last?.requestId || null,
            queryStage: queryDiagnostic.last?.stage || null,
            queryScope: queryDiagnostic.last?.scope || null,
            ...eventDetails,
        }, 300);
        visualReapplyDiagnostic.nextEventId = visualReapplyDiagnostic.events.at(-1)?.id || visualReapplyDiagnostic.nextEventId || 0;
    };
    const canDeferLegendVisibilityApply = () => visualMetadata.responseDataStatus?.kind === 'filtered_empty'
        && getLegendItems().length === 0
        && (legendVisibilityRestoreAfterNextQuery
            // Legacy Flot retains a blank canvas after a response is reduced
            // to zero series. The authoritative filtered_empty status plus an
            // empty legend prove that native visibility cannot be applied yet;
            // canvas presence does not mean that the missing legend is ready.
            || tools.seriesQueryFilterEnabled === true
            || tools.cpuCapacityFilterEnabled === true);
    const applyPersistentVisualState = async () => {
        const targetPanel = getTargetPanel();
        const targetRoot = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
        let engineResult = null;
        if (hasVisualWork()) {
            const visualLegendFilter = getVisualLegendFilter(tools);
            const seriesConfig = Object.fromEntries(getPanelLegendSeries(targetPanel).map(name => [name, !visualLegendFilter.includes(name)]));
            engineResult = await window.DashBridgeGrafanaVisualEngine?.apply({
                panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null,
                seriesConfig: hasLegendVisibilityWork() ? seriesConfig : null,
                mode: tools.legendMode || 'fast_complete_hide',
                ...tools
            });
        }
        let legendVisibilityApplied = null;
        if (hasExplicitLegendVisibilityWork() || legendVisibilityRestoreAfterNextQuery) {
            legendVisibilityApplied = await applyLegendVisibilityByKey(tools.legendVisibility || {});
            const filteredEmptyLegendCanReturnAfterQuery = canDeferLegendVisibilityApply();
            if (!legendVisibilityApplied && !filteredEmptyLegendCanReturnAfterQuery) {
                throw new Error('legend-visibility-reapply-failed');
            }
        }
        const styleState = window.DashBridgeGrafanaVisualEngine?.getLocalStyleDebug?.({
            root: targetRoot,
            removeFill: !!tools.removeFill,
            thickenLines: !!tools.thickenLines,
        }) || null;
        return {
            panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null,
            targetRootClass: targetRoot?.className || '',
            engineResult,
            styleState,
            legendVisibilityApplied,
            legendVisibilityDeferred: legendVisibilityApplied === false
                && canDeferLegendVisibilityApply(),
        };
    };
    const observePersistentVisualState = () => {
        const targetPanel = getTargetPanel();
        const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
        const renderer = window.DashBridgeGrafanaVisualEngine?.findUPlot?.(root) || null;
        const canvas = root?.querySelector?.('canvas') || null;
        const styleState = window.DashBridgeGrafanaVisualEngine?.getLocalStyleDebug?.({
            root,
            removeFill: !!tools.removeFill,
            thickenLines: !!tools.thickenLines,
        }) || null;
        const styleMatches = (!tools.removeFill || styleState?.fillMatchesExpected === true)
            && (!tools.thickenLines || styleState?.widthMatchesExpected === true);
        return { renderer, canvas, styleState, styleMatches };
    };
    const waitForCommittedVisualState = async generation => {
        const pollMs = 100;
        const stableWindowMs = 700;
        const timeoutMs = 3500;
        const startedAt = Date.now();
        let stableSince = 0;
        let previousRenderer = null;
        let previousCanvas = null;
        let adaptiveAttempt = 0;
        while (Date.now() - startedAt < timeoutMs) {
            if (generation !== visualStyleReapplyGeneration || !hasPersistentVisualWork()) {
                return { status: 'cancelled', reason: generation !== visualStyleReapplyGeneration
                    ? 'superseded-by-newer-query' : 'settings-no-longer-active' };
            }
            visualReapplyDiagnostic.settleInspections += 1;
            const observed = observePersistentVisualState();
            const rendererChanged = previousRenderer !== null
                && (observed.renderer !== previousRenderer || observed.canvas !== previousCanvas);
            const needsApply = !observed.styleMatches || rendererChanged;
            if (needsApply) {
                if (rendererChanged) visualReapplyDiagnostic.rendererReplacements += 1;
                if (!observed.styleMatches) visualReapplyDiagnostic.styleDrifts += 1;
                recordVisualReapply(rendererChanged ? 'renderer-replaced' : 'style-drift', {
                    generation,
                    rendererInstanceId: observed.styleState?.rendererInstanceId || null,
                    styleState: observed.styleState,
                });
                try {
                    const appliedState = await applyPersistentVisualState();
                    adaptiveAttempt += 1;
                    visualReapplyDiagnostic.completed += 1;
                    visualReapplyDiagnostic.adaptiveReapplies += 1;
                    visualReapplyDiagnostic.lastCompletedAt = Date.now();
                    recordVisualReapply('adaptive-completed', {
                        generation,
                        adaptiveAttempt,
                        ...appliedState,
                    });
                } catch (error) {
                    visualReapplyDiagnostic.errors += 1;
                    visualReapplyDiagnostic.lastError = error?.message || String(error);
                    recordVisualReapply('adaptive-error', {
                        generation,
                        adaptiveAttempt: adaptiveAttempt + 1,
                        name: error?.name || 'Error',
                        message: error?.message || String(error),
                        stack: String(error?.stack || ''),
                    });
                }
                const afterApply = observePersistentVisualState();
                previousRenderer = afterApply.renderer;
                previousCanvas = afterApply.canvas;
                stableSince = afterApply.styleMatches ? Date.now() : 0;
            } else {
                if (previousRenderer === null) {
                    previousRenderer = observed.renderer;
                    previousCanvas = observed.canvas;
                    stableSince = Date.now();
                } else if (!stableSince) {
                    stableSince = Date.now();
                }
                if (stableSince && Date.now() - stableSince >= stableWindowMs) {
                    return {
                        status: 'stable',
                        elapsedMs: Date.now() - startedAt,
                        stableForMs: Date.now() - stableSince,
                        adaptiveAttempts: adaptiveAttempt,
                        styleState: observed.styleState,
                    };
                }
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
        }
        visualReapplyDiagnostic.settleTimeouts += 1;
        const finalState = observePersistentVisualState();
        return {
            status: 'timeout',
            elapsedMs: Date.now() - startedAt,
            adaptiveAttempts: adaptiveAttempt,
            styleState: finalState.styleState,
            styleMatches: finalState.styleMatches,
        };
    };
    const reapplyVisualStylesAfterDataTransform = () => {
        if (!hasPersistentVisualWork() || visualStyleReapplyFrame) return;
        const generation = ++visualStyleReapplyGeneration;
        const delays = [0, 80, 180, 350];
        visualReapplyDiagnostic.requested += 1;
        visualReapplyDiagnostic.pending = true;
        visualReapplyDiagnostic.activeGeneration = generation;
        visualReapplyDiagnostic.attemptsPlanned = delays.length;
        visualReapplyDiagnostic.attemptsFinished = 0;
        visualReapplyDiagnostic.pendingSince = Date.now();
        recordVisualReapply('scheduled', {
            generation,
            removeFill: !!tools.removeFill,
            thickenLines: !!tools.thickenLines,
            invertLegend: !!tools.invertLegend,
            explicitLegendVisibility: hasExplicitLegendVisibilityWork(),
        });
        // Start on the next paint boundary, not one frame later.  A double RAF
        // let Grafana expose a freshly rebuilt Flot canvas with its native fill
        // for one visible frame before DashBridge restored style-only state.
        // The settling retries and renderer-replacement guard below still cover
        // React commits which happen after this first attempt.
        visualStyleReapplyFrame = requestAnimationFrame(async () => {
            visualStyleReapplyFrame = null;
            // A Grafana query response arrives before React/uPlot necessarily
            // commits the replacement renderer. Reapply as a short settling
            // burst so both an in-place data update and a later chart remount
            // receive the persisted settings.
            let deferredLegendVisibilityRestored = !legendVisibilityRestoreAfterNextQuery;
            for (let attempt = 0; attempt < delays.length; attempt += 1) {
                if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                if (generation !== visualStyleReapplyGeneration || !hasPersistentVisualWork()) {
                    visualReapplyDiagnostic.cancelled += 1;
                    recordVisualReapply('cancelled', {
                        reason: generation !== visualStyleReapplyGeneration ? 'superseded-by-newer-query' : 'settings-no-longer-active',
                        generation,
                        attempt: attempt + 1,
                    });
                    if (generation === visualReapplyDiagnostic.activeGeneration) {
                        visualReapplyDiagnostic.pending = false;
                        visualReapplyDiagnostic.finishedAt = Date.now();
                    }
                    return;
                }
                try {
                    const appliedState = await applyPersistentVisualState();
                    if (appliedState.legendVisibilityApplied === true) {
                        deferredLegendVisibilityRestored = true;
                    }
                    visualReapplyDiagnostic.completed += 1;
                    visualReapplyDiagnostic.attemptsFinished = attempt + 1;
                    visualReapplyDiagnostic.lastCompletedAt = Date.now();
                    recordVisualReapply('completed', {
                        generation,
                        attempt: attempt + 1,
                        ...appliedState,
                    });
                } catch (error) {
                    visualReapplyDiagnostic.errors += 1;
                    visualReapplyDiagnostic.lastError = error?.message || String(error);
                    recordVisualReapply('error', {
                        generation,
                        attempt: attempt + 1,
                        name: error?.name || 'Error',
                        message: error?.message || String(error),
                        stack: String(error?.stack || ''),
                    });
                }
            }
            // A source-filter OFF command can restore the complete legend only
            // after Grafana has rendered the first native response. Keep the
            // request active for the whole settling burst so an early attempt
            // against the old one-series legend cannot consume it.
            if (generation === visualStyleReapplyGeneration && legendVisibilityRestoreAfterNextQuery
                && deferredLegendVisibilityRestored) {
                legendVisibilityRestoreAfterNextQuery = false;
                recordVisualReapply('legend-visibility-restore-consumed', { generation });
            } else if (generation === visualStyleReapplyGeneration && legendVisibilityRestoreAfterNextQuery) {
                recordVisualReapply('legend-visibility-restore-pending', {
                    generation,
                    reason: 'native-legend-not-restored',
                });
            }
            const committed = await waitForCommittedVisualState(generation);
            recordVisualReapply(`commit-${committed.status}`, { generation, ...committed });
            if (committed.status === 'cancelled') {
                visualReapplyDiagnostic.cancelled += 1;
                if (generation === visualReapplyDiagnostic.activeGeneration) {
                    visualReapplyDiagnostic.pending = false;
                    visualReapplyDiagnostic.finishedAt = Date.now();
                }
                return;
            }
            if (generation === visualReapplyDiagnostic.activeGeneration) {
                visualReapplyDiagnostic.pending = false;
                visualReapplyDiagnostic.finishedAt = Date.now();
                recordVisualReapply('settled', {
                    generation,
                    attemptsFinished: visualReapplyDiagnostic.attemptsFinished,
                    committed,
                });
            }
        });
    };
    const consumeVisualStylesAfterQuery = () => {
        if (hasPersistentVisualWork()) {
            // Every Grafana data refresh (manual or automatic) can replace renderer
            // objects, so reapply directly after each observed response.
            reapplyVisualStylesAfterDataTransform();
        }
        if (thresholdRestoreAfterNextQuery && tools.thresholdEnabled) {
            // A response filter is allowed to remove every series and therefore
            // the renderer itself. Re-enable the saved threshold only after the
            // first unfiltered response, when uPlot/Flot can be mounted again.
            void applyThresholdWhenChartReady().then(() => {
                const status = window.__dashbridgeThresholdDiagnostic?.status;
                if (status?.enabled === true && status.engine && status.engine !== 'unknown') {
                    thresholdRestoreAfterNextQuery = false;
                }
            }).catch(() => { /* A panel can unmount again while Grafana commits the response. */ });
        }
    };

    const reportThreshold = async () => {
        const targetPanel = getTargetPanel();
        const thresholdRoot = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
        const panelId = getPanelStateKey(targetPanel) || tools.targetPanelId || '';
        const thresholdCanApply = !!tools.thresholdEnabled
            && (!tools.convertMemToUsed || visualMetadata.memoryConversionApplied === true);
        let unitDetails = null;
        if (thresholdCanApply) {
            unitDetails = await window.DashBridgeGrafanaVisualEngine?.getThresholdUnitAsync?.({ root: thresholdRoot, panelId }) || null;
        }
        const status = window.DashBridgeGrafanaVisualEngine?.setThreshold?.({
            root: thresholdRoot,
            enabled: thresholdCanApply,
            value: Number(tools.thresholdValue),
            rawValue: tools.thresholdRawValue
        }) || { enabled: false, exceeded: false };
        // Keep a compact, serialisable acknowledgement for the E2E report. This
        // distinguishes "threshold command was never run" from "the engine
        // ran but could not resolve the selected panel's chart".
        window.__dashbridgeThresholdDiagnostic = {
            at: Date.now(),
            panelId,
            enabled: !!tools.thresholdEnabled,
            requested: {
                value: Number(tools.thresholdValue),
                rawValue: tools.thresholdRawValue ?? null,
            },
            panelFound: !!targetPanel,
            rootClass: thresholdRoot?.className || '',
            unitEngine: unitDetails?.engine || '',
            suppressedReason: tools.thresholdEnabled && !thresholdCanApply ? 'memory-conversion-not-applied' : '',
            status: { ...status }
        };
        status.thresholdNotifyEnabled = tools.thresholdNotifyEnabled !== false;
        const panelHeader = targetPanel?.querySelector?.('[data-testid*="Panel header"]')
            || targetPanel?.closest?.('[data-testid*="Panel header"]')
            || document.querySelector('[data-testid*="Panel header"]');
        const titleElement = panelHeader?.querySelector('h6[title], h6, .panel-title')
            || document.querySelector('.panel-title, h6[title]');
        status.panelTitle = titleElement?.getAttribute('title')
            || titleElement?.textContent?.trim()
            || panelHeader?.getAttribute('data-testid')?.replace(/^.*Panel header\s*/i, '').trim()
            || 'Панель Grafana';
        renderNativeThresholdFeedback({ targetPanel, panelHeader, title: status.panelTitle, status });
        if (isDashboardIframe) {
            window.parent.postMessage({ action: 'panelThresholdStatus', status }, extensionOrigin);
        }
    };

    const startThresholdReporting = async () => {
        if (typeof window.__dashbridgeThresholdDataListener === 'function') {
            window.removeEventListener('dashbridgeThresholdDataUpdated', window.__dashbridgeThresholdDataListener);
        }
        // Do not resolve the command acknowledgement before the first threshold
        // application completes. The E2E runner captures immediately after it.
        await reportThreshold();
        if (tools.thresholdEnabled) {
            window.__dashbridgeThresholdDataListener = reportThreshold;
            window.addEventListener('dashbridgeThresholdDataUpdated', window.__dashbridgeThresholdDataListener);
        }
    };

    const startThresholdReportingSoon = () => {
        void startThresholdReporting().catch(() => { /* A panel can unmount during refresh. */ });
    };

    // BUG-A fix: добавлен таймаут 10 сек — если график не появился, observer отключается
    // и промис резолвится, чтобы не зависать навечно.
    const applyThresholdWhenChartReady = () => new Promise(resolve => {
        window.__dashbridgeThresholdReadyObserver?.disconnect();
        let applied = false;
        const finish = () => {
            if (applied) return;
            applied = true;
            clearTimeout(timeout);
            window.__dashbridgeThresholdReadyObserver?.disconnect();
            window.__dashbridgeThresholdReadyObserver = null;
            void startThresholdReporting().finally(resolve);
        };
        const tryApply = () => {
            if (applied) return;
            const targetPanel = getTargetPanel();
            const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
            if (!window.DashBridgeGrafanaVisualEngine?.isChartReady?.(root)) return;
            finish();
        };
        // Таймаут 10 секунд: если график не появился — всё равно резолвим промис,
        // чтобы не блокировать вызывающий код.
        const timeout = setTimeout(finish, 10_000);
        window.__dashbridgeThresholdReadyObserver = new MutationObserver(tryApply);
        window.__dashbridgeThresholdReadyObserver.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'width', 'height']
        });
        tryApply();
    });

    // Batch identifies duplicate legend labels by occurrence key. The Popup
    // painter intentionally uses names, so keep this narrow key-aware path
    // only for Batch requests.
    const resolveLegendVisibilityDesired = (visibility, key) => {
        const hasOwn = candidate => Object.prototype.hasOwnProperty.call(visibility, candidate);
        if (hasOwn(key)) return visibility[key] !== false;

        // Response transforms may rename the same logical field while a saved
        // key-aware legend selection remains active. Keep the occurrence suffix
        // stable and recognise only the reversible CPU label owned by
        // transformCpuData; unrelated series still require an exact key.
        const separatorIndex = key.lastIndexOf('\u0000');
        const label = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
        const occurrenceSuffix = separatorIndex >= 0 ? key.slice(separatorIndex) : '';
        const idleKeyword = String(tools.idleKeyword || 'idle');
        const idlePattern = new RegExp(escapeKeywordRegExp(idleKeyword), 'gi');
        const loadPattern = /load\s*\(calc\)/gi;
        const aliases = [];
        const originalIdleLabel = label.replace(loadPattern, idleKeyword);
        if (originalIdleLabel !== label) aliases.push(`${originalIdleLabel}${occurrenceSuffix}`);
        const calculatedLoadLabel = label.replace(idlePattern, 'load (calc)');
        if (calculatedLoadLabel !== label) aliases.push(`${calculatedLoadLabel}${occurrenceSuffix}`);
        const memoryIdentity = candidate => {
            const candidateSeparator = candidate.lastIndexOf('\u0000');
            const candidateLabel = candidateSeparator >= 0 ? candidate.slice(0, candidateSeparator) : candidate;
            const candidateOccurrence = candidateSeparator >= 0 ? candidate.slice(candidateSeparator) : '';
            const totalPattern = new RegExp(escapeKeywordRegExp(String(tools.totalKeyword || 'total')), 'gi');
            const availablePattern = new RegExp(escapeKeywordRegExp(String(tools.availKeyword || 'available')), 'gi');
            const calculatedPattern = /used\s*%\s*\(calc\)/gi;
            let server = candidateLabel;
            let recognised = false;
            for (const pattern of [calculatedPattern, totalPattern, availablePattern]) {
                const next = server.replace(pattern, '');
                if (next !== server) recognised = true;
                server = next;
            }
            if (!recognised) return null;
            if (tools.trimDomainEnabled !== false) {
                const domainPattern = new RegExp(escapeKeywordRegExp(String(tools.trimDomain || '.passport.local:9182')), 'gi');
                server = server.replace(domainPattern, '').replace(/:\d+$/, '');
            }
            return `${server.replace(/\s+/g, ' ').trim().toLowerCase()}${candidateOccurrence}`;
        };
        const currentMemoryIdentity = memoryIdentity(key);
        if (currentMemoryIdentity) {
            const memoryAlias = Object.keys(visibility)
                .find(candidate => memoryIdentity(candidate) === currentMemoryIdentity);
            if (memoryAlias) aliases.push(memoryAlias);
        }
        const alias = aliases.find(hasOwn);
        return alias ? visibility[alias] !== false : true;
    };

    const applyLegendVisibilityByKey = async (visibility = tools.legendVisibility) => {
        const diagnostic = {
            at: Date.now(),
            runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration || null,
            requested: visibility,
            requestedType: visibility === null ? 'null' : typeof visibility,
            success: false,
            attempts: [],
            entries: [],
        };
        if (!visibility || typeof visibility !== 'object') {
            diagnostic.reason = 'visibility-not-object';
            window.__dashbridgeLegendVisibilityDiagnostic = diagnostic;
            return false;
        }
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const getNativeControl = item => {
            for (const button of item.querySelectorAll('button')) {
                const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
                for (let fiber = fiberKey && button[fiberKey], depth = 0;
                    fiber && depth < 32; depth += 1, fiber = fiber.return) {
                    const props = fiber.memoizedProps;
                    if (props?.item && typeof props.onLabelClick === 'function') {
                        // Grafana 12 exposes a row-local onLabelClick as well as
                        // the owning legend callback higher in the Fiber tree.
                        // The local callback can update the painted row without
                        // committing item.disabled. That made hiding appear to
                        // work, but a later reset could never restore the native
                        // state. Use the callback which owns the complete items
                        // array, just like the proven visual-engine native path.
                        for (let parent = fiber, parentDepth = depth;
                            parent && parentDepth < 48;
                            parent = parent.return, parentDepth += 1) {
                            const parentProps = parent.memoizedProps;
                            if (!Array.isArray(parentProps?.items)
                                || typeof parentProps.onLabelClick !== 'function') continue;
                            // Identity is intentional: labels are not unique and
                            // Batch addresses duplicates by occurrence key.
                            const runtimeItem = parentProps.items.find(candidate => candidate === props.item);
                            if (!runtimeItem) continue;
                            return {
                                item: runtimeItem,
                                onLabelClick: parentProps.onLabelClick,
                                source: 'legend-items-owner',
                                fiberDepth: depth,
                                ownerDepth: parentDepth,
                                ownerItems: parentProps.items.length,
                            };
                        }
                        return {
                            item: props.item,
                            onLabelClick: props.onLabelClick,
                            source: 'row-fallback',
                            fiberDepth: depth,
                            ownerDepth: null,
                            ownerItems: null,
                        };
                    }
                }
            }
            return null;
        };
        const readEntries = () => {
            const occurrences = new Map();
            return getLegendItems().map(item => {
                const target = getLegendLabel(item);
                const name = (target.textContent || '').trim();
                if (!name) return null;
                const occurrence = occurrences.get(name) || 0;
                occurrences.set(name, occurrence + 1);
                const key = `${name}\u0000${occurrence}`;
                const control = getNativeControl(item);
                const classes = `${item.className || ''} ${target.className || ''}`.toLowerCase();
                const opacity = Number.parseFloat(getComputedStyle(item).opacity || '1');
                const nativeDisabled = control?.item?.disabled === true;
                const paintedVisible = !classes.includes('hidden') && !classes.includes('disabled')
                    && opacity >= 0.6;
                const current = !nativeDisabled && paintedVisible;
                return {
                    key, item, target, control, current, paintedVisible,
                    desired: resolveLegendVisibilityDesired(visibility, key), nativeDisabled,
                    opacity, hiddenClass: classes.includes('hidden'), disabledClass: classes.includes('disabled'),
                    fastHidden: item.classList.contains('dashbridge-uplot-fast-hidden'),
                    fastDimmed: item.classList.contains('dashbridge-uplot-fast-dimmed'),
                };
            }).filter(Boolean);
        };
        let lastNativeVisibilityWait = null;
        const waitForNativeVisibility = async (key, desired) => {
            const startedAt = performance.now();
            const deadline = startedAt + 2000;
            let frames = 0;
            let paintedMatchFrames = 0;
            while (performance.now() < deadline && frames < 240) {
                const entry = readEntries().find(candidate => candidate.key === key);
                // Native React state and the actually painted legend row must
                // agree. React can flip item.disabled one frame before it
                // removes the disabled class/opacity from the DOM.
                if (entry?.nativeDisabled === !desired && entry.current === desired) {
                    lastNativeVisibilityWait = {
                        frames,
                        elapsedMs: Math.round(performance.now() - startedAt),
                        timedOut: false,
                        acceptance: 'native-and-painted',
                        nativeCommitted: true,
                        paintedCommitted: true,
                    };
                    return entry;
                }
                // Grafana 12 commits the row's painted state immediately but
                // can keep the Fiber item.disabled value unchanged until the
                // next query-driven render. This is a valid pre-Refresh state:
                // require four consecutive painted frames, then let the causal
                // Refresh + semantic invariant prove the native commit.
                paintedMatchFrames = entry?.paintedVisible === desired
                    ? paintedMatchFrames + 1 : 0;
                if (paintedMatchFrames >= 4) {
                    lastNativeVisibilityWait = {
                        frames,
                        elapsedMs: Math.round(performance.now() - startedAt),
                        timedOut: false,
                        acceptance: 'painted-awaiting-native-refresh',
                        nativeCommitted: false,
                        paintedCommitted: true,
                        paintedMatchFrames,
                    };
                    return entry;
                }
                frames += 1;
                // requestAnimationFrame may run much faster than React commits
                // in the test-runner tab. A wall-clock guard prevents 60 quick
                // frames from producing a false native-legend-apply-failed.
                await Promise.race([
                    nextFrame(),
                    new Promise(resolve => setTimeout(resolve, 25)),
                ]);
            }
            lastNativeVisibilityWait = {
                frames,
                elapsedMs: Math.round(performance.now() - startedAt),
                timedOut: true,
                acceptance: 'timeout',
                nativeCommitted: false,
                paintedCommitted: false,
                paintedMatchFrames,
            };
            return null;
        };
        for (const entry of readEntries()) {
            if (entry.current === entry.desired) continue;
            const attempt = {
                key: entry.key,
                desired: entry.desired,
                beforeNativeDisabled: entry.nativeDisabled,
                method: '',
                controlSource: entry.control?.source || null,
                controlFiberDepth: entry.control?.fiberDepth ?? null,
                controlOwnerDepth: entry.control?.ownerDepth ?? null,
                controlOwnerItems: entry.control?.ownerItems ?? null,
            };
            try {
                if (entry.control) {
                    attempt.method = 'react-onLabelClick';
                    entry.control.onLabelClick(entry.control.item, {
                        type: 'click', ctrlKey: true, metaKey: false, shiftKey: false,
                        currentTarget: null, target: null,
                        nativeEvent: { ctrlKey: true, metaKey: false, shiftKey: false },
                        preventDefault() { }, stopPropagation() { }
                    });
                } else {
                    attempt.method = 'dom-click-fallback';
                    const init = { bubbles: true, cancelable: true, ctrlKey: true, metaKey: true, view: window };
                    entry.target.dispatchEvent(new PointerEvent('pointerdown', init));
                    entry.target.dispatchEvent(new MouseEvent('mousedown', init));
                    entry.target.dispatchEvent(new PointerEvent('pointerup', init));
                    entry.target.dispatchEvent(new MouseEvent('mouseup', init));
                    entry.target.dispatchEvent(new MouseEvent('click', init));
                }
            } catch (error) {
                attempt.error = error?.message || String(error);
            }
            const applied = await waitForNativeVisibility(entry.key, entry.desired);
            attempt.verification = lastNativeVisibilityWait;
            const observedAfter = applied || readEntries().find(candidate => candidate.key === entry.key) || null;
            attempt.afterNativeDisabled = observedAfter?.nativeDisabled ?? null;
            attempt.afterCurrent = observedAfter?.current ?? null;
            attempt.afterPaintedVisible = observedAfter?.paintedVisible ?? null;
            attempt.afterOpacity = observedAfter?.opacity ?? null;
            attempt.afterHiddenClass = observedAfter?.hiddenClass ?? null;
            attempt.afterDisabledClass = observedAfter?.disabledClass ?? null;
            attempt.afterFastHidden = observedAfter?.fastHidden ?? null;
            attempt.afterFastDimmed = observedAfter?.fastDimmed ?? null;
            attempt.applied = !!applied;
            diagnostic.attempts.push(attempt);
            if (!applied) break;
        }
        const entries = readEntries();
        diagnostic.nativeSuccess = entries.length > 0
            && entries.every(entry => entry.nativeDisabled === !entry.desired);
        diagnostic.paintedSuccess = entries.length > 0
            && entries.every(entry => entry.paintedVisible === entry.desired);
        diagnostic.success = diagnostic.paintedSuccess;
        diagnostic.entries = entries.map(entry => ({
            key: entry.key, desired: entry.desired, nativeDisabled: entry.nativeDisabled,
            current: entry.current, paintedVisible: entry.paintedVisible, hasReactControl: !!entry.control,
            opacity: entry.opacity, hiddenClass: entry.hiddenClass, disabledClass: entry.disabledClass,
            fastHidden: entry.fastHidden, fastDimmed: entry.fastDimmed,
        }));
        window.__dashbridgeLegendVisibilityDiagnostic = diagnostic;
        debugLog('Legend visibility result:', diagnostic);
        return diagnostic.success;
    };

    const isVisualEngineReady = (targetPanel, root) => {
        if (!window.DashBridgeGrafanaVisualEngine?.isChartReady?.(root)) return false;
        const canvas = root.querySelector?.('canvas');
        const canvasRect = canvas?.getBoundingClientRect?.();
        if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return false;
        if (!tools.legendFilter?.length) return true;
        const chartSeriesCount = window.DashBridgeGrafanaVisualEngine.getChartSeriesCount?.(root);
        const legendSeriesCount = getLegendItems()
            .filter(item => (getLegendLabel(item).textContent || '').trim()).length;
        return Number.isInteger(chartSeriesCount) && chartSeriesCount > 0
            && legendSeriesCount === chartSeriesCount;
    };
    // A narrow card can mount the right-hand legend before it has enough width
    // for Grafana to create a canvas. Move that DOM layout first; the normal
    // readiness path below still waits for the canvas before styling a chart.
    const isLegendLayoutReady = root => !!tools.invertLegend
        && !!root?.querySelector?.('.graph-panel__chart')
        && !!root?.querySelector?.('.graph-legend');

    // Grafana can report document readiness before its legend is complete.
    // Observe the mount and apply visual work once the chart structure agrees.
    const applyPopupVisualEngineWhenReady = () => new Promise(resolve => {
        window.__dashbridgeChartReadyCancel?.();
        let applying = false;
        let legendLayoutApplied = false;
        let legendLayoutApplying = false;
        let settled = false;
        let timeout = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            window.__dashbridgeChartReadyObserver?.disconnect();
            window.__dashbridgeChartReadyObserver = null;
            if (window.__dashbridgeChartReadyCancel === finish) {
                window.__dashbridgeChartReadyCancel = null;
            }
            resolve();
        };
        window.__dashbridgeChartReadyCancel = finish;
        const applyLegendLayoutBeforeChart = async targetPanel => {
            if (legendLayoutApplied || legendLayoutApplying) return;
            const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
            if (!isLegendLayoutReady(root)) return;
            legendLayoutApplying = true;
            try {
                await window.DashBridgeGrafanaVisualEngine?.apply({
                    panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null,
                    invertLegend: true
                });
                legendLayoutApplied = true;
            } finally {
                legendLayoutApplying = false;
            }
        };
        const tryApply = async () => {
            if (applying || settled) return;
            const targetPanel = getTargetPanel();
            const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
            if (!isVisualEngineReady(targetPanel, root)) {
                const renderedTable = Array.from(root.querySelectorAll?.('table,[role="table"],[role="grid"]') || [])
                    .some(element => !element.closest?.('.graph-legend,.u-legend,[class*="legend" i]'));
                const chartSurface = root.querySelector?.('canvas,.flot-base,.uplot,.graph-panel__chart');
                // Table panels never mount a chart renderer. Waiting for one
                // leaves a document-wide observer alive and delays the command
                // until the outer 20-second bridge timeout.
                if (renderedTable && !chartSurface) {
                    finish();
                    return;
                }
                await applyLegendLayoutBeforeChart(targetPanel);
                return;
            }
            applying = true;
            const visualLegendFilter = getVisualLegendFilter(tools);
            const hidden = new Set((visualLegendFilter || []).map(name => String(name)));
            const seriesConfig = Object.fromEntries(getLegendSeries().map(name => [name, !hidden.has(name)]));
            const fastLegend = visualLegendFilter?.length
                && await window.DashBridgeGrafanaVisualEngine?.applySeriesVisibility?.({
                    root,
                    seriesConfig: hasLegendVisibilityWork(tools) ? seriesConfig : null,
                    mode: tools.legendMode || 'fast_complete_hide'
                });
            if (!fastLegend || tools.removeFill || tools.thickenLines || tools.invertLegend) {
                await window.DashBridgeGrafanaVisualEngine?.apply({
                    panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null,
                    seriesConfig: hasLegendVisibilityWork(tools) ? seriesConfig : null,
                    mode: tools.legendMode || 'fast_complete_hide',
                    removeFill: tools.removeFill,
                    thickenLines: tools.thickenLines,
                    thickenLinesValue: tools.thickenLinesValue !== undefined ? Number(tools.thickenLinesValue) : 1.5,
                    invertLegend: tools.invertLegend
                });
            }
            await startThresholdReporting();
            finish();
        };
        window.__dashbridgeChartReadyObserver = new MutationObserver(() => { void tryApply(); });
        window.__dashbridgeChartReadyObserver.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'width', 'height']
        });
        timeout = setTimeout(finish, 18_000);
        void tryApply();
    });

    const isQueryUrl = url => /api\/(ds|tsdb)\/query|api\/datasources\/proxy/.test(url || '');
    const getFieldText = field => [
        field.name, field.config?.displayName, field.config?.displayNameFromDS,
        ...Object.values(field.labels || {})
    ].filter(Boolean).join(' ').toLowerCase();
    const escapeKeywordRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const trimResponseDomainLabels = data => {
        if (!data?.results || tools.trimDomainEnabled !== true) return { data, modifiedCount: 0 };
        const suffix = String(tools.trimDomain || '.passport.local:9182');
        if (!suffix) return { data, modifiedCount: 0 };
        const pattern = new RegExp(escapeKeywordRegExp(suffix), 'ig');
        let modifiedCount = 0;
        const trim = value => {
            if (typeof value !== 'string') return value;
            const next = value.replace(pattern, '');
            if (next !== value) modifiedCount += 1;
            return next;
        };
        Object.values(data.results).forEach(result => (result.frames || []).forEach(frame => {
            if (typeof frame.schema?.name === 'string') frame.schema.name = trim(frame.schema.name);
            (frame.schema?.fields || []).forEach(field => {
                field.name = trim(field.name);
                if (field.config) {
                    field.config.displayName = trim(field.config.displayName);
                    field.config.displayNameFromDS = trim(field.config.displayNameFromDS);
                }
                Object.keys(field.labels || {}).forEach(key => { field.labels[key] = trim(field.labels[key]); });
            });
        }));
        return { data, modifiedCount };
    };

    // This is intentionally the same data algorithm used by the proven Popup
    // action «Инвертировать Idle → Load».  Keep it here, in MAIN world, so a
    // Dashboard card and the Popup cannot gradually acquire different rules.
    const transformCpuData = data => {
        let modifiedCount = 0;
        const idleKeyword = String(tools.idleKeyword || 'idle').toLowerCase();
        const idlePattern = new RegExp(escapeKeywordRegExp(idleKeyword), 'gi');
        if (!data?.results) return { data, modifiedCount };
        const cpuFieldHasIdle = field => {
            if (field.config?.displayName?.toLowerCase().includes(idleKeyword)) return true;
            if (field.config?.displayNameFromDS?.toLowerCase().includes(idleKeyword)) return true;
            if (field.name?.toLowerCase().includes(idleKeyword)) return true;
            return Object.entries(field.labels || {}).some(([key, value]) =>
                !['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase()) &&
                String(value).toLowerCase().includes(idleKeyword)
            );
        };
        // BUG-D fix: trimCpuServerLabel и trimCpuServerText были идентичны — оставлена одна функция.
        const trimCpuServerLabel = value => {
            if (tools.trimDomainEnabled === false) return String(value);
            const domain = String(tools.trimDomain || '.passport.local:9182').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return String(value).replace(new RegExp(`${domain}(?::\\d+)?`, 'ig'), '');
        };
        const trimCpuServerText = trimCpuServerLabel;

        Object.values(data.results).forEach(result => {
            let hasIdle = false;
            (result.frames || []).forEach(frame => (frame.schema?.fields || []).forEach(field => {
                if (cpuFieldHasIdle(field)) hasIdle = true;
            }));
            if (!hasIdle) return;

            (result.frames || []).forEach(frame => {
                let fieldsToKeep = [];
                let valuesToKeep = [];
                (frame.schema?.fields || []).forEach((field, index) => {
                    let isMatch = false;
                    const replaceIdle = value => String(value).replace(idlePattern, 'load (calc)');

                    Object.entries(field.labels || {}).forEach(([key, value]) => {
                        if (['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) {
                            if (tools.trimDomainEnabled !== false) field.labels[key] = trimCpuServerLabel(value);
                            return;
                        }
                        if (String(value).toLowerCase().includes(idleKeyword)) {
                            isMatch = true;
                            field.labels[key] = replaceIdle(value);
                        }
                    });
                    if (field.config?.displayName?.toLowerCase().includes(idleKeyword)) {
                        isMatch = true;
                        field.config.displayName = trimCpuServerText(replaceIdle(field.config.displayName));
                    }
                    if (field.config?.displayNameFromDS?.toLowerCase().includes(idleKeyword)) {
                        isMatch = true;
                        field.config.displayNameFromDS = trimCpuServerText(replaceIdle(field.config.displayNameFromDS));
                    }
                    if (field.name?.toLowerCase().includes(idleKeyword)) {
                        isMatch = true;
                        field.name = trimCpuServerText(replaceIdle(field.name));
                    }
                    if (isMatch) Object.entries(field.labels || {}).forEach(([key, value]) => {
                        if (!['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) {
                            field.labels[key] = trimCpuServerText(value);
                        }
                    });

                    if (isMatch || field.type === 'time' || field.name === 'Time') {
                        if (isMatch) {
                            modifiedCount++;
                            const values = frame.data?.values?.[index] || [];
                            for (let i = 0; i < values.length; i++) {
                                if (values[i] !== null && typeof values[i] === 'number') values[i] = 100 - values[i];
                            }
                        }
                        fieldsToKeep.push(field);
                        valuesToKeep.push(frame.data?.values?.[index]);
                    }
                });

                frame.schema.fields = fieldsToKeep;
                frame.data.values = valuesToKeep;
            });
            result.frames = (result.frames || []).filter(frame => (frame.schema?.fields || []).length > 1);
        });
        return { data, modifiedCount };
    };

    // Same RAM conversion rules as the Popup action «Конвертировать график в
    // % Used»: correlate Total and Available/Used across Grafana query
    // results, remove the source memory frames, then add calculated frames.
    const transformMemData = data => {
        let modifiedCount = 0;
        if (!data?.results) return { data, modifiedCount, applied: false, reason: 'no-results' };
        const totalKeyword = String(tools.totalKeyword || 'total').toLowerCase();
        const availKeyword = String(tools.availKeyword || 'available').toLowerCase();
        const memCalcMode = tools.memCalcMode === 'used' || tools.memCalcMode === 'available'
            ? tools.memCalcMode
            : (availKeyword.includes('used') ? 'used' : 'available');
        const totalPattern = new RegExp(escapeKeywordRegExp(totalKeyword), 'gi');
        const availPattern = new RegExp(escapeKeywordRegExp(availKeyword), 'gi');
        const escapedDomain = String(tools.trimDomain || '.passport.local:9182').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const domainRegex = new RegExp(escapedDomain, 'i');
        const serverFrames = {};

        // BUG-K fix: ключ строится из того же набора источников, что и классификация поля
        // (instance > host > server > node > displayName > displayNameFromDS > name).
        // BUG-C fix: .replace(/:/g,'') заменён на точечную очистку только хвостового порта (:NNNN),
        // чтобы IP-адреса вида 10.0.0.1:9100 не склеивались в 10.0.0.19100.
        const buildServerKey = (field, fieldIndex, refId) => {
            const instance = field.labels?.instance || field.labels?.host || field.labels?.server || field.labels?.node || '';
            const display = field.config?.displayName || field.config?.displayNameFromDS || field.name || '';
            const rawServer = String(instance || display)
                .replace(totalPattern, '')
                .replace(availPattern, '');
            // Удаляем суффикс домена, затем только хвостовой порт (:1234) — не все двоеточия.
            const trimmed = tools.trimDomainEnabled === false
                ? rawServer
                : rawServer.replace(domainRegex, '').replace(/:\d+$/, '');
            return trimmed.trim() || `unknown_server_${refId}_${fieldIndex}`;
        };

        Object.entries(data.results).forEach(([refId, result]) => (result.frames || []).forEach(frame => {
            const fields = frame.schema?.fields || [];
            fields.forEach((field, fieldIndex) => {
                const lowerName = getFieldText(field);
                const isTotal = lowerName.includes(totalKeyword);
                const isAvail = lowerName.includes(availKeyword);
                if (!isTotal && !isAvail) return;
                const server = buildServerKey(field, fieldIndex, refId);
                const item = serverFrames[server] || (serverFrames[server] = {
                    timeField: null, totalField: null, availField: null, originalRefId: refId
                });
                const timeIndex = fields.findIndex(candidate => candidate.type === 'time' || candidate.name === 'Time');
                if (timeIndex >= 0 && !item.timeField) {
                    item.timeField = { field: fields[timeIndex], values: frame.data.values[timeIndex] };
                }
                if (isTotal && !item.totalField) item.totalField = { field, values: frame.data.values[fieldIndex] };
                if (isAvail && !item.availField) item.availField = { field, values: frame.data.values[fieldIndex] };
            });
        }));

        const memoryPairs = Object.values(serverFrames);
        if (!memoryPairs.length) return { data, modifiedCount, applied: false, reason: 'no-memory-series' };
        const incompletePair = memoryPairs.some(item => !item.timeField || !item.totalField || !item.availField
            || typeof item.timeField.values?.map !== 'function'
            || !item.totalField.values || !item.availField.values);
        if (incompletePair) return { data, modifiedCount, applied: false, reason: 'incomplete-pair' };

        Object.values(data.results).forEach(result => {
            result.frames = (result.frames || []).filter(frame => !(frame.schema?.fields || []).some(field => {
                const text = getFieldText(field);
                return text.includes(totalKeyword) || text.includes(availKeyword) || /\b(used|available|total|free)\b/i.test(text);
            }));
        });

        Object.entries(serverFrames).forEach(([server, item]) => {
            if (!item.timeField || !item.totalField || !item.availField) return;
            const secondMetricIsUsed = memCalcMode === 'used';
            const values = item.timeField.values.map((_, index) => {
                const total = item.totalField.values[index];
                const available = item.availField.values[index];
                if (total === null || available === null || typeof total !== 'number' || typeof available !== 'number' || total <= 0) return null;
                return (secondMetricIsUsed ? available / total : (total - available) / total) * 100;
            });
            modifiedCount++;
            const field = JSON.parse(JSON.stringify(item.availField.field));
            field.name = `${server} Used % (calc)`;
            field.config = { ...(field.config || {}), displayName: field.name, unit: 'percent' };
            delete field.config.min;
            delete field.config.max;
            Object.keys(field.labels || {}).forEach(key => {
                if (!['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) field.labels[key] = field.name;
            });
            data.results[item.originalRefId]?.frames.push({
                schema: { name: server, refId: item.originalRefId, meta: {}, fields: [item.timeField.field, field] },
                data: { values: [item.timeField.values, values] }
            });
        });
        return { data, modifiedCount, applied: true, reason: 'converted' };
    };

    // A calculated RAM field carries unit=percent. Some Grafana renderers
    // retain that field config when the next query restores the native Total /
    // Available series. Values are then bytes again but are rendered as huge
    // percentages. Explicitly restore the byte unit on memory source fields.
    const restoreMemByteUnit = data => {
        let modifiedCount = 0;
        if (!data?.results) return { data, modifiedCount };
        const memoryKeywords = [
            String(tools.totalKeyword || 'total').toLowerCase(),
            String(tools.availKeyword || 'available').toLowerCase(),
            'used', 'free', 'cached', 'buffers'
        ].filter(Boolean);
        Object.values(data.results).forEach(result => (result.frames || []).forEach(frame => {
            (frame.schema?.fields || []).forEach((field, fieldIndex) => {
                if (field.type === 'time' || field.name === 'Time') return;
                const values = frame.data?.values?.[fieldIndex] || [];
                const numeric = field.type === 'number'
                    || values.some(value => typeof value === 'number' && Number.isFinite(value));
                if (!numeric || !memoryKeywords.some(keyword => getFieldText(field).includes(keyword))) return;
                field.config = { ...(field.config || {}), unit: 'bytes' };
                modifiedCount += 1;
            });
        }));
        return { data, modifiedCount };
    };

    const { getResponseTableFrameShape } = window.DashBridgeGrafanaTableReport;

    const targetPanelUsesTable = () => {
        const panel = window.DashBridgeGrafanaDom?.outerPanel?.(getTargetPanel()) || getTargetPanel();
        if (!panel || panel.querySelector?.('.graph-panel__chart, .uplot, .u-wrap')) return false;
        return Array.from(panel.querySelectorAll?.('th, [role="columnheader"]') || [])
            .some(header => /^(?:metric|value|метрика|значение)$/iu.test(String(header.textContent || '').trim()));
    };

    const collectResponseTableRecords = data => {
        const records = [];
        const MAX_TABLE_RECORDS = 5000;
        outer: for (const result of Object.values(data?.results || {})) {
            for (const frame of result.frames || []) {
                const shape = getResponseTableFrameShape(frame);
                if (!shape || (shape.timeIndexes.length && !targetPanelUsesTable())) continue;
                for (let index = 0; index < shape.rowCount; index++) {
                    if (records.length >= MAX_TABLE_RECORDS) break outer;
                const name = String(shape.columns[shape.nameIndex]?.[index] ?? '').trim();
                const value = Number(shape.columns[shape.valueIndex]?.[index]);
                if (name && Number.isFinite(value)) records.push({ name: name.substring(0, 500), value });
                }
            }
        }
        return records;
    };

    // Keeps only chart fields or table rows that reached the requested threshold. This runs
    // after CPU/RAM calculations, so their derived values are evaluated.
    //
    // The safety floor is deliberately response-global, not per frame. Grafana
    // often returns one numeric series per frame; retaining a fallback in every
    // such frame would silently retain every series and make filtering a no-op.
    const filterSeriesByThreshold = data => {
        const metrics = {
            enabled: !!tools.seriesQueryFilterEnabled,
            beforeSeries: 0,
            thresholdMatchedSeries: 0,
            safetyRetainedSeries: 0,
            removedSeries: 0,
            afterSeries: 0,
        };
        if (!data?.results || !tools.seriesQueryFilterEnabled) return { data, metrics };
        const rawThreshold = tools.seriesQueryFilterRawValue;
        const hasRawThreshold = rawThreshold !== null && rawThreshold !== undefined && rawThreshold !== ''
            && Number.isFinite(Number(rawThreshold));
        const threshold = hasRawThreshold
            ? Number(rawThreshold)
            : Number(tools.seriesQueryFilterValue);
        if (!Number.isFinite(threshold)) return { data, metrics: { ...metrics, invalidThreshold: true } };
        const mode = tools.seriesQueryFilterMode === 'last' ? 'last' : 'max';
        const getEvaluationValue = values => {
            if (mode === 'last') {
                for (let index = (values?.length || 0) - 1; index >= 0; index--) {
                    const value = values[index];
                    if (typeof value === 'number' && Number.isFinite(value)) return value;
                }
                return Number.NEGATIVE_INFINITY;
            }
            return (values || []).reduce((maximum, value) => (
                typeof value === 'number' && Number.isFinite(value) && value > maximum ? value : maximum
            ), Number.NEGATIVE_INFINITY);
        };
        const isSeriesAboveThreshold = value => {
            return value > threshold;
        };
        const timeSeriesFrames = [];
        const tablePanel = targetPanelUsesTable();

        Object.values(data.results).forEach(result => {
            result.frames = (result.frames || []).map(frame => {
                const fields = frame.schema?.fields || [];
                const timeIndexes = fields.map((field, index) => field.type === 'time' || field.name === 'Time' ? index : -1)
                    .filter(index => index >= 0);
                const tableShape = getResponseTableFrameShape(frame);
                if (tableShape && (!tableShape.timeIndexes.length || tablePanel)) {
                    const keptRowIndexes = [];
                    for (let index = 0; index < tableShape.rowCount; index++) {
                        const value = Number(tableShape.columns[tableShape.valueIndex]?.[index]);
                        metrics.beforeSeries += 1;
                        if (Number.isFinite(value) && isSeriesAboveThreshold(value)) {
                            metrics.thresholdMatchedSeries += 1;
                            keptRowIndexes.push(index);
                        }
                    }
                    const draft = { frame, tableShape, keptRowIndexes };
                    timeSeriesFrames.push(draft);
                    return draft;
                }
                // Variable query responses are not time series.
                if (!timeIndexes.length) return frame;
                const passthroughIndexes = [];
                const candidates = fields.map((field, index) => {
                    if (timeIndexes.includes(index)) return null;
                    const values = frame.data?.values?.[index] || [];
                    const numeric = field?.type === 'number' || (field?.type == null
                        && values.some(value => typeof value === 'number' && Number.isFinite(value)));
                    if (!numeric) {
                        passthroughIndexes.push(index);
                        return null;
                    }
                    const evaluationValue = getEvaluationValue(values);
                    return { index, evaluationValue, matched: isSeriesAboveThreshold(evaluationValue) };
                }).filter(Boolean);
                metrics.beforeSeries += candidates.length;
                metrics.thresholdMatchedSeries += candidates.filter(candidate => candidate.matched).length;
                const keptIndexes = [...timeIndexes, ...passthroughIndexes,
                    ...candidates.filter(candidate => candidate.matched).map(candidate => candidate.index)];
                const draft = { frame, timeIndexes, keptIndexes, candidates };
                timeSeriesFrames.push(draft);
                return draft;
            });
        });

        // An empty result is a valid outcome: no series exceeded the configured
        // threshold. Grafana will render No data, and report collection uses the
        // response metadata below to distinguish it from a datasource failure.

        Object.values(data.results).forEach(result => {
            result.frames = (result.frames || [])
                // Drop time-only drafts before turning them back into Grafana frames.
                // Filtering after conversion would see no `.frame` property and retain
                // every frame, preventing a legitimate empty filtered result.
                .filter(item => !item?.frame || (item.tableShape
                    ? item.keptRowIndexes.length > 0
                    : item.keptIndexes.length > item.timeIndexes.length))
                .map(item => {
                    if (!item?.frame) return item;
                    if (item.tableShape) {
                        return {
                            ...item.frame,
                            schema: { ...item.frame.schema, fields: [...item.frame.schema.fields] },
                            data: {
                                ...item.frame.data,
                                values: (item.frame.data?.values || []).map(values => item.keptRowIndexes.map(index => values?.[index]))
                            }
                        };
                    }
                    const indexes = [...new Set(item.keptIndexes)].sort((left, right) => left - right);
                    const rebuiltFrame = {
                        ...item.frame,
                        schema: { ...item.frame.schema, fields: indexes.map(index => item.frame.schema?.fields?.[index]) },
                        data: { ...item.frame.data, values: indexes.map(index => item.frame.data?.values?.[index]) }
                    };
                    const highlightCandidates = item.candidates
                        .filter(candidate => indexes.includes(candidate.index))
                        .map(candidate => ({
                            index: indexes.indexOf(candidate.index),
                            threshold,
                            highlightKind: 'series-query-filter'
                        }));
                    return window.DashBridgeGrafanaCpuCapacityFilter?.markThresholdHighlights?.(
                        rebuiltFrame,
                        highlightCandidates
                    ) || rebuiltFrame;
                });
        });
        metrics.afterSeries = metrics.thresholdMatchedSeries + metrics.safetyRetainedSeries;
        metrics.removedSeries = Math.max(0, metrics.beforeSeries - metrics.afterSeries);
        return { data, metrics };
    };

    const getFieldLegendNames = field => [...new Set([
        ...(field.config?.custom?.__dashbridgeThresholdHighlight?.sourceNames || []),
        field.config?.displayName,
        field.config?.displayNameFromDS,
        field.name,
        ...Object.values(field.labels || {})
    ].filter(Boolean).map(value => String(value).trim()))];

    // In newer Grafana data frames every value field can simply be named
    // "Value". The human-visible series name then belongs to the frame.
    const getFrameLegendNames = (frame, field) => [...new Set([
        ...getFieldLegendNames(field),
        frame.schema?.name,
        frame.schema?.refId
    ].filter(Boolean).map(value => String(value).trim()))];

    const collectResponseSeriesNames = data => {
        const generic = value => /^(?:value|series|metric|значение|серия|метрика)$/iu
            .test(String(value || '').trim());
        const names = [];
        outer: for (const result of Object.values(data?.results || {})) {
            for (const frame of result.frames || []) {
                for (const field of frame.schema?.fields || []) {
                    if (field.type === 'time' || field.name === 'Time') continue;
                    if (names.length >= 20_000) break outer;
                    const candidates = [
                        field.config?.displayNameFromDS,
                        field.config?.displayName,
                        frame.schema?.name,
                        ...Object.values(field.labels || {}),
                        field.name,
                        frame.schema?.refId
                    ].map(value => String(value || '').trim()).filter(Boolean);
                    names.push(candidates.find(name => !generic(name)) || candidates[0] || '');
                }
            }
        }
        return names.filter(Boolean);
    };

    const collectResponseFilterVisibleNames = data => {
        const names = new Set();
        Object.values(data?.results || {}).forEach(result => {
            for (const frame of result.frames || []) {
                for (const field of frame.schema?.fields || []) {
                    if (field.type === 'time' || field.name === 'Time') continue;
                    [
                        field.config?.displayName,
                        field.config?.displayNameFromDS,
                        field.name,
                        frame.schema?.name,
                        ...Object.entries(field.labels || {})
                            .filter(([key]) => ['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase()))
                            .map(([, value]) => value)
                    ].filter(Boolean).forEach(value => names.add(String(value).trim()));
                }
            }
        });
        return [...names].filter(Boolean);
    };

    const collectThresholdHighlightRules = data => {
        const rules = [];
        const seen = new Set();
        Object.values(data?.results || {}).forEach(result => {
            for (const frame of result.frames || []) {
                for (const field of frame.schema?.fields || []) {
                    const marker = field.config?.custom?.__dashbridgeThresholdHighlight;
                    if (!marker || !Number.isFinite(Number(marker.threshold))) continue;
                    const kind = marker.kind || 'legacy';
                    const sourceNames = [...new Set([
                        ...(marker.sourceNames || []),
                        ...getFrameLegendNames(frame, field)
                    ].filter(Boolean).map(value => String(value).trim()))];
                    const key = `${kind}\u0000${Number(marker.threshold)}\u0000${sourceNames.join('\u0000')}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    rules.push({ threshold: Number(marker.threshold), sourceNames, kind });
                }
            }
        });
        return rules;
    };

    const collectCpuCapacityEntries = data => {
        const entries = [];
        const seen = new Set();
        Object.values(data?.results || {}).forEach(result => {
            for (const frame of result.frames || []) {
                for (const field of frame.schema?.fields || []) {
                    const marker = field.config?.custom?.__dashbridgeCpuCapacity;
                    const value = Number(marker?.value);
                    if (!Number.isFinite(value) || value <= 0) continue;
                    const sourceNames = [...new Set([
                        marker.instance,
                        ...getFrameLegendNames(frame, field)
                    ].filter(Boolean).map(name => String(name).trim()))];
                    const key = `${value}\u0000${sourceNames.join('\u0000')}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    entries.push({ value, sourceNames });
                }
            }
        });
        return entries;
    };

    // Complete-hide is the only legend mode that removes series from the
    // Grafana query response. Grafana can then assign its own compact palette
    // to the remaining fields on the next render.
    const filterLegendData = data => {
        // Frames without a time field belong to variable queries and remain
        // unchanged; the shared selector only filters chart data frames.
        return legendSelection.filterDataFrames(data, tools, getFrameLegendNames);
    };

    const hasSourceSeriesFilterScope = refIds => isDashboardIframe || refIds instanceof Set && refIds.size > 0;
    const hasDataTransform = () => !!tools.invertIdle || !!tools.convertMemToUsed || !!tools.forceMemByteUnit
        || tools.trimDomainEnabled === true || !!tools.seriesQueryFilterEnabled
        || !!tools.cpuCapacityFilterEnabled
        || legendSelection.isCompleteHideActive(tools);

    const getRequestQueries = requestBody => {
        try {
            const payload = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
            return Array.isArray(payload?.queries) ? payload.queries : [];
        } catch {
            return [];
        }
    };
    const isTargetPanelView = () => {
        const viewPanel = new URL(location.href).searchParams.get('viewPanel');
        if (!viewPanel) return false;
        // On a hard navigation Grafana can issue the View panel's first query
        // before DashBridge receives a command carrying targetPanelId. The
        // route itself still has an unambiguous single-panel scope.
        if (!tools.targetPanelId) return true;
        return `panel-${String(viewPanel).replace(/^panel-/, '')}`
            === `panel-${String(tools.targetPanelId).replace(/^panel-/, '')}`;
    };
    const getTargetQueryRefIds = requestBody => {
        if (isDashboardIframe) return null;
        const signatures = new Set(tools.targetQuerySignatures || []);
        const queries = getRequestQueries(requestBody);
        // Grafana's View route renders only the requested panel. It may start
        // the first datasource request before the dashboard definition has
        // been read, so the route's panel id is the strongest available scope.
        if (isTargetPanelView()) {
            return new Set(queries.map(query => String(query.refId || '')).filter(Boolean));
        }
        if (!signatures.size) return new Set();
        const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
        const scopeSignatures = new Set([...signatures].map(signature => {
            try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
        }).filter(Boolean));
        const configuredQueries = [...signatures].map(signature => {
            try { return JSON.parse(signature); } catch { return null; }
        }).filter(Boolean);
        try {
            const candidates = queries.map(query => ({
                raw: query,
                refId: String(query.refId || ''),
                alias: query.alias || '',
                signature: window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '',
                scopeSignature: getQueryScopeSignature?.(query) || '',
            }));
            const matched = candidates.filter(query => signatures.has(query.signature)
                || scopeSignatures.has(query.scopeSignature)
                || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                    ?.queryMatchesConfiguredTarget?.(configured, query.raw)));
            return new Set(matched.map(query => query.refId).filter(Boolean));
        } catch {
            return new Set();
        }
    };
    const getAnalysisQueryRefIds = (requestBody, signatures) => {
        if (isDashboardIframe) return null;
        const queries = getRequestQueries(requestBody);
        const configuredSignatures = new Set(signatures || []);
        if (!configuredSignatures.size) return new Set();
        const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
        const scopeSignatures = new Set([...configuredSignatures].map(signature => {
            try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
        }).filter(Boolean));
        const configuredQueries = [...configuredSignatures].map(signature => {
            try { return JSON.parse(signature); } catch { return null; }
        }).filter(Boolean);
        try {
            return new Set(queries.filter(query => {
                const signature = window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '';
                const scopeSignature = getQueryScopeSignature?.(query) || '';
                return configuredSignatures.has(signature) || scopeSignatures.has(scopeSignature)
                    || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                        ?.queryMatchesConfiguredTarget?.(configured, query));
            }).map(query => String(query.refId || '')).filter(Boolean));
        } catch {
            return new Set();
        }
    };
    const observePanelAnalysisResponse = (session, data, requestBody, requestStartedAt) => {
        try {
            if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
                || requestStartedAt < session.acceptAfter) return;
            const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
            if (targetRefIds !== null && !targetRefIds.size) return;
            const snapshot = window.DashBridgeGrafanaPanelAnalysis?.analyzeResponse?.({
                type: session.type,
                data,
                targetRefIds,
                settings: session.settings
            });
            if (snapshot?.ok) session.onSnapshot?.(snapshot);
        } catch {
            // Analysis is observational: malformed datasource frames must never
            // prevent the established CPU/RAM transform from consuming a response.
        }
    };
    const panelAnalysisRequestMatches = (session, requestBody, requestStartedAt) => {
        if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
            || requestStartedAt < session.acceptAfter) return false;
        const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
        return targetRefIds === null || targetRefIds.size > 0;
    };
    const createResponseFilterWorkspace = (data, targetRefIds, helperRefIds = new Set()) => {
        const privateHelperRefIds = new Set(helperRefIds || []);
        if (targetRefIds === null) {
            return { data, isolated: false, helperRefIds: privateHelperRefIds };
        }
        const includedRefIds = new Set([...targetRefIds, ...privateHelperRefIds]);
        return {
            data: {
                ...data,
                results: Object.fromEntries(Object.entries(data?.results || {})
                    .filter(([refId]) => includedRefIds.has(String(refId))))
            },
            isolated: true,
            helperRefIds: privateHelperRefIds
        };
    };
    const commitResponseFilterWorkspace = (target, workspace) => {
        if (!workspace?.isolated) return target;
        workspace.helperRefIds.forEach(refId => delete target.results?.[refId]);
        Object.assign(target.results, workspace.data.results);
        return target;
    };

    const prepareCpuCapacityRequestBody = requestBody => {
        const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
        if (!capacityFilter || !tools.cpuCapacityFilterEnabled) return { body: requestBody, changed: false };
        const allowedRefIds = isDashboardIframe ? null : getTargetQueryRefIds(requestBody);
        if (!isDashboardIframe && !allowedRefIds.size) return { body: requestBody, changed: false };
        return capacityFilter.prepareRequestBody(requestBody, { enabled: true, allowedRefIds });
    };

    const replaceFetchBody = (args, body) => {
        const [input, init] = args;
        if (typeof Request !== 'undefined' && input instanceof Request) {
            return [new Request(input, { ...(init || {}), body })];
        }
        return [input, { ...(init || {}), body }];
    };

    const getTargetLegendRefIds = data => {
        const targetNames = new Set((tools.targetLegendSeries || []).map(name => String(name).trim()).filter(Boolean));
        if (!targetNames.size) return new Set();
        const results = Object.entries(data?.results || {}).map(([refId, result]) => ({
            refId: String(refId),
            fields: (result.frames || []).flatMap(frame => (frame.schema?.fields || []).map(field => ({
                fieldNames: getFieldLegendNames(field)
            })))
        }));
        const matched = results.filter(result => result.fields.some(field =>
            field.fieldNames.some(name => targetNames.has(name))
        ));
        return new Set(matched.map(result => result.refId));
    };

    const calculatedTitleOriginalText = new WeakMap();
    const markCalculatedTitle = () => {
        const suffix = ' calculated';
        const root = getTargetPanel();
        const title = root.querySelector('[class*="panel-title" i], .panel-title-text, [data-testid*="header" i] h2, [data-testid*="header" i] h6, .panel-header h2, .panel-header h6');
        if (!title) return;
        const text = (title.textContent || '').trim();
        if (tools.invertIdle || tools.convertMemToUsed || tools.cpuCapacityFilterEnabled) {
            if (!calculatedTitleOriginalText.has(title)) {
                calculatedTitleOriginalText.set(title, text.endsWith(suffix) ? text.slice(0, -suffix.length) : text);
            }
            const originalText = calculatedTitleOriginalText.get(title);
            if (originalText && text !== `${originalText}${suffix}`) title.textContent = `${originalText}${suffix}`;
            return;
        }
        const originalText = calculatedTitleOriginalText.get(title);
        if (originalText !== undefined) {
            title.textContent = originalText;
            calculatedTitleOriginalText.delete(title);
        } else if (text.endsWith(suffix)) {
            title.textContent = text.slice(0, -suffix.length);
        }
    };

    let calculatedTitleFrame = 0;
    const scheduleCalculatedTitleSync = () => {
        if (calculatedTitleFrame) return;
        calculatedTitleFrame = requestAnimationFrame(() => {
            calculatedTitleFrame = 0;
            markCalculatedTitle();
            syncPanelDataStatusPresentation();
        });
    };
    const observeCalculatedTitle = () => {
        const observerRequired = !!tools.invertIdle || !!tools.convertMemToUsed
            || !!tools.cpuCapacityFilterEnabled || !!tools.seriesQueryFilterEnabled;
        // BUG-B fix: проверяем не только наличие флага, но и активность observer'а.
        // После suspend/resume браузер может разорвать соединение — тогда observer надо пересоздать.
        const existing = window.__dashbridgeCalculatedTitleObserver;
        if (!observerRequired) {
            existing?.disconnect();
            window.__dashbridgeCalculatedTitleObserver = null;
            if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
            calculatedTitleFrame = 0;
            return;
        }
        if (existing && existing._dashbridgeActive) return;
        existing?.disconnect();
        const obs = new MutationObserver(scheduleCalculatedTitleSync);
        obs._dashbridgeActive = true;
        obs.observe(document.documentElement, { subtree: true, childList: true });
        window.__dashbridgeCalculatedTitleObserver = obs;
    };
    registerRuntimeCleanup(() => {
        if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
        calculatedTitleFrame = 0;
    });

    // Monkey-patching (перехват сети): мы подменяем оригинальные window.fetch и XMLHttpRequest.
    // Это позволяет нам "на лету" перехватывать JSON-ответы от сервера Grafana (/api/ds/query) 
    // и изменять сырые метрики (например, инвертировать CPU idle в CPU used или считать RAM) 
    // до того, как они попадут во внутренний стейт дашборда.
    const installDataInterceptor = () => {
        if (window.__dashbridgeCardDataInterceptor) return;
        window.__dashbridgeCardDataInterceptor = true;
        const diagnostics = window.__dashbridgeDataInterceptorDiagnostic = window.__dashbridgeDataInterceptorDiagnostic || {
            queryResponses: 0, transformed: 0, exactMatches: 0, legendFallbackMatches: 0,
            unmatched: 0, sourceFilterRuns: 0, last: null,
            nextEventId: 0, activeRequests: 0, events: []
        };
        // Keep this journal compact and JSON-serializable: E2E needs causal
        // request evidence, not request/response payloads or DOM references.
        diagnostics.nextEventId = Number(diagnostics.nextEventId) || 0;
        diagnostics.activeRequests = Number(diagnostics.activeRequests) || 0;
        diagnostics.events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
        capDiagnosticJournal(diagnostics, 500);
        const payloadArchive = window.__dashbridgeDataInterceptorArchive
            || (window.__dashbridgeDataInterceptorArchive = {
                schema: 'dashbridge-e2e-network-payload-archive/v1',
                startedAt: Date.now(),
                requests: {},
                responses: {},
                limits: { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 },
                stats: { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 },
            });
        payloadArchive.requests ||= {};
        payloadArchive.responses ||= {};
        payloadArchive.limits ||= { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 };
        payloadArchive.stats ||= { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 };
        const archiveEnabled = () => window.__dashbridgeE2EDiagnostics?.installed === true;
        const fullPayloadEvidenceEnabled = () => window.__dashbridgeE2EDiagnostics?.fullPayloadEvidence === true;
        const hashPayload = text => {
            let value = 2166136261;
            for (let index = 0; index < text.length; index += 1) {
                value = Math.imul(value ^ text.charCodeAt(index), 16777619);
            }
            return `fnv1a-${(value >>> 0).toString(16)}`;
        };
        const serializePayload = value => {
            try {
                const text = typeof value === 'string' ? value : JSON.stringify(value);
                const maxCharacters = Number(payloadArchive.limits.payloadCharacters) || 8192;
                const remainingBudget = Math.max(0, (Number(payloadArchive.limits.fullPayloadBudget) || 0)
                    - (Number(payloadArchive.stats.storedFullPayloadCharacters) || 0));
                const retainFull = fullPayloadEvidenceEnabled() && text.length <= remainingBudget;
                let parsed = null;
                if (retainFull) {
                    parsed = value;
                    if (typeof value === 'string') {
                        try { parsed = JSON.parse(value); } catch (_) { parsed = value; }
                    }
                    payloadArchive.stats.storedFullPayloadCharacters += text.length;
                } else if (text.length) {
                    payloadArchive.stats.truncatedPayloads += 1;
                }
                return {
                    value: parsed,
                    textBytes: text.length,
                    hash: hashPayload(text),
                    truncated: !retainFull,
                    sample: retainFull ? null : {
                        first: text.slice(0, Math.floor(maxCharacters / 2)),
                        last: text.slice(-Math.ceil(maxCharacters / 2)),
                    },
                };
            } catch (error) {
                return { value: null, textBytes: null, hash: null, error: error?.message || String(error) };
            }
        };
        const archiveRequest = (requestId, transport, url, body) => {
            if (!archiveEnabled()) return;
            const before = Object.keys(payloadArchive.requests).length;
            setRecentDiagnosticRecord(payloadArchive.requests, requestId, {
                at: Date.now(), requestId, transport, url: String(url || ''),
                body: serializePayload(body ?? null),
            }, Number(payloadArchive.limits.requests) || 100);
            if (before >= (Number(payloadArchive.limits.requests) || 100)) payloadArchive.stats.droppedRequests += 1;
        };
        const archiveResponse = (requestId, stage, data, details = {}) => {
            if (!archiveEnabled()) return;
            const record = payloadArchive.responses[requestId]
                || setRecentDiagnosticRecord(payloadArchive.responses, requestId, { requestId, observations: [] }, Number(payloadArchive.limits.requests) || 100);
            record.observations.push({ at: Date.now(), stage, payload: serializePayload(data), ...details });
            const observationLimit = Number(payloadArchive.limits.observationsPerResponse) || 8;
            if (record.observations.length > observationLimit) {
                const removed = record.observations.length - observationLimit;
                record.observations.splice(0, removed);
                payloadArchive.stats.droppedObservations += removed;
            }
        };
        const pushEvent = (stage, details = {}) => {
            const event = { id: ++diagnostics.nextEventId, at: Date.now(), stage, ...details };
            pushBoundedDiagnosticEvent(diagnostics, event, 500);
            return event;
        };
        const reportCycle = { active: new Set(), failures: [] };
        const beginRequest = (transport, url) => {
            const requestId = `query_${Date.now()}_${diagnostics.nextEventId + 1}`;
            if (!reportCycle.active.size) {
                reportCycle.failures = [];
                visualMetadata.responseFilterEmptyIsNormal = false;
                if (isDashboardIframe) setPanelDataStatus('loading');
            }
            reportCycle.active.add(requestId);
            diagnostics.activeRequests = reportCycle.active.size;
            pushEvent('request-start', { requestId, transport, url: String(url || ''), activeRequests: diagnostics.activeRequests });
            return requestId;
        };
        const completeRequest = (requestId, transport, outcome, details = {}) => {
            if (!reportCycle.active.has(requestId)) return;
            reportCycle.active.delete(requestId);
            diagnostics.activeRequests = reportCycle.active.size;
            if (['http-error', 'network-error', 'decode-error'].includes(outcome)) {
                visualMetadata.responseFilterEmptyIsNormal = false;
                reportCycle.failures.push({ outcome, ...details });
            }
            pushEvent('request-complete', { requestId, transport, outcome, activeRequests: diagnostics.activeRequests });
            if (reportCycle.active.size) return;
            const failure = reportCycle.failures[0] || null;
            if (failure?.outcome === 'http-error') setPanelDataStatus('http_error', { httpStatus: failure.httpStatus });
            else if (failure?.outcome === 'network-error') setPanelDataStatus('network_error');
            else if (failure?.outcome === 'decode-error') setPanelDataStatus('decode_error');
            else if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
            // A transform determines data/empty from its scoped response. Do
            // not overwrite that result after the final parallel request.
            else if (outcome === 'transformed') { /* status already set by transform */ }
            else if (outcome === 'aborted') setPanelDataStatus('aborted');
            else setPanelDataStatus('unknown');
            window.dispatchEvent(new Event('dashbridgePanelDataSettled'));
        };
        const decodeNativeFetchResponse = response => response.clone().json();
        const transform = (data, requestBody, request) => {
            archiveResponse(request.requestId, 'decoded-before-transform', data, { transport: request.transport });
            if (!data?.results) {
                visualMetadata.responseFilterEmptyIsNormal = false;
                setPanelDataStatus('decode_error');
                pushEvent('decode-error', { ...request, reason: 'response has no results' });
                archiveResponse(request.requestId, 'returned-without-results', data, { reason: 'response has no results' });
                return data;
            }
            diagnostics.queryResponses += 1;
            const exactTargetRefIds = getTargetQueryRefIds(requestBody);
            let targetRefIds = exactTargetRefIds;
            let scope = exactTargetRefIds === null ? 'iframe' : exactTargetRefIds.size ? 'query-signature' : 'none';
            if (!isDashboardIframe && !targetRefIds.size) {
                targetRefIds = getTargetLegendRefIds(data);
                if (targetRefIds.size) scope = 'legend-fallback';
            }
            const resultRefIds = Object.keys(data.results || {});
            // A normal Grafana dashboard has many panels sharing the same
            // datasource endpoint. Never alter a response until it matches
            // the selected panel's saved query signature.
            if (!isDashboardIframe && !targetRefIds.size) {
                diagnostics.unmatched += 1;
                diagnostics.last = { at: Date.now(), scope, resultRefIds, targetRefIds: [] };
                pushEvent('scope-mismatch', { ...request, scope, resultRefIds, targetRefIds: [] });
                archiveResponse(request.requestId, 'returned-scope-mismatch', data, { scope, resultRefIds });
                return data;
            }
            if (scope === 'query-signature') diagnostics.exactMatches += 1;
            if (scope === 'legend-fallback') diagnostics.legendFallbackMatches += 1;
            const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
            const cpuContext = capacityFilter?.readContext?.(requestBody) || {
                helperRefIds: new Set(), loadRefIds: new Set()
            };
            // Only copy the selected panel and its private vCPU helper into the
            // transformation workspace. Neither response filter is allowed to
            // mutate frames belonging to another dashboard panel.
            const workspace = createResponseFilterWorkspace(data, targetRefIds, cpuContext.helperRefIds);
            const scopedData = workspace.data;
            const countSeries = source => Object.values(source?.results || {}).reduce((total, result) => total
                + (result.frames || []).reduce((frameTotal, frame) => frameTotal
                    + Math.max(0, (frame.schema?.fields || []).filter(field => field.type !== 'time' && field.name !== 'Time').length), 0), 0);
            const beforeSeries = countSeries(scopedData);
            trimResponseDomainLabels(scopedData);
            if (tools.invertIdle) transformCpuData(scopedData);
            const memoryTransform = tools.convertMemToUsed ? transformMemData(scopedData) : null;
            visualMetadata.memoryConversionApplied = tools.convertMemToUsed ? memoryTransform.applied : null;
            const memoryConversionFailed = !!tools.convertMemToUsed && !memoryTransform.applied;
            if (!tools.convertMemToUsed && tools.forceMemByteUnit) restoreMemByteUnit(scopedData);
            // Dynamic vCPU filtering owns only Load Average frames and runs
            // before the generic fixed-threshold series filter. The latter can
            // then safely evaluate the already-scoped result without changing
            // how vCPU capacity is calculated.
            const cpuCapacityFilter = tools.cpuCapacityFilterEnabled
                ? capacityFilter?.filterResponse?.(scopedData, requestBody, {
                    enabled: true,
                    coefficient: tools.cpuCapacityFilterCoefficient,
                    mode: tools.cpuCapacityFilterMode,
                    trimDomainEnabled: tools.trimDomainEnabled === true,
                    trimDomain: tools.trimDomain,
                    selectedTypes: [
                        tools.cpuCapacityFilterLoad1 !== false ? '1m' : null,
                        tools.cpuCapacityFilterLoad5 === true ? '5m' : null,
                        tools.cpuCapacityFilterLoad15 === true ? '15m' : null
                    ].filter(Boolean)
                })?.metrics || null
                : null;
            // The query signature is preferred, but Grafana may rewrite a
            // request before it reaches fetch/XHR. A matching legend refId is
            // still a panel-scoped response and must receive the source filter.
            let sourceFilter = null;
            if (memoryConversionFailed && tools.seriesQueryFilterEnabled) {
                sourceFilter = { enabled: true, skipped: 'memory-conversion-not-applied' };
            } else if (hasSourceSeriesFilterScope(targetRefIds)) {
                diagnostics.sourceFilterRuns += 1;
                sourceFilter = filterSeriesByThreshold(scopedData).metrics;
            }
            if (!memoryConversionFailed) filterLegendData(scopedData);
            visualMetadata.seriesThresholdHighlightRules = collectThresholdHighlightRules(scopedData);
            visualMetadata.seriesCpuCapacityEntries = collectCpuCapacityEntries(scopedData);
            // Lightweight metadata is enough for chart/table fallbacks. Do not
            // walk every value of every series during normal Grafana loading;
            // full report evaluation belongs to an explicit report request.
            visualMetadata.responseTableRecords = collectResponseTableRecords(scopedData);
            visualMetadata.responseSeriesNames = collectResponseSeriesNames(scopedData);
            if (responseSeriesFilterIsEnabled()) {
                visualMetadata.responseFilterVisibleNames = collectResponseFilterVisibleNames(scopedData);
                visualMetadata.responseFilterReady = true;
            } else {
                visualMetadata.responseFilterVisibleNames = [];
                visualMetadata.responseFilterReady = false;
            }
            // Bind the freshly computed metadata before Grafana consumes the
            // transformed response. For Flot this wraps the current setData;
            // its native data commit then schedules the correctly sized
            // overlay. No delayed redraw or forced plot resize is needed.
            const visualRoot = window.DashBridgeGrafanaDom?.outerPanel(getTargetPanel()) || getTargetPanel() || document;
            syncResponseFilterPresentation(visualRoot);
            diagnostics.transformed += 1;
            const afterSeries = countSeries(scopedData);
            const sourceFilterRemovedEverything = !!sourceFilter?.enabled
                && sourceFilter.beforeSeries > 0
                && sourceFilter.thresholdMatchedSeries === 0
                && sourceFilter.afterSeries === 0;
            const cpuFilterRemovedEverything = !!cpuCapacityFilter?.enabled
                && cpuCapacityFilter.beforeSeries > 0
                && cpuCapacityFilter.afterSeries === 0;
            visualMetadata.responseFilterEmptyIsNormal = afterSeries === 0
                && (sourceFilterRemovedEverything || cpuFilterRemovedEverything);
            if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
            else if (beforeSeries === 0 && afterSeries === 0) setPanelDataStatus('empty_source');
            else setPanelDataStatus('data');
            diagnostics.last = {
                at: Date.now(), scope, targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                resultRefIds, beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
            };
            pushEvent('transform', {
                ...request, scope, resultRefIds,
                targetRefIds: targetRefIds === null ? null : [...targetRefIds], beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                invertIdle: !!tools.invertIdle, convertMemToUsed: !!tools.convertMemToUsed,
                forceMemByteUnit: !!tools.forceMemByteUnit,
                sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
            });
            // Helper results are deliberately removed by filterResponse;
            // commit also expresses that deletion on the original response.
            commitResponseFilterWorkspace(data, workspace);
            archiveResponse(request.requestId, 'after-transform', data, {
                scope,
                resultRefIds,
                targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                beforeSeries,
                afterSeries,
            });
            reapplyVisualStylesAfterDataTransform();
            return data;
        };
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            if (!isQueryUrl(url)) return originalFetch(...args);
            const transformActive = hasDataTransform();
            const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
            const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
            const requestStartedAt = performance.now();
            // The production fast path must stay idle while every feature is
            // OFF. E2E is the sole exception: a reset still has to observe the
            // selected panel's request in order to prove a safe baseline.
            const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
            const observeActive = transformActive || hasPersistentVisualWork() || thresholdRestoreAfterNextQuery
                || diagnosticObservationActive || analysisCaptureActive;
            if (!observeActive) return originalFetch(...args);
            const requestId = beginRequest('fetch', url);
            let effectiveArgs = args;
            let requestBody = null;
            if (transformActive || diagnosticObservationActive || analysisCaptureActive) {
                requestBody = await window.DashBridgeGrafanaNetwork.readFetchBody(args[0], args[1]).catch(() => null);
            }
            if (tools.cpuCapacityFilterEnabled && requestBody !== null) {
                const prepared = prepareCpuCapacityRequestBody(requestBody);
                if (prepared.changed) {
                    requestBody = prepared.body;
                    effectiveArgs = replaceFetchBody(args, prepared.body);
                }
            }
            const requestBodyPromise = Promise.resolve(requestBody);
            try {
                const response = await originalFetch(...effectiveArgs);
                pushEvent('response', { requestId, transport: 'fetch', status: response.status, ok: response.ok });
                archiveResponse(requestId, 'http-response-metadata', null, {
                    transport: 'fetch',
                    status: response.status,
                    ok: response.ok,
                    redirected: response.redirected,
                    responseType: response.type,
                    url: response.url,
                    headers: Object.fromEntries(response.headers.entries()),
                });
                if (!response.ok) {
                    pushEvent('query-error', { requestId, transport: 'fetch', status: response.status });
                    completeRequest(requestId, 'fetch', 'http-error', { httpStatus: response.status });
                    return response;
                }
                if (!transformActive) {
                    const requestBody = await requestBodyPromise;
                    if (!isDashboardIframe && analysisCaptureActive
                        && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                        try {
                            const decoded = await decodeNativeFetchResponse(response);
                            observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                        } catch { /* DOM fallback remains available when a datasource response is not JSON. */ }
                    }
                    const targetRefIds = getTargetQueryRefIds(requestBody);
                    const scope = targetRefIds === null
                        ? 'iframe'
                        : (targetRefIds.size ? 'query-signature' : 'none');
                    consumeVisualStylesAfterQuery();
                    pushEvent('transform-skipped', {
                        requestId,
                        transport: 'fetch',
                        reason: 'visual-only-observed',
                        scope,
                        targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                    });
                    completeRequest(requestId, 'fetch', 'completed');
                    return response;
                }
                let originalResponseText = null;
                try {
                    const requestBody = await requestBodyPromise;
                    archiveRequest(requestId, 'fetch', url, requestBody);
                    // The transformed response replaces the native one, so consume the
                    // native body directly. Cloning here tees the stream and leaves the
                    // original branch unread; repeated Grafana refreshes can then retain
                    // buffered response bodies until GC and steadily grow tab memory.
                    originalResponseText = await response.text();
                    const decoded = JSON.parse(originalResponseText);
                    if (analysisCaptureActive && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                        observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                    }
                    const data = transform(decoded, requestBody, { requestId, transport: 'fetch' });
                    consumeVisualStylesAfterQuery();
                    completeRequest(requestId, 'fetch', data?.results ? 'transformed' : 'decode-error');
                    return window.DashBridgeGrafanaNetwork.createJsonResponse(data, response);
                } catch (error) {
                    pushEvent('decode-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                    completeRequest(requestId, 'fetch', 'decode-error');
                    return originalResponseText === null
                        ? response
                        : window.DashBridgeGrafanaNetwork.createBodyResponse(originalResponseText, response);
                }
            } catch (error) {
                pushEvent('query-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                completeRequest(requestId, 'fetch', error?.name === 'AbortError' ? 'aborted' : 'network-error');
                throw error;
            }
        };
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.__dashbridgeRequestUrl = url;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (isQueryUrl(this.__dashbridgeRequestUrl)) {
                const transformActive = hasDataTransform();
                const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
                const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
                const requestStartedAt = performance.now();
                const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
                const observeActive = transformActive || hasPersistentVisualWork() || thresholdRestoreAfterNextQuery
                    || diagnosticObservationActive || analysisCaptureActive;
                if (!observeActive) return originalSend.call(this, body);
                if (tools.cpuCapacityFilterEnabled) {
                    const prepared = prepareCpuCapacityRequestBody(body);
                    if (prepared.changed) body = prepared.body;
                }
                const requestId = beginRequest('xhr', this.__dashbridgeRequestUrl);
                if (transformActive) archiveRequest(requestId, 'xhr', this.__dashbridgeRequestUrl, body ?? null);
                this.addEventListener('abort', () => { this.__dashbridgeRequestAborted = true; }, { once: true });
                this.addEventListener('readystatechange', () => {
                    if (this.readyState !== 4 || this.__dashbridgeRequestFinished) return;
                    this.__dashbridgeRequestFinished = true;
                    const request = { requestId, transport: 'xhr' };
                    pushEvent('response', { ...request, status: this.status, ok: this.status >= 200 && this.status < 300 });
                    archiveResponse(requestId, 'http-response-metadata', null, {
                        transport: 'xhr',
                        status: this.status,
                        ok: this.status >= 200 && this.status < 300,
                        responseURL: this.responseURL,
                        responseType: this.responseType,
                        headers: this.getAllResponseHeaders?.() || '',
                    });
                    if (this.status < 200 || this.status >= 300) {
                        pushEvent('query-error', { ...request, status: this.status });
                        const outcome = this.status === 0
                            ? (this.__dashbridgeRequestAborted ? 'aborted' : 'network-error')
                            : 'http-error';
                        completeRequest(requestId, 'xhr', outcome, { httpStatus: this.status });
                        return;
                    }
                    const captureRequestMatches = analysisCaptureActive
                        && panelAnalysisRequestMatches(analysisCapture, body, requestStartedAt);
                    if (!transformActive && !captureRequestMatches) {
                        const targetRefIds = getTargetQueryRefIds(body);
                        const scope = targetRefIds === null
                            ? 'iframe'
                            : (targetRefIds.size ? 'query-signature' : 'none');
                        consumeVisualStylesAfterQuery();
                        pushEvent('transform-skipped', {
                            ...request,
                            reason: 'visual-only-observed',
                            scope,
                            targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                        });
                        completeRequest(requestId, 'xhr', 'completed');
                        return;
                    }
                    try {
                        const decoded = window.DashBridgeGrafanaNetwork.readXhrJson(this);
                        if (!decoded.supported) throw new Error(`Unsupported XHR responseType: ${decoded.type}`);
                        if (decoded.error) throw decoded.error;
                        if (captureRequestMatches) {
                            observePanelAnalysisResponse(analysisCapture, decoded.data, body, requestStartedAt);
                        }
                        if (!transformActive) {
                            consumeVisualStylesAfterQuery();
                            completeRequest(requestId, 'xhr', 'completed');
                            return;
                        }
                        const json = transform(decoded.data, body, request);
                        consumeVisualStylesAfterQuery();
                        const serialized = JSON.stringify(json);
                        if (decoded.type === 'text') {
                            Object.defineProperty(this, 'responseText', { configurable: true, value: serialized });
                            Object.defineProperty(this, 'response', { configurable: true, value: serialized });
                        }
                        completeRequest(requestId, 'xhr', json?.results ? 'transformed' : 'decode-error');
                    } catch (error) {
                        pushEvent('decode-error', { ...request, reason: error.message || String(error) });
                        completeRequest(requestId, 'xhr', 'decode-error');
                    }
                });
            }
            return originalSend.call(this, body);
        };
    };

    // Content scripts can be injected again after an extension reload while the
    // Grafana document remains alive. Keep exactly one command listener; otherwise
    // old and new closures race to process the same reset and the E2E acknowledgement
    // may expose a stale shared tools state.
    window.__dashbridgePanelToolsMessageHandler && window.removeEventListener(
        'message', window.__dashbridgePanelToolsMessageHandler
    );
    window.__dashbridgePanelReportSnapshotCancellers?.forEach(cancel => cancel());
    const panelReportSnapshotCancellers = new Map();
    window.__dashbridgePanelReportSnapshotCancellers = panelReportSnapshotCancellers;
    window.__dashbridgePanelToolsRuntimeGeneration = (window.__dashbridgePanelToolsRuntimeGeneration || 0) + 1;
    const processPanelToolsMessage = async event => {
        if (event.origin !== extensionOrigin) return;
        if (isDashboardIframe ? event.source !== window.parent : event.source !== window) return;
        if (!isDashboardIframe && !window.__dashbridgePanelToolsAllowTop) return;
        if (event.data?.action === 'getPanelLegendSeries') {
            const series = getLegendSeries();
            window.parent.postMessage({ action: 'panelLegendSeries', requestId: event.data.requestId, series }, extensionOrigin);
            return;
        }
        if (event.data?.action === 'getPanelThresholdStatus') {
            // The settings dialog requests this explicitly so the detected unit
            // is shown immediately, rather than waiting for the next data update.
            const targetPanel = getTargetPanel();
            const thresholdRoot = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
            const panelId = getPanelStateKey(targetPanel) || tools.targetPanelId || '';
            const status = await (window.DashBridgeGrafanaVisualEngine?.getThresholdUnitAsync?.({ root: thresholdRoot, panelId })
                || window.DashBridgeGrafanaVisualEngine?.getThresholdUnit?.(thresholdRoot))
                || { unit: '', engine: 'unknown' };
            // В iframe ответ идёт родительскому окну (extension page).
            // В обычном Grafana-табе (вызов через runGrafanaCommand/__dashbridgePanelToolsAllowTop)
            // ответ нужно отправить в то же окно, где слушает временный MAIN-world listener.
            if (isDashboardIframe) {
                window.parent.postMessage({
                    action: 'panelThresholdStatus',
                    requestId: event.data.requestId,
                    status
                }, extensionOrigin);
            } else {
                window.postMessage({
                    action: 'panelThresholdStatus',
                    requestId: event.data.requestId,
                    status
                }, location.origin);
            }
            return;
        }
        if (event.data?.action === 'refreshPanelThresholdLayout') {
            await applyThresholdWhenChartReady();
            window.dispatchEvent(new Event('resize'));
            return;
        }
        if (event.data?.action === 'cancelPanelReportSnapshot') {
            const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 160) : '';
            panelReportSnapshotCancellers.get(requestId)?.();
            return;
        }
        if (event.data?.action === 'collectPanelReportSnapshot') {
            const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 160) : '';
            if (!isDashboardIframe || !requestId) return;
            const targetPanel = getTargetPanel();
            const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
            let snapshot;
            try {
                const collect = () => window.DashBridgeGrafanaVisualEngine?.collectPanelReportSnapshot?.({
                    root, sla: event.data.sla || {}
                }) || { state: 'no_data', series: [] };
                const readySnapshot = () => {
                    const status = window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus?.kind || 'unknown';
                    const current = collect();
                    // Grafana can leave one background request pending even
                    // after a table/chart has rendered usable data. What the
                    // user currently sees is a valid report snapshot and must
                    // not wait for that unrelated request to time out.
                    if (Array.isArray(current.series) && current.series.length) return current;
                    if (status === 'loading') return null;
                    const terminalStatuses = new Set([
                        'filtered_empty', 'empty_source', 'http_error', 'network_error', 'decode_error', 'aborted'
                    ]);
                    // A completed chart with every series hidden is still a
                    // valid final state; it must not keep report generation
                    // waiting forever merely because the public series list is empty.
                    if (status === 'data' && ['flot', 'uplot', 'response'].includes(current.engine)) return current;
                    if (terminalStatuses.has(status)) {
                        return current;
                    }
                    const nativeNoData = Array.from(root?.querySelectorAll?.('div, span') || []).some(element =>
                        element.children.length === 0 && /^No data$/i.test(String(element.textContent || '').trim()));
                    return nativeNoData ? current : null;
                };
                panelReportSnapshotCancellers.get(requestId)?.();
                snapshot = await new Promise(resolve => {
                    let settled = false;
                    let timeout = null;
                    let dataObserver = null;
                    let inspectFrame = 0;
                    const finish = (current, force = false) => {
                        if (settled || (!current && !force)) return;
                        settled = true;
                        clearTimeout(timeout);
                        if (inspectFrame) cancelAnimationFrame(inspectFrame);
                        dataObserver?.disconnect();
                        window.removeEventListener('dashbridgePanelDataSettled', scheduleInspect);
                        if (panelReportSnapshotCancellers.get(requestId) === cancel) {
                            panelReportSnapshotCancellers.delete(requestId);
                        }
                        resolve(current);
                    };
                    const cancel = () => finish(null, true);
                    const inspect = () => finish(readySnapshot());
                    const scheduleInspect = () => {
                        if (inspectFrame || settled) return;
                        inspectFrame = requestAnimationFrame(() => {
                            inspectFrame = 0;
                            inspect();
                        });
                    };
                    const requestedTimeout = Number(event.data.timeoutMs);
                    const reportTimeoutMs = Number.isFinite(requestedTimeout)
                        ? Math.max(1, Math.min(120_000, requestedTimeout))
                        : 120_000;
                    timeout = setTimeout(() => finish({
                        state: 'timeout',
                        dataStatus: 'timeout',
                        dataStatusText: 'Штатный запрос Grafana не завершился в отведённое время',
                        error: 'Штатный запрос Grafana не завершился в отведённое время',
                        series: []
                    }), reportTimeoutMs);
                    panelReportSnapshotCancellers.set(requestId, cancel);
                    window.addEventListener('dashbridgePanelDataSettled', scheduleInspect);
                    if (typeof MutationObserver === 'function') {
                        dataObserver = new MutationObserver(scheduleInspect);
                        dataObserver.observe(root === document ? document.documentElement : root, {
                            childList: true, subtree: true, characterData: true
                        });
                    }
                    inspect();
                });
                if (!snapshot) return;
                snapshot = attachCpuCapacityToReportSnapshot(snapshot, event.data.sla || {});
            } catch (error) {
                snapshot = { state: 'error', error: String(error?.message || error).slice(0, 480), series: [] };
            }
            window.parent.postMessage({
                action: 'panelReportSnapshot', requestId, snapshot
            }, extensionOrigin);
            return;
        }
        if (event.data?.action === 'dashbridgeCapturePreparedDefaultChanged'
            && typeof event.data.enabled === 'boolean') {
            tools.capturePrepared = event.data.enabled;
            document.documentElement.dataset.dashbridgeCapturePrepared = String(event.data.enabled);
            if (Number(event.data.outputWidth) >= 100) {
                document.documentElement.dataset.dashbridgeCaptureWidth = String(Math.round(Number(event.data.outputWidth)));
            }
            if (Number(event.data.outputHeight) >= 100) {
                document.documentElement.dataset.dashbridgeCaptureHeight = String(Math.round(Number(event.data.outputHeight)));
            }
            document.dispatchEvent(new CustomEvent('dashbridgeGrafanaCaptureDefaultChanged', {
                detail: {
                    enabled: event.data.enabled,
                    width: Number(event.data.outputWidth) || 1000,
                    height: Number(event.data.outputHeight) || 520
                }
            }));
            return;
        }
        if (event.data?.action === 'startEmbeddedPanelAnalysis') {
            const requestedType = event.data.analysisType;
            const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 160) : '';
            if (!requestId || !['cpu', 'ram'].includes(requestedType)) return;
            const targetPanel = getTargetPanel();
            if (!targetPanel) return;
            const suppliedTitle = typeof event.data.panelTitle === 'string'
                ? event.data.panelTitle.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
                : '';
            void startEmbeddedPanelAnalysis(targetPanel, requestedType, suppliedTitle, requestId);
            return;
        }
        if (event.data?.action === 'cancelEmbeddedPanelAnalysis') {
            const session = window.__dashbridgePanelAnalysisCaptureSession;
            if (session?.requestId === event.data.requestId) session.cancel('dialog-closed');
            return;
        }
        if (event.data?.action !== 'applyPanelTools') return;
        const commandTools = event.data.tools || {};
        const invertIdleWasEnabled = !!tools.invertIdle;
        const convertMemWasEnabled = !!tools.convertMemToUsed;
        const visualWorkWasEnabled = hasVisualWork(tools);
        const thresholdWasEnabled = !!tools.thresholdEnabled;
        const forceMemByteUnitWasSpecified = Object.prototype.hasOwnProperty.call(commandTools, 'forceMemByteUnit');
        const seriesQueryFilterWasEnabled = !!tools.seriesQueryFilterEnabled;
        const cpuCapacityFilterWasEnabled = !!tools.cpuCapacityFilterEnabled;
        const previousResponseFilterConfigKey = getResponseSeriesFilterConfigKey(tools);
        const legendVisibilityPayloadProvided = Object.prototype.hasOwnProperty.call(commandTools, 'legendVisibility');
        const visibilityHasHiddenEntries = value => !!value && typeof value === 'object'
            && Object.values(value).some(visible => visible === false);
        // Generated commands always carry an explicit empty map so OFF/reset
        // remains deterministic. Treat it as real native legend work only when
        // it restores a previously hidden series. A map containing false and
        // explicit null (show all) remain unconditional user commands.
        const legendVisibilityRequested = legendVisibilityPayloadProvided
            && (commandTools.legendVisibility === null
                || visibilityHasHiddenEntries(commandTools.legendVisibility)
                || visibilityHasHiddenEntries(tools.legendVisibility));
        const commandDiagnostic = {
            at: Date.now(), requestId: event.data.requestId || null,
            runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration,
            queue: event.data.__dashbridgeCommandQueue || null,
            legendVisibilityRequested,
            payloadHasLegendVisibility: legendVisibilityPayloadProvided,
            receivedLegendVisibility: commandTools.legendVisibility,
            receivedLegendVisibilityType: commandTools.legendVisibility === null ? 'null' : typeof commandTools.legendVisibility,
            stateBefore: tools.legendVisibility,
        };
        Object.assign(tools, event.data.transformSettings || {}, commandTools);
        if (!tools.thresholdEnabled) thresholdRestoreAfterNextQuery = false;
        if (convertMemWasEnabled !== !!tools.convertMemToUsed) visualMetadata.memoryConversionApplied = null;
        if (Object.prototype.hasOwnProperty.call(commandTools, 'convertMemToUsed')) {
            if (tools.convertMemToUsed) tools.forceMemByteUnit = false;
            else if (!forceMemByteUnitWasSpecified && convertMemWasEnabled) tools.forceMemByteUnit = true;
        }
        enforceSingleResponseSeriesFilter(tools);
        if (previousResponseFilterConfigKey !== getResponseSeriesFilterConfigKey(tools)) {
            visualMetadata.responseFilterVisibleNames = [];
            visualMetadata.responseFilterReady = false;
        }
        if (seriesQueryFilterWasEnabled && !tools.seriesQueryFilterEnabled) {
            discardThresholdHighlightRules('series-query-filter');
        }
        if (!tools.seriesQueryFilterEnabled && !tools.cpuCapacityFilterEnabled) {
            visualMetadata.responseFilterEmptyIsNormal = false;
        }
        if (cpuCapacityFilterWasEnabled && !tools.cpuCapacityFilterEnabled) {
            discardThresholdHighlightRules('cpu-capacity-filter');
            visualMetadata.seriesCpuCapacityEntries = [];
        }
        const responseFilterWasDisabled = seriesQueryFilterWasEnabled && !tools.seriesQueryFilterEnabled
            || cpuCapacityFilterWasEnabled && !tools.cpuCapacityFilterEnabled;
        if (responseFilterWasDisabled && tools.thresholdEnabled
            && visualMetadata.responseDataStatus?.kind === 'filtered_empty') {
            thresholdRestoreAfterNextQuery = true;
        }
        if (responseFilterWasDisabled && legendVisibilityRequested) {
            // The filtered legend may not contain a series whose native hidden
            // state must be restored. Repeat the explicit visibility command
            // after the first full-data response, when that series exists again.
            legendVisibilityRestoreAfterNextQuery = true;
        }
        const responseLabelTransformWasDisabled = invertIdleWasEnabled && !tools.invertIdle
            || convertMemWasEnabled && !tools.convertMemToUsed;
        if (responseLabelTransformWasDisabled && legendVisibilityRequested) {
            // The current calculated legend can be restored before Refresh,
            // then legacy Flot can transfer its previous hidden presentation
            // to the native labels created by the untransformed response.
            // Reapply the empty/show-all map once those labels exist.
            legendVisibilityRestoreAfterNextQuery = true;
        }
        commandDiagnostic.stateAfter = tools.legendVisibility;
        commandDiagnostic.stateAfterType = tools.legendVisibility === null ? 'null' : typeof tools.legendVisibility;
        commandDiagnostic.stateAfterHasOwnProperty = Object.prototype.hasOwnProperty.call(tools, 'legendVisibility');
        tools.idleKeyword = tools.grafanaIdleKeyword;
        tools.totalKeyword = tools.grafanaMemTotalKeyword;
        tools.availKeyword = tools.grafanaMemAvailKeyword;
        tools.memCalcMode = tools.grafanaMemCalcMode === 'used' || tools.grafanaMemCalcMode === 'available'
            ? tools.grafanaMemCalcMode
            : (String(tools.availKeyword || '').toLowerCase().includes('used') ? 'used' : 'available');
        tools.trimDomain = tools.grafanaTrimDomain;
        tools.trimDomainEnabled = tools.grafanaTrimDomainEnabled;
        installDataInterceptor();
        markCalculatedTitle();
        observeCalculatedTitle();
        // Visibility is independent from visual styling. An explicit null means
        // "show every native Grafana series"; use an empty map so the normal
        // key-aware click path can restore every disabled legend item.
        const targetPanel = getTargetPanel();
        const root = window.DashBridgeGrafanaDom?.outerPanel(targetPanel) || targetPanel || document;
        syncResponseFilterPresentation(root);
        if (legendVisibilityRequested) {
            const visibility = tools.legendVisibility && typeof tools.legendVisibility === 'object'
                ? tools.legendVisibility
                : {};
            commandDiagnostic.resolvedVisibility = visibility;
            // Clear DashBridge-owned classes before validating native Grafana
            // visibility. Otherwise a successfully restored React item still
            // looks hidden to applyLegendVisibilityByKey and produces a false
            // native-legend-apply-failed acknowledgement.
            window.DashBridgeGrafanaVisualEngine?.resetSeriesVisibility?.({ root });
            await new Promise(resolve => requestAnimationFrame(resolve));
            debugLog('Applying legend visibility:', visibility);
            const legendVisibilityApplied = await applyLegendVisibilityByKey(visibility);
            commandDiagnostic.legendVisibilityApplied = legendVisibilityApplied;
            commandDiagnostic.legendVisibilityDeferred = !legendVisibilityApplied
                && canDeferLegendVisibilityApply();
            commandDiagnostic.legendDiagnostic = window.__dashbridgeLegendVisibilityDiagnostic || null;
            window.__dashbridgePanelToolsCommandDiagnostic = commandDiagnostic;
            if (!legendVisibilityApplied) {
                debugLog('Legend visibility command was not applied:', window.__dashbridgeLegendVisibilityDiagnostic || null);
            }
        } else {
            commandDiagnostic.resolvedVisibility = null;
            window.__dashbridgePanelToolsCommandDiagnostic = commandDiagnostic;
        }
        // DashBridge-owned fast visibility controllers must also be removed,
        // but they do not restore the native Grafana legend selection above.
        if (!tools.legendVisibility) {
            window.DashBridgeGrafanaVisualEngine?.resetSeriesVisibility?.({ root });
        }
        if (hasVisualWork()) {
            debugLog('Applying visual engine work');
            await applyPopupVisualEngineWhenReady();
        } else if (visualWorkWasEnabled) {
            debugLog('Restoring visual engine defaults (no visual work)');
            // A false visual state is still work: apply() restores the original
            // uPlot/Flot fill and line-width values remembered by the engine.
            // Without this call, a prior removeFill/thickenLines command remains
            // painted even though the persisted tools state is already false.
            await window.DashBridgeGrafanaVisualEngine?.apply({
                panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null,
                removeFill: false,
                thickenLines: false,
                thickenLinesValue: tools.thickenLinesValue !== undefined ? Number(tools.thickenLinesValue) : 1.5,
                invertLegend: false
            });
            window.DashBridgeGrafanaVisualEngine?.resetSeriesVisibility?.({ root });
        } else {
            debugLog('Skipping visual engine: no current or previous visual work');
        }
        if (tools.thresholdEnabled && !thresholdRestoreAfterNextQuery) await applyThresholdWhenChartReady();
        else if (tools.thresholdEnabled) await startThresholdReporting();
        else if (thresholdWasEnabled) await startThresholdReporting();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const layoutWork = hasVisualWork() || visualWorkWasEnabled
            || !!tools.thresholdEnabled || thresholdWasEnabled || legendVisibilityRequested;
        if (layoutWork) window.dispatchEvent(new Event('resize'));
        if (hasPersistentVisualWork()) {
            // Resize can make Grafana replace the uPlot instance after the first
            // successful apply. Re-assert the command on the committed renderer
            // before acknowledging it to the caller and capture semantic proof.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const postResizeState = await applyPersistentVisualState();
            recordVisualReapply('command-post-resize', postResizeState);
            const styleState = postResizeState.styleState;
            if ((tools.removeFill && styleState?.fillMatchesExpected !== true)
                || (tools.thickenLines && styleState?.widthMatchesExpected !== true)) {
                throw new Error(`visual-command-post-resize-mismatch:${JSON.stringify(styleState)}`);
            }
        }
        const applied = {
            action: 'panelToolsApplied',
            requestId: event.data.requestId,
            runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration,
            commandStatus: 'applied',
            queue: event.data.__dashbridgeCommandQueue || null,
            completedAt: Date.now(),
            legendVisibilityApplied: legendVisibilityRequested
                ? !!commandDiagnostic.legendVisibilityApplied : null,
            legendVisibilityDeferred: legendVisibilityRequested
                ? !!commandDiagnostic.legendVisibilityDeferred : false,
        };
        // In an embedded DashBridge card the receiver is the extension page
        // (the parent). In a normal Grafana tab the acknowledgement is for the
        // temporary MAIN-world listener in this same document.
        if (isDashboardIframe) window.parent.postMessage(applied, extensionOrigin);
        else window.postMessage(applied, location.origin);
    };
    // MessageEvent listeners do not await async handlers. Without an explicit
    // queue, rapid UI changes execute concurrently against the shared `tools`
    // object and an older command can finish after a newer one. Preserve every
    // click in FIFO order and expose queue timing in acknowledgements/E2E JSON.
    const panelToolsMessageHandler = event => {
        if (event.origin !== extensionOrigin) return;
        if (event.data?.action !== 'applyPanelTools') {
            void processPanelToolsMessage(event);
            return;
        }
        const sequence = (window.__dashbridgePanelToolsCommandSequence || 0) + 1;
        window.__dashbridgePanelToolsCommandSequence = sequence;
        const enqueuedAt = Date.now();
        const queuedEvent = {
            origin: event.origin,
            source: event.source,
            data: {
                ...event.data,
                __dashbridgeCommandQueue: { sequence, enqueuedAt },
            },
        };
        const previous = window.__dashbridgePanelToolsCommandQueue || Promise.resolve();
        const task = previous.catch(() => undefined).then(async () => {
            queuedEvent.data.__dashbridgeCommandQueue.startedAt = Date.now();
            queuedEvent.data.__dashbridgeCommandQueue.waitMs = Date.now() - enqueuedAt;
            await processPanelToolsMessage(queuedEvent);
        });
        window.__dashbridgePanelToolsCommandQueue = task;
        void task.catch(error => {
            const failed = {
                action: 'panelToolsApplied',
                requestId: event.data.requestId,
                runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration,
                commandStatus: 'error',
                commandError: {
                    name: error?.name || 'Error',
                    message: error?.message || String(error),
                    stack: String(error?.stack || ''),
                },
                queue: {
                    ...queuedEvent.data.__dashbridgeCommandQueue,
                    completedAt: Date.now(),
                },
                completedAt: Date.now(),
                legendVisibilityApplied: null,
            };
            window.__dashbridgePanelToolsCommandDiagnostic = failed;
            if (isDashboardIframe) window.parent.postMessage(failed, extensionOrigin);
            else window.postMessage(failed, location.origin);
        });
    };
    window.__dashbridgePanelToolsMessageHandler = panelToolsMessageHandler;
    window.addEventListener('message', panelToolsMessageHandler);
    registerRuntimeCleanup(() => window.removeEventListener('message', panelToolsMessageHandler));

    const findPanelSceneQueryRunner = panel => {
        if (!panel) return null;
        const seenObjects = new WeakSet();
        let inspectedObjects = 0;
        const isRunner = value => {
            if (!value || typeof value !== 'object' || typeof value.runQueries !== 'function') return false;
            const typeName = String(value.constructor?.name || '');
            return /SceneQueryRunner/i.test(typeName)
                || typeof value.getQueries === 'function'
                || Array.isArray(value.state?.queries);
        };
        const scan = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 12
                || inspectedObjects > 3000 || seenObjects.has(value)) return null;
            seenObjects.add(value);
            inspectedObjects += 1;
            if (isRunner(value)) return value;
            const preferredKeys = ['$data', 'data', 'queryRunner', 'runner', 'model', 'state', 'value'];
            const keys = [...new Set([...preferredKeys, ...Object.keys(value)])];
            for (const key of keys) {
                if (/^(?:parent|_parent|dashboard|children|child|sibling|return)$/i.test(key)) continue;
                let candidate;
                try { candidate = value[key]; } catch { continue; }
                const found = scan(candidate, depth + 1);
                if (found) return found;
            }
            return null;
        };
        const elements = [panel, ...(panel.querySelectorAll?.(
            '[data-viz-panel-key], [data-testid*="Panel header"], .graph-panel__chart, .panel-content, .uplot, .u-wrap, canvas'
        ) || [])].filter(Boolean).slice(0, 40);
        const checkedFibers = new Set();
        for (const element of elements) {
            const fiberKey = Object.getOwnPropertyNames(element).find(key =>
                key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
            );
            for (let fiber = fiberKey && element[fiberKey], depth = 0;
                fiber && depth < 30; depth += 1, fiber = fiber.return) {
                if (checkedFibers.has(fiber)) continue;
                checkedFibers.add(fiber);
                for (const candidate of [fiber.memoizedProps, fiber.pendingProps, fiber.memoizedState, fiber.stateNode]) {
                    const runner = scan(candidate);
                    if (runner) return runner;
                }
            }
        }
        return null;
    };
    const findLegacyFlotPanelController = panel => {
        if (!panel || !window.angular?.element) return null;
        const candidates = [
            panel,
            window.DashBridgeGrafanaDom?.outerPanel(panel),
            ...(panel.querySelectorAll?.('.panel-container, .panel-content, .graph-panel, .graph-panel__chart, canvas') || [])
        ].filter(Boolean);
        for (const element of candidates) {
            try {
                const angularElement = window.angular.element(element);
                const scopes = [angularElement.scope?.(), angularElement.isolateScope?.()].filter(Boolean);
                for (const scope of scopes) {
                    const controller = scope.ctrl || scope.panelCtrl || scope.$ctrl;
                    if (typeof controller?.refresh === 'function') return controller;
                }
            } catch { /* Continue with the next element. */ }
        }
        return null;
    };
    const refreshSelectedPanelData = panel => {
        const sceneRunner = findPanelSceneQueryRunner(panel);
        if (sceneRunner) {
            sceneRunner.runQueries();
            return 'scene-query-runner';
        }

        // Grafana 6-7 Graph panels expose their controller through Angular.
        // Prefer its local refresh before considering the dashboard toolbar.
        const legacyController = findLegacyFlotPanelController(panel);
        if (legacyController) {
            legacyController.refresh();
            return 'angular-panel-controller';
        }

        // Modern panels and legacy Angular Graph panels use the local paths
        // above. Some intermediate legacy Flot builds expose neither private
        // controller; a settings change still needs one query so the response
        // filter and vCPU helper can be applied. This compatibility refresh is
        // used only here after an explicit settings save, never on View remount.
        const root = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
        if (window.DashBridgeGrafanaVisualEngine?.findUPlot?.(root)) {
            return 'uplot-runner-unavailable';
        }
        const refreshButton = document.querySelector(
            'button[aria-label="Refresh dashboard"], .refresh-picker button, '
            + '[data-testid="data-toolbar-refresh"], button[title="Refresh dashboard"]'
        );
        if (!refreshButton) return 'flot-runner-unavailable';
        refreshButton.click();
        return 'dashboard-compatibility';
    };
    const openPanelSettings = panel => {
        const panelKey = getPanelStateKey(panel);
        const thresholdRoot = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel || document;
        const panelTitle = getPanelAnalysisTitle(panel);
        const panelSettings = readPanelAnalysisSettings();
        const panelKind = window.DashBridgeGrafanaPanelAnalysis?.classifyPanelTitle(panelTitle, panelSettings) || null;
        const savedState = normalizePanelLegendState(panelVisualState?.get(panel) || panel.__dashbridgeVisualState);
        const defaultCpuCapacityCoefficient = Number.isFinite(Number(panelSettings.grafanaCpuCapacityCoefficient))
            ? Number(panelSettings.grafanaCpuCapacityCoefficient) : 0.8;
        const state = savedState ? {
            ...savedState,
            cpuCapacityFilterCoefficient: Number.isFinite(Number(savedState.cpuCapacityFilterCoefficient))
                && Number(savedState.cpuCapacityFilterCoefficient) > 0
                ? Number(savedState.cpuCapacityFilterCoefficient) : defaultCpuCapacityCoefficient
        } : {
            removeFill: false, thickenLines: false, thickenLinesValue: 1.5, invertLegend: false,
            capturePrepared: document.documentElement.dataset.dashbridgeCapturePrepared === 'true',
            legendFilter: [], legendSelectionVersion: null, legendVisibleSeries: [], legendMode: 'fast_complete_hide', legendSearch: '', legendSelectFilter: '', legendIgnoreFilter: '', invertIdle: false,
            convertMemToUsed: false, forceMemByteUnit: false, seriesQueryFilterEnabled: false, seriesQueryFilterHighlightEnabled: true, seriesQueryFilterValue: 0,
            seriesQueryFilterRawValue: null, seriesQueryFilterMode: 'max', cpuCapacityFilterEnabled: false, cpuCapacityFilterHighlightEnabled: true,
            cpuCapacityFilterCoefficient: defaultCpuCapacityCoefficient, cpuCapacityFilterMode: 'max',
            cpuCapacityFilterLoad1: true, cpuCapacityFilterLoad5: false, cpuCapacityFilterLoad15: false,
            thresholdEnabled: false,
            thresholdNotifyEnabled: true, thresholdValue: 0
        };
        window.DashBridgePanelSettingsModal?.open({
            state,
            content: `${window.DashBridgePanelSettingsModal.transformFields(state, { panelKind })}${window.DashBridgePanelSettingsModal.thresholdFields(state)}${window.DashBridgePanelSettingsModal.legendFields(state.legendMode, state)}`,
            advanced: {
                cpuCapacityFilterCoefficientDefault: defaultCpuCapacityCoefficient,
                getLegendSeries: () => getPanelLegendSeries(panel),
                getThresholdStatus: () => window.DashBridgeGrafanaVisualEngine?.getThresholdUnitAsync?.({ root: thresholdRoot, panelId: panelKey })
                    || window.DashBridgeGrafanaVisualEngine?.getThresholdUnit?.(thresholdRoot),
                formatThresholdUnit: status => status?.unit
                    ? `Единица: ${status.unit}`
                    : (status?.engine && status.engine !== 'unknown' ? 'Без единицы' : 'Единица определяется по графику')
            },
            onSave: async next => {
                const nextState = {
                    ...state,
                    ...next
                };
                nextState.forceMemByteUnit = nextState.convertMemToUsed
                    ? false
                    : (state.convertMemToUsed || state.forceMemByteUnit);
                enforceSingleResponseSeriesFilter(nextState);
                const completeHideActive = legendSelection.isCompleteHideActive(nextState);
                if (!isDashboardIframe && (nextState.seriesQueryFilterEnabled || nextState.cpuCapacityFilterEnabled || completeHideActive)) {
                    nextState.targetQuerySignatures = await window.DashBridgeGrafanaVisualEngine?.getPanelQuerySignaturesAsync?.({
                        root: thresholdRoot,
                        panelId: panelKey
                    }) || [];
                    nextState.targetLegendSeries = getPanelLegendSeries(panel);
                }
                // invertIdle и convertMemToUsed тоже работают через fetch-перехват.
                // Без targetQuerySignatures/targetLegendSeries функция transform() не может
                // определить refId нужной панели и пропускает трансформацию
                // (guard: !isDashboardIframe && !targetRefIds.size → return data).
                // Берём оба источника: подписи запросов надёжнее, серии легенды — fallback.
                if (!isDashboardIframe && (nextState.invertIdle || nextState.convertMemToUsed || nextState.forceMemByteUnit)
                    && !nextState.seriesQueryFilterEnabled && !nextState.cpuCapacityFilterEnabled) {
                    const legendSeries = getPanelLegendSeries(panel);
                    nextState.targetLegendSeries = legendSeries;
                    if (!nextState.targetQuerySignatures?.length) {
                        nextState.targetQuerySignatures = await window.DashBridgeGrafanaVisualEngine?.getPanelQuerySignaturesAsync?.({
                            root: thresholdRoot,
                            panelId: panelKey
                        }) || [];
                    }
                }
                // Если все data-трансформации выключены — очищаем сохранённые сигнатуры.
                // Иначе transform() продолжит находить совпадения по старым refId и будет
                // применять filterLegendData / filterSeriesByThreshold к чужим панелям.
                if (!isDashboardIframe && !nextState.seriesQueryFilterEnabled && !nextState.cpuCapacityFilterEnabled
                    && !nextState.invertIdle && !nextState.convertMemToUsed
                    && !nextState.forceMemByteUnit
                    && !completeHideActive) {
                    nextState.targetQuerySignatures = [];
                    nextState.targetLegendSeries = [];
                }
                const dataTransformChanged = state.invertIdle !== nextState.invertIdle
                    || state.convertMemToUsed !== nextState.convertMemToUsed
                    || state.forceMemByteUnit !== nextState.forceMemByteUnit
                    || state.seriesQueryFilterEnabled !== nextState.seriesQueryFilterEnabled
                    || state.seriesQueryFilterValue !== nextState.seriesQueryFilterValue
                    || state.seriesQueryFilterRawValue !== nextState.seriesQueryFilterRawValue
                    || state.seriesQueryFilterMode !== nextState.seriesQueryFilterMode
                    || state.cpuCapacityFilterEnabled !== nextState.cpuCapacityFilterEnabled
                    || state.cpuCapacityFilterCoefficient !== nextState.cpuCapacityFilterCoefficient
                    || state.cpuCapacityFilterMode !== nextState.cpuCapacityFilterMode
                    || state.cpuCapacityFilterLoad1 !== nextState.cpuCapacityFilterLoad1
                    || state.cpuCapacityFilterLoad5 !== nextState.cpuCapacityFilterLoad5
                    || state.cpuCapacityFilterLoad15 !== nextState.cpuCapacityFilterLoad15;
                const thresholdHighlightVisibilityChanged =
                    state.seriesQueryFilterHighlightEnabled !== nextState.seriesQueryFilterHighlightEnabled
                    || state.cpuCapacityFilterHighlightEnabled !== nextState.cpuCapacityFilterHighlightEnabled;
                const responseFilterChanged = state.seriesQueryFilterEnabled !== nextState.seriesQueryFilterEnabled
                    || state.seriesQueryFilterValue !== nextState.seriesQueryFilterValue
                    || state.seriesQueryFilterRawValue !== nextState.seriesQueryFilterRawValue
                    || state.seriesQueryFilterMode !== nextState.seriesQueryFilterMode
                    || state.cpuCapacityFilterEnabled !== nextState.cpuCapacityFilterEnabled
                    || state.cpuCapacityFilterCoefficient !== nextState.cpuCapacityFilterCoefficient
                    || state.cpuCapacityFilterMode !== nextState.cpuCapacityFilterMode
                    || state.cpuCapacityFilterLoad1 !== nextState.cpuCapacityFilterLoad1
                    || state.cpuCapacityFilterLoad5 !== nextState.cpuCapacityFilterLoad5
                    || state.cpuCapacityFilterLoad15 !== nextState.cpuCapacityFilterLoad15;
                const legendDataFilterChanged = (state.legendMode === 'fast_complete_hide'
                    || nextState.legendMode === 'fast_complete_hide')
                    && (state.legendMode !== nextState.legendMode
                        || state.legendSelectionVersion !== nextState.legendSelectionVersion
                        || JSON.stringify(state.legendFilter || []) !== JSON.stringify(nextState.legendFilter || [])
                        || JSON.stringify(state.legendVisibleSeries || []) !== JSON.stringify(nextState.legendVisibleSeries || []));
                Object.assign(tools, nextState);
                const responseFilterWasDisabled = state.seriesQueryFilterEnabled && !nextState.seriesQueryFilterEnabled
                    || state.cpuCapacityFilterEnabled && !nextState.cpuCapacityFilterEnabled;
                if (!tools.thresholdEnabled) thresholdRestoreAfterNextQuery = false;
                else if (responseFilterWasDisabled
                    && visualMetadata.responseDataStatus?.kind === 'filtered_empty') {
                    thresholdRestoreAfterNextQuery = true;
                }
                if (state.convertMemToUsed !== nextState.convertMemToUsed) visualMetadata.memoryConversionApplied = null;
                if (responseFilterChanged) {
                    visualMetadata.responseFilterVisibleNames = [];
                    visualMetadata.responseFilterReady = false;
                }
                if (state.seriesQueryFilterEnabled && !nextState.seriesQueryFilterEnabled) {
                    discardThresholdHighlightRules('series-query-filter');
                }
                if (state.cpuCapacityFilterEnabled && !nextState.cpuCapacityFilterEnabled) {
                    discardThresholdHighlightRules('cpu-capacity-filter');
                    visualMetadata.seriesCpuCapacityEntries = [];
                }
                tools.targetPanelId = panelKey;
                tools.targetPanelTitle = panel.querySelector('[data-testid*="Panel header"], .panel-title, h6[title]')?.textContent?.trim() || '';
                tools.targetPanelType = 'active';
                installDataInterceptor();
                markCalculatedTitle();
                observeCalculatedTitle();
                panel.__dashbridgeVisualState = nextState;
                panelVisualState?.set(panel, nextState);
                panel.__dashbridgeVisualStateSignature = JSON.stringify(nextState);
                syncResponseFilterPresentation(thresholdRoot);
                const panelId = panelKey;
                if (hasVisualWork(state) || hasVisualWork(nextState)) {
                    const visualLegendFilter = getVisualLegendFilter(nextState);
                    const seriesConfig = Object.fromEntries(getPanelLegendSeries(panel).map(name => [name, !visualLegendFilter.includes(name)]));
                    await window.DashBridgeGrafanaVisualEngine?.apply({ panelId, seriesConfig: hasLegendVisibilityWork(nextState) ? seriesConfig : null, mode: nextState.legendMode, ...nextState });
                }
                if (tools.thresholdEnabled && !thresholdRestoreAfterNextQuery) await applyThresholdWhenChartReady();
                else if (tools.thresholdEnabled) await startThresholdReporting();
                else await startThresholdReporting();
                if (dataTransformChanged || legendDataFilterChanged) {
                    refreshSelectedPanelData(panel);
                } else if (thresholdHighlightVisibilityChanged) {
                    // The overlay already owns the latest threshold rules and
                    // can switch immediately without querying Grafana.
                    syncThresholdHighlightState(thresholdRoot);
                }
            }
        });
    };

    // The iframe URL is the only configuration source available before
    // Grafana's initial query. Install at document_start; it is a no-op until
    // a data transform (including complete-hide) is active.
    installDataInterceptor();

    const isPanelMenuDomainAllowed = () => document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true';
    const panelCaptureRuntime = window.DashBridgeGrafanaPanelCaptureRuntime?.create({
        isDashboardIframe, extensionOrigin, tools, panelVisualState,
        getPanelStateKey, registerRuntimeCleanup, syncThresholdHighlightState
    });
    if (!panelCaptureRuntime) throw new Error('DashBridge Grafana panel capture runtime is unavailable');
    const {
        readPanelCaptureState, syncPanelCaptureToggle,
        setPanelCapturePrepared, getPanelCaptureTitle, runPanelCapture
    } = panelCaptureRuntime;
    const panelMenuRuntime = window.DashBridgeGrafanaPanelMenuRuntime?.create({
        isDashboardIframe, extensionOrigin, isPanelMenuDomainAllowed,
        registerRuntimeCleanup, getPanelStateKey, restorePanelVisualState,
        refreshSelectedPanelData, openPanelSettings,
        readPanelCaptureState, syncPanelCaptureToggle, setPanelCapturePrepared,
        getPanelCaptureTitle, runPanelCapture
    });
    if (!panelMenuRuntime) throw new Error('DashBridge Grafana panel menu runtime is unavailable');
    const { startEmbeddedPanelAnalysis } = panelMenuRuntime;
    // Recreate long-lived behavior with callbacks from this generation. State
    // itself is global and remains unchanged across a safe reinjection.
    if (tools.invertIdle || tools.convertMemToUsed) {
        markCalculatedTitle();
        observeCalculatedTitle();
    }
    if (tools.thresholdEnabled) startThresholdReportingSoon();

})();
