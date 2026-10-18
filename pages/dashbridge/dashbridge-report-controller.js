(function initDashBridgeReportController(root) {
    'use strict';

    const FRAME_TIMEOUT_MS = 90_000;
    const TOTAL_TIMEOUT_MS = 125_000;

    function create({ reportEngine, transportFactory, testRunnerFactory, auditEngine,
        forceLoadPanel, postToDashboardFrame, getPanels, getActiveProfile, getTimeContext,
        attachmentsFactory = null, captureSelection = null, collage = null, copyImage = null,
        beginReport = null, getReportFrameSource = frame => frame?.src,
        saveProfiles = null,
        documentRef = document, navigatorRef = navigator, setTimer = setTimeout, clearTimer = clearTimeout }) {
        if (!reportEngine?.normalizePanel || !reportEngine?.orderPanels
            || !transportFactory?.create || !testRunnerFactory?.create
            || typeof forceLoadPanel !== 'function' || typeof postToDashboardFrame !== 'function'
            || typeof getPanels !== 'function' || typeof getActiveProfile !== 'function'
            || typeof getTimeContext !== 'function') {
            throw new TypeError('DashBridge report controller dependencies are incomplete');
        }
        let activePreview = null;
        let closeActivePreview = null;
        let reportPeriod = null;

        const getEffectivePanelSla = panel => {
            const config = reportEngine.normalizePanel(panel.report, panel);
            if (config.sla.source === 'graph') {
                if (!panel.tools?.thresholdEnabled) return { error: 'Для сообщения выбран порог графика, но он выключен. Включите и настройте порог графика либо в настройках сообщения панели выберите «Собственный SLA» или «Без SLA - информационная фраза».' };
                return { source: 'graph', operator: 'gt', evaluation: config.sla.evaluation,
                    value: panel.tools.thresholdValue, rawValue: panel.tools.thresholdRawValue,
                    warningValue: config.sla.warningValue, unit: panel.tools.thresholdUnit || '' };
            }
            if (config.sla.source === 'cpu_capacity') {
                if (!panel.tools?.cpuCapacityFilterEnabled) return { error: 'Фильтр Load Average по vCPU выключен.' };
                const coefficient = Number(panel.tools.cpuCapacityFilterCoefficient ?? 0.8);
                if (!Number.isFinite(coefficient) || coefficient <= 0) return { error: 'Некорректный коэффициент фильтра Load Average по vCPU.' };
                return { source: 'cpu_capacity', operator: 'gt', coefficient,
                    evaluation: panel.tools.cpuCapacityFilterMode === 'last' ? 'latest' : 'period_max', unit: '' };
            }
            return { ...config.sla };
        };

        const transport = transportFactory.create({
            forceLoadPanel,
            getEffectivePanelSla,
            postToDashboardFrame,
            frameTimeoutMs: FRAME_TIMEOUT_MS,
            totalTimeoutMs: TOTAL_TIMEOUT_MS
        });

        const setPanelDataStatus = (panel, snapshot) => {
            const card = documentRef.querySelector(`.panel-card[data-panel-id="${CSS.escape(panel.id)}"]`);
            const wrapper = card?.querySelector('.iframe-wrapper');
            if (!wrapper) return;
            wrapper.querySelector('.dashbridge-panel-data-status')?.remove();
            // SLA configuration belongs to the report UI; it does not mean the graph failed to load.
            const parentKinds = new Set(['timeout', 'iframe_unavailable', 'request_error']);
            const kind = String(snapshot?.dataStatus || '');
            const message = String(snapshot?.dataStatusText || snapshot?.error || '').trim();
            if (!parentKinds.has(kind) || !message) return;
            const status = documentRef.createElement('div');
            status.className = 'dashbridge-panel-data-status';
            status.dataset.kind = kind;
            status.setAttribute('role', 'alert');
            status.textContent = message;
            wrapper.appendChild(status);
        };

        const collect = async (signal = null, onProgress = () => {}, { requirePanels = true } = {}) => {
            transport.throwIfAborted(signal);
            const contextSignature = () => JSON.stringify({
                profile: { id: getActiveProfile()?.id, name: getActiveProfile()?.name,
                    report: { ...getActiveProfile()?.report, attachments: undefined } },
                time: getTimeContext(),
                panels: getPanels().map(panel => ({ id: panel.id, src: panel.src, title: panel.title, report: panel.report,
                    threshold: [panel.tools?.thresholdEnabled, panel.tools?.thresholdValue, panel.tools?.thresholdUnit],
                    capacity: [panel.tools?.cpuCapacityFilterEnabled, panel.tools?.cpuCapacityFilterCoefficient, panel.tools?.cpuCapacityFilterMode] })),
            });
            const initialContext = contextSignature();
            const profile = getActiveProfile();
            const reportPanels = reportEngine.orderPanels(
                getPanels(), reportEngine.normalizeProfile(profile?.report).panelOrder
            ).filter(panel => reportEngine.normalizePanel(panel.report, panel).enabled);
            if (requirePanels && !reportPanels.length) throw new Error('В настройках сообщения не выбрана ни одна панель.');
            // The optional second argument lets the checker publish settled panels while others load.
            // Text-only consumers (preview/generate) retain the existing progress contract.
            onProgress(`Получаем данные панелей: ${reportPanels.length}…`,
                { panels: reportPanels, completed: 0, total: reportPanels.length });
            reportPanels.forEach(panel => setPanelDataStatus(panel, null));
            let completedPanels = 0;
            const snapshots = await Promise.all(reportPanels.map(async panel => {
                transport.throwIfAborted(signal);
                const snapshot = await transport.requestPanelSnapshot(panel, signal);
                transport.throwIfAborted(signal);
                completedPanels += 1;
                setPanelDataStatus(panel, snapshot);
                onProgress(`Получаем данные панелей: ${completedPanels} из ${reportPanels.length}…`,
                    { panels: reportPanels, panel, snapshot, completed: completedPanels, total: reportPanels.length });
                return snapshot;
            }));
            transport.throwIfAborted(signal);
            if (initialContext !== contextSignature()) throw new Error('Параметры дашборда изменились во время сбора. Обновите данные сообщения.');
            const timeContext = getTimeContext();
            const generatedTime = new Date();
            const context = {
                profileName: profile?.name || '',
                period: reportPeriod || documentRef.getElementById('timePickerLabel')?.textContent?.trim() || `${timeContext.from} - ${timeContext.to}`,
                generatedAt: generatedTime.toLocaleString('ru-RU', {
                    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                })
            };
            const profileContext = reportEngine.normalizeProfile(profile.report).context;
            Object.assign(context, profileContext, {
                testDuration: reportEngine.formatDuration(profileContext.testStartedAt, generatedTime),
                stableLoadDuration: reportEngine.formatDuration(profileContext.stableLoadStartedAt, generatedTime)
            });
            const panelResults = reportPanels.map((panel, index) => {
                const rendered = reportEngine.renderPanel(panel, snapshots[index], context);
                return { ...rendered, key: reportEngine.normalizePanel(panel.report, panel).key, panel, snapshot: snapshots[index] };
            });
            const problems = panelResults.filter(item => ['unavailable', 'timeout', 'no_data', 'error', 'configuration_error'].includes(item.snapshot?.state));
            const output = reportEngine.compose(profile, panelResults, context);
            return { profile, reportPanels, snapshots, context, panelResults, problems, output };
        };

        const testRunner = testRunnerFactory.create({
            reportEngine,
            auditEngine,
            collect: (signal, onProgress) => collect(signal, onProgress, { requirePanels: false })
        });

        const generate = async (output, status, warnings, signal = null, { requirePanels = true } = {}) => {
            const collected = await collect(signal, message => {
                if (status.isConnected) status.textContent = message;
            }, { requirePanels });
            const { reportPanels, problems } = collected;
            warnings.textContent = problems.map(item => `${item.snapshot.dataStatus === 'configuration_error' ? 'Настройки сообщения — ' : ''}${item.panel.title || 'Панель'}: ${item.snapshot.error || 'данные недоступны'}`).join('\n');
            warnings.hidden = !problems.length;
            output.value = collected.output;
            status.textContent = `Готово. Обработано панелей: ${reportPanels.length}; предупреждений: ${problems.length}.`;
            globalThis.DashBridgeAnalytics?.outcome('dashbridge.report_generated',
                problems.length ? 'partial' : 'success', {
                    countBucket: globalThis.DashBridgeAnalytics.bucket(reportPanels.length)
                });
            return collected;
        };

        const openPreview = () => {
            if (activePreview?.isConnected) {
                activePreview.querySelector('.report-close')?.focus();
                return;
            }
            const overlay = documentRef.createElement('div');
            overlay.className = 'modal-overlay report-preview-overlay';
            overlay.innerHTML = `<section class="modal-content report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="reportPreviewTitle">
                <div class="report-preview-header"><div><h3 id="reportPreviewTitle">Сводное сообщение</h3><p>Текст и изображение отправляются отдельно.</p></div><div class="report-preview-header-actions"><button type="button" class="btn btn-outline report-regenerate">Обновить данные</button><button type="button" class="btn btn-outline report-close">Закрыть</button></div></div>
                <div class="report-preview-tabs" role="tablist" aria-label="Содержимое сообщения">
                    <button type="button" role="tab" id="reportTextTab" aria-controls="reportTextPanel" aria-selected="true">Текст</button>
                    <button type="button" role="tab" id="reportImagesTab" aria-controls="reportImagesPanel" aria-selected="false" tabindex="-1">Скриншоты</button>
                </div>
                <button type="button" class="btn btn-primary report-combined">Сформировать текст и скриншоты</button>
                <div id="reportTextPanel" class="report-text-panel" role="tabpanel" aria-labelledby="reportTextTab">
                <div class="report-text-body">
                <div class="report-preview-status" role="status">Подготовка…</div>
                <div class="report-preview-warnings" role="status" hidden></div>
                <textarea class="report-preview-output" aria-label="Сформированное сообщение"></textarea>
                <details class="report-generated-draft" hidden><summary>Данные обновлены - посмотреть новый текст</summary>
                    <p>Ваши правки сохранены в поле выше. Новый вариант можно применить отдельно.</p>
                    <textarea class="report-generated-output" readonly aria-label="Новый сформированный вариант"></textarea>
                    <button type="button" class="btn btn-outline report-apply-generated">Использовать новый текст</button>
                </details>
                </div>
                <div class="report-preview-footer"><button type="button" class="btn btn-primary report-copy">Копировать текст</button></div>
                </div>
                <div id="reportImagesPanel" class="report-attachments-host" role="tabpanel" aria-labelledby="reportImagesTab" hidden></div>
            </section>`;
            documentRef.body.appendChild(overlay); overlay.style.display = 'flex';
            activePreview = overlay;
            const output = overlay.querySelector('.report-preview-output');
            const status = overlay.querySelector('.report-preview-status');
            const warnings = overlay.querySelector('.report-preview-warnings');
            const regenerate = overlay.querySelector('.report-regenerate');
            const combined = overlay.querySelector('.report-combined');
            combined.hidden = !beginReport;
            const copy = overlay.querySelector('.report-copy');
            const generatedDraft = overlay.querySelector('.report-generated-draft');
            const generatedOutput = overlay.querySelector('.report-generated-output');
            let lastGenerated = '';
            const syncCopy = () => { copy.disabled = !output.value.trim(); };
            output.addEventListener('input', syncCopy);
            overlay.querySelector('.report-apply-generated').addEventListener('click', () => {
                output.value = generatedOutput.value;
                lastGenerated = output.value;
                generatedDraft.hidden = true;
                syncCopy(); output.focus();
            });
            syncCopy();
            const tabs = [...overlay.querySelectorAll('[role="tab"]')];
            let verifyCapturedReport = null;
            const selectTab = index => {
                tabs.forEach((tab, current) => {
                    tab.setAttribute('aria-selected', String(current === index));
                    tab.tabIndex = current === index ? 0 : -1;
                    overlay.querySelector('#' + tab.getAttribute('aria-controls')).hidden = current !== index;
                });
            };
            tabs.forEach((tab, index) => {
                tab.addEventListener('click', () => selectTab(index));
                tab.addEventListener('keydown', event => {
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                        : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
                    if (next === null) return;
                    event.preventDefault(); selectTab(next); tabs[next].focus();
                });
            });
            const previewProfileId = getActiveProfile()?.id;
            const attachments = attachmentsFactory?.create({
                preferences: reportEngine.normalizeProfile(getActiveProfile()?.report).attachments,
                onPreferencesChange: async preferences => {
                    const profile = getActiveProfile();
                    if (!profile || profile.systemKey === 'dashbridge' || profile.id !== previewProfileId || !saveProfiles) return;
                    profile.panels = getPanels();
                    profile.report = { ...profile.report, attachments: preferences };
                    const saved = await saveProfiles();
                    if (saved?.error) throw new Error(saved.error);
                },
                host: overlay.querySelector('.report-attachments-host'), overlay,
                getPanels: () => reportEngine.orderPanels(getPanels(), reportEngine.normalizeProfile(getActiveProfile()?.report).panelOrder),
                getContext: () => ({
                    profileId: getActiveProfile()?.id, name: getActiveProfile()?.name,
                    time: getTimeContext(),
                    period: documentRef.getElementById('timePickerLabel')?.textContent?.trim(),
                    panels: getPanels().map(panel => ({ id: panel.id, src: panel.src, title: panel.title,
                        paused: panel.paused, tools: panel.tools, grafanaTheme: panel.grafanaTheme, report: panel.report,
                        frameSrc: getReportFrameSource(documentRef.getElementById('iframe-' + panel.id)) }))
                }),
                captureSelection: async (selected, options) => {
                    const captured = await captureSelection(selected, { ...options,
                        waitForData: async (panel, signal) => {
                            const snapshot = await transport.requestPanelSnapshot({ ...panel,
                                report: { ...panel.report, sla: { source: 'none', evaluation: 'latest' } } }, signal);
                            transport.throwIfAborted(signal);
                            if (!['ok', 'no_threshold', 'critical', 'warning', 'breached'].includes(snapshot?.state)) {
                                throw new Error(snapshot?.error || snapshot?.dataStatusText || 'Данные панели для скриншота не готовы.');
                            }
                        }
                    });
                    await verifyCapturedReport?.(options.signal);
                    return captured;
                }, collage, copyImage, documentRef,
                requestReport: beginReport ? () => run(true) : null
            });
            let running = false;
            let runController = null;
            const run = async (withImages = false) => {
                if (running) return;
                running = true;
                runController = new AbortController();
                const controller = runController;
                const deadline = withImages ? setTimer(() => controller.abort(), 240_000) : null;
                regenerate.disabled = true;
                combined.disabled = true;
                attachments?.setCollecting(true);
                warnings.hidden = true;
                warnings.textContent = '';
                let lease = null;
                try {
                    if (withImages) {
                        status.textContent = 'Фиксируем период и загружаем панели без автообновления…';
                        lease = beginReport({ signal: controller.signal });
                        reportPeriod = lease.period;
                        await lease.ready;
                        transport.throwIfAborted(controller.signal);
                    }
                    for (let attempt = 0; attempt < (withImages ? 2 : 1); attempt += 1) {
                        const candidate = { value: '' };
                        const collected = await generate(candidate, status, warnings, controller.signal,
                            { requirePanels: !withImages });
                        if (output.value !== lastGenerated) {
                            generatedOutput.value = candidate.value;
                            generatedDraft.hidden = false;
                            status.textContent += ' Ваши правки сохранены; новый вариант доступен ниже.';
                        } else {
                            output.value = candidate.value;
                            lastGenerated = candidate.value;
                            generatedDraft.hidden = true;
                        }
                        syncCopy();
                        attachments?.setReport(collected);
                        if (withImages) {
                            verifyCapturedReport = async signal => {
                                const current = await Promise.all(collected.reportPanels.map(panel => transport.requestPanelSnapshot(panel, signal)));
                                if (JSON.stringify(current) !== JSON.stringify(collected.snapshots)) {
                                    const error = new Error('Данные изменились во время снимков. Коллаж отклонён; сформируйте общий отчёт заново.');
                                    error.code = 'REPORT_CHANGED';
                                    throw error;
                                }
                            };
                            attachments?.setCollecting(false);
                            selectTab(1);
                            const outcome = await attachments?.captureReport(controller.signal);
                            if (outcome?.error?.code === 'REPORT_CHANGED' && attempt === 0) {
                                status.textContent = 'Графики обновились. Повторяем общий сбор в том же периоде…';
                                continue;
                            }
                        }
                        break;
                    }
                }
                catch (error) {
                    globalThis.DashBridgeAnalytics?.outcome('dashbridge.report_generated',
                        error?.name === 'AbortError' ? 'cancelled' : 'error');
                    if (error?.name !== 'AbortError' && status.isConnected) status.textContent = error.message || String(error);
                }
                finally {
                    if (deadline !== null) clearTimer(deadline);
                    verifyCapturedReport = null;
                    lease?.release();
                    reportPeriod = null;
                    if (runController === controller) {
                        runController = null;
                        running = false;
                        if (regenerate.isConnected) regenerate.disabled = false;
                        if (combined.isConnected) combined.disabled = false;
                        attachments?.setCollecting(false);
                    }
                }
            };
            const close = () => {
                root.removeEventListener?.('pagehide', close);
                runController?.abort();
                attachments?.stop();
                if (activePreview === overlay) {
                    activePreview = null;
                    closeActivePreview = null;
                }
                overlay.remove();
            };
            closeActivePreview = close;
            root.addEventListener?.('pagehide', close, { once: true });
            overlay.querySelector('.report-close').addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            regenerate.addEventListener('click', () => { void run(); });
            combined.addEventListener('click', () => { void run(true); });
            overlay.querySelector('.report-copy').addEventListener('click', async event => {
                const button = event.currentTarget;
                try {
                    await navigatorRef.clipboard.writeText(output.value); button.textContent = 'Скопировано';
                    globalThis.DashBridgeAnalytics?.outcome('dashbridge.report_copied', 'success');
                }
                catch {
                    button.textContent = 'Ошибка копирования';
                    globalThis.DashBridgeAnalytics?.outcome('dashbridge.report_copied', 'error');
                }
                setTimer(() => { if (button.isConnected) button.textContent = 'Копировать текст'; }, 1800);
            });
            void run();
        };

        const invalidateProfileContext = () => closeActivePreview?.();

        return Object.freeze({ transport, testRunner, collect, generate, openPreview,
            invalidateProfileContext, getEffectivePanelSla, setPanelDataStatus });
    }

    root.DashBridgeReportController = Object.freeze({ create });
})(globalThis);
