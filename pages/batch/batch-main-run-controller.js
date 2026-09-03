(function initBatchMainRunController(root) {
    'use strict';

    function create({ startButton, operation, lifecycle, panelPicker, panelRules,
        captureUtils, parseUrl, normalizeRangesField, getCaptureTheme,
        updateProgress, showToast, logMessage, buildPanelUrl, createArchive,
        documentRef = document }) {
        const required = [
            parseUrl, normalizeRangesField, getCaptureTheme, updateProgress,
            showToast, logMessage, buildPanelUrl, createArchive,
        ];
        if (!startButton?.addEventListener || required.some(value => typeof value !== 'function')
            || typeof operation?.begin !== 'function'
            || typeof operation?.finish !== 'function'
            || typeof operation?.isActive !== 'function'
            || typeof operation?.loadPanel !== 'function'
            || typeof operation?.capturePanelToZip !== 'function'
            || typeof operation?.getCaptureOptions !== 'function'
            || typeof operation?.addArchiveReport !== 'function'
            || typeof panelPicker?.getDashboardPanelsWithRecovery !== 'function'
            || typeof panelRules?.load !== 'function'
            || typeof panelRules?.forPanel !== 'function'
            || typeof captureUtils?.createFilenameFactory !== 'function'
            || typeof captureUtils?.buildArchivePath !== 'function'
            || typeof lifecycle?.signal !== 'function') {
            throw new TypeError('Batch main run controller dependencies are incomplete');
        }

        const run = async () => {
            if (operation.processing) {
                showToast('Процесс уже запущен!', 'error');
                return;
            }
            const urlStr = documentRef.getElementById('dashUrl').value.trim();
            const timestampsText = documentRef.getElementById('timestamps').value.trim();
            if (!urlStr || !timestampsText) {
                showToast('Заполните URL и диапазоны дат', 'error');
                return;
            }
            const info = parseUrl(urlStr);
            if (!info) {
                showToast('Неверный формат URL', 'error');
                return;
            }
            const normalizedRanges = normalizeRangesField({ fieldId: 'timestamps', notify: false });
            if (normalizedRanges.errors.length) {
                showToast(`Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`, 'error');
                return;
            }
            const timestamps = normalizedRanges.ranges;
            const captureTheme = getCaptureTheme('captureThemeMain');
            const captureOptions = await operation.getCaptureOptions('compactCaptureMain');
            if (!timestamps.length) {
                showToast('Не удалось разобрать диапазоны дат', 'error');
                return;
            }

            const runId = await operation.begin({
                title: 'Массовый сбор скриншотов',
                phase: 'Получение списка панелей',
            });
            const captureFilename = captureUtils.createFilenameFactory();
            let analyticsOutcome = 'error';
            logMessage('🚀 Начало работы массового сбора...');
            try {
                const dashboardResult = await panelPicker.getDashboardPanelsWithRecovery(urlStr);
                if (!operation.isActive(runId)) return;
                const panels = { ...dashboardResult.panels };
                const mainPanelRules = await panelRules.load(urlStr);
                if (!operation.isActive(runId)) return;

                const mode = documentRef.getElementById('panelsMode').value;
                const userPanels = documentRef.getElementById('userPanels').value
                    .split(',').map(value => value.trim()).filter(Boolean);
                if (mode === 'whitelist' && !userPanels.length) {
                    throw new Error('Для белого списка укажите хотя бы один ID панели');
                }
                const orderedPanelIds = dashboardResult.panelList?.length
                    ? dashboardResult.panelList.map(panel => String(panel.id))
                    : Object.keys(panels);
                const panelIds = orderedPanelIds.filter(panelId => {
                    if (mode === 'whitelist' && userPanels.length) return userPanels.includes(panelId);
                    if (mode === 'blacklist' && userPanels.length) return !userPanels.includes(panelId);
                    return true;
                });
                if (!panelIds.length) throw new Error('Нет панелей для сбора после фильтрации');

                const totalJobs = panelIds.length * timestamps.length;
                let completedJobs = 0;
                let successfulJobs = 0;
                let failedJobs = 0;
                const captureErrors = [];
                updateProgress({ done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор панелей' });
                const archive = createArchive({
                    filename: `grafana_batch_${new Date().toISOString().slice(0, 10)}.zip`,
                    maxBytes: 300 * 1024 * 1024,
                });
                const captureWindow = await operation.acquireWindow();
                if (!operation.isActive(runId)) {
                    await operation.releaseWindow();
                    return;
                }
                const tabId = captureWindow.tabs[0].id;

                for (const panelId of panelIds) {
                    for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                        const range = timestamps[rangeIndex];
                        if (!operation.isActive(runId)) break;
                        const fullUrl = buildPanelUrl(urlStr, panelId, { ...range, theme: captureTheme });
                        const filename = captureFilename({
                            panelId, label: panels[panelId], from: range.from,
                            to: range.to, identity: fullUrl,
                        });
                        const archivePath = captureUtils.buildArchivePath({
                            filename, rangeIndex, rangeCount: timestamps.length,
                            from: range.from, to: range.to,
                        });
                        operation.progress.update({
                            done: completedJobs, total: totalJobs, success: successfulJobs,
                            failed: failedJobs, phase: `Панель ${panelId}`,
                            message: `${range.from} → ${range.to}`,
                        });
                        const rect = await operation.loadPanel(
                            tabId, fullUrl, panelId, null, null,
                            panelRules.forPanel(mainPanelRules, panelId), lifecycle.signal(runId),
                        );
                        if (rect && rect.w > 5 && rect.h > 5) {
                            if (await operation.capturePanelToZip(
                                captureWindow, tabId, panelId, archivePath, archive, captureOptions,
                            )) {
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
                        updateProgress({
                            done: completedJobs, total: totalJobs, success: successfulJobs,
                            failed: failedJobs, phase: 'Сбор панелей',
                        });
                    }
                }

                if (operation.isActive(runId)) {
                    if (!successfulJobs) {
                        analyticsOutcome = 'no_data';
                        logMessage('Сбор завершён без снимков. Архив не создан.', true);
                        showToast('Не удалось сохранить ни одной панели', 'error');
                    } else {
                        logMessage('📦 Формирование ZIP архива...');
                        operation.progress.update({
                            done: completedJobs, total: totalJobs, success: successfulJobs,
                            failed: failedJobs, phase: 'Формирование ZIP',
                            message: 'Подготовка архива к скачиванию…',
                        });
                        await operation.addArchiveReport(archive, {
                            kind: 'panels', dashboard: info, totalJobs,
                            successfulJobs, failedJobs, errors: captureErrors,
                        });
                        await archive.finalize();
                        if (failedJobs) {
                            analyticsOutcome = 'partial';
                            logMessage(`Сбор завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`);
                            showToast(`Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`, 'info');
                        } else {
                            analyticsOutcome = 'success';
                            logMessage('🎉 Сбор успешно завершен!');
                            showToast('Архив скачан!', 'success');
                        }
                    }
                }
            } catch (error) {
                if (operation.isActive(runId)) {
                    logMessage(`💥 Ошибка сбора: ${error.message}`, true);
                    showToast('Критическая ошибка', 'error');
                }
            } finally {
                if (!operation.isActive(runId) && analyticsOutcome === 'error') analyticsOutcome = 'cancelled';
                globalThis.DashBridgeAnalytics?.outcome('batch.main_run', analyticsOutcome, { workflow: 'main' });
                await operation.finish(runId);
            }
        };

        const setup = () => startButton.addEventListener('click', run);
        return Object.freeze({ setup, run });
    }

    root.BatchMainRunController = Object.freeze({ create });
})(globalThis);
