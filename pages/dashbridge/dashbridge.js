let profiles = [];
let activeProfileId = null;
let panels = []; // Всегда синхронизирован с активным профилем
let dashBridgeTimeController = null;
let dashBridgePanelToolsController = null;
let dashBridgePanelCardController = null;
let dashBridgePanelActionsController = null;

function forceLoadPanel(id) {
    return dashBridgePanelCardController.forceLoadPanel(id);
}

function refreshPanel(id) {
    return dashBridgePanelActionsController.refreshPanel(id);
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
const dashBridgeDragController = DashBridgeDragController.create({
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels,
});
const setupDashboardDragAndDrop = dashBridgeDragController.setup;
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

    dashBridgePanelAdditionController.setup();
    dashBridgePanelTransferController.setup();

    // --- ESC выходит из fullscreen ---
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        dashBridgePanelAdditionController.closeDashboardPickerIfOpen();
        closeDashboardPanelAnalysis();
        closePanelExtraActions();
        dashBridgePanelActionsController.exitFullscreen();
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

dashBridgePanelActionsController = DashBridgePanelActionsController.create({
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels,
    showAlert,
    showConfirm,
    setPanelDataStatus: setDashboardPanelDataStatus,
    forceLoadPanel,
    applyPanelParamsToUrl,
    navigateDashboardFrame,
    findPanelCard,
    postToDashboardFrame,
    removePanelCard: removeDashboardPanelCard,
    replacePanelCard: replaceDashboardPanelCard,
    updatePanelCard,
    panelAnalysis: dashBridgePanelAnalysisController,
    closePanelAnalysis: closeDashboardPanelAnalysis,
    panelTools: dashBridgePanelToolsController,
    isSupportedPanelUrl,
    normalizePanelUrl: normalizeGrafanaPanelUrl,
    escapeHtml,
    runToolbarCapture: runDashboardToolbarCapture,
    openPanelReportEditor,
    openPanelTools,
    syncPanelAnalysisAction,
    closePanelExtraActions,
    togglePanelExtraActions,
    openPanelAnalysis: openDashboardPanelAnalysis,
    icons: { expand: SVG_EXPAND, collapse: SVG_COLLAPSE },
});

dashBridgePanelCardController = DashBridgePanelCardController.create({
    renderer: DashBridgeRenderer,
    getPanels: () => panels,
    getActiveProfile,
    applyPanelParamsToUrl,
    navigateDashboardFrame,
    bindCardDrag: dashBridgeDragController.bindCard,
    bindPanelActions: dashBridgePanelActionsController.bindPanelActions,
    findPanelCard,
    getPanelAnalysisType,
    syncPanelAnalysisAction,
    closePanelAnalysis: closeDashboardPanelAnalysis,
    isPanelAnalysisOpen: dashBridgePanelAnalysisController.isPanel,
    onPanelRemoved: dashBridgePanelActionsController.handlePanelRemoved,
    escapeHtml,
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

window.deletePanel = dashBridgePanelActionsController.deletePanel;
window.refreshPanel = dashBridgePanelActionsController.refreshPanel;

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
        dashBridgePanelToolsController.acceptTitleResponse(e.data);
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
        dashBridgePanelToolsController.acceptLegendSeries(e.data, panel);
        return;
    }

    if (e.data.action === 'panelThresholdStatus') {
        const panel = getPanelForIframe(sourceIframe);
        dashBridgePanelToolsController.acceptThresholdStatus(e.data, panel);
        return;
    }

    if (e.data.action === 'broadcastCrosshair' && e.data.percentX !== undefined) {
        broadcastCrosshair(e.data.percentX, e.data.timestamp, sourceIframe);
    } else if (e.data.action === 'broadcastCrosshairHide') {
        hideCrosshair();
    }
});
