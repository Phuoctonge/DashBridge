(function initBatchSeriesRunController(root) {
    'use strict';

    function create({ startButton, operation, lifecycle, discovery,
        seriesSelection, panelRules, captureUtils, normalizeRangesField,
        getCaptureTheme, updateProgress, showToast, logMessage, parseUrl,
        buildPanelUrl, applyCompleteHideSelection, setLegendVisibility,
        createArchive, documentRef = document, chromeRef = chrome }) {
        const required = [
            normalizeRangesField, getCaptureTheme, updateProgress, showToast,
            logMessage, parseUrl, buildPanelUrl, applyCompleteHideSelection,
            setLegendVisibility, createArchive,
        ];
        if (!startButton?.addEventListener || required.some(value => typeof value !== 'function')
            || typeof operation?.begin !== 'function'
            || typeof operation?.finish !== 'function'
            || typeof operation?.isActive !== 'function'
            || typeof operation?.loadPanel !== 'function'
            || typeof operation?.capturePanelToZip !== 'function'
            || typeof operation?.getCaptureOptions !== 'function'
            || typeof operation?.addArchiveReport !== 'function'
            || typeof operation?.acquireWindow !== 'function'
            || typeof operation?.releaseWindow !== 'function'
            || typeof operation?.progress?.update !== 'function'
            || typeof discovery?.discoverForSlice !== 'function'
            || typeof seriesSelection?.resolvePatterns !== 'function'
            || typeof panelRules?.load !== 'function'
            || typeof panelRules?.forPanel !== 'function'
            || typeof captureUtils?.createFilenameFactory !== 'function'
            || typeof captureUtils?.buildArchivePath !== 'function'
            || typeof lifecycle?.signal !== 'function'
            || typeof chromeRef?.tabs?.getCurrent !== 'function'
            || typeof chromeRef?.tabs?.remove !== 'function') {
            throw new TypeError('Batch Series run controller dependencies are incomplete');
        }

        const run = async () => {
            if (operation.processing) {
                showToast('Процесс уже запущен!', 'error');
                return;
            }
            const normalizedRanges = normalizeRangesField({
                fieldId: 'seriesTimestamps', notify: false,
            });
            if (normalizedRanges.errors.length) {
                showToast(
                    `Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`,
                    'error',
                );
                return;
            }
            const timestamps = normalizedRanges.ranges;
            if (!timestamps.length) {
                showToast('Не удалось разобрать диапазоны дат', 'error');
                return;
            }

            const mode = documentRef.getElementById('seriesCaptureMode').value;
            const captureTheme = getCaptureTheme('captureThemeSeries');
            const captureOptions = await operation.getCaptureOptions('compactCaptureSeries');
            const includePattern = documentRef.getElementById('seriesIncludeFilter').value;
            const ignorePattern = documentRef.getElementById('seriesIgnoreFilter').value;
            const cards = documentRef.querySelectorAll('#seriesPanelsContainer .batch-series-card');
            if (!cards.length) {
                showToast('Нет панелей для сбора', 'error');
                return;
            }

            const runId = await operation.begin({
                title: 'Массовый сбор Series',
                phase: 'Подготовка фильтров Series',
            });
            const captureFilename = captureUtils.createFilenameFactory();
            logMessage('🚀 Начало сбора изолированных метрик (Series)...');
            let seriesDiscoveryTabId = null;
            try {
                const batchPageTab = await chromeRef.tabs.getCurrent();
                const seriesDashboardUrl = documentRef.getElementById('seriesDashUrl').value.trim();
                const seriesPanelRules = parseUrl(seriesDashboardUrl)
                    ? await panelRules.load(seriesDashboardUrl)
                    : {};
                if (!operation.isActive(runId)) return;
                const archive = createArchive({
                    filename: `grafana_series_${new Date().toISOString().slice(0, 10)}.zip`,
                    maxBytes: 300 * 1024 * 1024,
                });
                const captureWindow = await operation.acquireWindow();
                if (!operation.isActive(runId)) {
                    await operation.releaseWindow();
                    return;
                }
                const tabId = captureWindow.tabs[0].id;
                let totalJobs = 0;
                let completedJobs = 0;
                let successfulJobs = 0;
                let failedJobs = 0;
                const captureErrors = [];
                const recordSeriesJob = (
                    success, file = '', reason = 'Снимок Series не создан',
                ) => {
                    completedJobs++;
                    if (success) successfulJobs++;
                    else {
                        failedJobs++;
                        captureErrors.push({ file: file || `series-job-${completedJobs}`, reason });
                    }
                    updateProgress({
                        done: completedJobs, total: totalJobs, success: successfulJobs,
                        failed: failedJobs, phase: 'Сбор Series',
                    });
                };
                updateProgress({
                    done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор Series',
                });

                for (const card of cards) {
                    const urlStr = card.querySelector('.series-panel-url').value;
                    const parsed = new URL(urlStr);
                    const panelId = new URLSearchParams(parsed.search).get('viewPanel') || 'Unknown';
                    const signatures = JSON.parse(card.dataset.querySignatures || '[]');

                    for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                        const range = timestamps[rangeIndex];
                        if (!operation.isActive(runId)) break;
                        operation.progress.update({
                            done: completedJobs, total: totalJobs, success: successfulJobs,
                            failed: failedJobs, phase: `Series панели ${panelId}`,
                            message: `${range.from} → ${range.to}`,
                        });
                        try {
                            const discoveryResult = await discovery.discoverForSlice({
                                dashboardUrl: seriesDashboardUrl,
                                panelId,
                                range,
                                signatures,
                                tabId: seriesDiscoveryTabId,
                                signal: lifecycle.signal(runId),
                                onTabId: value => { seriesDiscoveryTabId = value; },
                                discoveryWindowId: batchPageTab?.windowId || null,
                            });
                            seriesDiscoveryTabId = discoveryResult.tabId;
                            const selection = seriesSelection.resolvePatterns(
                                discoveryResult.names, includePattern, ignorePattern,
                            );
                            totalJobs += mode === 'group'
                                ? (selection.matches.length ? 1 : 0)
                                : selection.matches.length;
                            updateProgress({
                                done: completedJobs, total: totalJobs,
                                success: successfulJobs, failed: failedJobs,
                                phase: 'Сбор Series',
                            });
                            if (!selection.matches.length) {
                                logMessage(
                                    `Для панели ${panelId} нет Series, подходящих под фильтры, в срезе ${range.from} → ${range.to}`,
                                );
                                continue;
                            }

                            const fullUrl = buildPanelUrl(urlStr, panelId, {
                                ...range, theme: captureTheme,
                            });
                            if (mode === 'group') {
                                const filteredUrl = applyCompleteHideSelection(
                                    fullUrl,
                                    selection.matches.map(series => series.name),
                                    signatures,
                                );
                                const filename = captureFilename({
                                    panelId,
                                    label: 'Group',
                                    from: range.from,
                                    to: range.to,
                                    identity: `${filteredUrl}\u0000${selection.matches.map(series => series.key).join('\u0000')}`,
                                });
                                const archivePath = captureUtils.buildArchivePath({
                                    filename, rangeIndex, rangeCount: timestamps.length,
                                    from: range.from, to: range.to,
                                });
                                const rect = await operation.loadPanel(
                                    tabId, filteredUrl, panelId, null, null,
                                    panelRules.forPanel(seriesPanelRules, panelId),
                                    lifecycle.signal(runId),
                                );
                                if (rect && rect.w > 5) {
                                    const captured = await operation.capturePanelToZip(
                                        captureWindow, tabId, panelId, archivePath,
                                        archive, captureOptions,
                                    );
                                    recordSeriesJob(
                                        captured, archivePath,
                                        'Не удалось захватить изображение панели',
                                    );
                                    if (!captured) {
                                        logMessage(`❌ Не удалось захватить панель: ${archivePath}`, true);
                                    }
                                } else {
                                    recordSeriesJob(
                                        false, archivePath,
                                        'Панель не найдена, не отрисована или имеет пустой размер',
                                    );
                                    logMessage(`❌ Панель не найдена или пустая: ${archivePath}`, true);
                                }
                            } else {
                                let previousSeriesName = null;
                                let seriesIndex = 0;
                                for (const series of selection.matches) {
                                    if (!operation.isActive(runId)) break;
                                    const seriesName = series.name;
                                    const occurrence = seriesIndex++;
                                    const filename = captureFilename({
                                        panelId,
                                        label: seriesName,
                                        from: range.from,
                                        to: range.to,
                                        identity: `${fullUrl}\u0000${series.key}`,
                                        occurrence,
                                    });
                                    const archivePath = captureUtils.buildArchivePath({
                                        filename, rangeIndex, rangeCount: timestamps.length,
                                        from: range.from, to: range.to,
                                    });
                                    const rect = await operation.loadPanel(
                                        tabId, fullUrl, panelId, null, previousSeriesName,
                                        panelRules.forPanel(seriesPanelRules, panelId),
                                        lifecycle.signal(runId),
                                    );
                                    previousSeriesName = seriesName;
                                    if (rect && rect.w > 5) {
                                        const filterResult = await setLegendVisibility({
                                            tabId, panelId, selectedKeys: [series.key],
                                        });
                                        if (!filterResult.ok) {
                                            recordSeriesJob(
                                                false, archivePath,
                                                'Не удалось применить фильтр легенды',
                                            );
                                            logMessage(
                                                `Unable to apply the legend filter: ${seriesName}`,
                                                true,
                                            );
                                            continue;
                                        }
                                        if (rect.missing?.length) {
                                            logMessage(
                                                `⚠️ Внимание: Серия не найдена или не кликабельна: ${rect.missing.join(', ')}`,
                                                true,
                                            );
                                        }
                                        const captured = await operation.capturePanelToZip(
                                            captureWindow, tabId, panelId, archivePath,
                                            archive, captureOptions,
                                        );
                                        recordSeriesJob(
                                            captured, archivePath,
                                            'Не удалось захватить изображение Series',
                                        );
                                        if (!captured) {
                                            logMessage(
                                                `❌ Не удалось захватить серию: ${archivePath}`,
                                                true,
                                            );
                                        }
                                    } else {
                                        recordSeriesJob(
                                            false, archivePath,
                                            'Панель не найдена, не отрисована или имеет пустой размер',
                                        );
                                        logMessage(
                                            `❌ Панель не найдена или пустая: ${archivePath}`,
                                            true,
                                        );
                                    }
                                }
                            }
                        } catch (error) {
                            logMessage(
                                `Не удалось получить серии панели ${panelId} для ${range.from} → ${range.to}: ${error.message}`,
                                true,
                            );
                        }
                    }
                }

                if (operation.isActive(runId)) {
                    if (!successfulJobs) {
                        logMessage('Сбор Series завершён без снимков. Архив не создан.', true);
                        showToast('Не удалось сохранить ни одной Series', 'error');
                    } else {
                        logMessage('📦 Формирование ZIP архива...');
                        operation.progress.update({
                            done: completedJobs, total: totalJobs,
                            success: successfulJobs, failed: failedJobs,
                            phase: 'Формирование ZIP',
                            message: 'Подготовка архива Series к скачиванию…',
                        });
                        await operation.addArchiveReport(archive, {
                            kind: 'series',
                            dashboard: parseUrl(seriesDashboardUrl),
                            totalJobs,
                            successfulJobs,
                            failedJobs,
                            errors: captureErrors,
                        });
                        await archive.finalize();
                        if (failedJobs) {
                            logMessage(
                                `Сбор Series завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`,
                            );
                            showToast(
                                `Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`,
                                'info',
                            );
                        } else {
                            logMessage('🎉 Сбор успешно завершен!');
                            showToast('Архив скачан!', 'success');
                        }
                    }
                }
            } catch (error) {
                if (operation.isActive(runId)) logMessage(`💥 Ошибка: ${error.message}`, true);
            } finally {
                if (seriesDiscoveryTabId) {
                    await chromeRef.tabs.remove(seriesDiscoveryTabId).catch(() => undefined);
                }
                await operation.finish(runId);
            }
        };

        const setup = () => startButton.addEventListener('click', run);
        return Object.freeze({ setup, run });
    }

    root.BatchSeriesRunController = Object.freeze({ create });
})(globalThis);
