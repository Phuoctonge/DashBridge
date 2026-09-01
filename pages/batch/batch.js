// Batch page controller.

document.addEventListener("DOMContentLoaded", () => {
    const batchPageController = BatchPageController.create({
        pageUi: BatchPageUi,
        pageState: BatchPageState,
        normalizeTimeRanges: normalizeGrafanaTimeRanges,
    });
    const {
        mainActionArea, panelsMode, showToast, logMessage, updateBatchProgress,
        normalizeTimeRangesField, getCaptureTheme,
    } = batchPageController;
    const panelPicker = BatchPanelPicker.create({ showToast, logMessage, panelsMode });

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
    batchPageController.setOperationProgressController(operationProgressController);
    batchPageController.setup({ updateActionVisibility, loadBatchPanelRules, panelPicker });

    BatchMainRunController.create({
        startButton: startBtn,
        operation: batchOperation,
        lifecycle: BatchRunLifecycle,
        panelPicker,
        panelRules: BatchPanelRules,
        captureUtils: BatchCaptureUtils,
        parseUrl: parseGrafanaUrl,
        normalizeRangesField: normalizeTimeRangesField,
        getCaptureTheme,
        updateProgress: updateBatchProgress,
        showToast,
        logMessage,
        buildPanelUrl: buildGrafanaPanelUrl,
        createArchive: createRollingZipArchive,
    }).setup();

    const seriesDiscoveryController = BatchSeriesDiscoveryController.create({
        panelPicker,
        getCaptureTheme,
        showToast,
        logMessage,
        escapeHtml,
        parseDashboardUrl: parseGrafanaDashboardUrl,
        buildSoloPanelUrl: buildGrafanaSoloPanelUrl,
        buildPanelUrl: buildGrafanaPanelUrl,
        ensureEarlyRuntime: ensureEarlyGrafanaRuntimeForUrl,
        fetchDashboardDefinition: fetchGrafanaDashboardDefinition,
        findDashboardPanel: findGrafanaDashboardPanel,
        getPanelQuerySignatures: getGrafanaPanelQuerySignatures,
    });
    const discoverSeriesForSlice = seriesDiscoveryController.discoverForSlice;
    seriesDiscoveryController.setup();

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
