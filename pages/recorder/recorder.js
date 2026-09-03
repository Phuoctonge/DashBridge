/* global DashBridgeAnalytics */
(function () {
    'use strict';

    const schema = globalThis.DashBridgeFlowSchema;
    const flowCompare = globalThis.DashBridgeFlowCompare;
    const comparisonXlsx = globalThis.DashBridgeComparisonXlsx;
    const CDP_VERSION = '1.3';
    const MAX_BODY_BYTES = 5 * 1024 * 1024;
    const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;
    const MAX_TOTAL_REQUEST_BODY_BYTES = 100 * 1024 * 1024;
    const MAX_TOTAL_BODY_BYTES = 100 * 1024 * 1024;
    const MAX_REQUESTS = 50_000;
    const MAX_STREAM_EVENTS = 50_000;
    const MAX_STREAM_PAYLOAD_BYTES = 20 * 1024 * 1024;
    const MAX_PAGE_EVENTS = 20_000;
    const MAX_DASHFLOW_WORKING_SET_BYTES = 256 * 1024 * 1024;
    const MAX_DASHFLOW_MANIFEST_BYTES = 1024 * 1024;
    const MAX_DASHFLOW_FLOW_BYTES = 64 * 1024 * 1024;
    const MAX_DASHFLOW_NETWORK_BYTES = 256 * 1024 * 1024;
    const MAX_DASHFLOW_STREAMS_BYTES = 64 * 1024 * 1024;
    const NETWORK_IDLE_MS = 650;
    const NETWORK_IDLE_TIMEOUT_MS = 15_000;

    const ui = {
        startUrl: document.getElementById('startUrl'),
        start: document.getElementById('startButton'),
        stop: document.getElementById('stopButton'),
        save: document.getElementById('saveButton'),
        replay: document.getElementById('replayButton'),
        file: document.getElementById('flowFile'),
        status: document.getElementById('status'),
        steps: document.getElementById('steps'),
        traffic: document.getElementById('traffic'),
        filter: document.getElementById('trafficFilter'),
        trafficMethodFilter: document.getElementById('trafficMethodFilter'),
        trafficStatusFilter: document.getElementById('trafficStatusFilter'),
        trafficTypeFilter: document.getElementById('trafficTypeFilter'),
        clearTrafficFilters: document.getElementById('clearTrafficFilters'),
        trafficSummary: document.getElementById('trafficSummary'),
        showAllSteps: document.getElementById('showAllSteps'),
        stepCount: document.getElementById('stepCount'),
        requestCount: document.getElementById('requestCount'),
        bodySize: document.getElementById('bodySize'),
        mode: document.getElementById('modeValue'),
        requestDetails: document.getElementById('requestDetails'),
        requestDetailsSummary: document.getElementById('requestDetailsSummary'),
        copyRequestUrl: document.getElementById('copyRequestUrlButton'),
        toggleSensitiveDetails: document.getElementById('toggleSensitiveDetailsButton'),
        sessionModeBadge: document.getElementById('sessionModeBadge'),
        sessionProgress: document.getElementById('sessionProgress'),
        comparisonPanel: document.getElementById('comparisonPanel'),
        comparisonSummary: document.getElementById('comparisonSummary'),
        comparisonFilter: document.getElementById('comparisonFilter'),
        comparisonUrlFilter: document.getElementById('comparisonUrlFilter'),
        exportComparison: document.getElementById('exportComparisonButton'),
        comparisonBody: document.getElementById('comparisonBody'),
        disableCache: document.getElementById('disableCache'),
        disableCookies: document.getElementById('disableCookies'),
        networkMode: document.getElementById('networkMode'),
        incognitoSetup: document.getElementById('incognitoSetup'),
        openIncognitoSettings: document.getElementById('openIncognitoSettings'),
    };

    const state = {
        mode: 'idle', tabId: null, windowId: null, attached: false, detaching: false,
        title: '', startUrl: '', createdAt: null, steps: [], requests: new Map(),
        baselineRequests: new Map(), comparison: [],
        loadedManifest: null, totalBodyBytes: 0, totalRequestBodyBytes: 0, inFlight: new Set(), lastNetworkAt: 0,
        actionSequence: 0, detachedUnexpectedly: false, activeRequests: new Map(), redirectCounts: new Map(), ignoredRequests: new Set(), selectedRequestId: null,
        requestChains: new Map(), requestExtraInfoIndexes: new Map(), responseExtraInfoIndexes: new Map(),
        activeStepId: null, selectedStepId: null, revealSensitiveDetails: false,
        pendingBodyCaptures: new Set(),
        pendingRequestBodyCaptures: new Set(), streams: [], streamPayloadBytes: 0,
        environment: null, pageEvents: [], captureFinishedAt: null,
        completeness: null,
        sessionOptions: { disableCache: true, disableCookies: true },
        incognitoAllowed: false, sessionStartedAt: null, stopRequested: false, importing: false,
    };

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    let operationProgressController = null;
    let sessionIndicatorTimer = null;

    function setStatus(message, error = false) {
        ui.status.textContent = message;
        ui.status.classList.toggle('error', error);
    }

    function formatBytes(bytes) {
        const value = Math.max(0, Number(bytes) || 0);
        if (value < 1024) return `${value} Б`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
        return `${(value / 1024 / 1024).toFixed(1)} МБ`;
    }

    function updateControls() {
        const active = ['recording', 'replaying'].includes(state.mode);
        const controlsLocked = active || state.importing;
        ui.start.disabled = controlsLocked;
        ui.stop.disabled = !active;
        ui.save.disabled = controlsLocked || (!state.steps.length && !state.requests.size);
        ui.replay.disabled = controlsLocked || !state.steps.length;
        ui.disableCache.disabled = controlsLocked;
        ui.disableCookies.disabled = controlsLocked;
        ui.exportComparison.disabled = controlsLocked || !state.comparison.length;
        ui.file.disabled = controlsLocked;
        const fileButton = ui.file.closest('.file-button');
        fileButton?.classList.toggle('disabled', controlsLocked);
        fileButton?.setAttribute('aria-disabled', String(controlsLocked));
        if (fileButton) fileButton.tabIndex = controlsLocked ? -1 : 0;
        ui.stop.classList.toggle('danger', active);
        ui.mode.textContent = state.mode === 'recording' ? 'Запись' : state.mode === 'replaying' ? 'Replay' : 'Ожидание';
        ui.stepCount.textContent = String(state.steps.length);
        ui.requestCount.textContent = String(state.requests.size);
        ui.bodySize.textContent = formatBytes(state.totalBodyBytes);
        updateNetworkMode();
        updateSessionIndicator();
        syncSessionIndicatorTimer();
    }

    function updateNetworkMode() {
        const cacheText = ui.disableCache.checked ? 'cache отключён' : 'cache разрешён';
        const needsIncognitoPermission = ui.disableCookies.checked && !state.incognitoAllowed;
        const cookieText = !ui.disableCookies.checked
            ? 'cookies: текущий Chrome-профиль'
            : state.incognitoAllowed
                ? 'cookies: временная incognito-сессия'
                : 'cookies: требуется разрешение incognito';
        ui.networkMode.textContent = `${cacheText} · ${cookieText}`;
        ui.networkMode.classList.toggle('pending', needsIncognitoPermission);
    }

    function updateSessionIndicator() {
        const labels = { idle: 'Ожидание', recording: 'Запись', replaying: 'Replay' };
        ui.sessionModeBadge.textContent = labels[state.mode] || state.mode;
        ui.sessionModeBadge.dataset.mode = state.mode;
        if (!['recording', 'replaying'].includes(state.mode) || !state.sessionStartedAt) {
            ui.sessionProgress.textContent = state.steps.length
                ? `В сценарии ${state.steps.length} шагов · ${state.requests.size} запросов`
                : 'Сессия не запущена';
            return;
        }
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
        const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
        const step = state.activeStepId ? ` · шаг ${state.activeStepId}/${Math.max(state.steps.length, state.activeStepId)}` : '';
        ui.sessionProgress.textContent = `${elapsed}${step} · ${state.requests.size} запросов`;
    }

    function syncSessionIndicatorTimer() {
        const active = ['recording', 'replaying'].includes(state.mode);
        if (active && sessionIndicatorTimer === null) {
            sessionIndicatorTimer = setInterval(updateSessionIndicator, 1_000);
        } else if (!active && sessionIndicatorTimer !== null) {
            clearInterval(sessionIndicatorTimer);
            sessionIndicatorTimer = null;
        }
    }

    function updateRecordingProgress() {
        if (state.mode !== 'recording' || !operationProgressController) return;
        let success = 0; let failed = 0;
        for (const request of state.requests.values()) {
            if (request.failed || Number(request.status) >= 400) failed += 1;
            else if (Number(request.status) > 0) success += 1;
        }
        operationProgressController.update({
            phase: 'Запись трафика', done: state.requests.size, total: 0, unit: 'запросов', success, failed,
            message: `Шагов: ${state.steps.length}. Выполняйте сценарий в контролируемой вкладке.`,
        });
    }

    async function refreshIncognitoAccess() {
        try { state.incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess(); }
        catch (_) { state.incognitoAllowed = false; }
        ui.incognitoSetup.hidden = !ui.disableCookies.checked || state.incognitoAllowed;
        updateNetworkMode();
        return state.incognitoAllowed;
    }

    const sessionTransport = DashBridgeRecorderSessionTransport.create({
        state,
        refreshIncognitoAccess,
        cdpVersion: CDP_VERSION,
        maxBodyBytes: MAX_BODY_BYTES,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });

    const recorderSettings = DashBridgeRecorderSettings.create({ ui });
    const saveRecorderSettings = recorderSettings.save;
    const scheduleRecorderSettingsSave = recorderSettings.schedule;
    const saveRecorderDraft = recorderSettings.saveDraft;
    const restoreRecorderSettings = recorderSettings.restore;

    const recorderView = DashBridgeRecorderView.create({
        ui,
        state,
        flowCompare,
        comparisonXlsx,
        schema,
        formatBytes,
        setStatus,
        updateControls,
        updateRecordingProgress,
    });
    const {
        stepLabel,
        requestDuration,
        renderSteps,
        renderTraffic,
        renderRequestDetails,
        renderComparison,
        buildComparison,
        exportComparisonReport,
        scheduleRender,
    } = recorderView;

    function resetSession({ keepSteps = false, keepBaseline = false } = {}) {
        if (!keepSteps) state.steps = [];
        if (!keepBaseline) state.baselineRequests = new Map();
        state.comparison = [];
        state.requests = new Map(); state.totalBodyBytes = 0; state.totalRequestBodyBytes = 0; state.inFlight = new Set();
        state.activeRequests = new Map(); state.redirectCounts = new Map();
        state.requestChains = new Map(); state.requestExtraInfoIndexes = new Map(); state.responseExtraInfoIndexes = new Map();
        state.ignoredRequests = new Set();
        state.selectedRequestId = null; state.selectedStepId = null; state.revealSensitiveDetails = false;
        state.pendingBodyCaptures = new Set();
        state.pendingRequestBodyCaptures = new Set(); state.streams = []; state.streamPayloadBytes = 0;
        state.environment = null; state.pageEvents = []; state.captureFinishedAt = null;
        state.completeness = {
            droppedRequests: 0, responseBodiesCaptured: 0, responseBodiesEmpty: 0,
            responseBodiesSkipped: 0, responseBodiesFailed: 0, responseBodiesUnavailable: 0,
            requestBodiesPartial: 0, requestBodiesSkipped: 0, requestBodiesFailed: 0,
            streamEventsDropped: 0, streamPayloadBytesDropped: 0, pendingCapturesAtStop: 0,
            pageEventsDropped: 0,
            unexpectedDebuggerDetach: false,
        };
        state.lastNetworkAt = 0; state.actionSequence = 0; state.activeStepId = null; state.detachedUnexpectedly = false;
        state.detaching = false; state.stopRequested = false;
        scheduleRender();
    }

    const recorderActionCapture = DashBridgeRecorderActionCapture.create({
        state, schema, setStatus, scheduleRender,
    });
    const addNavigateStep = recorderActionCapture.addNavigateStep;
    const addRecordedAction = recorderActionCapture.addRecordedAction;

    const networkCapture = DashBridgeRecorderNetworkCapture.create({
        state,
        schema,
        sendCdp: sessionTransport.sendCdp,
        sha256,
        bodyBytes,
        addNavigateStep,
        injectActionRecorder: sessionTransport.injectActionRecorder,
        scheduleRender,
        setStatus,
        limits: {
            maxBodyBytes: MAX_BODY_BYTES,
            maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
            maxTotalRequestBodyBytes: MAX_TOTAL_REQUEST_BODY_BYTES,
            maxTotalBodyBytes: MAX_TOTAL_BODY_BYTES,
            maxRequests: MAX_REQUESTS,
            maxStreamEvents: MAX_STREAM_EVENTS,
            maxStreamPayloadBytes: MAX_STREAM_PAYLOAD_BYTES,
            maxPageEvents: MAX_PAGE_EVENTS,
        },
    });

    const sessionController = DashBridgeRecorderSessionController.create({
        state,
        ui,
        schema,
        transport: sessionTransport,
        networkCapture,
        delay,
        resetSession,
        addNavigateStep,
        saveSettings: saveRecorderSettings,
        setStatus,
        updateControls,
        updateRecordingProgress,
        scheduleRender,
        getProgressController: () => operationProgressController,
    });

    const dashflowExport = DashBridgeDashflowExport.create({ schema, requestDuration, stepLabel });

    async function sha256(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    }

    function bodyBytes(request) {
        if (request.bodyBase64) {
            const binary = atob(request.responseBody || ''); const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            return bytes;
        }
        return new TextEncoder().encode(request.responseBody || '');
    }

    const dashflowIo = DashBridgeDashflowIo.create({
        JSZip,
        schema,
        sha256,
        limits: {
            fileBytes: 512 * 1024 * 1024,
            workingSetBytes: MAX_DASHFLOW_WORKING_SET_BYTES,
            manifestBytes: MAX_DASHFLOW_MANIFEST_BYTES,
            flowBytes: MAX_DASHFLOW_FLOW_BYTES,
            networkBytes: MAX_DASHFLOW_NETWORK_BYTES,
            streamsBytes: MAX_DASHFLOW_STREAMS_BYTES,
            requestBodyBytes: MAX_REQUEST_BODY_BYTES,
            totalRequestBodyBytes: MAX_TOTAL_REQUEST_BODY_BYTES,
            bodyBytes: MAX_BODY_BYTES,
            totalBodyBytes: MAX_TOTAL_BODY_BYTES,
            streamPayloadBytes: MAX_STREAM_PAYLOAD_BYTES
        }
    });

    const dashflowController = DashBridgeRecorderDashflowController.create({
        state,
        ui,
        schema,
        io: dashflowIo,
        exporter: dashflowExport,
        zipConstructor: JSZip,
        sha256,
        bodyBytes,
        stopSession: sessionController.stop,
        resetSession,
        saveSettings: saveRecorderSettings,
        setStatus,
        updateControls,
        scheduleRender,
        limits: {
            maxRequests: MAX_REQUESTS,
            maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
            maxTotalRequestBodyBytes: MAX_TOTAL_REQUEST_BODY_BYTES,
            maxBodyBytes: MAX_BODY_BYTES,
            maxTotalBodyBytes: MAX_TOTAL_BODY_BYTES,
            maxStreamEvents: MAX_STREAM_EVENTS,
            maxStreamPayloadBytes: MAX_STREAM_PAYLOAD_BYTES,
            maxPageEvents: MAX_PAGE_EVENTS,
            maxWorkingSetBytes: MAX_DASHFLOW_WORKING_SET_BYTES,
        },
    });

    const recorderReplay = DashBridgeRecorderReplay.create({
        state,
        ui,
        delay,
        networkIdleMs: NETWORK_IDLE_MS,
        networkIdleTimeoutMs: NETWORK_IDLE_TIMEOUT_MS,
        ensureDebuggerPermission: sessionTransport.ensureDebuggerPermission,
        stopActiveSession: sessionController.stop,
        resetSession,
        buildRecorderWindowLayout: sessionTransport.buildWindowLayout,
        createControlledTab: sessionTransport.createControlledTab,
        attachNetwork: sessionTransport.attachNetwork,
        buildComparison,
        scheduleRender,
        setStatus,
        updateControls,
        stepLabel,
        getOperationProgressController: () => operationProgressController,
    });
    const startReplay = recorderReplay.start;

    async function copySelectedRequestUrl() {
        const request = state.requests.get(state.selectedRequestId);
        if (!request?.url) return;
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(request.url);
            else {
                const input = document.createElement('textarea');
                input.value = request.url; input.style.position = 'fixed'; input.style.opacity = '0';
                document.body.appendChild(input); input.select();
                const copied = document.execCommand('copy'); input.remove();
                if (!copied) throw new Error('Копирование не поддерживается');
            }
            setStatus('URL запроса скопирован.');
            DashBridgeAnalytics?.outcome('recorder.request_url_copied', 'success');
        } catch (error) {
            setStatus(`Не удалось скопировать URL: ${error?.message || error}`, true);
            DashBridgeAnalytics?.outcome('recorder.request_url_copied', 'error');
        }
    }

    function clearTrafficFilters() {
        ui.filter.value = '';
        ui.trafficMethodFilter.value = 'all';
        ui.trafficStatusFilter.value = 'all';
        ui.trafficTypeFilter.value = 'all';
        state.selectedStepId = null;
        renderSteps(); renderTraffic();
    }

    chrome.debugger.onEvent.addListener(networkCapture.handleEvent);
    chrome.debugger.onDetach.addListener((source, reason) => {
        if (source.tabId !== state.tabId) return;
        state.attached = false;
        sessionTransport.postLifecycle({ type: 'unbind' });
        if (state.detaching) return;
        void sessionController.finalizeUnexpected(
            `Chrome отключил запись трафика: ${reason}`,
            { debuggerDetached: true },
        );
    });
    chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type === 'dashbridge-recorder-environment' && sender.tab?.id === state.tabId
            && sender.frameId === 0 && ['recording', 'replaying'].includes(state.mode)) {
            state.environment = { ...message.environment, chromeVersion: /(?:Chrome|Chromium)\/([\d.]+)/.exec(message.environment?.userAgent || '')?.[1] || '',
                extensionVersion: chrome.runtime.getManifest().version };
            return;
        }
        if (message?.type !== 'dashbridge-recorder-action' || sender.tab?.id !== state.tabId || state.mode !== 'recording') return;
        addRecordedAction(message.action, sender.frameId);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (tabId === state.tabId && changeInfo.status === 'complete') {
            sessionTransport.injectActionRecorder();
        }
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        if (tabId !== state.tabId) return;
        void sessionController.finalizeUnexpected('Контролируемая вкладка закрыта.');
    });

    ui.start.addEventListener('click', sessionController.start);
    ui.stop.addEventListener('click', () => sessionController.stop(true));
    ui.save.addEventListener('click', dashflowController.save);
    ui.replay.addEventListener('click', startReplay);
    ui.file.addEventListener('change', () => dashflowController.load(ui.file.files?.[0]));
    ui.file.closest('.file-button')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!ui.file.disabled) ui.file.click();
    });
    ui.filter.addEventListener('input', renderTraffic);
    ui.filter.addEventListener('change', () => DashBridgeAnalytics?.opened('recorder.traffic_filter_used'));
    [ui.trafficMethodFilter, ui.trafficStatusFilter, ui.trafficTypeFilter].forEach(control =>
        control.addEventListener('change', () => {
            renderTraffic(); DashBridgeAnalytics?.opened('recorder.traffic_filter_used');
        }));
    ui.clearTrafficFilters.addEventListener('click', clearTrafficFilters);
    ui.showAllSteps.addEventListener('click', () => { state.selectedStepId = null; renderSteps(); renderTraffic(); });
    ui.copyRequestUrl.addEventListener('click', copySelectedRequestUrl);
    ui.toggleSensitiveDetails.addEventListener('click', () => {
        state.revealSensitiveDetails = !state.revealSensitiveDetails; renderRequestDetails();
        DashBridgeAnalytics?.opened('recorder.sensitive_details_revealed');
    });
    ui.comparisonFilter.addEventListener('change', () => {
        renderComparison(); DashBridgeAnalytics?.opened('recorder.comparison_filter_used');
    });
    ui.comparisonUrlFilter.addEventListener('input', renderComparison);
    ui.comparisonUrlFilter.addEventListener('change', () => DashBridgeAnalytics?.opened('recorder.comparison_filter_used'));
    ui.exportComparison.addEventListener('click', exportComparisonReport);
    ui.startUrl.addEventListener('input', scheduleRecorderSettingsSave);
    ui.startUrl.addEventListener('change', () => { void saveRecorderSettings().catch(() => undefined); });
    ui.disableCache.addEventListener('change', () => { updateControls(); void saveRecorderSettings().catch(() => undefined); });
    ui.disableCookies.addEventListener('change', () => { updateControls(); refreshIncognitoAccess(); void saveRecorderSettings().catch(() => undefined); });
    ui.openIncognitoSettings.addEventListener('click', async () => {
        try {
            await saveRecorderDraft();
            await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
            setStatus('Включите доступ в режиме инкогнито. Chrome перезапустит расширение; затем откройте Recorder снова.');
        } catch (error) {
            setStatus(`Не удалось открыть настройки: ${error?.message || error}`, true);
        }
    });
    window.addEventListener('focus', refreshIncognitoAccess);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIncognitoAccess(); });
    window.addEventListener('beforeunload', () => { if (state.attached && Number.isInteger(state.tabId)) chrome.debugger.detach({ tabId: state.tabId }).catch(() => undefined); });
    window.addEventListener('pagehide', () => {
        recorderSettings.cancelScheduled();
        clearInterval(sessionIndicatorTimer);
        sessionIndicatorTimer = null;
        void saveRecorderSettings().catch(() => undefined);
        void operationProgressController?.release();
    });
    operationProgressController = globalThis.DashBridgeOperationProgress?.create({
        onCancel: () => sessionController.stop(true),
    }) || null;
    void restoreRecorderSettings().finally(() => {
        updateControls(); refreshIncognitoAccess(); renderSteps(); renderTraffic(); renderRequestDetails();
    });
})();
