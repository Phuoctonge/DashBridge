// Batch page controller.

document.addEventListener("DOMContentLoaded", () => {
    // --- UI Logic: Tabs ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const mainActionArea = document.getElementById('mainActionArea');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            // Full-dashboard capture belongs to collection settings.  Series
            // capture has its own action and must not offer the unrelated one.
            updateActionVisibility();
        });
    });

    // --- UI Logic: Panels Mode ---
    const panelsMode = document.getElementById('panelsMode');
    const userPanelsGroup = document.getElementById('userPanelsGroup');
    panelsMode.addEventListener('change', () => {
        if (panelsMode.value === 'whitelist' || panelsMode.value === 'blacklist') {
            userPanelsGroup.style.display = 'block';
        } else {
            userPanelsGroup.style.display = 'none';
        }
    });

    // --- Toast & Logs ---
    const showToast = BatchPageUi.createNotifier(document.getElementById('toastContainer'));
    const logContainer = document.getElementById('logContainer');
    const logMessage = BatchPageUi.createLogger(logContainer);
    const batchProgress = document.getElementById('batchProgress');
    const batchProgressText = document.getElementById('batchProgressText');
    const batchProgressStats = document.getElementById('batchProgressStats');
    const batchProgressBar = document.getElementById('batchProgressBar');
    const updateBatchProgress = ({ done, total, success, failed, phase }) => {
        batchProgress.hidden = false;
        const safeTotal = Math.max(1, Number(total) || 1);
        batchProgressBar.max = safeTotal;
        batchProgressBar.value = Math.min(safeTotal, Math.max(0, done));
        batchProgressText.textContent = `${phase}: ${Math.min(done, safeTotal)} / ${total}`;
        batchProgressStats.textContent = `Успешно: ${success} · Ошибки: ${failed}`;
        operationProgressController?.update({ done, total, success, failed, phase });
    };
    const normalizeTimeRangesField = ({ fieldId, notify = true } = {}) => {
        const field = document.getElementById(fieldId);
        const result = normalizeGrafanaTimeRanges(field.value);
        if (!result.ranges.length) {
            if (notify) showToast('Не удалось распознать временные диапазоны', 'error');
            return result;
        }
        // Preserve the original input when even one line is invalid, so the
        // user can correct it after the launch-time validation message.
        if (result.errors.length) {
            if (notify) showToast(`Не удалось распознать диапазоны в строках: ${result.errors.join(', ')}`, 'error');
            return result;
        }
        field.value = result.ranges.map(({ from, to }) => `${from}, ${to}`).join('\n');
        BatchPageState.save();
        if (notify) showToast(`Преобразовано диапазонов: ${result.ranges.length}.`, 'success');
        return result;
    };
    document.getElementById('clearLogs').addEventListener('click', () => {
        logContainer.innerHTML = '';
    });

    const panelPicker = BatchPanelPicker.create({ showToast, logMessage, panelsMode });

    // --- State Persistence ---
    const captureThemeInputs = Array.from(document.querySelectorAll('.batch-capture-theme'));

    function getCaptureTheme(groupId = 'captureThemeMain') {
        const value = document.querySelector(`#${groupId} input:checked`)?.value;
        return value === 'current' || value === 'dark' ? value : 'light';
    }

    function setCaptureTheme(value, groupId) {
        const normalized = value === 'current' || value === 'dark' ? value : 'light';
        document.querySelectorAll(`#${groupId} .batch-capture-theme`).forEach(input => {
            input.checked = input.value === normalized;
        });
    }

    // --- Per-panel transformation rules ---
    const dashUrl = document.getElementById('dashUrl');
    const batchPanelRulesUi = BatchPanelRulesUi.create({
        dashboardUrl: dashUrl,
        container: document.getElementById('batchPanelRules'),
        status: document.getElementById('batchPanelRulesStatus'),
        store: BatchPanelRules,
        parseUrl: parseGrafanaUrl,
    });
    const loadBatchPanelRules = batchPanelRulesUi.load;

    BatchPageState.bind();
    BatchPageState.restore().then(loadBatchPanelRules);
    document.getElementById('copyMainSettingsToSeriesBtn').addEventListener('click', () => {
        const mainUrl = dashUrl.value.trim();
        const mainSlices = document.getElementById('timestamps').value.trim();
        if (!mainUrl && !mainSlices) return showToast('В настройках сбора нет URL и временных срезов для копирования', 'info');
        document.getElementById('seriesDashUrl').value = mainUrl;
        document.getElementById('seriesTimestamps').value = mainSlices;
        resetSeriesDashboardSelection();
        BatchPageState.save();
        showToast('URL и временные срезы скопированы в Series', 'success');
    });
    let previousSeriesDashboardUrl = document.getElementById('seriesDashUrl').value.trim();
    const resetSeriesDashboardSelection = () => {
        const currentUrl = document.getElementById('seriesDashUrl').value.trim();
        if (currentUrl === previousSeriesDashboardUrl) return;
        previousSeriesDashboardUrl = currentUrl;
        panelPicker.clearSeriesSelection();
        document.getElementById('seriesPanelsContainer').replaceChildren();
        document.getElementById('seriesPanelSelectionStatus').textContent = 'Панели ещё не выбраны';
        document.getElementById('loadSelectedSeriesBtn').hidden = true;
    };
    document.getElementById('seriesDashUrl').addEventListener('input', resetSeriesDashboardSelection);
    document.getElementById('seriesDashUrl').addEventListener('change', resetSeriesDashboardSelection);
    captureThemeInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) setCaptureTheme(input.value, input.closest('fieldset')?.id);
        });
    });

    // --- Helper API: Parse Grafana URL ---
    function parseGrafanaUrl(url) {
        return parseGrafanaDashboardUrl(url);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Get Panels Action ---
    document.getElementById('getPanelsBtn').addEventListener('click', () => {
        void panelPicker.open({ dashboardUrl: document.getElementById('dashUrl').value.trim(), context: 'main' });
    });

    // --- Engine State ---
    const startBtn = document.getElementById('startBtn');
    const batchOperation = BatchOperationController.create({
        mainActionArea,
        startButton: startBtn,
        startSeriesButton: document.getElementById('startSeriesBtn'),
        cancelButton: document.getElementById('cancelBtn'),
        showToast,
        logMessage,
        lifecycle: BatchRunLifecycle,
        progressFactory: DashBridgeOperationProgress,
        captureWindowRunner: createBatchCaptureWindowRunner(),
        loadPanel: createBatchPanelLoader({ log: logMessage }),
    });
    const operationProgressController = batchOperation.progress;
    const loadBatchPanel = batchOperation.loadPanel;
    const updateActionVisibility = batchOperation.updateActionVisibility;
    const getOrCreateCaptureWindow = batchOperation.acquireWindow;
    const closeCaptureWindow = batchOperation.releaseWindow;
    const capturePanelToZip = batchOperation.capturePanelToZip;
    const getBatchCaptureOptions = batchOperation.getCaptureOptions;
    const addBatchArchiveReport = batchOperation.addArchiveReport;
    const beginBatchRun = batchOperation.begin;
    const isBatchRunActive = batchOperation.isActive;
    const finishBatchRun = batchOperation.finish;

    // --- Main Capture Action ---
    startBtn.addEventListener('click', async () => {
        if (batchOperation.processing) return showToast('Процесс уже запущен!', 'error');

        const urlStr = document.getElementById('dashUrl').value.trim();
        const timestampsText = document.getElementById('timestamps').value.trim();

        if (!urlStr || !timestampsText) return showToast('Заполните URL и диапазоны дат', 'error');

        const info = parseGrafanaUrl(urlStr);
        if (!info) return showToast('Неверный формат URL', 'error');

        const normalizedRanges = normalizeTimeRangesField({ fieldId: 'timestamps', notify: false });
        if (normalizedRanges.errors.length) {
            return showToast(`Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`, 'error');
        }
        const timestamps = normalizedRanges.ranges;
        // Баг исправлен: использовать тему из вкладки «Настройки сбора», а не Series
        const captureTheme = getCaptureTheme('captureThemeMain');
        const captureOptions = await getBatchCaptureOptions('compactCaptureMain');

        if (timestamps.length === 0) return showToast('Не удалось разобрать диапазоны дат', 'error');

        const runId = await beginBatchRun({ title: 'Массовый сбор скриншотов', phase: 'Получение списка панелей' });
        const captureFilename = BatchCaptureUtils.createFilenameFactory();
        logMessage('🚀 Начало работы массового сбора...');

        try {
            // Используем recovery для обработки ошибки 401 (истёкшая сессия)
            const dashboardResult = await panelPicker.getDashboardPanelsWithRecovery(urlStr);
            if (!isBatchRunActive(runId)) return;
            const panels = { ...dashboardResult.panels };
            const mainPanelRules = await BatchPanelRules.load(urlStr);
            if (!isBatchRunActive(runId)) return;

            // Применяем whitelist/blacklist
            const mode = document.getElementById('panelsMode').value;
            const uPanels = document.getElementById('userPanels').value.split(',').map(s => s.trim()).filter(s => s);
            if (mode === 'whitelist' && uPanels.length === 0) {
                throw new Error('Для белого списка укажите хотя бы один ID панели');
            }
            const orderedPanelIds = dashboardResult.panelList?.length
                ? dashboardResult.panelList.map(panel => String(panel.id))
                : Object.keys(panels);
            const pids = orderedPanelIds.filter(panelId => {
                if (mode === 'whitelist' && uPanels.length > 0) return uPanels.includes(panelId);
                if (mode === 'blacklist' && uPanels.length > 0) return !uPanels.includes(panelId);
                return true;
            });
            if (pids.length === 0) throw new Error('Нет панелей для сбора после фильтрации');
            const totalJobs = pids.length * timestamps.length;
            let completedJobs = 0;
            let successfulJobs = 0;
            let failedJobs = 0;
            const captureErrors = [];
            updateBatchProgress({ done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор панелей' });

            const archiveName = `grafana_batch_${new Date().toISOString().slice(0, 10)}.zip`;
            const archive = createRollingZipArchive({ filename: archiveName, maxBytes: 300 * 1024 * 1024 });
            const win = await getOrCreateCaptureWindow();
            if (!isBatchRunActive(runId)) {
                await closeCaptureWindow();
                return;
            }
            const tabId = win.tabs[0].id;
            for (const pid of pids) {
                for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                    const ts = timestamps[rangeIndex];
                    if (!isBatchRunActive(runId)) break;

                    const fullUrl = buildGrafanaPanelUrl(urlStr, pid, { ...ts, theme: captureTheme });
                    const filename = captureFilename({
                        panelId: pid,
                        label: panels[pid],
                        from: ts.from,
                        to: ts.to,
                        identity: fullUrl
                    });
                    const archivePath = BatchCaptureUtils.buildArchivePath({
                        filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                    });
                    operationProgressController.update({
                        done: completedJobs,
                        total: totalJobs,
                        success: successfulJobs,
                        failed: failedJobs,
                        phase: `Панель ${pid}`,
                        message: `${ts.from} → ${ts.to}`
                    });

                    const rect = await loadBatchPanel(tabId, fullUrl, pid, null, null, BatchPanelRules.forPanel(mainPanelRules, pid), BatchRunLifecycle.signal(runId));
                    if (rect && rect.w > 5 && rect.h > 5) {
                        if (await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions)) {
                            successfulJobs++;
                        } else {
                            failedJobs++;
                            captureErrors.push({ file: archivePath, reason: 'Не удалось захватить изображение панели' });
                            logMessage(`❌ Не удалось захватить панель: ${archivePath}`, true);
                        }
                    } else {
                        failedJobs++;
                        captureErrors.push({ file: archivePath, reason: 'Панель не найдена, не отрисована или имеет пустой размер' });
                        logMessage(`❌ Панель не найдена или пустая (w/h < 5): ${archivePath}`, true);
                    }
                    completedJobs++;
                    updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор панелей' });
                }
            }

            if (isBatchRunActive(runId)) {
                if (!successfulJobs) {
                    logMessage('Сбор завершён без снимков. Архив не создан.', true);
                    showToast('Не удалось сохранить ни одной панели', 'error');
                } else {
                    logMessage('📦 Формирование ZIP архива...');
                    operationProgressController.update({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Формирование ZIP', message: 'Подготовка архива к скачиванию…' });
                    await addBatchArchiveReport(archive, {
                        kind: 'panels',
                        dashboard: info,
                        totalJobs,
                        successfulJobs,
                        failedJobs,
                        errors: captureErrors
                    });
                    await archive.finalize();
                    if (failedJobs) {
                        logMessage(`Сбор завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`);
                        showToast(`Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`, 'info');
                    } else {
                        logMessage('🎉 Сбор успешно завершен!');
                        showToast('Архив скачан!', 'success');
                    }
                }
            }

        } catch (e) {
            if (isBatchRunActive(runId)) {
                logMessage(`💥 Ошибка сбора: ${e.message}`, true);
                showToast('Критическая ошибка', 'error');
            }
        } finally {
            await finishBatchRun(runId);
        }
    });

    // --- Independent Series Discovery Logic ---
    const seriesPanelIdFormatCache = new Map();
    const seriesDashboardIdentity = dashboardUrl => {
        const dashboard = parseGrafanaDashboardUrl(dashboardUrl);
        return dashboard ? `${dashboard.baseUrl}|org:${dashboard.orgId || 'default'}|${dashboard.uid}` : dashboardUrl;
    };
    const seriesPanelIdCandidates = (dashboardUrl, panelId) => {
        const format = seriesPanelIdFormatCache.get(seriesDashboardIdentity(dashboardUrl));
        if (format === 'prefixed') return [`panel-${panelId}`, String(panelId)];
        if (format === 'numeric') return [String(panelId), `panel-${panelId}`];
        return [`panel-${panelId}`, String(panelId)];
    };
    const rememberSeriesPanelIdFormat = (dashboardUrl, capturePanelId) => {
        seriesPanelIdFormatCache.set(seriesDashboardIdentity(dashboardUrl), String(capturePanelId).startsWith('panel-') ? 'prefixed' : 'numeric');
    };
    const buildSeriesCaptureUrl = (dashboardUrl, panelId, range, signatures) => {
        const url = new URL(buildGrafanaSoloPanelUrl(dashboardUrl, panelId, {
            from: range.from,
            to: range.to,
            theme: getCaptureTheme('captureThemeSeries')
        }));
        const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        url.searchParams.set('dashbridgeSeriesCapture', token);
        url.searchParams.set('dashbridgeSeriesTargets', JSON.stringify(signatures));
        return { url: url.toString(), token };
    };

    const navigateGrafanaSeriesCaptureTab = async (tabId, captureUrl, windowId = null) => {
        const registration = await ensureEarlyGrafanaRuntimeForUrl(captureUrl);
        if (!registration.ok) throw new Error('Не удалось подготовить ранний Grafana runtime');
        if (tabId) await chrome.tabs.update(tabId, { url: captureUrl });
        else {
            const tab = await chrome.tabs.create({
                url: captureUrl,
                active: true,
                ...(windowId ? { windowId } : {})
            });
            if (!tab.id) throw new Error('Не удалось открыть фоновую вкладку Grafana');
            tabId = tab.id;
        }
        return tabId;
    };

    const waitForCapturedSeries = (tabId, token, timeoutMs = 45000, signal = null) => new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            signal?.removeEventListener('abort', abort);
        };
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
            void chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', args: [token],
                func: expectedToken => window.dispatchEvent(new CustomEvent('dashbridgeSeriesCaptureCancelled', {
                    detail: { token: expectedToken }
                }))
            }).catch(() => undefined);
            fail(new DOMException('Batch run cancelled', 'AbortError'));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        chrome.scripting.executeScript({
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
                    if (event.detail?.token === expectedToken) finish({ ok: false, cancelled: true });
                };
                const deadlineTimer = setTimeout(() => {
                    const capture = window.__dashBridgeSeriesCapture;
                    finish({ ok: false, capture: capture?.token === expectedToken ? capture : null });
                }, Math.max(1, Number(budgetMs) || 45_000));
                window.addEventListener('dashbridgeSeriesCaptureUpdated', onUpdate);
                window.addEventListener('dashbridgeSeriesCaptureCancelled', onCancel);
                inspect();
            })
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
            fail(new Error(`${reason} (запросов: ${debug?.requests || 0}, совпадений: ${debug?.matched || 0})`));
        }).catch(fail);
    });

    const discoverSeriesForSlice = async ({ dashboardUrl, panelId, range, signatures, tabId = null, signal = null, onTabId = null, discoveryWindowId = null }) => {
        let nextTabId = tabId;
        let lastError = null;
        for (const capturePanelId of seriesPanelIdCandidates(dashboardUrl, panelId)) {
            const capture = buildSeriesCaptureUrl(dashboardUrl, capturePanelId, range, signatures);
            nextTabId = await navigateGrafanaSeriesCaptureTab(nextTabId, capture.url, discoveryWindowId);
            onTabId?.(nextTabId);
            try {
                const names = await waitForCapturedSeries(nextTabId, capture.token, 15000, signal);
                rememberSeriesPanelIdFormat(dashboardUrl, capturePanelId);
                return { tabId: nextTabId, names };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('Grafana не вернула серии');
    };

    const appendSeriesPanelCard = (panelId, panelTitle, panelUrl, signatures) => {
        const container = document.getElementById('seriesPanelsContainer');
        const card = document.createElement('div');
        card.className = 'batch-series-card';
        card.dataset.querySignatures = JSON.stringify(signatures || []);
        card.innerHTML = `<h3 style="margin-top:0; font-size:14px; color:var(--primary);">Панель ID: ${escapeHtml(panelId)} — ${escapeHtml(panelTitle)}</h3>
            <input type="hidden" class="series-panel-url" value="${escapeHtml(panelUrl)}">
            <p>Series будут определены для каждого временного среза и отфильтрованы по ключевым фразам.</p>`;
        container.appendChild(card);
    };
    const loadSelectedSeriesPanels = async () => {
        const dashboardUrl = document.getElementById('seriesDashUrl').value.trim();
        const panelIds = panelPicker.getSeriesSelectedPanelIds();
        if (!dashboardUrl) return showToast('Введите URL дашборда для Series', 'error');
        if (!panelIds.length) return showToast('Выберите хотя бы одну панель', 'error');
        const loader = document.getElementById('seriesLoaderStatus');
        loader.hidden = false;
        document.getElementById('seriesPanelsContainer').innerHTML = '';
        try {
            let loadedCards = 0;
            const { payload } = await fetchGrafanaDashboardDefinition(dashboardUrl);
            for (const panelId of panelIds) {
                const panelUrl = buildGrafanaPanelUrl(dashboardUrl, panelId, { theme: getCaptureTheme('captureThemeSeries') });
                try {
                    const panel = findGrafanaDashboardPanel(payload.dashboard, panelId);
                    if (!panel) throw new Error(`Панель ${panelId} не найдена в дашборде`);
                    const signatures = getGrafanaPanelQuerySignatures(panel);
                    if (!signatures.length) throw new Error('В панели нет активных запросов');
                    appendSeriesPanelCard(panelId, panel.title, panelUrl, signatures);
                    loadedCards++;
                } catch (error) {
                    logMessage(`Ошибка API для панели ${panelId}: ${error.message}`, true);
                }
            }
            if (loadedCards) showToast(`Подготовлено панелей: ${loadedCards}`, 'success');
            else showToast('Панели не подготовлены. Откройте журнал: в нём указана причина по каждой панели.', 'error');
        } catch (error) {
            logMessage(`Ошибка подготовки панелей: ${error.message}`, true);
            showToast('Не удалось подготовить панели', 'error');
        } finally {
            loader.hidden = true;
        }
    };
    document.getElementById('getSeriesPanelsBtn').addEventListener('click', () => {
        void panelPicker.open({ dashboardUrl: document.getElementById('seriesDashUrl').value.trim(), context: 'series' });
    });
    document.getElementById('loadSelectedSeriesBtn').addEventListener('click', loadSelectedSeriesPanels);

    document.getElementById('startSeriesBtn').addEventListener('click', async () => {
        if (batchOperation.processing) return showToast('Процесс уже запущен!', 'error');

        const normalizedRanges = normalizeTimeRangesField({ fieldId: 'seriesTimestamps', notify: false });
        if (normalizedRanges.errors.length) {
            return showToast(`Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`, 'error');
        }
        const timestamps = normalizedRanges.ranges;

        if (timestamps.length === 0) return showToast('Не удалось разобрать диапазоны дат', 'error');

        const mode = document.getElementById('seriesCaptureMode').value;
        const captureTheme = getCaptureTheme('captureThemeSeries');
        const captureOptions = await getBatchCaptureOptions('compactCaptureSeries');
        const includePattern = document.getElementById('seriesIncludeFilter').value;
        const ignorePattern = document.getElementById('seriesIgnoreFilter').value;
        const cards = document.querySelectorAll('#seriesPanelsContainer .batch-series-card');
        if (cards.length === 0) return showToast('Нет панелей для сбора', 'error');

        const runId = await beginBatchRun({ title: 'Массовый сбор Series', phase: 'Подготовка фильтров Series' });
        const captureFilename = BatchCaptureUtils.createFilenameFactory();
        logMessage('🚀 Начало сбора изолированных метрик (Series)...');

        let seriesDiscoveryTabId = null;
        try {
            const batchPageTab = await chrome.tabs.getCurrent();
            const seriesDashboardUrl = document.getElementById('seriesDashUrl').value.trim();
            const seriesPanelRules = parseGrafanaUrl(seriesDashboardUrl)
                ? await BatchPanelRules.load(seriesDashboardUrl)
                : {};
            if (!isBatchRunActive(runId)) return;
            const archiveName = `grafana_series_${new Date().toISOString().slice(0, 10)}.zip`;
            const archive = createRollingZipArchive({ filename: archiveName, maxBytes: 300 * 1024 * 1024 });
            const win = await getOrCreateCaptureWindow();
            if (!isBatchRunActive(runId)) {
                await closeCaptureWindow();
                return;
            }
            const tabId = win.tabs[0].id;
            let totalJobs = 0;
            let completedJobs = 0;
            let successfulJobs = 0;
            let failedJobs = 0;
            const captureErrors = [];
            const recordSeriesJob = (success, file = '', reason = 'Снимок Series не создан') => {
                completedJobs++;
                if (success) successfulJobs++;
                else {
                    failedJobs++;
                    captureErrors.push({ file: file || `series-job-${completedJobs}`, reason });
                }
                updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор Series' });
            };
            updateBatchProgress({ done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор Series' });

            for (const card of cards) {
                const urlStr = card.querySelector('.series-panel-url').value;
                const parsed = new URL(urlStr);
                const pid = new URLSearchParams(parsed.search).get('viewPanel') || 'Unknown';
                const signatures = JSON.parse(card.dataset.querySignatures || '[]');

                for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                    const ts = timestamps[rangeIndex];
                    if (!isBatchRunActive(runId)) break;
                    operationProgressController.update({
                        done: completedJobs,
                        total: totalJobs,
                        success: successfulJobs,
                        failed: failedJobs,
                        phase: `Series панели ${pid}`,
                        message: `${ts.from} → ${ts.to}`
                    });

                    try {
                        const discovery = await discoverSeriesForSlice({
                            dashboardUrl: seriesDashboardUrl,
                            panelId: pid,
                            range: ts,
                            signatures,
                            tabId: seriesDiscoveryTabId,
                            signal: BatchRunLifecycle.signal(runId),
                            onTabId: value => { seriesDiscoveryTabId = value; },
                            discoveryWindowId: batchPageTab?.windowId || null
                        });
                        seriesDiscoveryTabId = discovery.tabId;
                        const selection = BatchSeriesSelection.resolvePatterns(discovery.names, includePattern, ignorePattern);
                        totalJobs += mode === 'group' ? (selection.matches.length ? 1 : 0) : selection.matches.length;
                        updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор Series' });
                        if (!selection.matches.length) {
                            logMessage(`Для панели ${pid} нет Series, подходящих под фильтры, в срезе ${ts.from} → ${ts.to}`);
                            continue;
                        }

                        const fullUrl = buildGrafanaPanelUrl(urlStr, pid, { ...ts, theme: captureTheme });

                        if (mode === 'group') {
                            const filteredUrl = applyGrafanaCompleteHideSelection(
                                fullUrl,
                                selection.matches.map(series => series.name),
                                signatures
                            );
                            const filename = captureFilename({
                                panelId: pid,
                                label: 'Group',
                                from: ts.from,
                                to: ts.to,
                                identity: `${filteredUrl}\u0000${selection.matches.map(series => series.key).join('\u0000')}`
                            });
                            const archivePath = BatchCaptureUtils.buildArchivePath({
                                filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                            });
                            const rect = await loadBatchPanel(tabId, filteredUrl, pid, null, null, BatchPanelRules.forPanel(seriesPanelRules, pid), BatchRunLifecycle.signal(runId));
                            if (rect && rect.w > 5) {
                                const captured = await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions);
                                recordSeriesJob(captured, archivePath, 'Не удалось захватить изображение панели');
                                if (!captured) {
                                    logMessage(`❌ Не удалось захватить панель: ${archivePath}`, true);
                                }
                            } else {
                                recordSeriesJob(false, archivePath, 'Панель не найдена, не отрисована или имеет пустой размер');
                                logMessage(`❌ Панель не найдена или пустая: ${archivePath}`, true);
                            }
                        } else {
                            // standalone — каждая серия в отдельном файле
                            // prevSeriesName передаётся загрузчику для быстрого переключения без перезагрузки
                            let prevSeriesName = null;
                            let seriesIndex = 0;
                            for (const series of selection.matches) {
                                if (!isBatchRunActive(runId)) break;
                                const seriesName = series.name;
                                const occurrence = seriesIndex++;
                                const filename = captureFilename({
                                    panelId: pid,
                                    label: seriesName,
                                    from: ts.from,
                                    to: ts.to,
                                    identity: `${fullUrl}\u0000${series.key}`,
                                    occurrence
                                });
                                const archivePath = BatchCaptureUtils.buildArchivePath({
                                    filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                                });

                                // Передаём prevSeriesName: загрузчик использует его чтобы пропустить
                                // перезагрузку страницы если URL не изменился
                                const rect = await loadBatchPanel(tabId, fullUrl, pid, null, prevSeriesName, BatchPanelRules.forPanel(seriesPanelRules, pid), BatchRunLifecycle.signal(runId));
                                prevSeriesName = seriesName;

                                if (rect && rect.w > 5) {
                                    const filterResult = await setGrafanaLegendVisibility({
                                        tabId,
                                        panelId: pid,
                                        selectedKeys: [series.key]
                                    });
                                    if (!filterResult.ok) {
                                        recordSeriesJob(false, archivePath, 'Не удалось применить фильтр легенды');
                                        logMessage(`Unable to apply the legend filter: ${seriesName}`, true);
                                        continue;
                                    }
                                    if (rect.missing && rect.missing.length > 0) {
                                        logMessage(`⚠️ Внимание: Серия не найдена или не кликабельна: ${rect.missing.join(', ')}`, true);
                                    }
                                    const captured = await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions);
                                    recordSeriesJob(captured, archivePath, 'Не удалось захватить изображение Series');
                                    if (!captured) {
                                        logMessage(`❌ Не удалось захватить серию: ${archivePath}`, true);
                                    }
                                } else {
                                    recordSeriesJob(false, archivePath, 'Панель не найдена, не отрисована или имеет пустой размер');
                                    logMessage(`❌ Панель не найдена или пустая: ${archivePath}`, true);
                                }
                            }
                        }
                    } catch (error) {
                        logMessage(`Не удалось получить серии панели ${pid} для ${ts.from} → ${ts.to}: ${error.message}`, true);
                    }
                }
            }

            if (isBatchRunActive(runId)) {
                if (!successfulJobs) {
                    logMessage('Сбор Series завершён без снимков. Архив не создан.', true);
                    showToast('Не удалось сохранить ни одной Series', 'error');
                } else {
                    logMessage('📦 Формирование ZIP архива...');
                    operationProgressController.update({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Формирование ZIP', message: 'Подготовка архива Series к скачиванию…' });
                    await addBatchArchiveReport(archive, {
                        kind: 'series',
                        dashboard: parseGrafanaUrl(seriesDashboardUrl),
                        totalJobs,
                        successfulJobs,
                        failedJobs,
                        errors: captureErrors
                    });
                    await archive.finalize();
                    if (failedJobs) {
                        logMessage(`Сбор Series завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`);
                        showToast(`Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`, 'info');
                    } else {
                        logMessage('🎉 Сбор успешно завершен!');
                        showToast('Архив скачан!', 'success');
                    }
                }
            }
        } catch (e) {
            if (isBatchRunActive(runId)) logMessage(`💥 Ошибка: ${e.message}`, true);
        } finally {
            if (seriesDiscoveryTabId) await chrome.tabs.remove(seriesDiscoveryTabId).catch(() => undefined);
            await finishBatchRun(runId);
        }
    });
});
