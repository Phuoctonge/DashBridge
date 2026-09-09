(function initDashBridgeReportController(root) {
    'use strict';

    const FRAME_TIMEOUT_MS = 90_000;
    const TOTAL_TIMEOUT_MS = 125_000;

    function create({ reportEngine, transportFactory, testRunnerFactory, auditEngine,
        forceLoadPanel, postToDashboardFrame, getPanels, getActiveProfile, getTimeContext,
        attachmentsFactory = null, captureSelection = null, collage = null, copyImage = null,
        documentRef = document, navigatorRef = navigator, setTimer = setTimeout }) {
        if (!reportEngine?.normalizePanel || !reportEngine?.orderPanels
            || !transportFactory?.create || !testRunnerFactory?.create
            || typeof forceLoadPanel !== 'function' || typeof postToDashboardFrame !== 'function'
            || typeof getPanels !== 'function' || typeof getActiveProfile !== 'function'
            || typeof getTimeContext !== 'function') {
            throw new TypeError('DashBridge report controller dependencies are incomplete');
        }
        let activePreview = null;
        let closeActivePreview = null;

        const getEffectivePanelSla = panel => {
            const config = reportEngine.normalizePanel(panel.report, panel);
            if (config.sla.source === 'graph') {
                if (!panel.tools?.thresholdEnabled) return { error: 'Порог на графике выключен.' };
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
            const parentKinds = new Set(['timeout', 'iframe_unavailable', 'request_error', 'configuration_error']);
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
            const profile = getActiveProfile();
            const reportPanels = reportEngine.orderPanels(
                getPanels(), reportEngine.normalizeProfile(profile?.report).panelOrder
            ).filter(panel => reportEngine.normalizePanel(panel.report, panel).enabled);
            if (requirePanels && !reportPanels.length) throw new Error('В настройках сообщения не выбрана ни одна панель.');
            onProgress(`Получаем данные панелей: ${reportPanels.length}…`);
            reportPanels.forEach(panel => setPanelDataStatus(panel, null));
            let completedPanels = 0;
            const snapshots = await Promise.all(reportPanels.map(async panel => {
                transport.throwIfAborted(signal);
                const snapshot = await transport.requestPanelSnapshot(panel, signal);
                completedPanels += 1;
                setPanelDataStatus(panel, snapshot);
                onProgress(`Получаем данные панелей: ${completedPanels} из ${reportPanels.length}…`);
                return snapshot;
            }));
            transport.throwIfAborted(signal);
            const timeContext = getTimeContext();
            const context = {
                period: documentRef.getElementById('timePickerLabel')?.textContent?.trim() || `${timeContext.from} — ${timeContext.to}`,
                generatedAt: new Date().toLocaleString('ru-RU')
            };
            const profileContext = reportEngine.normalizeProfile(profile.report).context;
            Object.assign(context, profileContext, {
                testDuration: reportEngine.formatDuration(profileContext.testStartedAt),
                stableLoadDuration: reportEngine.formatDuration(profileContext.stableLoadStartedAt)
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

        const generate = async (output, status, warnings, signal = null) => {
            const collected = await collect(signal, message => {
                if (status.isConnected) status.textContent = message;
            });
            const { reportPanels, problems } = collected;
            warnings.textContent = problems.map(item => `${item.panel.title || 'Панель'}: ${item.snapshot.error || 'данные недоступны'}`).join('\n');
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
                <div class="report-preview-header"><div><h3 id="reportPreviewTitle">Сводное сообщение</h3><p>Текст и изображение отправляются отдельно.</p></div><button type="button" class="btn btn-outline report-close">Закрыть</button></div>
                <div class="report-preview-tabs" role="tablist" aria-label="Содержимое сообщения">
                    <button type="button" role="tab" id="reportTextTab" aria-controls="reportTextPanel" aria-selected="true">Текст</button>
                    <button type="button" role="tab" id="reportImagesTab" aria-controls="reportImagesPanel" aria-selected="false" tabindex="-1">Скриншоты</button>
                </div>
                <div id="reportTextPanel" class="report-text-panel" role="tabpanel" aria-labelledby="reportTextTab">
                <div class="report-text-body">
                <div class="report-preview-status" role="status">Подготовка…</div>
                <div class="report-preview-warnings" hidden></div>
                <textarea class="report-preview-output" aria-label="Сформированное сообщение"></textarea>
                </div>
                <div class="report-preview-footer"><button type="button" class="btn btn-outline report-regenerate">Обновить данные</button><button type="button" class="btn btn-primary report-copy">Копировать текст</button></div>
                </div>
                <div id="reportImagesPanel" class="report-attachments-host" role="tabpanel" aria-labelledby="reportImagesTab" hidden></div>
            </section>`;
            documentRef.body.appendChild(overlay); overlay.style.display = 'flex';
            activePreview = overlay;
            const output = overlay.querySelector('.report-preview-output');
            const status = overlay.querySelector('.report-preview-status');
            const warnings = overlay.querySelector('.report-preview-warnings');
            const regenerate = overlay.querySelector('.report-regenerate');
            const tabs = [...overlay.querySelectorAll('[role="tab"]')];
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
            const attachments = attachmentsFactory?.create({
                host: overlay.querySelector('.report-attachments-host'), overlay,
                getPanels: () => reportEngine.orderPanels(getPanels(), reportEngine.normalizeProfile(getActiveProfile()?.report).panelOrder),
                getContext: () => ({
                    profileId: getActiveProfile()?.id, name: getActiveProfile()?.name,
                    time: getTimeContext(),
                    period: documentRef.getElementById('timePickerLabel')?.textContent?.trim(),
                    panels: getPanels().map(panel => ({ id: panel.id, src: panel.src, title: panel.title,
                        paused: panel.paused, tools: panel.tools, grafanaTheme: panel.grafanaTheme, report: panel.report,
                        frameSrc: documentRef.getElementById('iframe-' + panel.id)?.src }))
                }),
                captureSelection, collage, copyImage, documentRef
            });
            let running = false;
            let runController = null;
            const run = async () => {
                if (running) return;
                running = true;
                runController = new AbortController();
                const controller = runController;
                regenerate.disabled = true;
                attachments?.setCollecting(true);
                warnings.hidden = true;
                warnings.textContent = '';
                try {
                    const collected = await generate(output, status, warnings, controller.signal);
                    attachments?.setReport(collected);
                }
                catch (error) {
                    globalThis.DashBridgeAnalytics?.outcome('dashbridge.report_generated',
                        error?.name === 'AbortError' ? 'cancelled' : 'error');
                    if (error?.name !== 'AbortError' && status.isConnected) status.textContent = error.message || String(error);
                }
                finally {
                    if (runController === controller) {
                        runController = null;
                        running = false;
                        if (regenerate.isConnected) regenerate.disabled = false;
                        attachments?.setCollecting(false);
                    }
                }
            };
            const close = () => {
                runController?.abort();
                attachments?.stop();
                if (activePreview === overlay) {
                    activePreview = null;
                    closeActivePreview = null;
                }
                overlay.remove();
            };
            closeActivePreview = close;
            overlay.querySelector('.report-close').addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            regenerate.addEventListener('click', run);
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
