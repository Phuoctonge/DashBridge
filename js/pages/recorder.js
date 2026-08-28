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
    const MAX_ACTION_VALUE = 1024 * 1024;
    const NETWORK_IDLE_MS = 650;
    const NETWORK_IDLE_TIMEOUT_MS = 15_000;
    const RECORDER_DRAFT_KEY = 'dashbridgeRecorderDraft';
    const RECORDER_SETTINGS_KEY = 'dashbridgeRecorderSettings';

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
    let lifecyclePort = null;
    let operationProgressController = null;
    let settingsSaveTimer = null;
    let sessionIndicatorTimer = null;

    function connectLifecyclePort() {
        try {
            const port = chrome.runtime.connect({ name: 'dashbridge-recorder-lifecycle' });
            lifecyclePort = port;
            port.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                if (lifecyclePort === port) lifecyclePort = null;
            });
            return port;
        } catch (_) {
            lifecyclePort = null;
            return null;
        }
    }

    function postLifecycle(message) {
        try {
            const wasConnected = Boolean(lifecyclePort);
            const connected = lifecyclePort || connectLifecyclePort();
            if (!connected) return false;
            if (!wasConnected && state.attached && message?.type !== 'bind') {
                connected.postMessage({ type: 'bind', tabId: state.tabId });
            }
            connected.postMessage(message);
            return true;
        } catch (_) {
            lifecyclePort = null;
            return false;
        }
    }

    connectLifecyclePort();
    setInterval(() => {
        if (state.attached) {
            postLifecycle({ type: 'heartbeat' });
        }
    }, 20_000);
    const debuggerTarget = () => ({ tabId: state.tabId });
    const sendCdp = (method, params = {}) => chrome.debugger.sendCommand(debuggerTarget(), method, params);

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

    function recorderSettingsSnapshot() {
        return {
            startUrl: String(ui.startUrl.value || '').slice(0, 4096),
            disableCache: ui.disableCache.checked,
            disableCookies: ui.disableCookies.checked,
        };
    }

    async function saveRecorderSettings({ includeDraft = false } = {}) {
        const settings = recorderSettingsSnapshot();
        const values = { [RECORDER_SETTINGS_KEY]: settings };
        if (includeDraft) values[RECORDER_DRAFT_KEY] = settings;
        await chrome.storage.local.set(values);
    }

    function scheduleRecorderSettingsSave() {
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => {
            settingsSaveTimer = null;
            void saveRecorderSettings().catch(() => undefined);
        }, 250);
    }

    async function saveRecorderDraft() {
        await saveRecorderSettings({ includeDraft: true });
    }

    async function restoreRecorderSettings() {
        try {
            const stored = await chrome.storage.local.get([RECORDER_SETTINGS_KEY, RECORDER_DRAFT_KEY]);
            const persistent = stored?.[RECORDER_SETTINGS_KEY];
            const draft = stored?.[RECORDER_DRAFT_KEY];
            const settings = draft && typeof draft === 'object' ? draft : persistent;
            if (!settings || typeof settings !== 'object') return;
            if (typeof settings.startUrl === 'string') ui.startUrl.value = settings.startUrl.slice(0, 4096);
            if (typeof settings.disableCache === 'boolean') ui.disableCache.checked = settings.disableCache;
            if (typeof settings.disableCookies === 'boolean') ui.disableCookies.checked = settings.disableCookies;
            await saveRecorderSettings();
            if (draft) await chrome.storage.local.remove(RECORDER_DRAFT_KEY);
        } catch (_) { /* settings restoration is best-effort */ }
    }

    const sensitiveNamePattern = /authorization|proxy-authorization|cookie|set-cookie|pass(?:word|wd)?|token|secret|api[-_]?key|session|username|login|e-?mail|phone|credential/i;

    function stepLabel(step) {
        if (step.type === 'navigate') return step.url;
        const locator = step._dashbridge?.locator || {};
        const target = locator.accessibleName || locator.ariaLabel || locator.labelText || locator.text
            || locator.name || locator.href || locator.css || '';
        const sensitiveLocator = [locator.id, locator.name, locator.accessibleName, locator.ariaLabel, locator.labelText]
            .some(value => sensitiveNamePattern.test(String(value || '')));
        if (step.type === 'change') return `${target}: ${step._dashbridge?.secret || sensitiveLocator ? '••••••••' : String(step.value ?? '').slice(0, 80)}`;
        if (step.type === 'keyDown') return `${step.key || ''} — ${target}`;
        return target || step.type;
    }

    function renderSteps() {
        ui.steps.textContent = '';
        ui.showAllSteps.hidden = state.selectedStepId === null;
        if (!state.steps.length) {
            const empty = document.createElement('li');
            empty.className = 'empty'; empty.textContent = 'Сценарий пока пуст'; ui.steps.appendChild(empty);
            return;
        }
        const requestCounts = new Map();
        for (const request of state.requests.values()) {
            const stepId = Number(request.stepId) || null;
            requestCounts.set(stepId, (requestCounts.get(stepId) || 0) + 1);
        }
        state.steps.forEach((step, index) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            const stepId = index + 1;
            button.type = 'button'; button.className = 'step-button';
            button.classList.toggle('selected', state.selectedStepId === stepId);
            button.classList.toggle('active', state.activeStepId === stepId && ['recording', 'replaying'].includes(state.mode));
            button.setAttribute('aria-pressed', String(state.selectedStepId === stepId));
            button.title = state.selectedStepId === stepId ? 'Показать трафик всех шагов' : `Показать трафик шага ${stepId}`;
            const type = document.createElement('span');
            const meta = document.createElement('span'); meta.className = 'step-meta';
            type.className = 'step-type'; type.textContent = `${stepId}. ${step.type}`;
            const count = document.createElement('span'); count.className = 'step-request-count';
            count.textContent = `${requestCounts.get(stepId) || 0} запр.`;
            meta.append(type, count);
            const label = document.createElement('span');
            const navigationSuffix = step?._dashbridge?.navigationUrl
                ? ` → navigate ${step._dashbridge.navigationUrl}` : '';
            label.textContent = `${stepLabel(step)}${navigationSuffix}`;
            button.append(meta, label);
            button.addEventListener('click', () => {
                state.selectedStepId = state.selectedStepId === stepId ? null : stepId;
                renderSteps(); renderTraffic();
            });
            item.appendChild(button); ui.steps.appendChild(item);
        });
    }

    function requestDuration(request) {
        if (!Number.isFinite(request.startedMonotonic) || !Number.isFinite(request.finishedMonotonic)) return null;
        return Math.max(0, (request.finishedMonotonic - request.startedMonotonic) * 1000);
    }

    function renderTraffic() {
        const filter = ui.filter.value.trim().toLowerCase();
        const method = ui.trafficMethodFilter.value;
        const status = ui.trafficStatusFilter.value;
        const resourceType = ui.trafficTypeFilter.value;
        const matchesStatus = request => {
            const code = Number(request.status);
            if (status === 'pending') return !Number.isFinite(code) || code <= 0;
            if (status === 'success') return code >= 200 && code < 400;
            if (status === 'error') return code >= 400;
            return true;
        };
        const matchingEntries = [...state.requests.values()].filter(request =>
            (!filter || String(request.url).toLowerCase().includes(filter))
            && (method === 'all' || request.method === method)
            && (resourceType === 'all' || request.resourceType === resourceType)
            && (state.selectedStepId === null || Number(request.stepId) === state.selectedStepId)
            && matchesStatus(request)
        );
        const entries = matchingEntries.slice(-1000);
        ui.trafficSummary.textContent = `Показано ${entries.length} из ${matchingEntries.length}`
            + (matchingEntries.length !== state.requests.size ? ` · всего ${state.requests.size}` : '');
        ui.traffic.textContent = '';
        if (!entries.length) {
            const row = document.createElement('tr'); const cell = document.createElement('td');
            const hasFilters = filter || method !== 'all' || status !== 'all' || resourceType !== 'all' || state.selectedStepId !== null;
            cell.colSpan = 6; cell.className = 'empty'; cell.textContent = hasFilters ? 'По выбранным фильтрам запросов нет' : 'Запросов пока нет';
            row.appendChild(cell); ui.traffic.appendChild(row); return;
        }
        const groups = new Map();
        for (const request of entries) {
            const stepId = Number(request.stepId) || null;
            if (!groups.has(stepId)) groups.set(stepId, []);
            groups.get(stepId).push(request);
        }
        const orderedGroups = [...groups].sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left - right);
        for (const [stepId, requests] of orderedGroups) {
            const heading = document.createElement('tr'); heading.className = 'traffic-step-group';
            const headingCell = document.createElement('td'); headingCell.colSpan = 6;
            const step = stepId ? state.steps[stepId - 1] : null;
            const navigationSuffix = step?._dashbridge?.navigationUrl
                ? ` → navigate ${step._dashbridge.navigationUrl}` : '';
            headingCell.textContent = step
                ? `${stepId}. ${step.type} ${stepLabel(step)}${navigationSuffix} · ${requests.length} запросов`
                : `Без шага · ${requests.length} запросов`;
            heading.appendChild(headingCell); ui.traffic.appendChild(heading);
            for (const request of requests) {
                const row = document.createElement('tr');
                row.tabIndex = 0;
                row.classList.toggle('selected', request.requestId === state.selectedRequestId);
                row.setAttribute('aria-selected', String(request.requestId === state.selectedRequestId));
                const selectRequest = () => { state.selectedRequestId = request.requestId; state.revealSensitiveDetails = false; renderTraffic(); renderRequestDetails(); };
                row.addEventListener('click', selectRequest);
                row.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault(); selectRequest();
                });
                const values = [request.method || '', request.status || '', request.resourceType || '', request.url || '', formatBytes(request.encodedDataLength), requestDuration(request) === null ? '' : `${Math.round(requestDuration(request))} мс`];
                values.forEach((value, index) => {
                    const cell = document.createElement('td'); cell.textContent = String(value);
                    if (index === 1) cell.className = Number(value) >= 400 ? 'status-bad' : 'status-ok';
                    if (index === 3) { cell.className = 'url'; cell.title = String(value); }
                    row.appendChild(cell);
                });
                ui.traffic.appendChild(row);
            }
        }
    }

    function redactSensitiveValue(value) {
        if (Array.isArray(value)) return value.map(redactSensitiveValue);
        if (!value || typeof value !== 'object') return value;
        if (typeof value.name === 'string' && Object.prototype.hasOwnProperty.call(value, 'value')
            && sensitiveNamePattern.test(value.name)) return { ...value, value: '••••••••' };
        return Object.fromEntries(Object.entries(value).map(([key, nested]) =>
            [key, sensitiveNamePattern.test(key) ? '••••••••' : redactSensitiveValue(nested)]
        ));
    }

    function redactSensitiveText(value) {
        if (typeof value !== 'string' || !value) return value;
        try { return JSON.stringify(redactSensitiveValue(JSON.parse(value))); }
        catch (_) {
            return value.replace(/((?:pass(?:word|wd)?|token|secret|api[-_]?key|session|username|login|e-?mail|phone|credential)["']?\s*[:=]\s*["']?)[^&"',\s}\]]+/gi, '$1••••••••');
        }
    }

    function redactSensitiveUrl(value) {
        try {
            const url = new URL(value);
            for (const name of [...url.searchParams.keys()]) {
                if (sensitiveNamePattern.test(name)) url.searchParams.set(name, '••••••••');
            }
            return url.toString();
        } catch (_) { return value; }
    }

    function renderRequestDetails() {
        const request = state.requests.get(state.selectedRequestId);
        const hasRequest = Boolean(request);
        ui.copyRequestUrl.disabled = !hasRequest;
        ui.toggleSensitiveDetails.disabled = !hasRequest;
        ui.toggleSensitiveDetails.textContent = state.revealSensitiveDetails ? 'Скрыть секреты' : 'Показать секреты';
        if (!request) {
            ui.requestDetailsSummary.textContent = 'Запрос не выбран';
            ui.requestDetails.textContent = 'Выберите строку трафика';
            return;
        }
        const displayUrl = state.revealSensitiveDetails ? request.url : redactSensitiveUrl(request.url);
        ui.requestDetailsSummary.textContent = `${request.method || '—'} · ${request.status || 'без ответа'} · ${displayUrl || ''}`;
        const preview = request.responseBody === undefined ? undefined
            : request.bodyBase64 ? `[base64, ${formatBytes(request.bodyBytes)}]`
                : String(request.responseBody).slice(0, 64 * 1024) + (String(request.responseBody).length > 64 * 1024 ? '\n…[обрезано в интерфейсе]' : '');
        const details = {
            request: { method: request.method, url: displayUrl, headers: request.requestHeaders, postData: request.postData },
            response: { status: request.status, statusText: request.statusText, headers: request.responseHeaders, mimeType: request.mimeType, bodyPath: request.bodyPath, sha256: request.bodySha256, capture: request.responseBodyCapture, preview },
            timingMs: requestDuration(request), resourceType: request.resourceType,
            requestBodyCapture: request.requestBodyCapture,
            fromDiskCache: request.fromDiskCache, fromServiceWorker: request.fromServiceWorker,
            error: request.errorText,
        };
        if (!state.revealSensitiveDetails) {
            details.request.headers = redactSensitiveValue(details.request.headers);
            details.response.headers = redactSensitiveValue(details.response.headers);
            details.request.postData = redactSensitiveText(details.request.postData);
            details.response.preview = redactSensitiveText(details.response.preview);
        }
        ui.requestDetails.textContent = JSON.stringify(details, null, 2);
    }

    function comparisonValue(request) {
        if (!request) return '—';
        const duration = requestDuration(request);
        return `${request.status || 0} · ${formatBytes(request.bodyBytes || request.encodedDataLength)}${duration === null ? '' : ` · ${Math.round(duration)} мс`}`;
    }

    function matchesComparisonUrl(url, value) {
        const fragment = String(value || '').trim().toLowerCase();
        if (!fragment) return true;
        return String(url || '').toLowerCase().includes(fragment);
    }

    function filteredComparisonItems() {
        const selected = ui.comparisonFilter.value;
        const urlFilter = ui.comparisonUrlFilter.value;
        return state.comparison.filter(item =>
            (selected === 'all' || item.status === selected) && matchesComparisonUrl(item.url, urlFilter)
        );
    }

    function renderComparison() {
        if (!state.comparison.length) { ui.comparisonPanel.hidden = true; return; }
        ui.comparisonPanel.hidden = false;
        const counts = Object.fromEntries(['unchanged', 'changed', 'added', 'removed'].map(status => [status, state.comparison.filter(item => item.status === status).length]));
        const visible = filteredComparisonItems();
        ui.comparisonSummary.textContent = `Без изменений: ${counts.unchanged} · Изменено: ${counts.changed} · Добавлено: ${counts.added} · Удалено: ${counts.removed} · Показано: ${visible.length}`;
        ui.comparisonBody.textContent = '';
        if (!visible.length) {
            const row = document.createElement('tr'); const cell = document.createElement('td');
            cell.colSpan = 6; cell.className = 'empty'; cell.textContent = 'По выбранному URL-фильтру запросов нет';
            row.appendChild(cell); ui.comparisonBody.appendChild(row); return;
        }
        const groups = new Map();
        for (const item of visible) {
            const stepId = Number(item.stepId) || null;
            if (!groups.has(stepId)) groups.set(stepId, []);
            groups.get(stepId).push(item);
        }
        const orderedGroups = [...groups].sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left - right);
        for (const [stepId, items] of orderedGroups) {
            const heading = document.createElement('tr'); heading.className = 'comparison-step-group';
            const headingCell = document.createElement('td'); headingCell.colSpan = 6;
            const step = stepId ? state.steps[stepId - 1] : null;
            const navigationSuffix = step?._dashbridge?.navigationUrl
                ? ` → navigate ${step._dashbridge.navigationUrl}` : '';
            headingCell.textContent = step
                ? `${stepId}. ${step.type} ${stepLabel(step)}${navigationSuffix} · ${items.length} сравнений`
                : `Без шага · ${items.length} сравнений`;
            heading.appendChild(headingCell); ui.comparisonBody.appendChild(heading);
            for (const item of items) {
                const row = document.createElement('tr'); row.className = `comparison-row-${item.status}`;
                const values = [item.status, item.method, item.url, comparisonValue(item.baseline), comparisonValue(item.current), item.differences.join(', ') || '—'];
                values.forEach((value, index) => {
                    const cell = document.createElement('td'); cell.textContent = String(value);
                    if (index === 0) cell.className = 'comparison-result';
                    if (index === 2) { cell.className = 'url'; cell.title = String(value); }
                    row.appendChild(cell);
                });
                ui.comparisonBody.appendChild(row);
            }
        }
    }

    function buildComparison() {
        state.comparison = flowCompare.build(state.baselineRequests.values(), state.requests.values());
        renderComparison();
    }

    async function exportComparisonReport() {
        const visible = filteredComparisonItems();
        if (!visible.length) { setStatus('По текущим фильтрам нечего экспортировать', true); return; }
        try {
            if (!comparisonXlsx?.build) throw new Error('Модуль Excel не загружен');
            ui.exportComparison.disabled = true; setStatus('Формирование Excel-отчёта…');
            const steps = state.steps.map((step, index) => ({
                id: index + 1,
                action: `${step.type} ${stepLabel(step)}`,
                navigationUrl: step._dashbridge?.navigationUrl || '',
            }));
            const generatedAt = new Date();
            const bytes = await comparisonXlsx.build({
                title: state.title || 'DashBridge recording', generatedAt: generatedAt.toISOString(),
                generatedDisplay: generatedAt.toLocaleString('ru-RU'),
                urlFilter: ui.comparisonUrlFilter.value.trim(), statusFilter: ui.comparisonFilter.value,
                steps, items: visible,
            });
            const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${schema.safeFilename(state.title || 'DashBridge')}_comparison_${timestamp}.xlsx`;
            try { await chrome.downloads.download({ url, filename, saveAs: true }); }
            finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
            setStatus(`Excel-отчёт ${filename} передан в загрузки Chrome.`);
        } catch (error) {
            setStatus(`Не удалось сформировать Excel: ${error?.message || error}`, true);
        } finally {
            updateControls();
        }
    }

    let renderPending = false;
    let renderTimer = null;
    let lastRenderAt = 0;
    function scheduleRender({ immediate = false } = {}) {
        if (immediate && renderTimer !== null) {
            clearTimeout(renderTimer); renderTimer = null; renderPending = false;
        }
        if (renderPending) return;
        renderPending = true;
        const active = ['recording', 'replaying'].includes(state.mode);
        const waitMs = immediate ? 0 : active ? Math.max(0, 200 - (performance.now() - lastRenderAt)) : 0;
        renderTimer = setTimeout(() => requestAnimationFrame(() => {
            renderTimer = null; renderPending = false; lastRenderAt = performance.now();
            updateControls(); renderSteps(); renderTraffic(); renderRequestDetails(); renderComparison();
            updateRecordingProgress();
        }), waitMs);
    }

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

    async function ensureDebuggerPermission() {
        // Chrome does not permit `debugger` in optional_permissions. The API is
        // declared at install time but is attached only from an explicit Record/Replay click.
        return true;
    }

    async function attachNetwork(tabId) {
        state.tabId = tabId;
        await chrome.debugger.attach({ tabId }, CDP_VERSION);
        state.attached = true;
        postLifecycle({ type: 'bind', tabId });
        await Promise.all([
            sendCdp('Network.enable', {
                maxTotalBufferSize: 100 * 1024 * 1024, maxResourceBufferSize: MAX_BODY_BYTES,
                maxPostDataSize: MAX_REQUEST_BODY_BYTES,
            }),
            sendCdp('Page.enable'),
        ]);
        await sendCdp('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => undefined);
        await Promise.all([
            sendCdp('Network.setCacheDisabled', { cacheDisabled: state.sessionOptions.disableCache }),
            sendCdp('Network.setBypassServiceWorker', { bypass: state.sessionOptions.disableCache }),
        ]);
    }

    async function detachNetwork() {
        if (!state.attached || !Number.isInteger(state.tabId)) return;
        const target = { tabId: state.tabId };
        state.attached = false;
        state.detaching = true;
        postLifecycle({ type: 'unbind' });
        try { await chrome.debugger.detach(target).catch(() => undefined); }
        finally { state.detaching = false; }
    }

    async function assertIncognitoReady() {
        if (!state.sessionOptions.disableCookies) return;
        const allowed = await refreshIncognitoAccess();
        if (!allowed) {
            throw new Error('Для Disable Cookies включите «Разрешить использование в режиме инкогнито» в настройках расширения Chrome');
        }
        const windows = await chrome.windows.getAll({ populate: false });
        if (windows.some(windowInfo => windowInfo.incognito)) {
            throw new Error('Закройте остальные окна инкогнито: Chrome использует для них общее cookie-хранилище');
        }
    }

    function buildRecorderWindowLayout() {
        const availableLeft = Number.isFinite(globalThis.screen?.availLeft) ? Math.round(globalThis.screen.availLeft) : 0;
        const availableTop = Number.isFinite(globalThis.screen?.availTop) ? Math.round(globalThis.screen.availTop) : 0;
        const availableWidth = Math.max(0, Math.round(Number(globalThis.screen?.availWidth) || 0));
        const availableHeight = Math.max(0, Math.round(Number(globalThis.screen?.availHeight) || 0));
        return {
            controlled: availableWidth >= 720 && availableHeight >= 500 ? {
                left: availableLeft, top: availableTop, width: availableWidth, height: availableHeight, state: 'normal'
            } : null,
        };
    }

    async function createControlledTab(layout = null) {
        await assertIncognitoReady();
        const created = await chrome.windows.create({
            url: 'about:blank', type: 'normal', focused: true,
            incognito: state.sessionOptions.disableCookies,
            ...(layout?.controlled || {}),
        });
        const tab = created.tabs?.[0];
        if (!Number.isInteger(created.id) || !Number.isInteger(tab?.id)) throw new Error('Не удалось открыть контролируемую вкладку');
        state.windowId = created.id;
        return tab.id;
    }

    async function injectActionRecorder() {
        if (!['recording', 'replaying'].includes(state.mode) || !Number.isInteger(state.tabId)) return;
        await chrome.scripting.executeScript({
            target: { tabId: state.tabId, allFrames: true },
            files: ['js/content/scenario-recorder.js'],
        }).catch(() => undefined);
    }

    function addNavigateStep(url, at = Date.now()) {
        const normalized = schema.normalizeHttpUrl(url);
        if (!normalized) return;
        const previous = state.steps[state.steps.length - 1];
        if (previous?.type === 'navigate' && previous.url === normalized) return;
        const previousAt = Number(previous?._dashbridge?.at || 0);
        if (previous && at - previousAt >= 0 && at - previousAt < 5_000) {
            // Redirects and navigations caused by the preceding click belong to
            // that logical step. Adding another navigate would replay the page twice.
            if (previous.type === 'navigate') {
                previous._dashbridge.finalUrl = normalized; scheduleRender(); return;
            }
            if (['click', 'keyDown'].includes(previous.type)) {
                previous._dashbridge.navigationUrl = normalized; scheduleRender(); return;
            }
        }
        if (state.steps.length >= schema.MAX_FLOW_STEPS) { setStatus(`Достигнут лимит ${schema.MAX_FLOW_STEPS} шагов`, true); return; }
        state.steps.push({ type: 'navigate', url: normalized, _dashbridge: { at, sequence: ++state.actionSequence } });
        state.activeStepId = state.steps.length;
        claimRequestsForStep(state.activeStepId, at);
        scheduleRender();
    }

    function claimRequestsForStep(stepId, startedAt) {
        const boundary = Math.max(0, Number(startedAt) || Date.now());
        for (const request of state.requests.values()) {
            const requestAt = Number(request.wallTime) * 1000;
            if (Number.isFinite(requestAt) && requestAt >= boundary - 50) request.stepId = stepId;
        }
    }

    function selectorList(locator) {
        const selectors = [];
        if (locator?.id) selectors.push([`id/${locator.id}`]);
        if (locator?.testId) selectors.push([`${locator.testAttribute || 'data-testid'}/${locator.testId}`]);
        if (locator?.ariaLabel) selectors.push([`aria/${locator.ariaLabel}`]);
        if (locator?.role && locator?.accessibleName) selectors.push([`role/${locator.role}/${locator.accessibleName}`]);
        if (locator?.href) selectors.push([`href/${locator.href}`]);
        if (locator?.text) selectors.push([`text/${locator.text}`]);
        if (locator?.css) selectors.push([locator.css]);
        return selectors;
    }

    function addRecordedAction(action, frameId) {
        if (state.mode !== 'recording' || !action || typeof action !== 'object') return;
        if (!['click', 'change', 'keyDown', 'submit'].includes(action.type) || !action.locator?.css) return;
        if (state.steps.length >= schema.MAX_FLOW_STEPS) { setStatus(`Достигнут лимит ${schema.MAX_FLOW_STEPS} шагов`, true); return; }
        const previousBeforeAdd = state.steps[state.steps.length - 1];
        if (action.type === 'submit' && previousBeforeAdd?.type === 'click'
            && Number(action.at || 0) - Number(previousBeforeAdd._dashbridge?.at || 0) < 1_000) return;
        const base = {
            type: action.type,
            selectors: selectorList(action.locator),
            target: 'main',
            _dashbridge: {
                at: Math.max(0, Number(action.at) || Date.now()), sequence: ++state.actionSequence,
                locator: action.locator, frameUrl: String(action.frameUrl || '').slice(0, 4096), frameId,
                secret: action.secret === true,
            }
        };
        if (action.type === 'change') base.value = typeof action.value === 'string' ? action.value.slice(0, MAX_ACTION_VALUE) : action.value;
        if (action.type === 'keyDown') base.key = String(action.key || '').slice(0, 30);
        const previous = state.steps[state.steps.length - 1];
        const sameChange = base.type === 'change' && previous?.type === 'change'
            && previous._dashbridge?.frameUrl === base._dashbridge.frameUrl
            && previous._dashbridge?.locator?.css === base._dashbridge.locator.css
            && base._dashbridge.at - Number(previous._dashbridge?.at || 0) < 2_000;
        if (sameChange) state.steps[state.steps.length - 1] = base;
        else state.steps.push(base);
        state.activeStepId = state.steps.length;
        claimRequestsForStep(state.activeStepId, base._dashbridge.at);
        scheduleRender();
    }

    function ensureRequest(requestId) {
        const activeKey = state.activeRequests.get(requestId) || requestId;
        let request = state.requests.get(activeKey);
        if (!request) {
            request = {
                requestId: activeKey, cdpRequestId: requestId, stepId: state.activeStepId,
                requestBodyCapture: { status: 'none' }, responseBodyCapture: { status: 'pending' },
                decodedDataLength: 0, dataEncodedLength: 0,
            };
            state.requests.set(activeKey, request); state.activeRequests.set(requestId, activeKey);
            const chain = state.requestChains.get(requestId) || [];
            if (!chain.includes(activeKey)) chain.push(activeKey);
            state.requestChains.set(requestId, chain);
        }
        return request;
    }

    function beginRequest(params) {
        const cdpId = params.requestId;
        const previous = state.activeRequests.has(cdpId) ? ensureRequest(cdpId) : null;
        if (previous && params.redirectResponse) {
            Object.assign(previous, {
                status: params.redirectResponse.status, statusText: params.redirectResponse.statusText,
                responseHeaders: params.redirectResponse.headers || {}, mimeType: params.redirectResponse.mimeType,
                protocol: params.redirectResponse.protocol, finishedMonotonic: params.timestamp,
                encodedDataLength: params.redirectResponse.encodedDataLength || 0, redirectURL: params.request?.url || '',
            });
            setResponseBodyStatus(previous, 'unavailable', 'redirect');
        }
        const redirectIndex = state.redirectCounts.get(cdpId) || 0;
        const candidateKey = redirectIndex ? `${cdpId}:redirect-${redirectIndex}` : cdpId;
        const earlyPlaceholder = state.requests.get(candidateKey);
        const reusePlaceholder = Boolean(earlyPlaceholder && !earlyPlaceholder.url);
        const key = reusePlaceholder ? earlyPlaceholder.requestId : candidateKey;
        state.redirectCounts.set(cdpId, Math.max(redirectIndex + 1, 1));
        if (!previous && state.requests.size >= MAX_REQUESTS) {
            setStatus(`Достигнут лимит ${MAX_REQUESTS} запросов; новые записи пропускаются`, true);
            state.completeness.droppedRequests += 1;
            state.ignoredRequests.add(cdpId);
            return { requestId: key, cdpRequestId: cdpId, dropped: true };
        }
        const request = reusePlaceholder ? earlyPlaceholder : {
            requestId: key, cdpRequestId: cdpId, stepId: state.activeStepId,
            requestBodyCapture: { status: 'none' }, responseBodyCapture: { status: 'pending' },
            decodedDataLength: 0, dataEncodedLength: 0,
        };
        state.requests.set(key, request); state.activeRequests.set(cdpId, key);
        const chain = state.requestChains.get(cdpId) || [];
        if (!chain.includes(key)) chain.push(key);
        state.requestChains.set(cdpId, chain);
        return request;
    }

    function requestForExtraInfo(requestId, indexMap) {
        const chain = state.requestChains.get(requestId) || [];
        const index = indexMap.get(requestId) || 0;
        if (!chain[index]) {
            const key = index ? `${requestId}:redirect-${index}` : requestId;
            if (!state.requests.has(key)) {
                state.requests.set(key, {
                    requestId: key, cdpRequestId: requestId, stepId: state.activeStepId,
                    requestBodyCapture: { status: 'none' }, responseBodyCapture: { status: 'pending' },
                    decodedDataLength: 0, dataEncodedLength: 0,
                });
            }
            chain[index] = key; state.requestChains.set(requestId, chain);
        }
        const key = chain[index];
        indexMap.set(requestId, index + 1);
        return state.requests.get(key);
    }

    function setResponseBodyStatus(request, status, reason = null) {
        if (!request || request.responseBodyCapture?.status !== 'pending') return;
        request.responseBodyCapture = { status, ...(reason ? { reason } : {}) };
        const counter = status === 'captured' ? 'responseBodiesCaptured'
            : status === 'empty' ? 'responseBodiesEmpty'
                : status === 'skipped' ? 'responseBodiesSkipped'
                    : status === 'unavailable' ? 'responseBodiesUnavailable' : 'responseBodiesFailed';
        state.completeness[counter] += 1;
    }

    async function captureRequestBody(request) {
        if (!request || request.postData !== undefined || request.requestBodyCapture?.status !== 'pending') return;
        try {
            const result = await sendCdp('Network.getRequestPostData', { requestId: request.cdpRequestId });
            if (request.requestBodyCapture?.status !== 'pending') return;
            const postData = String(result.postData || '');
            if (new TextEncoder().encode(postData).byteLength > MAX_REQUEST_BODY_BYTES) {
                request.requestBodyCapture = { status: 'skipped', reason: 'too-large' };
                state.completeness.requestBodiesSkipped += 1;
                return;
            }
            const postDataBytes = new TextEncoder().encode(postData).byteLength;
            if (state.totalRequestBodyBytes + postDataBytes > MAX_TOTAL_REQUEST_BODY_BYTES) {
                request.requestBodyCapture = { status: 'skipped', reason: 'total-limit' };
                state.completeness.requestBodiesSkipped += 1;
                return;
            }
            request.postData = postData;
            state.totalRequestBodyBytes += postDataBytes;
            request.requestBodyCapture = { status: request.postData ? 'captured' : 'empty', source: 'cdp' };
            markMultipartRequestBody(request);
        } catch (error) {
            if (request.requestBodyCapture?.status !== 'pending') return;
            request.requestBodyCapture = { status: 'failed', reason: 'cdp-error', error: error?.message || String(error) };
            state.completeness.requestBodiesFailed += 1;
        }
    }

    function markMultipartRequestBody(request) {
        if (!request || request.requestBodyCapture?.status !== 'captured') return;
        if (!/^multipart\/form-data\b/i.test(headerValue(request.requestHeaders, 'content-type'))) return;
        request.requestBodyCapture = { ...request.requestBodyCapture, status: 'partial', reason: 'multipart-file-bytes-may-be-omitted' };
        state.completeness.requestBodiesPartial += 1;
    }

    function queueRequestBodyCapture(request) {
        const pending = captureRequestBody(request).finally(() => state.pendingRequestBodyCaptures.delete(pending));
        state.pendingRequestBodyCaptures.add(pending);
    }

    async function captureResponseBody(request) {
        if (!request || request.bodyCaptured || request.responseBodyCapture?.status !== 'pending') return;
        const decision = schema.classifyResponseBodyCapture(request, {
            maxBodyBytes: MAX_BODY_BYTES,
            totalBodyBytes: state.totalBodyBytes,
            maxTotalBodyBytes: MAX_TOTAL_BODY_BYTES,
        });
        if (decision) { setResponseBodyStatus(request, decision.status, decision.reason); return; }
        request.bodyCaptured = true;
        try {
            const result = await sendCdp('Network.getResponseBody', { requestId: request.cdpRequestId || request.requestId });
            if (request.responseBodyCapture?.status !== 'pending') return;
            const bodyLength = result.base64Encoded ? schema.base64DecodedByteLength(result.body) : new TextEncoder().encode(String(result.body || '')).byteLength;
            if (bodyLength > MAX_BODY_BYTES) { setResponseBodyStatus(request, 'skipped', 'too-large'); return; }
            if (state.totalBodyBytes + bodyLength > MAX_TOTAL_BODY_BYTES) { setResponseBodyStatus(request, 'skipped', 'total-limit'); return; }
            request.responseBody = String(result.body || '');
            request.bodyBase64 = result.base64Encoded === true;
            request.bodyBytes = bodyLength;
            request.bodySha256 = await sha256(bodyBytes(request));
            state.totalBodyBytes += bodyLength;
            setResponseBodyStatus(request, bodyLength ? 'captured' : 'empty');
        } catch (error) {
            request.bodyError = error?.message || String(error);
            setResponseBodyStatus(request, 'failed', 'cdp-error');
        }
        scheduleRender();
    }

    function queueResponseBodyCapture(request) {
        const pending = captureResponseBody(request).finally(() => state.pendingBodyCaptures.delete(pending));
        state.pendingBodyCaptures.add(pending);
    }

    function appendStreamEvent(type, params) {
        const payload = params.response?.payloadData ?? params.data ?? '';
        const bytes = new TextEncoder().encode(String(payload)).byteLength;
        if (state.streams.length >= MAX_STREAM_EVENTS || state.streamPayloadBytes + bytes > MAX_STREAM_PAYLOAD_BYTES) {
            state.completeness.streamEventsDropped += 1;
            state.completeness.streamPayloadBytesDropped += bytes;
            return;
        }
        state.streamPayloadBytes += bytes;
        const requestKey = params.requestId ? state.activeRequests.get(params.requestId) : null;
        const request = requestKey ? state.requests.get(requestKey) : null;
        state.streams.push({ type, stepId: request?.stepId ?? state.activeStepId,
            at: new Date().toISOString(), monotonicTime: params.timestamp ?? null, ...params });
    }

    function appendPageEvent(event) {
        if (state.pageEvents.length >= MAX_PAGE_EVENTS) { state.completeness.pageEventsDropped += 1; return; }
        state.pageEvents.push(event);
    }

    function handleCdpEvent(source, method, params) {
        if (source.tabId !== state.tabId) return;
        state.lastNetworkAt = Date.now();
        if (method !== 'Network.requestWillBeSent' && state.ignoredRequests.has(params.requestId)) {
            if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') state.ignoredRequests.delete(params.requestId);
            return;
        }
        if (method === 'Network.requestWillBeSent') {
            const request = beginRequest(params);
            if (request.dropped) return;
            Object.assign(request, {
                url: params.request?.url, method: params.request?.method,
                requestHeaders: request.associatedCookies !== undefined ? request.requestHeaders : params.request?.headers || {},
                postData: params.request?.postData,
                hasPostData: params.request?.hasPostData === true,
                startedMonotonic: params.timestamp, wallTime: params.wallTime,
                resourceType: params.type, documentUrl: params.documentURL,
                initiator: params.initiator, redirectResponse: params.redirectResponse || null,
            });
            const inlinePostBytes = request.postData === undefined ? 0 : new TextEncoder().encode(String(request.postData)).byteLength;
            const exceedsInlineLimit = inlinePostBytes > MAX_REQUEST_BODY_BYTES
                || state.totalRequestBodyBytes + inlinePostBytes > MAX_TOTAL_REQUEST_BODY_BYTES;
            if (exceedsInlineLimit) {
                request.postData = undefined; state.completeness.requestBodiesSkipped += 1;
            } else if (request.postData !== undefined) {
                state.totalRequestBodyBytes += inlinePostBytes;
            }
            request.requestBodyCapture = exceedsInlineLimit
                ? { status: 'skipped', reason: inlinePostBytes > MAX_REQUEST_BODY_BYTES ? 'too-large' : 'total-limit' }
                : request.postData !== undefined
                    ? { status: request.postData ? 'captured' : 'empty', source: 'inline' }
                : request.hasPostData ? { status: 'pending' } : { status: 'none' };
            markMultipartRequestBody(request);
            if (request.requestBodyCapture.status === 'pending') queueRequestBodyCapture(request);
            state.inFlight.add(params.requestId);
        } else if (method === 'Network.requestWillBeSentExtraInfo') {
            const request = requestForExtraInfo(params.requestId, state.requestExtraInfoIndexes);
            request.requestHeaders = params.headers || request.requestHeaders || {};
            request.associatedCookies = params.associatedCookies || [];
            request.requestHeadersText = params.headersText || null;
            request.connectTiming = params.connectTiming || null;
            request.clientSecurityState = params.clientSecurityState || null;
            markMultipartRequestBody(request);
        } else if (method === 'Network.responseReceived') {
            const request = ensureRequest(params.requestId);
            Object.assign(request, {
                status: params.response?.status, statusText: params.response?.statusText,
                responseHeaders: request.blockedCookies !== undefined ? request.responseHeaders : params.response?.headers || {},
                mimeType: params.response?.mimeType,
                protocol: params.response?.protocol, fromDiskCache: params.response?.fromDiskCache === true,
                fromServiceWorker: params.response?.fromServiceWorker === true, remoteIPAddress: params.response?.remoteIPAddress,
                remotePort: params.response?.remotePort, connectionId: params.response?.connectionId,
                connectionReused: params.response?.connectionReused === true,
                securityState: params.response?.securityState, securityDetails: params.response?.securityDetails || null,
                fromPrefetchCache: params.response?.fromPrefetchCache === true,
                responseTiming: params.response?.timing || null, resourceType: params.type || request.resourceType,
            });
        } else if (method === 'Network.responseReceivedExtraInfo') {
            const request = requestForExtraInfo(params.requestId, state.responseExtraInfoIndexes);
            request.responseHeaders = params.headers || request.responseHeaders || {};
            request.responseHeadersText = params.headersText || null;
            request.blockedCookies = params.blockedCookies || [];
            request.exemptedCookies = params.exemptedCookies || [];
            request.resourceIPAddressSpace = params.resourceIPAddressSpace || null;
            if (Number.isFinite(params.statusCode)) request.status = params.statusCode;
        } else if (method === 'Network.dataReceived') {
            const request = ensureRequest(params.requestId);
            request.decodedDataLength += Number(params.dataLength) || 0;
            request.dataEncodedLength += Number(params.encodedDataLength) || 0;
        } else if (method === 'Network.requestServedFromCache') {
            ensureRequest(params.requestId).servedFromCache = true;
        } else if (method === 'Network.resourceChangedPriority') {
            const request = ensureRequest(params.requestId);
            (request.priorityChanges ||= []).push({ priority: params.newPriority, timestamp: params.timestamp });
        } else if (method === 'Network.loadingFinished') {
            const request = ensureRequest(params.requestId);
            request.finishedMonotonic = params.timestamp; request.encodedDataLength = params.encodedDataLength;
            state.inFlight.delete(params.requestId); queueResponseBodyCapture(request);
        } else if (method === 'Network.loadingFailed') {
            const request = ensureRequest(params.requestId);
            request.finishedMonotonic = params.timestamp; request.failed = true; request.errorText = params.errorText;
            request.canceled = params.canceled === true; request.blockedReason = params.blockedReason || null;
            request.corsErrorStatus = params.corsErrorStatus || null;
            setResponseBodyStatus(request, 'unavailable', 'loading-failed');
            state.inFlight.delete(params.requestId);
        } else if (/^Network\.(?:webSocket|eventSourceMessageReceived|webTransport)/.test(method)) {
            appendStreamEvent(method.slice('Network.'.length), params);
        } else if (method === 'Page.frameNavigated' && !params.frame?.parentId && state.mode === 'recording') {
            addNavigateStep(params.frame.url, Date.now());
            setTimeout(injectActionRecorder, 150);
        } else if (method === 'Page.navigatedWithinDocument' && state.mode === 'recording') {
            appendPageEvent({ type: 'sameDocumentNavigation', frameId: params.frameId, url: params.url, timestamp: Date.now() });
            addNavigateStep(params.url, Date.now());
        } else if (method === 'Page.lifecycleEvent') {
            appendPageEvent({ type: params.name, frameId: params.frameId, loaderId: params.loaderId,
                monotonicTime: params.timestamp });
        }
        scheduleRender();
    }

    async function startRecording() {
        const startUrl = schema.normalizeHttpUrl(ui.startUrl.value);
        if (!startUrl) { setStatus('Введите корректный адрес сайта, например site.ru', true); return; }
        ui.startUrl.value = startUrl;
        try {
            await operationProgressController?.openPictureInPicture({
                title: 'Traffic Recorder', phase: 'Запись трафика', width: 390, height: 300
            });
            void saveRecorderSettings().catch(() => undefined);
            await ensureDebuggerPermission();
            await stopActiveSession(false);
            resetSession();
            state.sessionOptions = { disableCache: ui.disableCache.checked, disableCookies: ui.disableCookies.checked };
            state.mode = 'recording'; state.startUrl = startUrl; state.createdAt = new Date().toISOString(); state.sessionStartedAt = Date.now();
            state.title = new URL(startUrl).hostname; updateControls();
            const layout = buildRecorderWindowLayout();
            const tabId = await createControlledTab(layout);
            await attachNetwork(tabId);
            addNavigateStep(startUrl);
            setStatus('Запись активна. Выполняйте сценарий в открывшейся вкладке.');
            await chrome.tabs.update(tabId, { url: startUrl });
            updateRecordingProgress();
        } catch (error) {
            await stopActiveSession(false);
            operationProgressController?.finish({ status: 'error', message: `Не удалось начать запись: ${error?.message || error}` });
            setStatus(`Не удалось начать запись: ${error?.message || error}`, true);
        }
    }

    async function stopActiveSession(showStatus = true) {
        if (!['recording', 'replaying'].includes(state.mode) && !state.attached) return;
        if (showStatus) state.stopRequested = true;
        await delay(250);
        const pendingCaptures = () => [...state.pendingBodyCaptures, ...state.pendingRequestBodyCaptures];
        if (pendingCaptures().length) {
            await Promise.race([
                Promise.allSettled(pendingCaptures()),
                delay(3_000),
            ]);
        }
        state.completeness.pendingCapturesAtStop = pendingCaptures().length;
        for (const request of state.requests.values()) {
            if (request.responseBodyCapture?.status === 'pending') setResponseBodyStatus(request, 'unavailable', 'capture-stopped');
            if (request.requestBodyCapture?.status === 'pending') {
                request.requestBodyCapture = { status: 'failed', reason: 'capture-stopped' };
                state.completeness.requestBodiesFailed += 1;
            }
        }
        await detachNetwork();
        state.captureFinishedAt = new Date().toISOString();
        const ephemeralWindowId = state.sessionOptions.disableCookies ? state.windowId : null;
        state.mode = 'idle';
        state.sessionStartedAt = null;
        state.tabId = null; state.windowId = null;
        if (Number.isInteger(ephemeralWindowId)) await chrome.windows.remove(ephemeralWindowId).catch(() => undefined);
        if (showStatus) {
            operationProgressController?.cancel();
            setStatus(`Сессия остановлена: ${state.steps.length} шагов, ${state.requests.size} запросов.`);
        }
        scheduleRender();
    }

    async function finalizeUnexpectedSession(message, { debuggerDetached = false } = {}) {
        if (!['recording', 'replaying'].includes(state.mode)) return;
        const ephemeralWindowId = state.sessionOptions.disableCookies ? state.windowId : null;
        state.attached = false;
        state.detachedUnexpectedly = true;
        state.captureFinishedAt = new Date().toISOString();
        state.completeness.pendingCapturesAtStop = state.pendingBodyCaptures.size + state.pendingRequestBodyCaptures.size;
        if (debuggerDetached) state.completeness.unexpectedDebuggerDetach = true;
        for (const request of state.requests.values()) {
            if (request.responseBodyCapture?.status === 'pending') {
                setResponseBodyStatus(request, 'unavailable', debuggerDetached ? 'debugger-detached' : 'controlled-tab-closed');
            }
            if (request.requestBodyCapture?.status === 'pending') {
                request.requestBodyCapture = { status: 'failed', reason: debuggerDetached ? 'debugger-detached' : 'controlled-tab-closed' };
                state.completeness.requestBodiesFailed += 1;
            }
        }
        state.inFlight.clear();
        state.mode = 'idle'; state.sessionStartedAt = null;
        state.tabId = null; state.windowId = null;
        postLifecycle({ type: 'unbind' });
        operationProgressController?.finish({ status: 'error', message });
        setStatus(message, true); scheduleRender();
        if (Number.isInteger(ephemeralWindowId)) await chrome.windows.remove(ephemeralWindowId).catch(() => undefined);
    }

    function headersToHar(headers) {
        if (Array.isArray(headers)) return headers.map(header => ({ name: String(header.name), value: String(header.value) }));
        return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
    }

    function headerValue(headers, wantedName) {
        const match = headersToHar(headers).find(header => header.name.toLowerCase() === wantedName.toLowerCase());
        return match?.value || '';
    }

    function requestCookies(headers) {
        return headerValue(headers, 'cookie').split(';').map(value => value.trim()).filter(Boolean).map(pair => {
            const separator = pair.indexOf('=');
            return { name: separator < 0 ? pair : pair.slice(0, separator), value: separator < 0 ? '' : pair.slice(separator + 1) };
        });
    }

    function responseCookies(headers) {
        return headersToHar(headers).filter(header => header.name.toLowerCase() === 'set-cookie')
            .flatMap(header => String(header.value).split(/\r?\n(?=[^;=\s]+=[^;]*)/)).map(value => {
            const header = { value };
            const [pair, ...attributes] = header.value.split(';'); const separator = pair.indexOf('=');
            const cookie = { name: separator < 0 ? pair.trim() : pair.slice(0, separator).trim(), value: separator < 0 ? '' : pair.slice(separator + 1).trim() };
            for (const attribute of attributes) {
                const [rawName, ...rawValue] = attribute.trim().split('='); const name = rawName.toLowerCase(); const value = rawValue.join('=');
                if (name === 'path') cookie.path = value; else if (name === 'domain') cookie.domain = value;
                else if (name === 'expires') cookie.expires = value; else if (name === 'httponly') cookie.httpOnly = true;
                else if (name === 'secure') cookie.secure = true; else if (name === 'samesite') cookie.sameSite = value;
            }
            return cookie;
            });
    }

    function buildNetworkExport() {
        const requests = [...state.requests.values()].filter(request => request.url && request.method).map(request => {
            const { responseBody, bodyCaptured, ...record } = request;
            return {
                ...record,
                requestHeaders: headersToHar(request.requestHeaders),
                responseHeaders: headersToHar(request.responseHeaders),
            };
        });
        return {
            version: 2, source: 'Chrome DevTools Protocol', createdAt: state.createdAt,
            finishedAt: state.captureFinishedAt, pageEvents: state.pageEvents, requests,
        };
    }

    function buildHar() {
        const entries = [...state.requests.values()].filter(request => request.url && request.method).map(request => {
            const duration = requestDuration(request) || 0;
            const content = { size: request.bodyBytes ?? (request.decodedDataLength || request.encodedDataLength || 0), mimeType: request.mimeType || '' };
            if (request.bodyPath) content._dashbridgeBodyPath = request.bodyPath;
            if (request.bodySha256) content._dashbridgeSha256 = request.bodySha256;
            content._dashbridgeBodyCapture = request.responseBodyCapture || { status: 'unavailable', reason: 'unknown' };
            let queryString = [];
            try { queryString = [...new URL(request.url).searchParams].map(([name, value]) => ({ name, value })); } catch (_) { /* invalid CDP URL */ }
            const stepId = Number(request.stepId) || null;
            const durationValue = requestDuration(request);
            const responseHeadersSize = request.responseHeadersText
                ? new TextEncoder().encode(request.responseHeadersText).byteLength : -1;
            const responseBodySize = request.dataEncodedLength > 0 ? request.dataEncodedLength
                : Number.isFinite(request.encodedDataLength)
                    ? Math.max(0, request.encodedDataLength - Math.max(0, responseHeadersSize)) : -1;
            const entry = {
                startedDateTime: Number.isFinite(request.wallTime) ? new Date(request.wallTime * 1000).toISOString() : state.createdAt,
                time: duration,
                ...(stepId ? { pageref: `step-${stepId}` } : {}),
                request: {
                    method: request.method, url: request.url, httpVersion: request.protocol || '',
                    headers: headersToHar(request.requestHeaders), queryString, cookies: requestCookies(request.requestHeaders),
                    headersSize: request.requestHeadersText ? new TextEncoder().encode(request.requestHeadersText).byteLength : -1,
                    bodySize: request.postData !== undefined ? new TextEncoder().encode(request.postData).byteLength : -1,
                },
                response: {
                    status: Number(request.status) || 0, statusText: request.statusText || '', httpVersion: request.protocol || '',
                    headers: headersToHar(request.responseHeaders), cookies: responseCookies(request.responseHeaders), content,
                    redirectURL: request.redirectURL || '',
                    headersSize: responseHeadersSize, bodySize: responseBodySize,
                },
                cache: {}, timings: schema.buildHarTimings(request, durationValue || 0),
                serverIPAddress: request.remoteIPAddress || undefined,
                connection: request.connectionId !== undefined ? String(request.connectionId) : undefined,
                _resourceType: request.resourceType || '',
                _dashbridgeStep: stepId,
                _dashbridgeFromDiskCache: request.fromDiskCache === true,
                _dashbridgeFromServiceWorker: request.fromServiceWorker === true,
                _dashbridgeRequestBodyCapture: request.requestBodyCapture || { status: 'none' },
                _dashbridgeInitiator: request.initiator || null,
                _dashbridgeSecurity: { state: request.securityState || null, details: request.securityDetails || null },
                _dashbridgeCdpTiming: request.responseTiming || null,
                _dashbridgeTransferSize: Number(request.encodedDataLength) || 0,
            };
            if (request.postData !== undefined) entry.request.postData = { mimeType: String(request.requestHeaders?.['Content-Type'] || request.requestHeaders?.['content-type'] || ''), text: request.postData };
            if (request.failed) entry._dashbridgeError = request.errorText || 'Loading failed';
            return entry;
        });
        const pages = state.steps.map((step, index) => ({
            id: `step-${index + 1}`, startedDateTime: new Date(Number(step._dashbridge?.at) || Date.parse(state.createdAt)).toISOString(),
            title: `${index + 1}. ${step.type} ${stepLabel(step)}`.trim(), pageTimings: {},
            _dashbridgeStep: step,
        }));
        return { log: { version: '1.2', creator: { name: 'DashBridge Traffic Recorder', version: chrome.runtime.getManifest().version }, pages, entries } };
    }

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

    function bytesToBase64(bytes) {
        let binary = '';
        const chunkSize = 32 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        }
        return btoa(binary);
    }

    function dashflowEntryUncompressedSize(entry) {
        const size = Number(entry?._data?.uncompressedSize);
        return Number.isFinite(size) && size >= 0 ? size : null;
    }

    function assertDashflowEntrySize(entry, label, maxBytes) {
        if (!entry) throw new TypeError(`В архиве отсутствует ${label}`);
        const size = dashflowEntryUncompressedSize(entry);
        if (size !== null && size > maxBytes) throw new RangeError(`${label} превышает безопасный распакованный размер`);
        return size;
    }

    function assertDashflowWorkingSet(entries) {
        const uniqueEntries = new Set();
        let total = 0;
        for (const entry of entries) {
            if (!entry || uniqueEntries.has(entry)) continue;
            uniqueEntries.add(entry);
            const size = dashflowEntryUncompressedSize(entry);
            if (size !== null) total += size;
            if (total > MAX_DASHFLOW_WORKING_SET_BYTES) {
                throw new RangeError('Распакованные данные .dashflow превышают безопасный общий размер');
            }
        }
        return total;
    }

    function estimateDashflowWorkingSet() {
        // During save, bodies coexist as strings/Base64, decoded bytes and ZIP
        // entries. Keep the estimate conservative to avoid exhausting Chrome.
        return state.totalBodyBytes * 3 + state.totalRequestBodyBytes * 4 + state.streamPayloadBytes * 4
            + state.requests.size * 2048 + state.steps.length * 2048;
    }

    async function saveDashflow() {
        try {
            if (typeof JSZip !== 'function') throw new Error('JSZip не загружен');
            if (estimateDashflowWorkingSet() > MAX_DASHFLOW_WORKING_SET_BYTES) {
                throw new RangeError('Запись слишком велика для безопасного сохранения одним .dashflow; уменьшите сценарий');
            }
            setStatus('Подготовка .dashflow…'); ui.save.disabled = true;
            const zip = new JSZip();
            let bodyIndex = 0;
            for (const request of state.requests.values()) {
                if (request.responseBody === undefined) continue;
                const bytes = bodyBytes(request);
                request.bodyBytes = bytes.byteLength;
                const safeId = String(request.requestId).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 96) || 'request';
                bodyIndex += 1;
                request.bodyPath = `bodies/${String(bodyIndex).padStart(6, '0')}_${safeId}.bin`;
                request.bodySha256 = request.bodySha256 || await sha256(bytes);
                zip.file(request.bodyPath, bytes);
            }
            const flow = {
                title: state.title || 'DashBridge recording', timeout: 15_000, steps: state.steps,
                _dashbridge: { networkMode: {
                    cacheDisabled: state.sessionOptions.disableCache,
                    bypassServiceWorker: state.sessionOptions.disableCache,
                    ephemeralCookies: state.sessionOptions.disableCookies,
                } },
            };
            const manifest = schema.createManifest({
                title: flow.title, startUrl: state.startUrl || state.steps.find(step => step.type === 'navigate')?.url,
                createdAt: state.createdAt, requestCount: state.requests.size, stepCount: state.steps.length,
                containsSecrets: state.steps.some(step => step._dashbridge?.secret) || state.requests.size > 0,
                networkMode: {
                    cacheDisabled: state.sessionOptions.disableCache,
                    ephemeralCookies: state.sessionOptions.disableCookies,
                },
                finishedAt: state.captureFinishedAt || new Date().toISOString(),
                environment: state.environment || {
                    userAgent: navigator.userAgent,
                    language: navigator.language,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                    extensionVersion: chrome.runtime.getManifest().version,
                },
                captureLimits: {
                    requests: MAX_REQUESTS, requestBodyBytesPerRequest: MAX_REQUEST_BODY_BYTES,
                    requestBodyBytesTotal: MAX_TOTAL_REQUEST_BODY_BYTES,
                    responseBodyBytesPerRequest: MAX_BODY_BYTES,
                    responseBodyBytesTotal: MAX_TOTAL_BODY_BYTES, streamEvents: MAX_STREAM_EVENTS,
                    streamPayloadBytesTotal: MAX_STREAM_PAYLOAD_BYTES, pendingCaptureWaitMs: 3_000,
                    pageEvents: MAX_PAGE_EVENTS,
                    archiveWorkingSetBytes: MAX_DASHFLOW_WORKING_SET_BYTES,
                },
                completeness: state.completeness,
            });
            const serialized = {
                manifest: JSON.stringify(manifest, null, 2),
                flow: JSON.stringify(flow, null, 2),
                network: JSON.stringify(buildNetworkExport(), null, 2),
                har: JSON.stringify(buildHar(), null, 2),
                streams: JSON.stringify({
                version: 1, payloadBytes: state.streamPayloadBytes, events: state.streams,
                }, null, 2),
            };
            const serializedUpperBound = Object.values(serialized).reduce((total, value) => total + value.length * 2, 0);
            if (state.totalBodyBytes + serializedUpperBound > MAX_DASHFLOW_WORKING_SET_BYTES) {
                throw new RangeError('Метаданные записи превышают безопасный размер одного .dashflow');
            }
            zip.file('manifest.json', serialized.manifest);
            zip.file('flow.json', serialized.flow);
            zip.file('network.json', serialized.network);
            zip.file('traffic.har', serialized.har);
            zip.file('streams.json', serialized.streams);
            // The container is ZIP-compatible, but octet-stream prevents the
            // Windows save dialog from replacing the product extension with .zip.
            const blob = await zip.generateAsync({
                type: 'blob', mimeType: 'application/octet-stream',
                compression: 'DEFLATE', compressionOptions: { level: 6 }
            });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${schema.safeFilename(flow.title)}_${timestamp}.dashflow`;
            try { await chrome.downloads.download({ url, filename, saveAs: true }); }
            finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
            state.loadedManifest = manifest; setStatus(`Файл ${filename} передан в загрузки Chrome.`);
        } catch (error) {
            setStatus(`Не удалось сохранить .dashflow: ${error?.message || error}`, true);
        } finally { updateControls(); }
    }

    async function loadDashflow(file) {
        if (state.importing || ['recording', 'replaying'].includes(state.mode)) return;
        state.importing = true; updateControls();
        try {
            if (!file || file.size > 512 * 1024 * 1024) throw new RangeError('Файл превышает лимит 512 МиБ');
            setStatus('Чтение .dashflow…');
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const manifestFile = zip.file('manifest.json'); const flowFile = zip.file('flow.json');
            const networkFile = zip.file('network.json'); const streamsFile = zip.file('streams.json');
            const harFile = zip.file('traffic.har');
            if (!manifestFile || !flowFile || !networkFile || !harFile || !streamsFile) {
                throw new TypeError('В архиве отсутствуют обязательные файлы DashFlow v2');
            }
            assertDashflowEntrySize(manifestFile, 'manifest.json', MAX_DASHFLOW_MANIFEST_BYTES);
            assertDashflowEntrySize(flowFile, 'flow.json', MAX_DASHFLOW_FLOW_BYTES);
            assertDashflowEntrySize(networkFile, 'network.json', MAX_DASHFLOW_NETWORK_BYTES);
            assertDashflowEntrySize(streamsFile, 'streams.json', MAX_DASHFLOW_STREAMS_BYTES);
            assertDashflowEntrySize(harFile, 'traffic.har', MAX_DASHFLOW_NETWORK_BYTES);
            const archiveEntries = [manifestFile, flowFile, networkFile, streamsFile, harFile];
            assertDashflowWorkingSet(archiveEntries);

            const manifest = schema.validateManifest(JSON.parse(await manifestFile.async('string')));
            const flow = schema.validateFlow(JSON.parse(await flowFile.async('string')));
            const network = schema.validateNetwork(JSON.parse(await networkFile.async('string')));
            const streams = schema.validateStreams(JSON.parse(await streamsFile.async('string')));
            const derivedHar = JSON.parse(await harFile.async('string'));
            if (!derivedHar?.log || derivedHar.log.version !== '1.2' || !Array.isArray(derivedHar.log.entries)) {
                throw new TypeError('Некорректный traffic.har');
            }
            const importedRequests = new Map();
            network.requests.forEach((request, index) => {
                const key = String(request.requestId || `import-${index}`);
                if (importedRequests.has(key)) throw new TypeError(`Повторяющийся requestId: ${key}`);
                importedRequests.set(key, { ...request, requestId: key });
            });

            let importedRequestBodyBytes = 0;
            for (const request of importedRequests.values()) {
                if (request.postData === undefined) continue;
                const bytes = new TextEncoder().encode(String(request.postData)).byteLength;
                if (bytes > MAX_REQUEST_BODY_BYTES || importedRequestBodyBytes + bytes > MAX_TOTAL_REQUEST_BODY_BYTES) {
                    throw new RangeError('Тела запросов превышают лимиты DashFlow');
                }
                importedRequestBodyBytes += bytes;
            }

            const bodyEntries = new Map();
            for (const request of importedRequests.values()) {
                if (!request.bodyPath) continue;
                if (!/^bodies\/[a-zA-Z0-9_.-]+\.bin$/.test(request.bodyPath)) throw new TypeError('Некорректный путь тела ответа');
                const bodyFile = zip.file(request.bodyPath);
                if (!bodyFile) throw new TypeError(`В архиве отсутствует ${request.bodyPath}`);
                assertDashflowEntrySize(bodyFile, request.bodyPath, MAX_BODY_BYTES);
                bodyEntries.set(request.bodyPath, bodyFile);
            }
            archiveEntries.push(...bodyEntries.values());
            assertDashflowWorkingSet(archiveEntries);

            let importedBodyBytes = 0;
            for (const request of importedRequests.values()) {
                if (!request.bodyPath) continue;
                const bytes = await bodyEntries.get(request.bodyPath).async('uint8array');
                if (bytes.byteLength > MAX_BODY_BYTES || importedBodyBytes + bytes.byteLength > MAX_TOTAL_BODY_BYTES) {
                    throw new RangeError('Тела ответов превышают лимиты DashFlow');
                }
                const digest = await sha256(bytes);
                if (request.bodySha256 && request.bodySha256 !== digest) throw new TypeError(`Нарушена целостность ${request.bodyPath}`);
                request.responseBody = bytesToBase64(bytes); request.bodyBase64 = true;
                request.bodyBytes = bytes.byteLength; request.bodySha256 = digest;
                importedBodyBytes += bytes.byteLength;
            }

            let importedStreamPayloadBytes = 0;
            for (const event of streams.events) {
                const payload = event?.response?.payloadData ?? event?.data ?? '';
                importedStreamPayloadBytes += new TextEncoder().encode(String(payload)).byteLength;
                if (importedStreamPayloadBytes > MAX_STREAM_PAYLOAD_BYTES) {
                    throw new RangeError('Потоковые данные превышают лимиты DashFlow');
                }
            }

            // Commit only after every entry has passed structural, size and
            // integrity validation. A rejected file leaves the current state intact.
            await stopActiveSession(false); resetSession();
            state.loadedManifest = manifest; state.steps = flow.steps;
            state.title = String(flow.title || manifest.title || 'DashBridge recording');
            state.startUrl = manifest.startUrl || flow.steps.find(step => step.type === 'navigate')?.url || '';
            state.createdAt = manifest.createdAt || new Date().toISOString(); ui.startUrl.value = state.startUrl;
            state.requests = importedRequests;
            state.totalRequestBodyBytes = importedRequestBodyBytes; state.totalBodyBytes = importedBodyBytes;
            state.pageEvents = Array.isArray(network.pageEvents) ? network.pageEvents : [];
            state.streams = streams.events; state.streamPayloadBytes = importedStreamPayloadBytes;
            state.environment = manifest.environment || null;
            state.captureFinishedAt = manifest.capture?.finishedAt || network.finishedAt || null;
            state.completeness = manifest.capture?.completeness || state.completeness;
            state.baselineRequests = new Map([...state.requests].map(([key, request]) => [key, { ...request }]));
            void saveRecorderSettings().catch(() => undefined);
            setStatus(`Загружено: ${state.steps.length} шагов, baseline ${state.requests.size} запросов.`); scheduleRender();
        } catch (error) {
            setStatus(`Не удалось открыть .dashflow: ${error?.message || error}`, true);
        } finally {
            state.importing = false; ui.file.value = ''; updateControls();
        }
    }

    async function waitForTabComplete(tabId, timeoutMs = 20_000) {
        if (state.stopRequested) throw new Error('Операция остановлена пользователем');
        const existing = await chrome.tabs.get(tabId).catch(() => null);
        if (existing?.status === 'complete') return;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('Превышено время загрузки страницы')), timeoutMs);
            const cancellation = setInterval(() => {
                if (state.stopRequested) finish(new Error('Операция остановлена пользователем'));
            }, 100);
            const listener = (updatedId, changeInfo) => { if (updatedId === tabId && changeInfo.status === 'complete') finish(); };
            const finish = error => { clearTimeout(timeout); clearInterval(cancellation); chrome.tabs.onUpdated.removeListener(listener); error ? reject(error) : resolve(); };
            chrome.tabs.onUpdated.addListener(listener);
        });
    }

    async function waitForNetworkIdle() {
        const deadline = Date.now() + NETWORK_IDLE_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (state.stopRequested) throw new Error('Операция остановлена пользователем');
            if (!state.inFlight.size && Date.now() - state.lastNetworkAt >= NETWORK_IDLE_MS) return;
            await delay(100);
        }
    }

    function normalizeReplaySteps(steps) {
        return steps.filter((step, index) => {
            if (step.type !== 'change' || steps[index - 1]?.type !== 'click') return true;
            const css = step._dashbridge?.locator?.css;
            const duplicate = steps.slice(Math.max(0, index - 3), index - 1).reverse().find(candidate =>
                candidate.type === 'change' && candidate._dashbridge?.locator?.css === css
                && candidate.value === step.value
                && Number(step._dashbridge?.at || 0) - Number(candidate._dashbridge?.at || 0) < 2_000
            );
            return !duplicate;
        });
    }

    function performDomAction(step) {
        const locator = step?._dashbridge?.locator || {};
        const expectedFrameUrl = step?._dashbridge?.frameUrl;
        if (expectedFrameUrl && location.href !== expectedFrameUrl) {
            return { ok: false, url: location.href, error: 'Другой frame URL' };
        }
        const normalizedText = value => String(value || '').replace(/\s+/g, ' ').trim();
        const roleOf = element => {
            const explicit = element.getAttribute('role');
            if (explicit) return explicit;
            if (element.localName === 'button') return 'button';
            if (element.localName === 'a' && element.hasAttribute('href')) return 'link';
            if (element.localName === 'textarea') return 'textbox';
            if (element.localName === 'select') return 'combobox';
            if (element.localName !== 'input') return null;
            const type = String(element.type || 'text').toLowerCase();
            if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'range') return 'slider';
            return type === 'hidden' ? null : 'textbox';
        };
        const accessibleNameOf = element => {
            const ariaLabel = normalizedText(element.getAttribute('aria-label'));
            if (ariaLabel) return ariaLabel;
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
                const text = normalizedText(labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '));
                if (text) return text;
            }
            if ('labels' in element && element.labels?.length) {
                const text = normalizedText(Array.from(element.labels).map(label => label.textContent || '').join(' '));
                if (text) return text;
            }
            return normalizedText(element.innerText || element.textContent);
        };
        const isUsable = element => element instanceof Element && element.isConnected
            && element.getClientRects().length > 0 && !element.hasAttribute('disabled');
        const matchesType = element => (!locator.tag || element.localName === locator.tag)
            && (!locator.inputType || String(element.getAttribute('type') || '').toLowerCase() === String(locator.inputType).toLowerCase());
        const testAttribute = ['data-testid', 'data-test-id', 'data-qa', 'data-cy'].includes(locator.testAttribute)
            ? locator.testAttribute : 'data-testid';
        const matchesFingerprint = element => {
            if (!matchesType(element)) return false;
            if (locator.id && element.id === locator.id) return true;
            if (locator.testId && element.getAttribute(testAttribute) === locator.testId) return true;
            if (locator.name && element.getAttribute('name') === locator.name) return true;
            if (locator.ariaLabel && normalizedText(element.getAttribute('aria-label')) === normalizedText(locator.ariaLabel)) return true;
            if (locator.href && element.localName === 'a' && element.href === locator.href) return true;
            if (locator.action && element.localName === 'form' && element.action === locator.action) return true;
            const expectedName = normalizedText(locator.accessibleName || locator.labelText || locator.text);
            if (locator.role && expectedName && roleOf(element) === locator.role && accessibleNameOf(element) === expectedName) return true;
            return Boolean(locator.text && normalizedText(element.innerText || element.textContent) === normalizedText(locator.text));
        };
        const byAttribute = (attribute, value) => !value ? [] : Array.from(document.querySelectorAll(`[${attribute}]`))
            .filter(candidate => candidate.getAttribute(attribute) === value);
        let ambiguity = '';
        const unique = (candidates, description, strictFingerprint = false) => {
            const matches = Array.from(candidates || []).filter(element => isUsable(element)
                && matchesType(element) && (!strictFingerprint || matchesFingerprint(element)));
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) ambiguity = `Неоднозначный локатор (${description}): найдено ${matches.length} элементов`;
            return null;
        };
        let element = locator.id ? unique([document.getElementById(locator.id)].filter(Boolean), `id=${locator.id}`) : null;
        if (!element && locator.testId) element = unique(byAttribute(testAttribute, locator.testId), `${testAttribute}=${locator.testId}`);
        if (!element && locator.name) element = unique(document.getElementsByName(locator.name), `name=${locator.name}`);
        if (!element && locator.ariaLabel) element = unique(byAttribute('aria-label', locator.ariaLabel), `aria-label=${locator.ariaLabel}`);
        if (!element && locator.href) element = unique(Array.from(document.links).filter(link => link.href === locator.href), `href=${locator.href}`);
        if (!element && locator.action) element = unique(Array.from(document.forms).filter(form => form.action === locator.action), `action=${locator.action}`);
        const expectedName = normalizedText(locator.accessibleName || locator.labelText || locator.text);
        if (!element && locator.role && expectedName) {
            element = unique(Array.from(document.querySelectorAll('button,a,input,textarea,select,[role],[tabindex],[contenteditable="true"]'))
                .filter(candidate => roleOf(candidate) === locator.role && accessibleNameOf(candidate) === expectedName),
            `role=${locator.role}, name=${expectedName}`);
        }
        if (!element && locator.text && locator.tag && /^[a-z][a-z0-9-]*$/i.test(locator.tag)) {
            element = unique(Array.from(document.getElementsByTagName(locator.tag))
                .filter(candidate => normalizedText(candidate.innerText || candidate.textContent) === normalizedText(locator.text)),
            `${locator.tag}, text=${locator.text}`);
        }
        if (!element && locator.css && locator.stable !== false) {
            try { element = unique(document.querySelectorAll(locator.css), `css=${locator.css}`, true); }
            catch (_) { /* invalid selector: report a safe lookup failure below */ }
        }
        if (!element) {
            const description = locator.accessibleName || locator.ariaLabel || locator.name || locator.testId || locator.href || locator.css || 'locator';
            return { ok: false, url: location.href, error: ambiguity || `Надёжный элемент не найден: ${description}` };
        }
        element.scrollIntoView({ block: 'center', inline: 'center' });
        if (step.type === 'click') {
            element.click(); return { ok: true, url: location.href };
        }
        if (step.type === 'change') {
            if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
                if (element.checked !== Boolean(step.value)) element.click();
            } else {
                const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                if (setter) setter.call(element, step.value == null ? '' : String(step.value));
                else element.value = step.value == null ? '' : String(step.value);
                element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
            return { ok: true, url: location.href };
        }
        if (step.type === 'keyDown') {
            element.focus();
            element.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true, composed: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: step.key, bubbles: true, composed: true }));
            return { ok: true, url: location.href };
        }
        if (step.type === 'submit') {
            if (!(element instanceof HTMLFormElement)) return { ok: false, url: location.href, error: 'Submit locator не указывает на form' };
            if (typeof element.requestSubmit === 'function') element.requestSubmit();
            else element.submit();
            return { ok: true, url: location.href };
        }
        return { ok: false, url: location.href, error: `Тип ${step.type} не поддерживается` };
    }

    async function performDomActionWithWait(step, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        let lastError = 'Элемент не найден';
        while (Date.now() < deadline) {
            if (state.stopRequested) throw new Error('Операция остановлена пользователем');
            const results = await chrome.scripting.executeScript({
                target: { tabId: state.tabId, allFrames: true }, func: performDomAction, args: [step],
            }).catch(error => { lastError = error?.message || String(error); return []; });
            const success = results.find(result => result.result?.ok);
            if (success) return success;
            lastError = results.map(result => result.result?.error).filter(error => error && error !== 'Другой frame URL')[0] || lastError;
            await delay(200);
        }
        throw new Error(lastError);
    }

    async function waitForExpectedNavigation(expectedUrl, timeoutMs = 20_000) {
        if (!expectedUrl) return;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (state.stopRequested) throw new Error('Операция остановлена пользователем');
            const tab = await chrome.tabs.get(state.tabId).catch(() => null);
            if (tab?.url === expectedUrl) { await waitForTabComplete(state.tabId, timeoutMs); return; }
            await delay(100);
        }
        throw new Error(`Не выполнен переход на ${expectedUrl}`);
    }

    async function executeStep(step, index) {
        if (state.stopRequested) throw new Error('Операция остановлена пользователем');
        state.activeStepId = index + 1;
        setStatus(`Replay: шаг ${index + 1}/${state.steps.length} — ${step.type}`);
        operationProgressController?.update({
            phase: `Replay: шаг ${index + 1} из ${state.steps.length}`, done: index, total: state.steps.length,
            success: index, failed: 0, message: `${step.type} ${stepLabel(step)}`,
        });
        if (step.type === 'navigate') {
            await chrome.tabs.update(state.tabId, { url: step.url }); await waitForTabComplete(state.tabId); await waitForNetworkIdle();
        } else {
            await performDomActionWithWait(step);
            await waitForExpectedNavigation(step._dashbridge?.navigationUrl);
            await delay(100);
            await waitForNetworkIdle();
        }
        operationProgressController?.update({
            phase: `Replay: выполнен шаг ${index + 1} из ${state.steps.length}`, done: index + 1, total: state.steps.length,
            success: index + 1, failed: 0, message: `${step.type} ${stepLabel(step)}`,
        });
    }

    async function startReplay() {
        if (!state.steps.length) return;
        try {
            await operationProgressController?.openPictureInPicture({
                title: 'Traffic Recorder · Replay', phase: 'Подготовка replay', width: 390, height: 300
            });
            await ensureDebuggerPermission();
            const replaySteps = normalizeReplaySteps(state.steps.map(step => structuredClone(step)));
            await stopActiveSession(false); resetSession({ keepSteps: true, keepBaseline: true }); state.steps = replaySteps;
            state.sessionOptions = { disableCache: ui.disableCache.checked, disableCookies: ui.disableCookies.checked };
            state.mode = 'replaying'; state.createdAt = new Date().toISOString(); state.sessionStartedAt = Date.now(); updateControls();
            const layout = buildRecorderWindowLayout();
            const tabId = await createControlledTab(layout); await attachNetwork(tabId);
            for (let index = 0; index < replaySteps.length; index += 1) await executeStep(replaySteps[index], index);
            await stopActiveSession(false); buildComparison();
            operationProgressController?.finish({ status: 'complete', message: `Replay завершён: ${replaySteps.length} шагов` });
            setStatus(`Replay завершен: ${replaySteps.length} шагов, собрано ${state.requests.size} запросов. Сравнение готово.`);
        } catch (error) {
            await stopActiveSession(false);
            if (state.baselineRequests.size && state.requests.size) buildComparison();
            if (state.stopRequested) {
                setStatus('Replay остановлен пользователем.');
            } else {
                operationProgressController?.finish({ status: 'error', message: `Replay остановлен: ${error?.message || error}` });
                setStatus(`Replay остановлен: ${error?.message || error}`, true);
            }
        }
        scheduleRender();
    }

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
        } catch (error) {
            setStatus(`Не удалось скопировать URL: ${error?.message || error}`, true);
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

    chrome.debugger.onEvent.addListener(handleCdpEvent);
    chrome.debugger.onDetach.addListener((source, reason) => {
        if (source.tabId !== state.tabId) return;
        state.attached = false;
        postLifecycle({ type: 'unbind' });
        if (state.detaching) return;
        void finalizeUnexpectedSession(`Chrome отключил запись трафика: ${reason}`, { debuggerDetached: true });
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
        if (tabId === state.tabId && changeInfo.status === 'complete') injectActionRecorder();
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        if (tabId !== state.tabId) return;
        void finalizeUnexpectedSession('Контролируемая вкладка закрыта.');
    });

    ui.start.addEventListener('click', startRecording);
    ui.stop.addEventListener('click', () => stopActiveSession(true));
    ui.save.addEventListener('click', saveDashflow);
    ui.replay.addEventListener('click', startReplay);
    ui.file.addEventListener('change', () => loadDashflow(ui.file.files?.[0]));
    ui.file.closest('.file-button')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!ui.file.disabled) ui.file.click();
    });
    ui.filter.addEventListener('input', renderTraffic);
    ui.trafficMethodFilter.addEventListener('change', renderTraffic);
    ui.trafficStatusFilter.addEventListener('change', renderTraffic);
    ui.trafficTypeFilter.addEventListener('change', renderTraffic);
    ui.clearTrafficFilters.addEventListener('click', clearTrafficFilters);
    ui.showAllSteps.addEventListener('click', () => { state.selectedStepId = null; renderSteps(); renderTraffic(); });
    ui.copyRequestUrl.addEventListener('click', copySelectedRequestUrl);
    ui.toggleSensitiveDetails.addEventListener('click', () => {
        state.revealSensitiveDetails = !state.revealSensitiveDetails; renderRequestDetails();
    });
    ui.comparisonFilter.addEventListener('change', renderComparison);
    ui.comparisonUrlFilter.addEventListener('input', renderComparison);
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
        clearTimeout(settingsSaveTimer);
        clearInterval(sessionIndicatorTimer);
        sessionIndicatorTimer = null;
        void saveRecorderSettings().catch(() => undefined);
        void operationProgressController?.release();
    });
    operationProgressController = globalThis.DashBridgeOperationProgress?.create({ onCancel: () => stopActiveSession(true) }) || null;
    void restoreRecorderSettings().finally(() => {
        updateControls(); refreshIncognitoAccess(); renderSteps(); renderTraffic(); renderRequestDetails();
    });
})();
