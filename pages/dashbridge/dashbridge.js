let profiles = [];
let activeProfileId = null;
let panels = []; // Всегда синхронизирован с активным профилем
let dashBridgeTimeController = null;

function loadActiveProfileTimeState() {
    return dashBridgeTimeController.loadProfileState();
}

function syncTimeControlsFromState() {
    return dashBridgeTimeController.syncControls();
}
const { showAlert, showConfirm, showPrompt } = window.DashBridgeModal;
const {
    isSupportedPanelUrl,
    normalizeGrafanaPanelUrl,
    buildDashBridgeSoloPanelUrl,
    getProfilePanelIdentity,
    parseQuickPanelIds,
} = window.DashBridgePanelUrl;
const {
    INVALID_PANELS_CODE,
    createPanelExportPayload,
    buildPanelExportFileName,
    parsePanelImportText,
} = window.DashBridgePanelTransfer;
const dashBridgeProfileController = DashBridgeProfileController.create({
    profileStore: DashBridgeProfileStore,
    timeState: DashBridgeTimeState,
    renderer: DashBridgeRenderer,
    getProfilePanelIdentity,
    showAlert,
    showConfirm,
    getProfiles: () => profiles,
    setProfiles: value => { profiles = value; },
    getActiveProfileId: () => activeProfileId,
    setActiveProfileId: value => { activeProfileId = value; },
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    loadActiveProfileTimeState,
    syncTimeControlsFromState,
    renderDashboard,
    panelFrameSignature,
    adoptPanelState,
    reconcileDashboardPanelCards,
});
const {
    getActiveProfile, loadProfiles, saveProfiles, savePanels, switchProfile, createProfile,
    renameActiveProfile, deleteProfile, renderProfileSwitcher, getCurrentProfilePanelIdentities,
    currentProfileHasPanel, setTabActiveProfileId,
} = dashBridgeProfileController;
const {
    openPanelEditor: openPanelReportEditor,
    openReportSettings,
} = window.DashBridgeReportUi.create({
    getPanels: () => panels,
    getActiveProfile,
    savePanels,
    normalizePanelMetadataText,
    escapeHtml,
});

function normalizePanelMetadataText(value, maxLength = 96) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

const {
    getFrameOrigin,
    post: postToDashboardFrame,
    navigate: navigateDashboardFrame,
} = DashBridgeFrameController;
const dashBridgePanelAnalysisController = DashBridgePanelAnalysisController.create({
    postToDashboardFrame,
    normalizePanelMetadataText,
    analysisApi: window.DashBridgeGrafanaPanelAnalysis,
});
const openDashboardPanelAnalysis = dashBridgePanelAnalysisController.open;
const closeDashboardPanelAnalysis = dashBridgePanelAnalysisController.close;

let crosshairMode = 'line';
let crosshairThickness = 1;
let grafanaTransformSettings = normalizeGrafanaSettings({});
const grafanaTransformSettingKeys = new Set(getGrafanaSettingsStorageKeys());

try {
    crosshairMode = localStorage.getItem('dashbridge_crosshairMode') || 'line';
    if (!['line', 'off'].includes(crosshairMode)) crosshairMode = 'line';
    crosshairThickness = parseInt(localStorage.getItem('dashbridge_crosshairThickness'), 10) || 1;
} catch (e) {
    console.warn("localStorage init failed:", e);
}

dashBridgeTimeController = DashBridgeTimeController.create({
    timeState: DashBridgeTimeState,
    getActiveProfile,
    saveProfiles,
    getPanels: () => panels,
    getPanelTools,
    legendSelection: window.DashBridgeGrafanaLegendSelection,
    panelBootstrap: window.DashBridgeGrafanaPanelBootstrap,
    getTransformSettings: () => grafanaTransformSettings,
    postToDashboardFrame,
    navigateDashboardFrame,
    refreshAllPanels,
});
const applyPanelParamsToUrl = dashBridgeTimeController.applyPanelParamsToUrl;
const getPanelForIframe = dashBridgeTimeController.getPanelForIframe;
const broadcastTimeUpdate = dashBridgeTimeController.broadcast;
const setupTimeControls = dashBridgeTimeController.setupControls;

// --- Drag & Drop state ---
let draggedId = null;
let draggedEl = null;
let dragTargetEl = null;
let dragDropSide = null;

// --- Fullscreen state ---
let fullscreenPanelId = null;
let defaultCapturePrepared = false;

// --- SVG-иконки ---
const SVG_GRIP = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
  <circle cx="2" cy="2"  r="1.4"/><circle cx="8" cy="2"  r="1.4"/>
  <circle cx="2" cy="7"  r="1.4"/><circle cx="8" cy="7"  r="1.4"/>
  <circle cx="2" cy="12" r="1.4"/><circle cx="8" cy="12" r="1.4"/>
</svg>`;

const SVG_EXPAND = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
  <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
  <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
  <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
</svg>`;

const SVG_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
  <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
  <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
  <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
</svg>`;

const SVG_REFRESH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
  <polyline points="21 3 21 8 16 8"/>
</svg>`;

const SVG_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/>
  <line x1="10" y1="14" x2="21" y2="3"/>
</svg>`;

const SVG_DELETE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const SVG_PANEL_SETTINGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 7h16"/><circle cx="9" cy="7" r="2"/>
  <path d="M4 17h16"/><circle cx="15" cy="17" r="2"/>
</svg>`;

const SVG_IFRAME_SETTINGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
</svg>`;

const SVG_PAUSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const SVG_RESUME = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>`;
const SVG_CAPTURE_SAVE = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.25 3h12.5L21 7.25v12.5A1.25 1.25 0 0 1 19.75 21H4.25A1.25 1.25 0 0 1 3 19.75V4.25A1.25 1.25 0 0 1 4.25 3Z"/><path d="M7 3v6.25h9.5V3M7.25 21v-7.25h9.5V21"/><path d="M14 5.25v2" stroke-width="2.25"/></svg>`;
const SVG_CAPTURE_COPY = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16.5 6V4.75A1.75 1.75 0 0 0 14.75 3h-10A1.75 1.75 0 0 0 3 4.75v10a1.75 1.75 0 0 0 1.75 1.75H6"/><rect x="6.5" y="6.5" width="14.5" height="14.5" rx="2"/><circle cx="11" cy="11" r="1.25"/><path d="m8 18 3.5-3.5 2.5 2.25 1.8-1.75 3.2 3"/></svg>`;
const SVG_MORE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
const SVG_ANALYSIS = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M3 19h18"/><circle cx="19" cy="6" r="2.5"/></svg>`;
const SVG_REPORT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 7 8 6 8-6"/></svg>`;

function getPanelTools(panel) {
    const saved = panel.tools || {};
    const isMemoryPanel = /\b(?:memory|ram)\b|памят/i.test(String(panel.title || ''));
    // Previous visual-filter settings are deliberately ignored. Only the
    // response-level filter is retained in the current panel schema.
    const hasResponseSeriesFilter = saved.seriesFilterSettingsVersion === 2;
    // The removed click-toggle mode is not migrated. Its transient native
    // visibility state was unreliable after Grafana refreshes, so old legend
    // selections are deliberately ignored instead of becoming data filters.
    const keepCompleteHideSelection = saved.legendMode === 'fast_complete_hide';
    return {
        removeFill: !!saved.removeFill,
        thickenLines: !!saved.thickenLines,
        thickenLinesValue: saved.thickenLinesValue !== undefined ? Number(saved.thickenLinesValue) : 1.5,
        invertLegend: !!saved.invertLegend,
        capturePrepared: defaultCapturePrepared,
        legendFilter: keepCompleteHideSelection && Array.isArray(saved.legendFilter) ? saved.legendFilter : [],
        legendSelectionVersion: keepCompleteHideSelection && Number(saved.legendSelectionVersion) === 2 ? 2 : null,
        legendVisibleSeries: keepCompleteHideSelection && Array.isArray(saved.legendVisibleSeries) ? saved.legendVisibleSeries : [],
        legendSelectFilter: keepCompleteHideSelection && typeof saved.legendSelectFilter === 'string' ? saved.legendSelectFilter : '',
        legendIgnoreFilter: keepCompleteHideSelection && typeof saved.legendIgnoreFilter === 'string' ? saved.legendIgnoreFilter : '',
        legendMode: 'fast_complete_hide',
        invertIdle: !!saved.invertIdle,
        convertMemToUsed: !!saved.convertMemToUsed,
        // Existing profiles may already have convertMemToUsed=false while a
        // stale percent formatter is painted. Memory-titled panels opt into
        // the byte-unit repair during migration as well.
        forceMemByteUnit: !!saved.forceMemByteUnit || (!saved.convertMemToUsed && isMemoryPanel),
        seriesQueryFilterEnabled: hasResponseSeriesFilter && !!saved.seriesQueryFilterEnabled && !saved.cpuCapacityFilterEnabled,
        seriesQueryFilterHighlightEnabled: saved.seriesQueryFilterHighlightEnabled !== false,
        seriesQueryFilterValue: Number.isFinite(Number(saved.seriesQueryFilterValue)) ? Number(saved.seriesQueryFilterValue) : 0,
        seriesQueryFilterRawValue: Number.isFinite(Number(saved.seriesQueryFilterRawValue)) && saved.seriesQueryFilterRawValue !== null && saved.seriesQueryFilterRawValue !== ''
            ? Number(saved.seriesQueryFilterRawValue)
            : null,
        seriesQueryFilterMode: saved.seriesQueryFilterMode === 'last' ? 'last' : 'max',
        cpuCapacityFilterEnabled: !!saved.cpuCapacityFilterEnabled,
        cpuCapacityFilterHighlightEnabled: saved.cpuCapacityFilterHighlightEnabled !== false,
        cpuCapacityFilterCoefficient: Number.isFinite(Number(saved.cpuCapacityFilterCoefficient)) && Number(saved.cpuCapacityFilterCoefficient) > 0
            ? Number(saved.cpuCapacityFilterCoefficient) : grafanaTransformSettings.grafanaCpuCapacityCoefficient,
        cpuCapacityFilterMode: saved.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
        cpuCapacityFilterLoad1: saved.cpuCapacityFilterLoad1 !== false,
        cpuCapacityFilterLoad5: saved.cpuCapacityFilterLoad5 === true,
        cpuCapacityFilterLoad15: saved.cpuCapacityFilterLoad15 === true,
        thresholdEnabled: !!saved.thresholdEnabled,
        thresholdNotifyEnabled: saved.thresholdNotifyEnabled !== false,
        thresholdValue: Number(saved.thresholdValue) || 0,
        thresholdRawValue: Number.isFinite(Number(saved.thresholdRawValue)) && saved.thresholdRawValue !== null && saved.thresholdRawValue !== ''
            ? Number(saved.thresholdRawValue)
            : null,
        thresholdUnit: normalizePanelMetadataText(saved.thresholdUnit)
    };
}

function applyPanelTools(panel, iframe) {
    // The cache is populated before frames are created and kept current by the
    // sync-storage listener. Re-reading the same settings once per iframe made
    // a dashboard with many panels issue a burst of duplicate IPC calls.
    return postToDashboardFrame(iframe, {
        action: 'applyPanelTools', tools: getPanelTools(panel), transformSettings: grafanaTransformSettings
    });
}

const panelLegendWaiters = new Map();
const panelThresholdWaiters = new Map();
const panelThresholdStates = new Map();
const panelTitleWaiters = new Map();

function requestPanelTitle(panel, iframe) {
    if (!panel || !iframe) return Promise.resolve('');
    const requestId = `panel-title-${panel.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            panelTitleWaiters.delete(requestId);
            resolve('');
        }, 1000);
        panelTitleWaiters.set(requestId, title => {
            clearTimeout(timeout);
            panelTitleWaiters.delete(requestId);
            resolve(title);
        });
        if (!postToDashboardFrame(iframe, { action: 'getDashbridgePanelTitle', requestId })) {
            clearTimeout(timeout);
            panelTitleWaiters.delete(requestId);
            resolve('');
        }
    });
}

function ensureThresholdNotifications() {
    let container = document.getElementById('dashbridgeThresholdNotifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'dashbridgeThresholdNotifications';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    return container;
}

function updatePanelThresholdStatus(panel, status) {
    const card = document.querySelector(`.panel-card[data-panel-id="${CSS.escape(panel.id)}"]`);
    const previous = panelThresholdStates.get(panel.id) || { exceeded: false, dismissed: false };
    const currentTools = panel.tools || {};
    const rawFromStatus = status?.rawThreshold !== null && status?.rawThreshold !== ''
        && Number.isFinite(Number(status?.rawThreshold))
        ? Number(status.rawThreshold)
        : null;
    const storedRaw = Number.isFinite(Number(currentTools.thresholdRawValue)) && currentTools.thresholdRawValue !== null
        ? Number(currentTools.thresholdRawValue)
        : rawFromStatus;
    const factor = Number(status?.factor);
    const displayedValue = Number.isFinite(storedRaw) && Number.isFinite(factor) && factor > 0
        ? storedRaw / factor
        : currentTools.thresholdValue;
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
        panelThresholdStates.set(panel.id, { exceeded: false, dismissed: false });
        return;
    }
    if (status?.thresholdNotifyEnabled === false) {
        document.querySelector(`.threshold-notification[data-panel-id="${CSS.escape(panel.id)}"]`)?.remove();
        panelThresholdStates.set(panel.id, { exceeded: false, dismissed: false });
        return;
    }
    if (previous.exceeded || previous.dismissed) {
        panelThresholdStates.set(panel.id, { ...previous, exceeded: true });
        return;
    }
    panelThresholdStates.set(panel.id, { exceeded: true, dismissed: false });
    const notice = document.createElement('div');
    notice.className = 'threshold-notification';
    notice.dataset.panelId = panel.id;
    notice.innerHTML = `
        <strong>${escapeHtml(status.panelTitle || 'Панель Grafana')}</strong>
        <button type="button" aria-label="Закрыть">×</button>
        <span class="threshold-notification-status">Порог превышен</span>`;
    notice.querySelector('button').addEventListener('click', () => {
        notice.remove();
        panelThresholdStates.set(panel.id, { exceeded: true, dismissed: true });
    });
    ensureThresholdNotifications().appendChild(notice);
}

function requestPanelLegendSeries(panel, iframe) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            panelLegendWaiters.delete(panel.id);
            resolve([]);
        }, 2500);
        panelLegendWaiters.set(panel.id, series => {
            clearTimeout(timer);
            resolve(series);
        });
        if (!postToDashboardFrame(iframe, { action: 'getPanelLegendSeries', requestId: panel.id })) {
            clearTimeout(timer);
            panelLegendWaiters.delete(panel.id);
            resolve([]);
        }
    });
}

function requestPanelThresholdStatus(panel, iframe) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            panelThresholdWaiters.delete(panel.id);
            resolve(null);
        }, 1500);
        panelThresholdWaiters.set(panel.id, status => {
            clearTimeout(timer);
            resolve(status);
        });
        if (!postToDashboardFrame(iframe, { action: 'getPanelThresholdStatus', requestId: panel.id, threshold: getPanelTools(panel) })) {
            clearTimeout(timer);
            panelThresholdWaiters.delete(panel.id);
            resolve(null);
        }
    });
}

function formatThresholdUnit(status) {
    if (status?.unit) return `Единица: ${status.unit}`;
    if (status?.engine && status.engine !== 'unknown') return 'Без единицы';
    return 'Единица определяется по графику';
}

async function openPanelTools(panel, iframe) {
    const tools = getPanelTools(panel);
    const storedSettings = await chrome.storage.sync.get(getGrafanaSettingsStorageKeys());
    const panelSettings = normalizeGrafanaSettings(storedSettings);
    let resolvedTitle = panel.title;
    let panelKind = window.DashBridgeGrafanaPanelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
    // Most panels already have a persisted title and open immediately. Query
    // the live iframe only when that title cannot select a specialised form.
    if (!panelKind) {
        const liveTitle = await requestPanelTitle(panel, iframe);
        resolvedTitle = normalizePanelMetadataText(liveTitle, 240) || resolvedTitle;
        panelKind = window.DashBridgeGrafanaPanelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
    }
    if (resolvedTitle && panel.title !== resolvedTitle) {
        panel.title = resolvedTitle;
        savePanels();
    }
    return window.DashBridgePanelSettingsModal.open({
        state: tools,
        content: `${window.DashBridgePanelSettingsModal.transformFields(tools, { panelKind })}${window.DashBridgePanelSettingsModal.thresholdFields(tools)}${window.DashBridgePanelSettingsModal.legendFields(tools.legendMode, tools)}`,
        advanced: {
            cpuCapacityFilterCoefficientDefault: panelSettings.grafanaCpuCapacityCoefficient,
            getLegendSeries: () => requestPanelLegendSeries(panel, iframe),
            getThresholdStatus: () => requestPanelThresholdStatus(panel, iframe),
            formatThresholdUnit
        },
        onSave: nextTools => {
            const previousTools = getPanelTools(panel);
            // The calculated response owns a percent field config. Grafana can
            // retain that config when native byte series return, so remember
            // that this panel must explicitly restore its byte unit.
            nextTools.forceMemByteUnit = nextTools.convertMemToUsed
                ? false
                : (previousTools.convertMemToUsed || previousTools.forceMemByteUnit);
            panel.tools = nextTools;
            savePanels();
            const liveApplyKeys = ['thresholdEnabled', 'thresholdNotifyEnabled', 'thresholdValue', 'thresholdRawValue', 'thresholdUnit'];
            const liveApplyOnlyChange = liveApplyKeys.some(key => previousTools[key] !== nextTools[key])
                && Object.keys(nextTools).filter(key => !liveApplyKeys.includes(key))
                    .every(key => JSON.stringify(previousTools[key]) === JSON.stringify(nextTools[key]));
            if (liveApplyOnlyChange) {
                const targetIframe = forceLoadPanel(panel.id);
                if (targetIframe) void applyPanelTools(panel, targetIframe);
            } else {
                refreshPanel(panel.id);
            }
        }
    });
}

const dashBridgeReportController = DashBridgeReportController.create({
    reportEngine: DashBridgeReport,
    transportFactory: DashBridgeReportTransport,
    testRunnerFactory: DashBridgeReportTestRunner,
    auditEngine: DashBridgeReportAudit,
    forceLoadPanel,
    postToDashboardFrame,
    getPanels: () => panels,
    getActiveProfile,
    getTimeContext: dashBridgeTimeController.getState,
});
const dashBridgeReportTransport = dashBridgeReportController.transport;
const dashBridgeReportTestRunner = dashBridgeReportController.testRunner;
const collectProfileReport = dashBridgeReportController.collect;
const openReportPreview = dashBridgeReportController.openPreview;
const setDashboardPanelDataStatus = dashBridgeReportController.setPanelDataStatus;

// ════════════════════════════════════════════════════════
//  Инициализация
// ════════════════════════════════════════════════════════

// DashBridge page controller.
document.addEventListener('DOMContentLoaded', async () => {
    const rulesPromise = chrome.runtime.sendMessage({ type: 'dashbridge-ensure-iframe-rules' })
        .then(rulesReady => {
            if (!rulesReady?.ok) {
                console.warn('Grafana iframe rules were not acknowledged:', rulesReady?.error || 'unknown error', rulesReady);
            }
        })
        .catch(error => console.warn('Could not prepare Grafana iframe rules:', error));
    try {
        await DashBridgeDataMigration.run();
    } catch (error) {
        // Keep the dashboard available. The schema marker is written last, so
        // the migration is retried without data loss on the next page load.
        console.error('Не удалось выполнить миграцию данных DashBridge:', error);
    }
    const [storedSettings] = await Promise.all([
        chrome.storage.sync.get([...new Set([...getGrafanaSettingsStorageKeys(), 'grafanaCompactScreenshot'])]),
        loadProfiles(),
        rulesPromise
    ]);
    grafanaTransformSettings = normalizeGrafanaSettings(storedSettings);
    defaultCapturePrepared = !!storedSettings.grafanaCompactScreenshot;
    syncDashboardCaptureToggles(defaultCapturePrepared);
    setupTimeControls();
    setupEventListeners();
    setupDashboardDragAndDrop();
    const crosshairSlider = document.getElementById('crosshairThicknessSlider');
    if (crosshairSlider) crosshairSlider.value = crosshairThickness;
    updateCrosshairBtn();
    renderProfileSwitcher();
    renderDashboard();
});

function clearDragMarkers(_container) {
    dragTargetEl?.classList.remove('drag-over-left', 'drag-over-right');
    dragTargetEl = null;
    dragDropSide = null;
}

function savePanelOrder(container) {
    const panelsById = new Map(panels.map(panel => [panel.id, panel]));
    panels = [...container.querySelectorAll('.panel-card')]
        .map(card => panelsById.get(card.dataset.panelId))
        .filter(Boolean);
    savePanels();
}

function setupDashboardDragAndDrop() {
    const container = document.getElementById('dashboard');

    container.addEventListener('dragover', (e) => {
        if (!draggedEl) return;
        const target = e.target.closest('.panel-card');
        if (!target || target === draggedEl || !container.contains(target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        clearDragMarkers(container);
        dragTargetEl = target;
        dragDropSide = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2 ? 'left' : 'right';
        target.classList.add(dragDropSide === 'left' ? 'drag-over-left' : 'drag-over-right');
    });

    container.addEventListener('dragleave', (e) => {
        if (e.target === container && !container.contains(e.relatedTarget)) clearDragMarkers(container);
    });

    container.addEventListener('drop', (e) => {
        if (!draggedEl || !dragTargetEl || !dragDropSide) return;
        e.preventDefault();
        if (dragDropSide === 'left') container.insertBefore(draggedEl, dragTargetEl);
        else container.insertBefore(draggedEl, dragTargetEl.nextSibling);
        savePanelOrder(container);
        clearDragMarkers(container);
    });
}

function getCompactCaptureDimensions() {
    return {
        width: grafanaTransformSettings.grafanaCompactExportWidth,
        height: grafanaTransformSettings.grafanaCompactExportHeight
    };
}

function syncDashboardCaptureToggles(enabled) {
    const dimensions = getCompactCaptureDimensions();
    document.querySelectorAll('.btn-capture-toggle').forEach(button => {
        button.classList.toggle('capture-toggle-active', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.title = enabled
            ? `Компактный снимок ${dimensions.width}×${dimensions.height}: включён`
            : `Компактный снимок ${dimensions.width}×${dimensions.height}: выключен`;
        button.setAttribute('aria-label', button.title);
    });
}

function getPanelAnalysisType(panel) {
    return window.DashBridgeGrafanaPanelAnalysis?.classifyTitle(panel?.title, grafanaTransformSettings) || null;
}

function findPanelCard(panelId) {
    return document.querySelector(`.panel-card[data-panel-id="${CSS.escape(String(panelId))}"]`);
}

function syncPanelAnalysisAction(panel, card = findPanelCard(panel?.id)) {
    const action = card?.querySelector('.btn-analysis');
    if (!action) return null;
    const type = getPanelAnalysisType(panel);
    action.hidden = type !== 'cpu' && type !== 'ram';
    action.dataset.analysisType = type || '';
    action.title = type === 'ram' ? 'Анализ RAM' : 'Анализ CPU';
    action.setAttribute('aria-label', action.title);
    return type;
}

function closePanelExtraActions(except = null) {
    document.querySelectorAll('.panel-actions.extra-actions-open').forEach(actions => {
        if (actions === except) return;
        actions.classList.remove('extra-actions-open');
        actions.querySelectorAll('.panel-extra-inline').forEach(button => { button.hidden = true; });
        actions.querySelector('.btn-more')?.setAttribute('aria-expanded', 'false');
    });
}

function togglePanelExtraActions(button) {
    const actions = button?.closest('.panel-actions');
    if (!actions) return;
    const opening = !actions.classList.contains('extra-actions-open');
    closePanelExtraActions(opening ? actions : null);
    actions.classList.toggle('extra-actions-open', opening);
    actions.querySelectorAll('.panel-extra-inline').forEach(extra => { extra.hidden = !opening; });
    button.setAttribute('aria-expanded', String(opening));
}

function setDashboardCapturePrepared(enabled, { persist = true } = {}) {
    defaultCapturePrepared = !!enabled;
    syncDashboardCaptureToggles(defaultCapturePrepared);
    const dimensions = getCompactCaptureDimensions();
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        postToDashboardFrame(iframe, {
            action: 'dashbridgeCapturePreparedDefaultChanged',
            enabled: defaultCapturePrepared,
            outputWidth: dimensions.width,
            outputHeight: dimensions.height
        });
    });
    if (persist) void chrome.storage.sync.set({ grafanaCompactScreenshot: defaultCapturePrepared });
    return defaultCapturePrepared;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (Object.keys(changes).some(key => grafanaTransformSettingKeys.has(key))) {
        const nextSettings = { ...grafanaTransformSettings };
        Object.entries(changes).forEach(([key, change]) => {
            if (grafanaTransformSettingKeys.has(key)) nextSettings[key] = change.newValue;
        });
        grafanaTransformSettings = normalizeGrafanaSettings(nextSettings);
        panels.forEach(panel => syncPanelAnalysisAction(panel));
    }
    if (changes.grafanaCompactScreenshot) {
        const nextPrepared = !!changes.grafanaCompactScreenshot.newValue;
        // A local click already updated every iframe before persisting. Ignore
        // its storage echo; external-tab changes still propagate normally.
        if (nextPrepared !== defaultCapturePrepared) {
            setDashboardCapturePrepared(nextPrepared, { persist: false });
        }
    } else if (changes.grafanaCompactExportWidth || changes.grafanaCompactExportHeight) {
        syncDashboardCaptureToggles(defaultCapturePrepared);
        const dimensions = getCompactCaptureDimensions();
        document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
            postToDashboardFrame(iframe, {
                action: 'dashbridgeCapturePreparedDefaultChanged',
                enabled: defaultCapturePrepared,
                outputWidth: dimensions.width,
                outputHeight: dimensions.height
            });
        });
    }
});

function escapeHtml(str) {
    return DashBridgeRenderer.escapeHtml(str);
}

// ════════════════════════════════════════════════════════
//  Тема
// ════════════════════════════════════════════════════════

function updateCrosshairBtn() {
    const toggle = document.getElementById('crosshairToggleCheckbox');
    if (toggle) toggle.checked = crosshairMode === 'line';

    const valueLabel = document.getElementById('crosshairThicknessValue');
    if (valueLabel) valueLabel.textContent = crosshairThickness + 'px';
}
// ════════════════════════════════════════════════════════
//  Обработчики событий
// ════════════════════════════════════════════════════════

async function refreshAllPanels() {
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        const panel = getPanelForIframe(iframe);
        if (!panel || panel.paused) return;
        if (iframe.src) navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, iframe.src));
        else if (iframe.dataset.src) iframe.dataset.src = applyPanelParamsToUrl(panel, iframe.dataset.src);
    });
}

function setupEventListeners() {
    // --- Тема (глобальная, синхронизируется через chrome.storage.sync) ---
    document.getElementById('capturePreparedToggleBtn')?.addEventListener('click', () => {
        setDashboardCapturePrepared(!defaultCapturePrepared);
    });
    document.getElementById('captureAllPanelsBtn')?.addEventListener('click', event => {
        void captureAllDashboardPanels(event.currentTarget);
    });

    // --- Режим курсора (меню) ---
    const crosshairMenuBtn = document.getElementById('crosshairMenuBtn');
    const crosshairDropdown = document.getElementById('crosshairDropdown');
    const crosshairToggleCheckbox = document.getElementById('crosshairToggleCheckbox');

    if (crosshairMenuBtn) {
        crosshairMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isShowing = crosshairDropdown.style.display === 'flex';
            closeHeaderMenus(); // Закрываем остальные
            crosshairDropdown.style.display = isShowing ? 'none' : 'flex';
            crosshairMenuBtn.setAttribute('aria-expanded', !isShowing);
        });
    }

    if (crosshairDropdown) {
        crosshairDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (crosshairToggleCheckbox) {
        crosshairToggleCheckbox.addEventListener('change', (e) => {
            crosshairMode = e.target.checked ? 'line' : 'off';
            try {
                localStorage.setItem('dashbridge_crosshairMode', crosshairMode);
            } catch (err) { }
            if (crosshairMode === 'off') hideCrosshair();
            document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(ifr => {
                postToDashboardFrame(ifr, { action: 'setCrosshairMode', mode: crosshairMode, thickness: crosshairThickness });
            });
        });
    }

    const crosshairSlider = document.getElementById('crosshairThicknessSlider');
    if (crosshairSlider) {
        crosshairSlider.addEventListener('input', (e) => {
            crosshairThickness = parseInt(e.target.value, 10) || 1;
            const valueLabel = document.getElementById('crosshairThicknessValue');
            if (valueLabel) valueLabel.textContent = crosshairThickness + 'px';

            try {
                localStorage.setItem('dashbridge_crosshairThickness', crosshairThickness);
            } catch (err) { }
            document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(ifr => {
                postToDashboardFrame(ifr, { action: 'setCrosshairThickness', thickness: crosshairThickness });
            });
        });
    }

    // --- Профили ---
    const profileDropdown = document.getElementById('profileDropdown');
    const dataDropdown = document.getElementById('dataDropdown');
    const addPanelDropdown = document.getElementById('addPanelDropdown');
    const reportDropdown = document.getElementById('reportDropdown');
    const closeHeaderMenus = () => {
        if (dataDropdown) dataDropdown.style.display = 'none';
        if (addPanelDropdown) addPanelDropdown.style.display = 'none';
        if (reportDropdown) reportDropdown.style.display = 'none';
        if (crosshairDropdown) crosshairDropdown.style.display = 'none';
        document.getElementById('dataMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('addPanelMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('reportMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('crosshairMenuBtn')?.setAttribute('aria-expanded', 'false');
    };
    document.getElementById('profilePickerBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isShowing = profileDropdown.style.display === 'flex';
        profileDropdown.style.display = isShowing ? 'none' : 'flex';
        // Закрываем другие поповеры
        document.getElementById('timePopover').style.display = 'none';
        document.getElementById('refreshPopover').style.display = 'none';
        closeHeaderMenus();
        if (!isShowing) renderProfileSwitcher();
    });
    profileDropdown.addEventListener('click', (e) => e.stopPropagation());

    const toggleHeaderMenu = (button, dropdown) => {
        const isShowing = dropdown.style.display === 'block';
        closeHeaderMenus();
        profileDropdown.style.display = 'none';
        document.getElementById('timePopover').style.display = 'none';
        document.getElementById('refreshPopover').style.display = 'none';
        if (!isShowing) {
            dropdown.style.display = 'block';
            button.setAttribute('aria-expanded', 'true');
        }
    };
    document.getElementById('dataMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, dataDropdown);
    });
    document.getElementById('addPanelMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, addPanelDropdown);
    });
    document.getElementById('reportMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, reportDropdown);
    });
    dataDropdown.addEventListener('click', event => event.stopPropagation());
    addPanelDropdown.addEventListener('click', event => event.stopPropagation());
    reportDropdown.addEventListener('click', event => event.stopPropagation());
    document.getElementById('configureReportBtn').addEventListener('click', () => {
        closeHeaderMenus(); openReportSettings();
    });
    document.getElementById('generateReportBtn').addEventListener('click', () => {
        closeHeaderMenus(); openReportPreview();
    });
    document.getElementById('testReportBtn').addEventListener('click', () => {
        closeHeaderMenus(); dashBridgeReportTestRunner.open();
    });

    document.getElementById('newProfileBtn').addEventListener('click', async () => {
        const name = await showPrompt('Название нового профиля:');
        if (name && name.trim()) createProfile(name.trim());
    });

    document.getElementById('renameProfileBtn').addEventListener('click', async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const name = await showPrompt('Переименовать профиль:', profile.name);
        if (name && name.trim() && name.trim() !== profile.name) {
            renameActiveProfile(name.trim());
        }
    });

    document.getElementById('deleteProfileBtn').addEventListener('click', () => {
        deleteProfile(activeProfileId);
    });

    // --- Модал добавления панели ---
    const modal = document.getElementById('modalOverlay');
    document.getElementById('addPanelBtn').addEventListener('click', () => {
        modal.style.display = 'flex';
        document.getElementById('newPanelUrl').focus();
    });
    document.getElementById('closeModalBtn').addEventListener('click', () => {
        modal.style.display = 'none';
        document.getElementById('newPanelUrl').value = '';
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            document.getElementById('newPanelUrl').value = '';
        }
    });

    document.getElementById('savePanelBtn').addEventListener('click', async () => {
        let url = document.getElementById('newPanelUrl').value.trim();
        const width = document.getElementById('newPanelWidth').value;
        if (!url) { await showAlert('Укажите URL!'); return; }

        try {
            url = normalizeGrafanaPanelUrl(url);
        } catch (e) {
            console.error('Invalid URL format', e);
            await showAlert('Укажите корректный URL с протоколом http или https.');
            return;
        }

        if (currentProfileHasPanel(url)) {
            await showAlert('Эта панель уже есть в текущем профиле.');
            return;
        }

        const addedPanel = { id: crypto.randomUUID(), src: url, width, height: '350px' };
        panels.push(addedPanel);
        savePanels();
        appendDashboardPanelCards([addedPanel]);
        modal.style.display = 'none';
        document.getElementById('newPanelUrl').value = '';
    });

    // --- Экспорт / Импорт ---
    // Quick addition of several panels from one dashboard URL.
    const quickAddModal = document.getElementById('quickAddModalOverlay');
    const clearQuickAddForm = () => {
        document.getElementById('quickAddDashboardUrl').value = '';
        document.getElementById('quickAddPanelIds').value = '';
    };
    const closeQuickAddModal = () => {
        quickAddModal.style.display = 'none';
        clearQuickAddForm();
    };

    document.getElementById('quickAddPanelsBtn').addEventListener('click', () => {
        quickAddModal.style.display = 'flex';
        document.getElementById('quickAddDashboardUrl').focus();
    });
    document.getElementById('closeQuickAddModalBtn').addEventListener('click', closeQuickAddModal);
    quickAddModal.addEventListener('click', event => {
        if (event.target === quickAddModal) closeQuickAddModal();
    });
    document.getElementById('saveQuickPanelsBtn').addEventListener('click', async () => {
        const dashboardUrl = document.getElementById('quickAddDashboardUrl').value.trim();
        const width = document.getElementById('quickAddPanelWidth').value;
        if (!dashboardUrl) {
            await showAlert('Укажите URL дашборда Grafana.');
            return;
        }

        let panelIds;
        try {
            panelIds = parseQuickPanelIds(document.getElementById('quickAddPanelIds').value);
            if (!panelIds.length) throw new Error('Укажите хотя бы один ID панели.');
        } catch (error) {
            await showAlert(error.message);
            return;
        }

        let panelUrls;
        try {
            panelUrls = panelIds.map(panelId => buildDashBridgeSoloPanelUrl(dashboardUrl, panelId));
        } catch (error) {
            await showAlert(error.message || 'Не удалось подготовить URL панелей.');
            return;
        }

        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const newPanels = panelUrls
            .filter(url => {
                const identity = getProfilePanelIdentity(url);
                if (!identity || existingPanelIdentities.has(identity)) return false;
                existingPanelIdentities.add(identity);
                return true;
            })
            .map(url => ({ id: crypto.randomUUID(), src: url, width, height: '350px' }));

        if (!newPanels.length) {
            await showAlert('Все указанные панели уже есть в текущем профиле.');
            return;
        }

        panels.push(...newPanels);
        savePanels();
        appendDashboardPanelCards(newPanels);
        closeQuickAddModal();
        if (newPanels.length !== panelIds.length) {
            await showAlert(`Добавлено панелей: ${newPanels.length}. Уже существующие панели пропущены.`);
        }
    });

    // Independent dashboard inventory picker. The existing ID-based flow above
    // remains available for users who already know the panel IDs.
    const dashboardPicker = document.getElementById('dashboardPanelPickerOverlay');
    const dashboardPickerUrl = document.getElementById('dashboardPanelPickerUrl');
    const dashboardPickerStatus = document.getElementById('dashboardPanelPickerStatus');
    const dashboardPickerSelection = document.getElementById('dashboardPanelPickerSelection');
    const dashboardPickerList = document.getElementById('dashboardPanelPickerList');
    const dashboardPickerAdd = document.getElementById('addSelectedDashboardPanelsBtn');
    const dashboardPickerLoad = document.getElementById('loadDashboardPanelsBtn');
    let dashboardPickerState = null;
    let dashboardPickerLoadVersion = 0;

    const updateDashboardPickerSelection = () => {
        const selected = dashboardPickerList.querySelectorAll('input[type="checkbox"]:checked').length;
        dashboardPickerAdd.disabled = selected === 0;
        if (dashboardPickerState) {
            const available = dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)').length;
            dashboardPickerStatus.textContent = available
                ? `Выбрано панелей: ${selected} из ${available}.`
                : 'Все найденные панели уже добавлены в текущий профиль.';
        }
    };
    const resetDashboardPicker = () => {
        dashboardPickerLoadVersion += 1;
        dashboardPickerState = null;
        dashboardPickerUrl.value = '';
        dashboardPickerStatus.textContent = '';
        dashboardPickerList.replaceChildren();
        dashboardPickerSelection.hidden = true;
        dashboardPickerAdd.disabled = true;
        dashboardPickerLoad.disabled = false;
        dashboardPickerLoad.textContent = 'Получить панели';
    };
    const closeDashboardPicker = () => {
        dashboardPicker.style.display = 'none';
        resetDashboardPicker();
    };
    const renderDashboardPickerPanels = (dashboardUrl, panelList) => {
        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const safePanels = (Array.isArray(panelList) ? panelList : [])
            .filter(panel => /^\d+$/.test(String(panel?.id || '')) && Number(panel.id) > 0)
            .slice(0, 2000)
            .map(panel => ({
                id: String(panel.id),
                title: normalizePanelMetadataText(panel.title || `Panel_${panel.id}`, 240),
                type: normalizePanelMetadataText(panel.type || '', 80),
                url: buildDashBridgeSoloPanelUrl(dashboardUrl, String(panel.id))
            }));
        dashboardPickerList.replaceChildren();
        safePanels.forEach((panel, index) => {
            const existing = existingPanelIdentities.has(getProfilePanelIdentity(panel.url));
            const item = document.createElement('label');
            item.className = `dashboard-panel-picker-item${existing ? ' is-existing' : ''}`;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.panelIndex = String(index);
            checkbox.checked = !existing;
            checkbox.disabled = existing;
            checkbox.addEventListener('change', updateDashboardPickerSelection);
            const title = document.createElement('span');
            title.className = 'dashboard-panel-picker-item-title';
            title.textContent = panel.title;
            const meta = document.createElement('span');
            meta.className = 'dashboard-panel-picker-item-meta';
            meta.textContent = existing
                ? `ID ${panel.id} · уже добавлена`
                : `ID ${panel.id}${panel.type ? ` · ${panel.type}` : ''}`;
            item.append(checkbox, title, meta);
            dashboardPickerList.appendChild(item);
        });
        dashboardPickerState = { dashboardUrl, panels: safePanels };
        dashboardPickerSelection.hidden = false;
        if (!safePanels.length) {
            dashboardPickerStatus.textContent = 'В дашборде не найдены панели с числовыми ID.';
            dashboardPickerAdd.disabled = true;
            return;
        }
        updateDashboardPickerSelection();
    };

    document.getElementById('discoverDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPicker.style.display = 'flex';
        dashboardPickerUrl.focus();
    });
    document.getElementById('closeDashboardPanelPickerBtn').addEventListener('click', closeDashboardPicker);
    document.getElementById('cancelDashboardPanelPickerBtn').addEventListener('click', closeDashboardPicker);
    dashboardPicker.addEventListener('click', event => {
        if (event.target === dashboardPicker) closeDashboardPicker();
    });
    dashboardPickerLoad.addEventListener('click', async () => {
        const dashboardUrl = dashboardPickerUrl.value.trim();
        let dashboardLocation = null;
        try { dashboardLocation = new URL(dashboardUrl); } catch { dashboardLocation = null; }
        if (!parseGrafanaDashboardUrl(dashboardUrl)
            || !['http:', 'https:'].includes(dashboardLocation?.protocol)
            || dashboardLocation.username || dashboardLocation.password) {
            dashboardPickerStatus.textContent = 'Укажите корректный URL дашборда Grafana вида /d/...';
            return;
        }
        const loadVersion = ++dashboardPickerLoadVersion;
        dashboardPickerState = null;
        dashboardPickerSelection.hidden = true;
        dashboardPickerList.replaceChildren();
        dashboardPickerAdd.disabled = true;
        dashboardPickerLoad.disabled = true;
        dashboardPickerLoad.textContent = 'Загрузка…';
        dashboardPickerStatus.textContent = 'Получаем список панелей Grafana…';
        try {
            const result = await fetchGrafanaDashboardPanels(dashboardUrl);
            if (loadVersion !== dashboardPickerLoadVersion || dashboardPicker.style.display !== 'flex') return;
            renderDashboardPickerPanels(dashboardUrl, result.panelList);
        } catch (error) {
            if (loadVersion !== dashboardPickerLoadVersion) return;
            const unauthorized = [401, 403].includes(Number(error?.status))
                || error?.code === 'GRAFANA_AUTH_REQUIRED';
            dashboardPickerStatus.textContent = unauthorized
                ? 'Требуется авторизация Grafana. Откройте дашборд в обычной вкладке, войдите и повторите запрос.'
                : `Не удалось получить панели: ${String(error?.message || error).slice(0, 300)}`;
        } finally {
            if (loadVersion === dashboardPickerLoadVersion) {
                dashboardPickerLoad.disabled = false;
                dashboardPickerLoad.textContent = 'Получить панели';
            }
        }
    });
    document.getElementById('selectAllDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
            .forEach(input => { input.checked = true; });
        updateDashboardPickerSelection();
    });
    document.getElementById('clearDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
            .forEach(input => { input.checked = false; });
        updateDashboardPickerSelection();
    });
    dashboardPickerAdd.addEventListener('click', async () => {
        if (!dashboardPickerState) return;
        const selectedIndexes = [...dashboardPickerList.querySelectorAll('input[type="checkbox"]:checked')]
            .map(input => Number(input.dataset.panelIndex))
            .filter(Number.isInteger);
        const width = document.getElementById('dashboardPanelPickerWidth').value;
        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const selectedPanels = selectedIndexes
            .map(index => dashboardPickerState.panels[index])
            .filter(panel => {
                if (!panel) return false;
                const identity = getProfilePanelIdentity(panel.url);
                if (!identity || existingPanelIdentities.has(identity)) return false;
                existingPanelIdentities.add(identity);
                return true;
            });
        if (!selectedPanels.length) {
            dashboardPickerStatus.textContent = 'Выберите хотя бы одну панель, которой ещё нет в профиле.';
            updateDashboardPickerSelection();
            return;
        }
        const addedPanels = selectedPanels.map(panel => ({
            id: crypto.randomUUID(), src: panel.url, title: panel.title, width, height: '350px'
        }));
        panels.push(...addedPanels);
        await savePanels();
        appendDashboardPanelCards(addedPanels);
        closeDashboardPicker();
        if (selectedPanels.length !== selectedIndexes.length) {
            await showAlert(`Добавлено панелей: ${selectedPanels.length}. Уже существующие панели пропущены.`);
        }
    });

    document.getElementById('exportPanelsBtn').addEventListener('click', exportPanels);
    const importInput = document.getElementById('importPanelsInput');
    document.getElementById('importPanelsBtn').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importPanels(file);
        importInput.value = '';
    });

    // --- ESC выходит из fullscreen ---
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (dashboardPicker.style.display === 'flex') closeDashboardPicker();
        closeDashboardPanelAnalysis();
        closePanelExtraActions();
        if (fullscreenPanelId) toggleFullscreen(fullscreenPanelId);
    });

    // --- Закрыть все поповеры по клику вне ---
    document.addEventListener('click', () => {
        profileDropdown.style.display = 'none';
        closeHeaderMenus();
        const tp = document.getElementById('timePopover');
        const rp = document.getElementById('refreshPopover');
        if (tp) tp.style.display = 'none';
        if (rp) rp.style.display = 'none';
        closePanelExtraActions();
    });
}

// ════════════════════════════════════════════════════════
//  Управление панелями
// ════════════════════════════════════════════════════════

async function deletePanel(id) {
    if (await showConfirm('Удалить панель?')) {
        panels = panels.filter(p => p.id !== id);
        savePanels();
        removeDashboardPanelCard(id);
    }
}

// Обновляет iframe панели: если ещё не загружен — форсирует загрузку с cache-busting
function refreshPanel(id) {
    const panel = panels.find(item => item.id === id);
    if (panel) setDashboardPanelDataStatus(panel, null);
    const iframe = forceLoadPanel(id);
    if (iframe && iframe.src) {
        const url = new URL(applyPanelParamsToUrl(panel, iframe.src));
        url.searchParams.set('_t', Date.now());
        navigateDashboardFrame(iframe, url.toString());
    }
}

// При входе в fullscreen форсируем загрузку iframe, иначе пользователь увидит пустой экран
function refreshPanelThresholdLayout(id) {
    const panel = panels.find(item => item.id === id);
    const iframe = document.getElementById('iframe-' + id);
    if (!panel?.tools?.thresholdEnabled || !iframe) return;

    let notified = false;
    let observer = null;
    const notifyAfterLayout = () => {
        if (notified) return;
        notified = true;
        observer?.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            postToDashboardFrame(iframe, { action: 'refreshPanelThresholdLayout' });
        }));
    };
    if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(notifyAfterLayout);
        observer.observe(iframe);
    }
    // The fallback also covers browsers that do not expose ResizeObserver.
    requestAnimationFrame(() => requestAnimationFrame(notifyAfterLayout));
}

function toggleFullscreen(id) {
    const card = findPanelCard(id);
    if (!card) return;
    const isCurrentlyFullscreen = fullscreenPanelId === id;

    if (fullscreenPanelId) {
        const prevCard = findPanelCard(fullscreenPanelId);
        if (prevCard) {
            prevCard.classList.remove('fullscreen');
            const prevBtn = prevCard.querySelector('.btn-fullscreen');
            if (prevBtn) { prevBtn.innerHTML = SVG_EXPAND; prevBtn.title = 'На весь экран'; }
        }
        fullscreenPanelId = null;
    }

    if (!isCurrentlyFullscreen) {
        card.classList.add('fullscreen');
        const btn = card.querySelector('.btn-fullscreen');
        if (btn) { btn.innerHTML = SVG_COLLAPSE; btn.title = 'Свернуть (Esc)'; }
        fullscreenPanelId = id;
        // Гарантируем наличие iframe перед переходом в полноэкранный режим.
        forceLoadPanel(id);
    }
    refreshPanelThresholdLayout(id);
}

async function exportPanels() {
    if (panels.length === 0) { await showAlert('Нет панелей для экспорта.'); return; }
    const profile = getActiveProfile();
    const exportedAt = new Date().toISOString();
    const data = createPanelExportPayload({ profile, panels, exportedAt });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildPanelExportFileName(profile?.name, exportedAt);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importPanels(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imported = parsePanelImportText(e.target.result, {
                fallbackProfileName: file.name,
                randomUUID: () => crypto.randomUUID(),
            });
            imported.warnings.forEach(error => {
                console.warn('Пропущена некорректная импортируемая панель:', error);
            });
            const {
                profileName,
                timeState: importedTimeState,
                report: importedReport,
                panels: importedPanels,
            } = imported;
            if (importedPanels.length === 0) { await showAlert('В файле нет панелей с корректными настройками и URL.'); return; }

            const choice = await showConfirm(
                `Файл содержит ${importedPanels.length} панел(и).\n\n` +
                `[OK] — Заменить панели текущего профиля\n` +
                `[Отмена] — Создать новый профиль «${profileName}»`
            );

            if (choice) {
                // Заменяем панели активного профиля
                panels = importedPanels;
                const activeProfile = getActiveProfile();
                if (activeProfile && imported.hasTimeState) {
                    activeProfile.timeState = importedTimeState;
                    loadActiveProfileTimeState();
                    syncTimeControlsFromState();
                }
                if (activeProfile && imported.hasReport) activeProfile.report = importedReport;
                savePanels();
                renderDashboard();
            } else {
                // Создаём новый профиль с импортированными панелями
                const newProfile = {
                    id: crypto.randomUUID(), name: profileName, panels: importedPanels,
                    timeState: importedTimeState, report: importedReport
                };
                const currentProfile = getActiveProfile();
                if (currentProfile) currentProfile.panels = panels;
                profiles.push(newProfile);
                setTabActiveProfileId(newProfile.id);
                panels = importedPanels;
                loadActiveProfileTimeState();
                await saveProfiles();
                renderProfileSwitcher();
                syncTimeControlsFromState();
                renderDashboard();
            }
        } catch (err) {
            if (err?.code === INVALID_PANELS_CODE) {
                await showAlert(err.message);
                return;
            }
            await showAlert('Ошибка чтения файла: ' + err.message);
        }
    };
    reader.readAsText(file);
}

window.deletePanel = deletePanel;
window.refreshPanel = refreshPanel;

// ════════════════════════════════════════════════════════
//  Рендер дашборда
// ════════════════════════════════════════════════════════

function forceLoadPanel(id) {
    const iframe = document.getElementById('iframe-' + id);
    if (!iframe) return null;
    const pendingSrc = iframe.dataset.src;
    if (pendingSrc && !iframe.src) {
        navigateDashboardFrame(iframe, pendingSrc);
        iframe.removeAttribute('data-src');
    }
    return iframe;
}

function updatePanelCard(panelId) {
    const { reloadFrame = true } = arguments[1] || {};
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;

    const card = document.querySelector(`.panel-card[data-panel-id="${panelId}"]`);
    if (!card) return;

    // Update card dimensions
    card.dataset.panelSize = panel.width === '100%' ? 'full' : (panel.width === '33%' ? 'third' : 'half');
    card.dataset.heightMode = panel.height === '350px' ? 'auto' : 'fixed';
    card.style.height = panel.height;

    // «Открыть в Grafana» читает адрес из data-url — синхронизируем с новым src.
    const openBtn = card.querySelector('.btn-open');
    if (openBtn) openBtn.dataset.url = panel.src;

    // Update iframe src if panel is not paused
    if (!panel.paused && reloadFrame) {
        const iframe = card.querySelector('iframe');
        if (iframe) {
            const newSrc = applyPanelParamsToUrl(panel);
            // Only reload iframe if URL actually changed
            if (iframe.src !== newSrc && iframe.dataset.src !== newSrc) {
                if (iframe.src) {
                    // Уже загруженный iframe переводим на новый URL.
                    // data-src не выставляем: он хранит только ещё не применённый URL.
                    iframe.removeAttribute('data-src');
                    navigateDashboardFrame(iframe, newSrc);
                } else {
                    // Кадр ещё ждёт попадания в viewport — обновляем отложенный URL.
                    iframe.dataset.src = newSrc;
                }
            }
        }
    }
}

function openIframeSettings(panel) {
    const selectedGrafanaTheme = ['light', 'dark'].includes(panel.grafanaTheme) ? panel.grafanaTheme : 'follow';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content iframe-settings-modal">
            <div class="modal-header"><h4>Настройки iframe</h4></div>
            <p class="panel-tools-hint">Размер и параметры применяются только к этой карточке и сохраняются в текущем профиле.</p>
            <div class="form-group">
                <label for="iframeSettingsUrl">URL Grafana</label>
                <input class="form-input" type="url" id="iframeSettingsUrl" value="${escapeHtml(panel.src)}" spellcheck="false">
            </div>
            <div class="form-group">
                <label for="iframeSettingsTheme">Тема Grafana</label>
                <select class="form-input" id="iframeSettingsTheme">
                    <option value="follow" ${selectedGrafanaTheme === 'follow' ? 'selected' : ''}>Как в DashBridge</option>
                    <option value="light" ${selectedGrafanaTheme === 'light' ? 'selected' : ''}>Светлая</option>
                    <option value="dark" ${selectedGrafanaTheme === 'dark' ? 'selected' : ''}>Тёмная</option>
                </select>
            </div>
            <div class="form-group">
                <label for="iframeSettingsWidth">Ширина на экране</label>
                <select class="form-input" id="iframeSettingsWidth">
                    <option value="100%" ${panel.width === '100%' ? 'selected' : ''}>100% (на всю ширину)</option>
                    <option value="50%" ${panel.width !== '100%' && panel.width !== '33%' ? 'selected' : ''}>50% (половина экрана)</option>
                    <option value="33%" ${panel.width === '33%' ? 'selected' : ''}>33% (треть экрана)</option>
                </select>
            </div>
            <div class="form-group">
                <label for="iframeSettingsHeight">Высота, px</label>
                <input class="form-input" type="number" id="iframeSettingsHeight" min="180" max="3000" step="10" value="${Math.max(180, parseInt(panel.height, 10) || 350)}">
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-outline iframe-settings-cancel">Отмена</button><button type="button" class="btn btn-primary iframe-settings-save">Сохранить</button></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.iframe-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.iframe-settings-save').addEventListener('click', async () => {
        const rawUrl = overlay.querySelector('#iframeSettingsUrl').value.trim();
        const height = Number(overlay.querySelector('#iframeSettingsHeight').value);
        if (!isSupportedPanelUrl(rawUrl)) {
            await showAlert('Укажите корректный HTTP(S) URL Grafana.');
            return;
        }
        if (!Number.isFinite(height) || height < 180 || height > 3000) {
            await showAlert('Высота должна быть от 180 до 3000 px.');
            return;
        }
        // Ссылку приводим к тому же виду, что и при добавлении панели: иначе
        // вставленный из Grafana адрес остаётся полным дашбордом (/d/ без kiosk)
        // и карточка показывает панель вместе с верхней частью интерфейса.
        let url;
        try {
            url = normalizeGrafanaPanelUrl(rawUrl);
        } catch (error) {
            await showAlert(error.message || 'Укажите ссылку Grafana вида /d/... или /d-solo/....');
            return;
        }
        const previousSrc = panel.src;
        const previousGrafanaTheme = panel.grafanaTheme || 'follow';
        panel.src = url;
        panel.grafanaTheme = overlay.querySelector('#iframeSettingsTheme').value;
        panel.width = overlay.querySelector('#iframeSettingsWidth').value;
        panel.height = `${Math.round(height)}px`;
        savePanels();
        close();
        // Update only this panel card without reloading the entire dashboard
        updatePanelCard(panel.id, {
            reloadFrame: previousSrc !== panel.src || previousGrafanaTheme !== panel.grafanaTheme
        });
    });
}

async function togglePanelPause(id) {
    const panel = panels.find(item => item.id === id);
    if (!panel) return;
    if (dashBridgePanelAnalysisController.isPanel(panel)) closeDashboardPanelAnalysis();
    panel.paused = !panel.paused;
    savePanels();
    replaceDashboardPanelCard(panel.id);
}

function createDashboardPanelCard(panel, container) {
    const card = DashBridgeRenderer.createPanelCard({
            panel,
            iframeSrc: applyPanelParamsToUrl(panel),
            analysisType: getPanelAnalysisType(panel),
            icons: { grip: SVG_GRIP, expand: SVG_EXPAND, refresh: SVG_REFRESH, pause: SVG_PAUSE, resume: SVG_RESUME, captureSave: SVG_CAPTURE_SAVE, captureCopy: SVG_CAPTURE_COPY, iframeSettings: SVG_IFRAME_SETTINGS, panelSettings: SVG_PANEL_SETTINGS, report: SVG_REPORT, more: SVG_MORE, analysis: SVG_ANALYSIS, open: SVG_OPEN, delete: SVG_DELETE }
    });


    const iframeEl = card.querySelector('iframe');

    if (!panel.paused) {
        navigateDashboardFrame(iframeEl, iframeEl.dataset.src);
        iframeEl.removeAttribute('data-src');
    }

    // ── Drag & Drop ──────────────────────────────────────────────────────
    const handle = card.querySelector('.drag-handle');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    // Сбрасываем draggable, если пользователь отпустил кнопку без drag
    handle.addEventListener('mouseup', () => { card.draggable = false; });

    card.addEventListener('dragstart', (e) => {
        draggedId = panel.id;
        draggedEl = card;
        card.classList.add('dragging');
        container.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panel.id);
    });
    card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        container.classList.remove('is-dragging');
        clearDragMarkers(container);
        draggedId = null;
        draggedEl = null;
    });

    // ── Кнопки ──────────────────────────────────────────────────────────
    card.querySelector('.btn-fullscreen')?.addEventListener('click', () => toggleFullscreen(panel.id));
    card.querySelector('.btn-refresh')?.addEventListener('click', () => refreshPanel(panel.id));
    card.querySelector('.btn-pause')?.addEventListener('click', () => togglePanelPause(panel.id));
    card.querySelector('.btn-resume')?.addEventListener('click', () => togglePanelPause(panel.id));
    card.querySelector('.btn-capture-save')?.addEventListener('click', event => {
        void runDashboardToolbarCapture(panel, iframeEl, 'download', event.currentTarget);
    });
    card.querySelector('.btn-capture-copy')?.addEventListener('click', event => {
        void runDashboardToolbarCapture(panel, iframeEl, 'copy', event.currentTarget);
    });
    card.querySelector('.btn-iframe-settings')?.addEventListener('click', () => openIframeSettings(panel));
    card.querySelector('.btn-report-settings')?.addEventListener('click', () => { closePanelExtraActions(); openPanelReportEditor(panel); });
    card.querySelector('.btn-panel-tools')?.addEventListener('click', () => openPanelTools(panel, iframeEl));
    card.querySelector('.btn-more')?.addEventListener('click', event => {
        event.stopPropagation();
        syncPanelAnalysisAction(panel, card);
        togglePanelExtraActions(event.currentTarget);
    });
    card.querySelector('.btn-analysis')?.addEventListener('click', event => {
        const type = event.currentTarget.dataset.analysisType;
        if (!['cpu', 'ram'].includes(type)) return;
        openDashboardPanelAnalysis(panel, iframeEl, type);
        closePanelExtraActions();
    });
    card.querySelector('.btn-open')?.addEventListener('click', (e) => {
        // noopener,noreferrer — защита от уязвимости target=_blank
        window.open(applyPanelParamsToUrl(panel, e.currentTarget.dataset.url), '_blank', 'noopener,noreferrer');
    });
    card.querySelector('.btn-delete').addEventListener('click', () => deletePanel(panel.id));
    return card;
}

function replaceDashboardPanelCard(panelId) {
    const panel = panels.find(item => item.id === panelId);
    const currentCard = findPanelCard(panelId);
    const container = document.getElementById('dashboard');
    if (!panel || !currentCard || !container) return;
    const wasFullscreen = currentCard.classList.contains('fullscreen');
    const replacement = createDashboardPanelCard(panel, container);
    if (wasFullscreen) {
        replacement.classList.add('fullscreen');
        const fullscreenButton = replacement.querySelector('.btn-fullscreen');
        if (fullscreenButton) {
            fullscreenButton.innerHTML = SVG_COLLAPSE;
            fullscreenButton.title = 'Свернуть (Esc)';
        }
    }
    currentCard.replaceWith(replacement);
}

function appendDashboardPanelCards(addedPanels) {
    const container = document.getElementById('dashboard');
    if (!container || !Array.isArray(addedPanels) || !addedPanels.length) return;
    container.querySelector('.empty-state')?.remove();
    const fragment = document.createDocumentFragment();
    addedPanels.forEach(panel => fragment.appendChild(createDashboardPanelCard(panel, container)));
    container.appendChild(fragment);
}

function removeDashboardPanelCard(panelId) {
    if (dashBridgePanelAnalysisController.isPanel(panelId)) closeDashboardPanelAnalysis();
    findPanelCard(panelId)?.remove();
    panelThresholdStates.delete(panelId);
    document.querySelector(`.threshold-notification[data-panel-id="${CSS.escape(panelId)}"]`)?.remove();
    if (fullscreenPanelId === panelId) fullscreenPanelId = null;
    if (panels.length === 0) void renderDashboard();
}

function panelFrameSignature(panel) {
    try {
        return JSON.stringify({
            src: panel?.src || '',
            grafanaTheme: panel?.grafanaTheme || 'follow',
            paused: !!panel?.paused,
            tools: panel?.tools || {}
        });
    } catch {
        return '';
    }
}

function adoptPanelState(target, source) {
    Object.keys(target).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
    });
    Object.assign(target, source);
    return target;
}

function reconcileDashboardPanelCards(previousPanels = []) {
    const container = document.getElementById('dashboard');
    if (!container) return;
    if (panels.length === 0) {
        void renderDashboard();
        return;
    }

    container.querySelector('.empty-state')?.remove();
    const previousById = new Map(previousPanels.map(panel => [panel.id, panel]));
    const nextIds = new Set(panels.map(panel => panel.id));
    container.querySelectorAll('.panel-card').forEach(card => {
        if (!nextIds.has(card.dataset.panelId)) removeDashboardPanelCard(card.dataset.panelId);
    });

    panels.forEach(panel => {
        const previous = previousById.get(panel.id);
        let card = findPanelCard(panel.id);
        const previousFrameSignature = previous?.frameSignature ?? panelFrameSignature(previous);
        const frameChanged = previous && previousFrameSignature !== panelFrameSignature(panel);
        const pausedTitleChanged = previous?.paused && previous.title !== panel.title;
        if (!card) {
            card = createDashboardPanelCard(panel, container);
        } else if (frameChanged || pausedTitleChanged) {
            if (dashBridgePanelAnalysisController.isPanel(panel)) closeDashboardPanelAnalysis();
            replaceDashboardPanelCard(panel.id);
            card = findPanelCard(panel.id);
        } else {
            updatePanelCard(panel.id, { reloadFrame: false });
            syncPanelAnalysisAction(panel, card);
        }
        if (card) container.appendChild(card);
    });
}

async function renderDashboard() {
    closeDashboardPanelAnalysis();
    const container = document.getElementById('dashboard');
    container.innerHTML = '';

    if (panels.length === 0) {
        const profile = getActiveProfile();
        container.innerHTML = `<div class="empty-state">
            <h2>Профиль «${escapeHtml(profile?.name || 'Default')}» пуст</h2>
            <p style="margin-top: 10px; opacity: 0.7;">Нажмите «Добавить панель» и вставьте ссылку Embed из Grafana.</p>
        </div>`;
        return;
    }

    // DocumentFragment: 1 reflow вместо N при рендере 20-30 панелей
    const fragment = document.createDocumentFragment();
    for (const panel of panels) {
        fragment.appendChild(createDashboardPanelCard(panel, container));
    }

    // Один appendChild фрагмента — 1 reflow вместо N
    container.appendChild(fragment);
}

// ════════════════════════════════════════════════════════
//  Кроссхейр-синхронизация между iframe
// ════════════════════════════════════════════════════════

const dashBridgeCrosshair = createDashBridgeCrosshair({
    frames: () => document.querySelectorAll('iframe[name="dashbridge-iframe"]'),
    send: postToDashboardFrame,
    isEnabled: () => crosshairMode === 'line'
});
const broadcastCrosshair = (percentX, timestamp, sourceIframe) => dashBridgeCrosshair.broadcast(percentX, timestamp, sourceIframe);
const hideCrosshair = () => dashBridgeCrosshair.hide();

const dashBridgeCapture = DashBridgeCapture.create({
    getPanels: () => panels,
    getActiveProfile,
    getDefaultCapturePrepared: () => defaultCapturePrepared,
    getCompactCaptureDimensions,
    forceLoadPanel,
    syncDashboardCaptureToggles,
    postToDashboardFrame,
    showAlert,
});
const captureAllDashboardPanels = dashBridgeCapture.captureAll;
const runDashboardToolbarCapture = dashBridgeCapture.captureFromToolbar;
const captureDashbridgePanel = dashBridgeCapture.capturePanel;

window.addEventListener('message', (e) => {
    if (!e.data || !e.data.action) return;

    // Проверка безопасности: принимаем сообщения только от iframe-ов, открытых на нашем дашборде
    const sourceIframe = Array.from(document.querySelectorAll('iframe[name="dashbridge-iframe"]'))
        .find(ifr => ifr.contentWindow === e.source);
    if (!sourceIframe || getFrameOrigin(sourceIframe) !== e.origin) return;

    if (e.data.action === 'panelReportSnapshot' && typeof e.data.requestId === 'string') {
        dashBridgeReportTransport.acceptSnapshot(e.data.requestId, sourceIframe, e.data.snapshot);
        return;
    }

    if (e.data.action === 'dashbridgePanelAnalysisUpdate'
        && typeof e.data.requestId === 'string') {
        dashBridgePanelAnalysisController.accept(e.data, sourceIframe);
        return;
    }

    if (e.data.action === 'dashbridgePanelCaptureRequest'
        && typeof e.data.requestId === 'string'
        && ['download', 'copy'].includes(e.data.outputAction)) {
        const panel = getPanelForIframe(sourceIframe);
        void captureDashbridgePanel(sourceIframe, panel, e.data);
        return;
    }

    if (e.data.action === 'dashbridgeCapturePreparedChanged' && typeof e.data.enabled === 'boolean') {
        setDashboardCapturePrepared(e.data.enabled);
        return;
    }

    if (e.data.action === 'dashbridgePanelTitle') {
        const panel = getPanelForIframe(sourceIframe);
        const title = typeof e.data.title === 'string' ? e.data.title.trim().slice(0, 240) : '';
        if (panel && title && panel.title !== title) {
            panel.title = title;
            savePanels();
            syncPanelAnalysisAction(panel, sourceIframe.closest('.panel-card'));
        }
        return;
    }

    if (e.data.action === 'dashbridgePanelTitleResponse' && typeof e.data.requestId === 'string') {
        const resolve = panelTitleWaiters.get(e.data.requestId);
        if (resolve) resolve(normalizePanelMetadataText(e.data.title, 240));
        return;
    }

    if (e.data.action === 'dashbridgeIframeReady') {
        // `load` can fire for an inherited about:blank document. A message from
        // the content script proves that the Grafana document now owns this window.
        sourceIframe.dataset.dashbridgeOrigin = e.origin;
        sourceIframe.dataset.dashbridgeLoaded = 'true';
        postToDashboardFrame(sourceIframe, { action: 'setCrosshairMode', mode: crosshairMode, thickness: crosshairThickness });
        const panel = getPanelForIframe(sourceIframe);
        dashBridgeTimeController.sendTimeUpdate(sourceIframe);
        if (panel) applyPanelTools(panel, sourceIframe);
        dashBridgePanelAnalysisController.retryForFrame(sourceIframe);
        return;
    }

    if (e.data.action === 'dashbridgePanelRendered') {
        sourceIframe.dataset.dashbridgeRendered = 'true';
        dashBridgePanelAnalysisController.retryForFrame(sourceIframe);
        if (new URLSearchParams(location.search).has('guiCapture')) {
            chrome.runtime.sendMessage({ type: 'dashbridge-gui-capture-ready' }).catch(() => undefined);
        }
        return;
    }

    if (e.data.action === 'panelLegendSeries' && typeof e.data.requestId === 'string') {
        const panel = panels.find(item => item.id === sourceIframe.closest('.panel-card')?.dataset.panelId);
        const resolve = panel && panelLegendWaiters.get(e.data.requestId);
        if (resolve && panel?.id === e.data.requestId) {
            panelLegendWaiters.delete(e.data.requestId);
            resolve(Array.isArray(e.data.series) ? e.data.series : []);
        }
        return;
    }

    if (e.data.action === 'panelThresholdStatus') {
        const panel = getPanelForIframe(sourceIframe);
        const resolve = panel && panelThresholdWaiters.get(e.data.requestId);
        if (resolve && panel?.id === e.data.requestId) {
            panelThresholdWaiters.delete(e.data.requestId);
            const safeStatusUnit = normalizePanelMetadataText(e.data.status?.unit);
            if (safeStatusUnit && panel.tools?.thresholdUnit !== safeStatusUnit) {
                panel.tools = { ...panel.tools, thresholdUnit: safeStatusUnit };
                savePanels();
            }
            resolve(e.data.status || null);
            return;
        }
        if (panel) updatePanelThresholdStatus(panel, e.data.status);
        return;
    }

    if (e.data.action === 'broadcastCrosshair' && e.data.percentX !== undefined) {
        broadcastCrosshair(e.data.percentX, e.data.timestamp, sourceIframe);
    } else if (e.data.action === 'broadcastCrosshairHide') {
        hideCrosshair();
    }
});
