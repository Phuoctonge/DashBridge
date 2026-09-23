// Batch page controller.

document.addEventListener("DOMContentLoaded", () => {
    const batchPageController = BatchPageController.create({
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
    const updateActionVisibility = batchOperation.updateActionVisibility;
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
    seriesDiscoveryController.setup();

    BatchSeriesRunController.create({
        startButton: document.getElementById('startSeriesBtn'),
        operation: batchOperation,
        lifecycle: BatchRunLifecycle,
        discovery: seriesDiscoveryController,
        seriesSelection: BatchSeriesSelection,
        panelRules: BatchPanelRules,
        captureUtils: BatchCaptureUtils,
        normalizeRangesField: normalizeTimeRangesField,
        getCaptureTheme,
        updateProgress: updateBatchProgress,
        showToast,
        logMessage,
        parseUrl: parseGrafanaUrl,
        buildPanelUrl: buildGrafanaPanelUrl,
        applyCompleteHideSelection: applyGrafanaCompleteHideSelection,
        setLegendVisibility: setGrafanaLegendVisibility,
        createArchive: createRollingZipArchive,
    }).setup();
});
