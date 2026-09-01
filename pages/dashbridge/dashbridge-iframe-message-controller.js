(function initDashBridgeIframeMessageController(root) {
    'use strict';

    function create({ getFrameOrigin, getPanelForIframe, getPanels,
        acceptReportSnapshot, acceptPanelAnalysis, capturePanel,
        setCapturePrepared, savePanels, syncPanelAnalysisAction,
        acceptTitleResponse, postToDashboardFrame, getCrosshairMode,
        getCrosshairThickness, sendTimeUpdate, applyPanelTools,
        retryPanelAnalysis, acceptLegendSeries, acceptThresholdStatus,
        broadcastCrosshair, hideCrosshair, windowRef = window,
        documentRef = document, locationRef = location, chromeRef = chrome }) {
        const required = [
            getFrameOrigin, getPanelForIframe, getPanels, acceptReportSnapshot,
            acceptPanelAnalysis, capturePanel, setCapturePrepared, savePanels,
            syncPanelAnalysisAction, acceptTitleResponse, postToDashboardFrame,
            getCrosshairMode, getCrosshairThickness, sendTimeUpdate,
            applyPanelTools, retryPanelAnalysis, acceptLegendSeries,
            acceptThresholdStatus, broadcastCrosshair, hideCrosshair,
        ];
        if (required.some(value => typeof value !== 'function')) {
            throw new TypeError('DashBridge iframe message controller dependencies are incomplete');
        }

        const findSourceIframe = event => Array.from(
            documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]'),
        ).find(iframe => iframe.contentWindow === event.source);

        const handleMessage = event => {
            if (!event.data || !event.data.action) return;
            const sourceIframe = findSourceIframe(event);
            if (!sourceIframe || getFrameOrigin(sourceIframe) !== event.origin) return;

            if (event.data.action === 'panelReportSnapshot' && typeof event.data.requestId === 'string') {
                acceptReportSnapshot(event.data.requestId, sourceIframe, event.data.snapshot);
                return;
            }
            if (event.data.action === 'dashbridgePanelAnalysisUpdate'
                && typeof event.data.requestId === 'string') {
                acceptPanelAnalysis(event.data, sourceIframe);
                return;
            }
            if (event.data.action === 'dashbridgePanelCaptureRequest'
                && typeof event.data.requestId === 'string'
                && ['download', 'copy'].includes(event.data.outputAction)) {
                void capturePanel(sourceIframe, getPanelForIframe(sourceIframe), event.data);
                return;
            }
            if (event.data.action === 'dashbridgeCapturePreparedChanged'
                && typeof event.data.enabled === 'boolean') {
                setCapturePrepared(event.data.enabled);
                return;
            }
            if (event.data.action === 'dashbridgePanelTitle') {
                const panel = getPanelForIframe(sourceIframe);
                const title = typeof event.data.title === 'string'
                    ? event.data.title.trim().slice(0, 240)
                    : '';
                if (panel && title && panel.title !== title) {
                    panel.title = title;
                    savePanels();
                    syncPanelAnalysisAction(panel, sourceIframe.closest('.panel-card'));
                }
                return;
            }
            if (event.data.action === 'dashbridgePanelTitleResponse'
                && typeof event.data.requestId === 'string') {
                acceptTitleResponse(event.data);
                return;
            }
            if (event.data.action === 'dashbridgeIframeReady') {
                sourceIframe.dataset.dashbridgeOrigin = event.origin;
                sourceIframe.dataset.dashbridgeLoaded = 'true';
                postToDashboardFrame(sourceIframe, {
                    action: 'setCrosshairMode',
                    mode: getCrosshairMode(),
                    thickness: getCrosshairThickness(),
                });
                const panel = getPanelForIframe(sourceIframe);
                sendTimeUpdate(sourceIframe);
                if (panel) applyPanelTools(panel, sourceIframe);
                retryPanelAnalysis(sourceIframe);
                return;
            }
            if (event.data.action === 'dashbridgePanelRendered') {
                sourceIframe.dataset.dashbridgeRendered = 'true';
                retryPanelAnalysis(sourceIframe);
                if (new URLSearchParams(locationRef.search).has('guiCapture')) {
                    chromeRef.runtime.sendMessage({ type: 'dashbridge-gui-capture-ready' })
                        .catch(() => undefined);
                }
                return;
            }
            if (event.data.action === 'panelLegendSeries'
                && typeof event.data.requestId === 'string') {
                const panelId = sourceIframe.closest('.panel-card')?.dataset.panelId;
                const panel = getPanels().find(item => item.id === panelId);
                acceptLegendSeries(event.data, panel);
                return;
            }
            if (event.data.action === 'panelThresholdStatus') {
                acceptThresholdStatus(event.data, getPanelForIframe(sourceIframe));
                return;
            }
            if (event.data.action === 'broadcastCrosshair' && event.data.percentX !== undefined) {
                broadcastCrosshair(event.data.percentX, event.data.timestamp, sourceIframe);
            } else if (event.data.action === 'broadcastCrosshairHide') {
                hideCrosshair();
            }
        };

        const setup = () => windowRef.addEventListener('message', handleMessage);
        return Object.freeze({ setup, handleMessage });
    }

    root.DashBridgeIframeMessageController = Object.freeze({ create });
})(globalThis);
