(function () {
    'use strict';

    globalThis.DashBridgeRecorderView = Object.freeze({
        create({ ui, state, flowCompare, comparisonXlsx, schema, formatBytes, setStatus, updateControls, updateRecordingProgress }) {
            if (!ui || !state || !flowCompare?.build || !schema?.safeFilename
                || typeof formatBytes !== 'function' || typeof setStatus !== 'function'
                || typeof updateControls !== 'function' || typeof updateRecordingProgress !== 'function') {
                throw new TypeError('Recorder view requires UI, state and rendering adapters');
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

            return Object.freeze({
                stepLabel,
                requestDuration,
                renderSteps,
                renderTraffic,
                renderRequestDetails,
                renderComparison,
                buildComparison,
                exportComparisonReport,
                scheduleRender,
            });
        },
    });
})();
