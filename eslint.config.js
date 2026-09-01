'use strict';

const readonly = names => Object.fromEntries(names.map(name => [name, 'readonly']));

const webGlobals = readonly([
    'AbortController', 'AbortSignal', 'Audio', 'Blob', 'CSS', 'CSSStyleSheet',
    'CanvasRenderingContext2D', 'ClipboardItem', 'CustomEvent', 'DOMException',
    'DOMParser', 'DataTransfer', 'Document', 'Element', 'Event', 'File',
    'FileReader', 'FormData', 'Headers', 'HTMLElement', 'HTMLCanvasElement',
    'HTMLFormElement', 'HTMLImageElement', 'HTMLInputElement', 'HTMLSelectElement',
    'HTMLTextAreaElement', 'Image', 'ImageData', 'IntersectionObserver',
    'KeyboardEvent', 'MessageChannel', 'MouseEvent', 'MutationObserver', 'Node',
    'OffscreenCanvas', 'Path2D', 'PerformanceObserver', 'Range', 'Request',
    'ResizeObserver', 'Response', 'ShadowRoot', 'TextDecoder', 'TextEncoder',
    'URL', 'URLSearchParams', 'WebSocket', 'WheelEvent', 'Window', 'Worker',
    'XMLHttpRequest', 'XMLSerializer', 'alert', 'atob', 'btoa',
    'cancelAnimationFrame', 'caches', 'chrome', 'clearInterval', 'clearTimeout',
    'close', 'confirm', 'console', 'createImageBitmap', 'crypto', 'document',
    'fetch', 'getComputedStyle', 'history', 'indexedDB', 'localStorage',
    'importScripts', 'innerHeight', 'innerWidth', 'location', 'matchMedia',
    'navigator', 'open', 'origin', 'performance', 'prompt', 'queueMicrotask',
    'requestAnimationFrame', 'screen', 'self', 'sessionStorage', 'setInterval',
    'setTimeout', 'structuredClone', 'window', 'EventTarget', 'PointerEvent',
    'PopStateEvent'
]);

const extensionRuntimeGlobals = readonly([
    'Chart', 'JSZip', 'DashBridgeArchiveBudget', 'DashBridgeBatchCaptureWindowRunner',
    'DashBridgeBatchPageState', 'DashBridgeBatchPanelRules', 'DashBridgeCaptureOutput',
    'DashBridgeComparisonXlsx', 'DashBridgeDashflowExport', 'DashBridgeDashflowIo',
    'DashBridgeDataMigration', 'DashBridgeFlowCompare', 'DashBridgeFlowSchema',
    'DashBridgeGrafanaBatchPanelRules', 'DashBridgeGrafanaDashboardApi',
    'DashBridgeGrafanaPanelIdentity', 'DashBridgeGrafanaRuntimeManifest',
    'DashBridgeGrafanaSettings', 'DashBridgeGrafanaTime', 'DashBridgeLocalStateSchema',
    'DashBridgeOperationProgress', 'DashBridgePanelDefinition', 'DashBridgeProfileStore',
    'DashBridgeReport', 'DashBridgeReportTransport', 'DashBridgeStorageWriter',
    'DashBridgeSyncInputWriter', 'DashBridgeTheme', 'DashBridgeTimeState',
    'DashBridgeUpdateMetadata', 'DashBridgeUrlPolicy', 'DashBridgeVisualEngine',
    'DashBridgeWindowLayout', 'DashBridgeDnrRules', 'DashBridgeRenderer',
    'DashBridgeTestReport', 'DashBridgeTestRunner', 'DashBridgeUpdateCheck',
    'DashBridgeWorklogMetrics', 'BatchCaptureUtils', 'BatchPageState',
    'BatchPageUi', 'BatchPanelRules', 'BatchRunLifecycle', 'BatchSeriesSelection',
    'BatchMainRunController', 'BatchOperationController', 'BatchPageController',
    'BatchPanelPicker', 'BatchPanelRulesUi', 'BatchSeriesDiscoveryController',
    'BatchSeriesRunController',
    'DashBridgeCapture', 'DashBridgeDragController', 'DashBridgeFrameController',
    'DashBridgeIframeMessageController',
    'DashBridgePanelActionsController', 'DashBridgePanelAdditionController',
    'DashBridgePanelAnalysisController',
    'DashBridgePageUiController', 'DashBridgePanelCardController', 'DashBridgePanelToolsController',
    'DashBridgePanelTransferController', 'DashBridgeProfileController',
    'DashBridgeRecorderNetworkCapture', 'DashBridgeRecorderReplay', 'DashBridgeRecorderView', 'DashBridgeReportAudit',
    'DashBridgeReportController', 'DashBridgeReportTestRunner',
    'DashBridgeTimeController',
    'DASHBRIDGE_TEST_SUITE', 'DIAGNOSTIC_CAPTURE_MODES',
    'applyGrafanaCompleteHideSelection', 'applySharedGrafanaPanelTools',
    'buildGrafanaPanelUrl', 'buildGrafanaSoloPanelUrl',
    'buildRuntimeDiagnosticDiff', 'captureGrafanaPanelImage',
    'captureRuntimeDiagnostic', 'createBatchCaptureWindowRunner',
    'createBatchPanelLoader', 'createDashBridgeCrosshair',
    'createRollingZipArchive', 'dashbridgeRunProbe', 'detectGrafanaTimeFormat',
    'disableAutoRefresh', 'downloadZipArchive', 'ensureEarlyGrafanaRuntimeForUrl',
    'ensureGrafanaRuntime', 'execMain', 'fetchGrafanaDashboardDefinition',
    'fetchGrafanaDashboardPanels', 'findGrafanaDashboardPanel',
    'getGrafanaPanelQuerySignatures', 'getGrafanaSettingsDefaults',
    'getGrafanaSettingsStorageKeys', 'getTestFeatureReference',
    'installRuntimeDiagnostics', 'normalizeGrafanaSettings',
    'normalizeGrafanaTimeRanges', 'normalizeHttpBaseUrl', 'normalizeHttpHost',
    'normalizeHttpOrigin', 'parseGrafanaAbsoluteTime',
    'parseGrafanaDashboardUrl', 'parseGrafanaUrlTimeRange', 'parseHttpUrl',
    'readNetworkDiagnosticArchive', 'readRuntimeDiagnosticEvents',
    'resolvePanelId', 'restoreAutoRefresh', 'runGrafanaCommand',
    'runtimeSnapshotRef', 'serializeGrafanaAbsoluteTime',
    'setGrafanaLegendVisibility'
]);

const nodeGlobals = readonly([
    'AbortController', 'Blob', 'Buffer', 'DOMException', 'Event', 'Headers',
    'Request', 'Response', 'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams',
    '__dirname', '__filename', 'btoa',
    'clearImmediate', 'clearInterval', 'clearTimeout', 'console', 'exports',
    'fetch', 'global', 'module', 'process', 'queueMicrotask', 'require',
    'setImmediate', 'setInterval', 'setTimeout', 'structuredClone'
]);

const correctnessRules = {
    'constructor-super': 'error',
    'for-direction': 'error',
    'getter-return': ['error', { allowImplicit: true }],
    'no-async-promise-executor': 'error',
    'no-class-assign': 'error',
    'no-compare-neg-zero': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-const-assign': 'error',
    'no-constant-binary-expression': 'error',
    'no-control-regex': 'off',
    'no-debugger': 'error',
    'no-dupe-args': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-else-if': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty-character-class': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-fallthrough': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-invalid-regexp': 'error',
    'no-irregular-whitespace': 'off',
    'no-loss-of-precision': 'error',
    'no-new-native-nonconstructor': 'error',
    'no-obj-calls': 'error',
    'no-promise-executor-return': 'off',
    'no-prototype-builtins': 'error',
    'no-redeclare': ['error', { builtinGlobals: false }],
    'no-self-assign': 'error',
    'no-setter-return': 'error',
    'no-shadow-restricted-names': 'error',
    'no-sparse-arrays': 'error',
    'no-this-before-super': 'error',
    'no-undef': 'error',
    'no-unexpected-multiline': 'error',
    'no-unreachable': 'error',
    'no-unreachable-loop': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'no-unused-labels': 'error',
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-useless-escape': 'off',
    'no-with': 'error',
    'require-yield': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    // Classic scripts intentionally expose top-level functions to later HTML
    // scripts. Dependency contracts, not lexical scope, own that usage.
    'no-unused-vars': 'off'
};

module.exports = [
    {
        ignores: [
            '.git/**', '.gitnexus/**', 'dist/**', 'node_modules/**',
            'test-results/**', 'vendor/**'
        ]
    },
    {
        files: ['js/**/*.js', 'pages/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...webGlobals, ...extensionRuntimeGlobals }
        },
        rules: correctnessRules
    },
    {
        files: ['test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: nodeGlobals
        },
        rules: correctnessRules
    },
    {
        // These files are pasted/injected into a real browser page by the
        // diagnostic workflow, even though they live below test/.
        files: ['test/devtools-e2e-*-diagnostics.js'],
        languageOptions: {
            globals: webGlobals
        }
    }
];
