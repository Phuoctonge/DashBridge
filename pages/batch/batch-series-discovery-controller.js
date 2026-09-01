(function initBatchSeriesDiscoveryController(root) {
    'use strict';

    function create({ panelPicker, getCaptureTheme, showToast, logMessage,
        escapeHtml, parseDashboardUrl, buildSoloPanelUrl, buildPanelUrl,
        ensureEarlyRuntime, fetchDashboardDefinition, findDashboardPanel,
        getPanelQuerySignatures, documentRef = document, chromeRef = chrome }) {
        const required = [
            getCaptureTheme, showToast, logMessage, escapeHtml, parseDashboardUrl,
            buildSoloPanelUrl, buildPanelUrl, ensureEarlyRuntime,
            fetchDashboardDefinition, findDashboardPanel, getPanelQuerySignatures,
        ];
        if (required.some(value => typeof value !== 'function')
            || typeof panelPicker?.open !== 'function'
            || typeof panelPicker?.getSeriesSelectedPanelIds !== 'function'
            || typeof chromeRef?.tabs?.update !== 'function'
            || typeof chromeRef?.tabs?.create !== 'function'
            || typeof chromeRef?.scripting?.executeScript !== 'function') {
            throw new TypeError('Batch Series discovery dependencies are incomplete');
        }

        const panelIdFormatCache = new Map();
        const dashboardIdentity = dashboardUrl => {
            const dashboard = parseDashboardUrl(dashboardUrl);
            return dashboard
                ? `${dashboard.baseUrl}|org:${dashboard.orgId || 'default'}|${dashboard.uid}`
                : dashboardUrl;
        };
        const panelIdCandidates = (dashboardUrl, panelId) => {
            const format = panelIdFormatCache.get(dashboardIdentity(dashboardUrl));
            if (format === 'prefixed') return [`panel-${panelId}`, String(panelId)];
            if (format === 'numeric') return [String(panelId), `panel-${panelId}`];
            return [`panel-${panelId}`, String(panelId)];
        };
        const rememberPanelIdFormat = (dashboardUrl, capturePanelId) => {
            panelIdFormatCache.set(
                dashboardIdentity(dashboardUrl),
                String(capturePanelId).startsWith('panel-') ? 'prefixed' : 'numeric',
            );
        };
        const buildCaptureUrl = (dashboardUrl, panelId, range, signatures) => {
            const url = new URL(buildSoloPanelUrl(dashboardUrl, panelId, {
                from: range.from,
                to: range.to,
                theme: getCaptureTheme('captureThemeSeries'),
            }));
            const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            url.searchParams.set('dashbridgeSeriesCapture', token);
            url.searchParams.set('dashbridgeSeriesTargets', JSON.stringify(signatures));
            return { url: url.toString(), token };
        };

        const navigateCaptureTab = async (tabId, captureUrl, windowId = null) => {
            const registration = await ensureEarlyRuntime(captureUrl);
            if (!registration.ok) throw new Error('Не удалось подготовить ранний Grafana runtime');
            if (tabId) await chromeRef.tabs.update(tabId, { url: captureUrl });
            else {
                const tab = await chromeRef.tabs.create({
                    url: captureUrl,
                    active: true,
                    ...(windowId ? { windowId } : {}),
                });
                if (!tab.id) throw new Error('Не удалось открыть фоновую вкладку Grafana');
                tabId = tab.id;
            }
            return tabId;
        };

        const waitForCapturedSeries = (
            tabId, token, timeoutMs = 45000, signal = null,
        ) => new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => signal?.removeEventListener('abort', abort);
            const succeed = value => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const fail = error => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };
            const abort = () => {
                void chromeRef.scripting.executeScript({
                    target: { tabId }, world: 'MAIN', args: [token],
                    func: expectedToken => window.dispatchEvent(new CustomEvent(
                        'dashbridgeSeriesCaptureCancelled',
                        { detail: { token: expectedToken } },
                    )),
                }).catch(() => undefined);
                fail(new DOMException('Batch run cancelled', 'AbortError'));
            };
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
            chromeRef.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [token, timeoutMs],
                func: (expectedToken, budgetMs) => new Promise(resolveInPage => {
                    let done = false;
                    let settleTimer = null;
                    const finish = result => {
                        if (done) return;
                        done = true;
                        clearTimeout(deadlineTimer);
                        clearTimeout(settleTimer);
                        window.removeEventListener('dashbridgeSeriesCaptureUpdated', onUpdate);
                        window.removeEventListener('dashbridgeSeriesCaptureCancelled', onCancel);
                        resolveInPage(result);
                    };
                    const inspect = () => {
                        if (done) return;
                        const capture = window.__dashBridgeSeriesCapture;
                        if (capture?.token !== expectedToken) return;
                        const names = capture.names;
                        const coverageComplete = !capture.expectedCount
                            || capture.matchedIdentities?.length >= capture.expectedCount;
                        if (!Array.isArray(names) || !coverageComplete || !capture.lastMatchAt) return;
                        const settleWait = Math.max(0, 400 - (Date.now() - capture.lastMatchAt));
                        clearTimeout(settleTimer);
                        if (settleWait > 0) settleTimer = setTimeout(inspect, settleWait);
                        else finish({ ok: true, names });
                    };
                    const onUpdate = event => {
                        if (event.detail?.token === expectedToken) inspect();
                    };
                    const onCancel = event => {
                        if (event.detail?.token === expectedToken) {
                            finish({ ok: false, cancelled: true });
                        }
                    };
                    const deadlineTimer = setTimeout(() => {
                        const capture = window.__dashBridgeSeriesCapture;
                        finish({
                            ok: false,
                            capture: capture?.token === expectedToken ? capture : null,
                        });
                    }, Math.max(1, Number(budgetMs) || 45_000));
                    window.addEventListener('dashbridgeSeriesCaptureUpdated', onUpdate);
                    window.addEventListener('dashbridgeSeriesCaptureCancelled', onCancel);
                    inspect();
                }),
            }).then(results => {
                if (settled) return;
                const result = results?.[0]?.result;
                if (result?.ok && Array.isArray(result.names)) {
                    succeed(result.names);
                    return;
                }
                const capture = result?.capture;
                const debug = capture?.debug;
                const reason = !capture
                    ? 'перехватчик DashBridge не запустился'
                    : !debug?.requests
                        ? 'Grafana не выполнила запрос данных во временной вкладке'
                        : 'ответы Grafana не совпали с запросами выбранной панели';
                fail(new Error(
                    `${reason} (запросов: ${debug?.requests || 0}, совпадений: ${debug?.matched || 0})`,
                ));
            }).catch(fail);
        });

        const discoverForSlice = async ({ dashboardUrl, panelId, range, signatures,
            tabId = null, signal = null, onTabId = null,
            discoveryWindowId = null }) => {
            let nextTabId = tabId;
            let lastError = null;
            for (const capturePanelId of panelIdCandidates(dashboardUrl, panelId)) {
                const capture = buildCaptureUrl(dashboardUrl, capturePanelId, range, signatures);
                nextTabId = await navigateCaptureTab(nextTabId, capture.url, discoveryWindowId);
                onTabId?.(nextTabId);
                try {
                    const names = await waitForCapturedSeries(nextTabId, capture.token, 15000, signal);
                    rememberPanelIdFormat(dashboardUrl, capturePanelId);
                    return { tabId: nextTabId, names };
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError || new Error('Grafana не вернула серии');
        };

        const appendPanelCard = (panelId, panelTitle, panelUrl, signatures) => {
            const container = documentRef.getElementById('seriesPanelsContainer');
            const card = documentRef.createElement('div');
            card.className = 'batch-series-card';
            card.dataset.querySignatures = JSON.stringify(signatures || []);
            card.innerHTML = `<h3 style="margin-top:0; font-size:14px; color:var(--primary);">Панель ID: ${escapeHtml(panelId)} — ${escapeHtml(panelTitle)}</h3>
                <input type="hidden" class="series-panel-url" value="${escapeHtml(panelUrl)}">
                <p>Series будут определены для каждого временного среза и отфильтрованы по ключевым фразам.</p>`;
            container.appendChild(card);
        };

        const loadSelectedPanels = async () => {
            const dashboardUrl = documentRef.getElementById('seriesDashUrl').value.trim();
            const panelIds = panelPicker.getSeriesSelectedPanelIds();
            if (!dashboardUrl) return showToast('Введите URL дашборда для Series', 'error');
            if (!panelIds.length) return showToast('Выберите хотя бы одну панель', 'error');
            const loader = documentRef.getElementById('seriesLoaderStatus');
            loader.hidden = false;
            documentRef.getElementById('seriesPanelsContainer').innerHTML = '';
            try {
                let loadedCards = 0;
                const { payload } = await fetchDashboardDefinition(dashboardUrl);
                for (const panelId of panelIds) {
                    const panelUrl = buildPanelUrl(dashboardUrl, panelId, {
                        theme: getCaptureTheme('captureThemeSeries'),
                    });
                    try {
                        const panel = findDashboardPanel(payload.dashboard, panelId);
                        if (!panel) throw new Error(`Панель ${panelId} не найдена в дашборде`);
                        const signatures = getPanelQuerySignatures(panel);
                        if (!signatures.length) throw new Error('В панели нет активных запросов');
                        appendPanelCard(panelId, panel.title, panelUrl, signatures);
                        loadedCards++;
                    } catch (error) {
                        logMessage(`Ошибка API для панели ${panelId}: ${error.message}`, true);
                    }
                }
                if (loadedCards) showToast(`Подготовлено панелей: ${loadedCards}`, 'success');
                else {
                    showToast(
                        'Панели не подготовлены. Откройте журнал: в нём указана причина по каждой панели.',
                        'error',
                    );
                }
            } catch (error) {
                logMessage(`Ошибка подготовки панелей: ${error.message}`, true);
                showToast('Не удалось подготовить панели', 'error');
            } finally {
                loader.hidden = true;
            }
        };

        const setup = () => {
            documentRef.getElementById('getSeriesPanelsBtn').addEventListener('click', () => {
                void panelPicker.open({
                    dashboardUrl: documentRef.getElementById('seriesDashUrl').value.trim(),
                    context: 'series',
                });
            });
            documentRef.getElementById('loadSelectedSeriesBtn')
                .addEventListener('click', loadSelectedPanels);
        };

        return Object.freeze({ setup, discoverForSlice, loadSelectedPanels, waitForCapturedSeries });
    }

    root.BatchSeriesDiscoveryController = Object.freeze({ create });
})(globalThis);
