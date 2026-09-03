let profiles = [];
let activeProfileId = null;
let panels = []; // Всегда синхронизирован с активным профилем
const dashBridgeRuntimeScopeId = crypto.randomUUID();
let dashBridgeTimeController = null;
let dashBridgePanelToolsController = null;
let dashBridgePanelCardController = null;
let dashBridgePageUiController = null;
let dashBridgeReportController = null;

function invalidateActiveProfileRuntime() {
    dashBridgeReportController?.invalidateProfileContext();
}

function forceLoadPanel(id) {
    return dashBridgePanelCardController.forceLoadPanel(id);
}

function refreshPanel(id) {
    return dashBridgePanelCardController.refreshPanel(id);
}

function updatePanelCard(panelId, options) {
    return dashBridgePanelCardController.updatePanelCard(panelId, options);
}

function replaceDashboardPanelCard(panelId) {
    return dashBridgePanelCardController.replacePanelCard(panelId);
}

function appendDashboardPanelCards(addedPanels) {
    return dashBridgePanelCardController.appendPanelCards(addedPanels);
}

function removeDashboardPanelCard(panelId) {
    return dashBridgePanelCardController.removePanelCard(panelId);
}

function panelFrameSignature(panel) {
    return dashBridgePanelCardController.panelFrameSignature(panel);
}

function adoptPanelState(target, source) {
    return dashBridgePanelCardController.adoptPanelState(target, source);
}

function reconcileDashboardPanelCards(previousPanels) {
    return dashBridgePanelCardController.reconcilePanelCards(previousPanels);
}

function renderDashboard() {
    return dashBridgePanelCardController.renderDashboard();
}

function setupEventListeners() {
    return dashBridgePageUiController.setup();
}

function updateCrosshairBtn() {
    return dashBridgePageUiController.updateCrosshairControls();
}

function loadActiveProfileTimeState() {
    return dashBridgeTimeController.loadProfileState();
}

function syncTimeControlsFromState() {
    return dashBridgeTimeController.syncControls();
}

function getPanelTools(panel) {
    return dashBridgePanelToolsController.normalizeTools(panel);
}

function applyPanelTools(panel, iframe) {
    return dashBridgePanelToolsController.apply(panel, iframe);
}

function openPanelTools(panel, iframe) {
    return dashBridgePanelToolsController.open(panel, iframe);
}
const { showAlert, showConfirm, showPrompt } = window.DashBridgeModal;
const {
    isSupportedPanelUrl,
    normalizeGrafanaPanelUrl,
    buildDashBridgeSoloPanelUrl,
    getProfilePanelIdentity,
    parseQuickPanelIds,
} = window.DashBridgePanelUrl;
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
    invalidateActiveProfileRuntime,
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
} = DashBridgeIframeMessageController;
const dashBridgePanelAnalysisController = DashBridgePanelAnalysisController.create({
    postToDashboardFrame,
    normalizePanelMetadataText,
    analysisApi: window.DashBridgeGrafanaPanelAnalysis,
    getTransformSettings: () => grafanaTransformSettings,
    findPanelCard,
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
    runtimeScopeId: dashBridgeRuntimeScopeId,
});
const applyPanelParamsToUrl = dashBridgeTimeController.applyPanelParamsToUrl;
const getPanelForIframe = dashBridgeTimeController.getPanelForIframe;
const broadcastTimeUpdate = dashBridgeTimeController.broadcast;
const setupTimeControls = dashBridgeTimeController.setupControls;

let defaultCapturePrepared = false;

dashBridgePanelToolsController = DashBridgePanelToolsController.create({
    postToDashboardFrame,
    getCapturePrepared: () => defaultCapturePrepared,
    getTransformSettings: () => grafanaTransformSettings,
    getDefaultCpuCapacityCoefficient: () => grafanaTransformSettings.grafanaCpuCapacityCoefficient,
    normalizePanelMetadataText,
    savePanels,
    forceLoadPanel,
    refreshPanel,
    settingsStorage: chrome.storage.sync,
    getSettingsKeys: getGrafanaSettingsStorageKeys,
    normalizeSettings: normalizeGrafanaSettings,
    panelAnalysis: window.DashBridgeGrafanaPanelAnalysis,
    settingsModal: window.DashBridgePanelSettingsModal,
    escapeHtml,
});
const dashBridgePanelTransferController = DashBridgePanelTransferController.create({
    transfer: window.DashBridgePanelTransfer,
    showAlert,
    showConfirm,
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    getProfiles: () => profiles,
    getActiveProfile,
    setTabActiveProfileId,
    savePanels,
    saveProfiles,
    loadActiveProfileTimeState,
    syncTimeControlsFromState,
    renderProfileSwitcher,
    renderDashboard,
});
const dashBridgePanelAdditionController = DashBridgePanelAdditionController.create({
    normalizePanelUrl: normalizeGrafanaPanelUrl,
    buildSoloPanelUrl: buildDashBridgeSoloPanelUrl,
    getPanelIdentity: getProfilePanelIdentity,
    parsePanelIds: parseQuickPanelIds,
    parseDashboardUrl: parseGrafanaDashboardUrl,
    fetchDashboardPanels: fetchGrafanaDashboardPanels,
    normalizePanelMetadataText,
    showAlert,
    currentProfileHasPanel,
    getCurrentProfilePanelIdentities,
    getPanels: () => panels,
    savePanels,
    appendPanelCards: appendDashboardPanelCards,
});

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

dashBridgeReportController = DashBridgeReportController.create({
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
        const migration = await DashBridgeDataMigration.run();
        if (migration?.migrated) {
            globalThis.DashBridgeAnalytics?.track('extension.data_migration', 'lifecycle', {});
        }
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
    dashBridgeCapture.syncToggles(defaultCapturePrepared);
    setupTimeControls();
    setupEventListeners();
    dashBridgePanelCardController.setupDrag();
    const crosshairSlider = document.getElementById('crosshairThicknessSlider');
    if (crosshairSlider) crosshairSlider.value = crosshairThickness;
    updateCrosshairBtn();
    renderProfileSwitcher();
    renderDashboard();
});

function getCompactCaptureDimensions() {
    return {
        width: grafanaTransformSettings.grafanaCompactExportWidth,
        height: grafanaTransformSettings.grafanaCompactExportHeight
    };
}

function findPanelCard(panelId) {
    return document.querySelector(`.panel-card[data-panel-id="${CSS.escape(String(panelId))}"]`);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (Object.keys(changes).some(key => grafanaTransformSettingKeys.has(key))) {
        const nextSettings = { ...grafanaTransformSettings };
        Object.entries(changes).forEach(([key, change]) => {
            if (grafanaTransformSettingKeys.has(key)) nextSettings[key] = change.newValue;
        });
        grafanaTransformSettings = normalizeGrafanaSettings(nextSettings);
        panels.forEach(panel => dashBridgePanelAnalysisController.syncAction(panel));
    }
    if (changes.grafanaCompactScreenshot) {
        const nextPrepared = !!changes.grafanaCompactScreenshot.newValue;
        // A local click already updated every iframe before persisting. Ignore
        // its storage echo; external-tab changes still propagate normally.
        if (nextPrepared !== defaultCapturePrepared) {
            dashBridgeCapture.setPrepared(nextPrepared, { persist: false });
        }
    } else if (changes.grafanaCompactExportWidth || changes.grafanaCompactExportHeight) {
        dashBridgeCapture.syncToggles(defaultCapturePrepared);
        dashBridgeCapture.broadcastPrepared(defaultCapturePrepared);
    }
});

function escapeHtml(str) {
    return DashBridgeRenderer.escapeHtml(str);
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
    setDefaultCapturePrepared: value => { defaultCapturePrepared = value; },
    getCompactCaptureDimensions,
    forceLoadPanel,
    postToDashboardFrame,
    showAlert,
});
const captureAllDashboardPanels = dashBridgeCapture.captureAll;
const runDashboardToolbarCapture = dashBridgeCapture.captureFromToolbar;
const captureDashbridgePanel = dashBridgeCapture.capturePanel;

dashBridgePanelCardController = DashBridgePanelCardController.create({
    renderer: DashBridgeRenderer,
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels,
    getActiveProfile,
    applyPanelParamsToUrl,
    navigateDashboardFrame,
    findPanelCard,
    getPanelAnalysisType: dashBridgePanelAnalysisController.getType,
    syncPanelAnalysisAction: dashBridgePanelAnalysisController.syncAction,
    closePanelAnalysis: closeDashboardPanelAnalysis,
    isPanelAnalysisOpen: dashBridgePanelAnalysisController.isPanel,
    escapeHtml,
    actionDependencies: {
        showAlert,
        showConfirm,
        setPanelDataStatus: setDashboardPanelDataStatus,
        postToDashboardFrame,
        panelAnalysis: dashBridgePanelAnalysisController,
        panelTools: dashBridgePanelToolsController,
        isSupportedPanelUrl,
        normalizePanelUrl: normalizeGrafanaPanelUrl,
        runToolbarCapture: runDashboardToolbarCapture,
        openPanelReportEditor,
        openPanelTools,
        openPanelAnalysis: openDashboardPanelAnalysis,
    },
    runtimeScopeId: dashBridgeRuntimeScopeId,
    icons: {
        grip: SVG_GRIP,
        expand: SVG_EXPAND,
        collapse: SVG_COLLAPSE,
        refresh: SVG_REFRESH,
        pause: SVG_PAUSE,
        resume: SVG_RESUME,
        captureSave: SVG_CAPTURE_SAVE,
        captureCopy: SVG_CAPTURE_COPY,
        iframeSettings: SVG_IFRAME_SETTINGS,
        panelSettings: SVG_PANEL_SETTINGS,
        report: SVG_REPORT,
        more: SVG_MORE,
        analysis: SVG_ANALYSIS,
        open: SVG_OPEN,
        delete: SVG_DELETE,
    },
});

dashBridgePageUiController = DashBridgePageUiController.create({
    getCrosshairMode: () => crosshairMode,
    setCrosshairMode: value => { crosshairMode = value; },
    getCrosshairThickness: () => crosshairThickness,
    setCrosshairThickness: value => { crosshairThickness = value; },
    hideCrosshair,
    postToDashboardFrame,
    getFrames: () => document.querySelectorAll('iframe[name="dashbridge-iframe"]'),
    getCapturePrepared: () => defaultCapturePrepared,
    setCapturePrepared: dashBridgeCapture.setPrepared,
    captureAllPanels: captureAllDashboardPanels,
    renderProfileSwitcher,
    showPrompt,
    createProfile,
    renameActiveProfile,
    deleteProfile,
    getActiveProfile,
    getActiveProfileId: () => activeProfileId,
    openReportSettings,
    openReportPreview,
    openReportTest: () => dashBridgeReportTestRunner.open(),
    setupPanelAddition: dashBridgePanelAdditionController.setup,
    closeDashboardPickerIfOpen: dashBridgePanelAdditionController.closeDashboardPickerIfOpen,
    setupPanelTransfer: dashBridgePanelTransferController.setup,
    closePanelAnalysis: closeDashboardPanelAnalysis,
    closePanelExtraActions: dashBridgePanelCardController.closeExtraActions,
    exitFullscreen: dashBridgePanelCardController.exitFullscreen,
});

window.deletePanel = dashBridgePanelCardController.deletePanel;
window.refreshPanel = dashBridgePanelCardController.refreshPanel;

DashBridgeIframeMessageController.create({
    getPanelForIframe,
    getPanels: () => panels,
    acceptReportSnapshot: dashBridgeReportTransport.acceptSnapshot,
    acceptPanelAnalysis: dashBridgePanelAnalysisController.accept,
    capturePanel: captureDashbridgePanel,
    setCapturePrepared: dashBridgeCapture.setPrepared,
    savePanels,
    syncPanelAnalysisAction: dashBridgePanelAnalysisController.syncAction,
    acceptTitleResponse: dashBridgePanelToolsController.acceptTitleResponse,
    acceptPanelToolsApplied: dashBridgePanelToolsController.acceptApplied,
    getCrosshairMode: () => crosshairMode,
    getCrosshairThickness: () => crosshairThickness,
    sendTimeUpdate: dashBridgeTimeController.sendTimeUpdate,
    applyPanelTools,
    retryPanelAnalysis: dashBridgePanelAnalysisController.retryForFrame,
    acceptLegendSeries: dashBridgePanelToolsController.acceptLegendSeries,
    acceptThresholdStatus: dashBridgePanelToolsController.acceptThresholdStatus,
    broadcastCrosshair,
    hideCrosshair,
}).setup();
