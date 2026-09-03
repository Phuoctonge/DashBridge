(function initDashBridgePanelToolsController(root) {
    'use strict';

    function create({ postToDashboardFrame, getCapturePrepared, getTransformSettings,
        getDefaultCpuCapacityCoefficient, normalizePanelMetadataText, savePanels,
        forceLoadPanel, refreshPanel, settingsStorage, getSettingsKeys, normalizeSettings,
        panelAnalysis, settingsModal, escapeHtml, documentRef = document, cssEscape = CSS.escape,
        setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), random = () => Math.random() }) {
        if (typeof postToDashboardFrame !== 'function' || typeof getCapturePrepared !== 'function'
            || typeof getTransformSettings !== 'function' || typeof getDefaultCpuCapacityCoefficient !== 'function'
            || typeof normalizePanelMetadataText !== 'function' || typeof savePanels !== 'function'
            || typeof forceLoadPanel !== 'function' || typeof refreshPanel !== 'function'
            || !settingsStorage?.get || typeof getSettingsKeys !== 'function' || typeof normalizeSettings !== 'function'
            || !settingsModal?.open) {
            throw new TypeError('DashBridge panel tools controller dependencies are incomplete');
        }

        const legendWaiters = new Map();
        const thresholdWaiters = new Map();
        const thresholdStates = new Map();
        const titleWaiters = new Map();
        const appliedWaiters = new Map();
        const analyticsFeatures = Object.freeze({
            removeFill: 'grafana.panel.fill_removed', thickenLines: 'grafana.panel.lines_thickened',
            invertLegend: 'grafana.panel.legend_inverted', invertIdle: 'grafana.panel.cpu_idle_to_load',
            convertMemToUsed: 'grafana.panel.ram_to_used', forceMemByteUnit: 'grafana.panel.ram_force_byte_unit',
            seriesQueryFilterEnabled: 'grafana.panel.series_value_filter',
            seriesQueryFilterHighlightEnabled: 'grafana.panel.series_highlight',
            cpuCapacityFilterEnabled: 'grafana.panel.load_cpu_capacity_filter',
            cpuCapacityFilterHighlightEnabled: 'grafana.panel.load_cpu_capacity_highlight',
            cpuCapacityFilterLoad1: 'grafana.panel.load_series_1m', cpuCapacityFilterLoad5: 'grafana.panel.load_series_5m',
            cpuCapacityFilterLoad15: 'grafana.panel.load_series_15m', thresholdEnabled: 'grafana.panel.threshold',
            thresholdNotifyEnabled: 'grafana.panel.threshold_notification', capturePrepared: 'grafana.panel.compact_capture'
        });

        const normalizeTools = panel => {
            const saved = panel.tools || {};
            const isMemoryPanel = /\b(?:memory|ram)\b|памят/i.test(String(panel.title || ''));
            const hasResponseSeriesFilter = saved.seriesFilterSettingsVersion === 2;
            const keepCompleteHideSelection = saved.legendMode === 'fast_complete_hide';
            return {
                removeFill: !!saved.removeFill,
                thickenLines: !!saved.thickenLines,
                thickenLinesValue: saved.thickenLinesValue !== undefined ? Number(saved.thickenLinesValue) : 1.5,
                invertLegend: !!saved.invertLegend,
                capturePrepared: getCapturePrepared(),
                legendFilter: keepCompleteHideSelection && Array.isArray(saved.legendFilter) ? saved.legendFilter : [],
                legendSelectionVersion: keepCompleteHideSelection && Number(saved.legendSelectionVersion) === 2 ? 2 : null,
                legendVisibleSeries: keepCompleteHideSelection && Array.isArray(saved.legendVisibleSeries) ? saved.legendVisibleSeries : [],
                legendSelectFilter: keepCompleteHideSelection && typeof saved.legendSelectFilter === 'string' ? saved.legendSelectFilter : '',
                legendIgnoreFilter: keepCompleteHideSelection && typeof saved.legendIgnoreFilter === 'string' ? saved.legendIgnoreFilter : '',
                legendMode: 'fast_complete_hide',
                invertIdle: !!saved.invertIdle,
                convertMemToUsed: !!saved.convertMemToUsed,
                forceMemByteUnit: !!saved.forceMemByteUnit || (!saved.convertMemToUsed && isMemoryPanel),
                seriesQueryFilterEnabled: hasResponseSeriesFilter && !!saved.seriesQueryFilterEnabled && !saved.cpuCapacityFilterEnabled,
                seriesQueryFilterHighlightEnabled: saved.seriesQueryFilterHighlightEnabled !== false,
                seriesQueryFilterValue: Number.isFinite(Number(saved.seriesQueryFilterValue)) ? Number(saved.seriesQueryFilterValue) : 0,
                seriesQueryFilterRawValue: Number.isFinite(Number(saved.seriesQueryFilterRawValue))
                    && saved.seriesQueryFilterRawValue !== null && saved.seriesQueryFilterRawValue !== ''
                    ? Number(saved.seriesQueryFilterRawValue) : null,
                seriesQueryFilterInputUnit: normalizePanelMetadataText(saved.seriesQueryFilterInputUnit, 32),
                seriesQueryFilterMode: saved.seriesQueryFilterMode === 'last' ? 'last' : 'max',
                cpuCapacityFilterEnabled: !!saved.cpuCapacityFilterEnabled,
                cpuCapacityFilterHighlightEnabled: saved.cpuCapacityFilterHighlightEnabled !== false,
                cpuCapacityFilterCoefficient: Number.isFinite(Number(saved.cpuCapacityFilterCoefficient))
                    && Number(saved.cpuCapacityFilterCoefficient) > 0
                    ? Number(saved.cpuCapacityFilterCoefficient) : getDefaultCpuCapacityCoefficient(),
                cpuCapacityFilterMode: saved.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
                cpuCapacityFilterLoad1: saved.cpuCapacityFilterLoad1 !== false,
                cpuCapacityFilterLoad5: saved.cpuCapacityFilterLoad5 === true,
                cpuCapacityFilterLoad15: saved.cpuCapacityFilterLoad15 === true,
                thresholdEnabled: !!saved.thresholdEnabled,
                thresholdNotifyEnabled: saved.thresholdNotifyEnabled !== false,
                thresholdValue: Number(saved.thresholdValue) || 0,
                thresholdRawValue: Number.isFinite(Number(saved.thresholdRawValue))
                    && saved.thresholdRawValue !== null && saved.thresholdRawValue !== ''
                    ? Number(saved.thresholdRawValue) : null,
                thresholdInputUnit: normalizePanelMetadataText(saved.thresholdInputUnit, 32),
                thresholdUnit: normalizePanelMetadataText(saved.thresholdUnit)
            };
        };

        const apply = (panel, iframe) => {
            const tools = normalizeTools(panel);
            const requestId = `panel-tools-${now()}-${random().toString(36).slice(2)}`;
            appliedWaiters.set(requestId, Object.entries(analyticsFeatures)
                .filter(([key]) => tools[key] === true).map(([, featureId]) => featureId));
            setTimer(() => appliedWaiters.delete(requestId), 25_000);
            return postToDashboardFrame(iframe, {
                action: 'applyPanelTools', requestId, tools, transformSettings: getTransformSettings()
            });
        };

        const acceptApplied = message => {
            const features = appliedWaiters.get(message?.requestId);
            if (!features || !['applied', 'error'].includes(message?.commandStatus)) return false;
            appliedWaiters.delete(message.requestId);
            features.forEach(featureId => root.DashBridgeAnalytics?.track(featureId,
                message.commandStatus === 'applied' ? 'effective' : 'outcome', {
                    surface: 'dashbridge', outcome: message.commandStatus === 'applied' ? 'success' : 'error'
                }));
            return true;
        };

        const requestTitle = (panel, iframe) => {
            if (!panel || !iframe) return Promise.resolve('');
            const requestId = `panel-title-${panel.id}-${now()}-${random().toString(36).slice(2)}`;
            return new Promise(resolve => {
                const timeout = setTimer(() => {
                    titleWaiters.delete(requestId);
                    resolve('');
                }, 1000);
                titleWaiters.set(requestId, title => {
                    clearTimer(timeout);
                    titleWaiters.delete(requestId);
                    resolve(title);
                });
                if (!postToDashboardFrame(iframe, { action: 'getDashbridgePanelTitle', requestId })) {
                    clearTimer(timeout);
                    titleWaiters.delete(requestId);
                    resolve('');
                }
            });
        };

        const ensureNotifications = () => {
            let container = documentRef.getElementById('dashbridgeThresholdNotifications');
            if (!container) {
                container = documentRef.createElement('div');
                container.id = 'dashbridgeThresholdNotifications';
                container.setAttribute('aria-live', 'polite');
                documentRef.body.appendChild(container);
            }
            return container;
        };

        const updateThresholdStatus = (panel, status) => {
            const panelId = cssEscape(panel.id);
            const card = documentRef.querySelector(`.panel-card[data-panel-id="${panelId}"]`);
            const previous = thresholdStates.get(panel.id) || { exceeded: false, dismissed: false };
            const currentTools = panel.tools || {};
            const rawFromStatus = status?.rawThreshold !== null && status?.rawThreshold !== ''
                && Number.isFinite(Number(status?.rawThreshold)) ? Number(status.rawThreshold) : null;
            const storedRaw = Number.isFinite(Number(currentTools.thresholdRawValue))
                && currentTools.thresholdRawValue !== null ? Number(currentTools.thresholdRawValue) : rawFromStatus;
            const factor = Number(status?.factor);
            const displayedValue = Number.isFinite(storedRaw) && Number.isFinite(factor) && factor > 0
                ? storedRaw / factor : currentTools.thresholdValue;
            const safeStatusUnit = normalizePanelMetadataText(status?.unit);
            if ((safeStatusUnit && currentTools.thresholdUnit !== safeStatusUnit)
                || (Number.isFinite(storedRaw) && currentTools.thresholdRawValue !== storedRaw)
                || (Number.isFinite(displayedValue) && currentTools.thresholdValue !== displayedValue)) {
                panel.tools = {
                    ...currentTools,
                    thresholdUnit: safeStatusUnit || normalizePanelMetadataText(currentTools.thresholdUnit),
                    thresholdRawValue: Number.isFinite(storedRaw) ? storedRaw : currentTools.thresholdRawValue,
                    thresholdValue: Number.isFinite(displayedValue) ? displayedValue : currentTools.thresholdValue
                };
                savePanels();
            }
            const exceeded = !!status?.enabled && !!status?.exceeded;
            card?.classList.toggle('threshold-exceeded', exceeded);
            if (!exceeded) {
                thresholdStates.set(panel.id, { exceeded: false, dismissed: false });
                return;
            }
            if (status?.thresholdNotifyEnabled === false) {
                documentRef.querySelector(`.threshold-notification[data-panel-id="${panelId}"]`)?.remove();
                thresholdStates.set(panel.id, { exceeded: false, dismissed: false });
                return;
            }
            if (previous.exceeded || previous.dismissed) {
                thresholdStates.set(panel.id, { ...previous, exceeded: true });
                return;
            }
            thresholdStates.set(panel.id, { exceeded: true, dismissed: false });
            const notice = documentRef.createElement('div');
            notice.className = 'threshold-notification';
            notice.dataset.panelId = panel.id;
            notice.innerHTML = `
                <strong>${escapeHtml(status.panelTitle || 'Панель Grafana')}</strong>
                <button type="button" aria-label="Закрыть">×</button>
                <span class="threshold-notification-status">Порог превышен</span>`;
            notice.querySelector('button').addEventListener('click', () => {
                notice.remove();
                thresholdStates.set(panel.id, { exceeded: true, dismissed: true });
            });
            ensureNotifications().appendChild(notice);
        };

        const requestLegendSeries = (panel, iframe) => new Promise(resolve => {
            const timer = setTimer(() => { legendWaiters.delete(panel.id); resolve([]); }, 2500);
            legendWaiters.set(panel.id, series => { clearTimer(timer); resolve(series); });
            if (!postToDashboardFrame(iframe, { action: 'getPanelLegendSeries', requestId: panel.id })) {
                clearTimer(timer); legendWaiters.delete(panel.id); resolve([]);
            }
        });

        const requestThresholdStatus = (panel, iframe) => new Promise(resolve => {
            const timer = setTimer(() => { thresholdWaiters.delete(panel.id); resolve(null); }, 1500);
            thresholdWaiters.set(panel.id, status => { clearTimer(timer); resolve(status); });
            if (!postToDashboardFrame(iframe, {
                action: 'getPanelThresholdStatus', requestId: panel.id, threshold: normalizeTools(panel)
            })) {
                clearTimer(timer); thresholdWaiters.delete(panel.id); resolve(null);
            }
        });

        const formatThresholdUnit = status => {
            if (status?.unit) return `Единица: ${status.unit}`;
            if (status?.engine && status.engine !== 'unknown') return 'Без единицы';
            return 'Единица определяется по графику';
        };

        const open = async (panel, iframe) => {
            const tools = normalizeTools(panel);
            const storedSettings = await settingsStorage.get(getSettingsKeys());
            const panelSettings = normalizeSettings(storedSettings);
            let resolvedTitle = panel.title;
            let panelKind = panelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
            if (!panelKind) {
                const liveTitle = await requestTitle(panel, iframe);
                resolvedTitle = normalizePanelMetadataText(liveTitle, 240) || resolvedTitle;
                panelKind = panelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
            }
            if (resolvedTitle && panel.title !== resolvedTitle) {
                panel.title = resolvedTitle;
                savePanels();
            }
            return settingsModal.open({
                state: tools,
                content: `${settingsModal.transformFields(tools, { panelKind })}${settingsModal.thresholdFields(tools)}${settingsModal.legendFields(tools.legendMode, tools)}`,
                advanced: {
                    cpuCapacityFilterCoefficientDefault: panelSettings.grafanaCpuCapacityCoefficient,
                    getLegendSeries: () => requestLegendSeries(panel, iframe),
                    getThresholdStatus: () => requestThresholdStatus(panel, iframe),
                    formatThresholdUnit
                },
                onSave: nextTools => {
                    const previousTools = normalizeTools(panel);
                    nextTools.forceMemByteUnit = nextTools.convertMemToUsed
                        ? false : (previousTools.convertMemToUsed || previousTools.forceMemByteUnit);
                    panel.tools = nextTools;
                    Object.entries(analyticsFeatures).forEach(([key, featureId]) => {
                        if (!!previousTools[key] !== !!nextTools[key]) {
                            root.DashBridgeAnalytics?.changed(featureId, !!nextTools[key], { surface: 'dashbridge' });
                        }
                    });
                    const previousLegend = JSON.stringify(previousTools.legendVisibleSeries || []);
                    const nextLegend = JSON.stringify(nextTools.legendVisibleSeries || []);
                    if (previousLegend !== nextLegend) root.DashBridgeAnalytics?.changed(
                        'grafana.panel.legend_selection', !!nextTools.legendVisibleSeries?.length, { surface: 'dashbridge' });
                    savePanels();
                    const liveApplyKeys = ['thresholdEnabled', 'thresholdNotifyEnabled', 'thresholdValue', 'thresholdRawValue', 'thresholdInputUnit', 'thresholdUnit'];
                    const liveApplyOnlyChange = liveApplyKeys.some(key => previousTools[key] !== nextTools[key])
                        && Object.keys(nextTools).filter(key => !liveApplyKeys.includes(key))
                            .every(key => JSON.stringify(previousTools[key]) === JSON.stringify(nextTools[key]));
                    if (liveApplyOnlyChange) {
                        const targetIframe = forceLoadPanel(panel.id);
                        if (targetIframe) void apply(panel, targetIframe);
                    } else {
                        refreshPanel(panel.id);
                    }
                }
            });
        };

        const acceptTitleResponse = message => {
            const resolve = titleWaiters.get(message?.requestId);
            if (!resolve) return false;
            resolve(normalizePanelMetadataText(message.title, 240));
            return true;
        };
        const acceptLegendSeries = (message, panel) => {
            const resolve = panel && legendWaiters.get(message?.requestId);
            if (!resolve || panel.id !== message.requestId) return false;
            legendWaiters.delete(message.requestId);
            resolve(Array.isArray(message.series) ? message.series : []);
            return true;
        };
        const acceptThresholdStatus = (message, panel) => {
            const resolve = panel && thresholdWaiters.get(message?.requestId);
            if (resolve && panel.id === message.requestId) {
                thresholdWaiters.delete(message.requestId);
                const safeStatusUnit = normalizePanelMetadataText(message.status?.unit);
                if (safeStatusUnit && panel.tools?.thresholdUnit !== safeStatusUnit) {
                    panel.tools = { ...panel.tools, thresholdUnit: safeStatusUnit };
                    savePanels();
                }
                resolve(message.status || null);
                return true;
            }
            if (panel) updateThresholdStatus(panel, message?.status);
            return !!panel;
        };
        const removePanel = panelId => {
            thresholdStates.delete(panelId);
            documentRef.querySelector(`.threshold-notification[data-panel-id="${cssEscape(panelId)}"]`)?.remove();
        };

        return Object.freeze({ normalizeTools, apply, open, acceptApplied, acceptTitleResponse, acceptLegendSeries,
            acceptThresholdStatus, updateThresholdStatus, removePanel });
    }

    root.DashBridgePanelToolsController = Object.freeze({ create });
})(globalThis);
