(function initDashBridgeIframeMessageController(root) {
    'use strict';

    function getFrameOrigin(iframe) {
        try {
            const src = iframe?.dataset?.src || iframe?.src;
            if (src && src !== 'about:blank') return new URL(src).origin;
        } catch { /* Invalid or unavailable iframe URL. */ }
        return null;
    }

    function post(iframe, message) {
        if (!iframe?.isConnected || !iframe.contentWindow || iframe.dataset.dashbridgeLoaded !== 'true') return false;
        const targetOrigin = getFrameOrigin(iframe);
        if (!targetOrigin || iframe.dataset.dashbridgeOrigin !== targetOrigin) return false;
        try {
            iframe.contentWindow.postMessage(message, targetOrigin);
            return true;
        } catch {
            return false;
        }
    }

    function navigate(iframe, url) {
        if (!iframe || !url) return;
        iframe.dataset.dashbridgeLoaded = 'false';
        iframe.dataset.dashbridgeRendered = 'false';
        delete iframe.dataset.dashbridgeOrigin;
        iframe.src = url;
    }

    function create({ getFrameOrigin: resolveFrameOrigin = getFrameOrigin, getPanelForIframe, getPanels,
        acceptReportSnapshot, acceptPanelAnalysis, capturePanel,
        setCapturePrepared, savePanels, syncPanelAnalysisAction,
        acceptTitleResponse, postToDashboardFrame = post, getCrosshairMode,
        getCrosshairThickness, sendTimeUpdate, applyPanelTools,
        retryPanelAnalysis, acceptLegendSeries, acceptThresholdStatus,
        broadcastCrosshair, hideCrosshair, windowRef = window,
        documentRef = document, locationRef = location, chromeRef = chrome }) {
        const required = [
            resolveFrameOrigin, getPanelForIframe, getPanels, acceptReportSnapshot,
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
            if (!sourceIframe || resolveFrameOrigin(sourceIframe) !== event.origin) return;
            const sourcePanel = getPanelForIframe(sourceIframe);
            // A profile switch updates the active panel collection before the
            // old cards are unmounted. Reject every message from those stale
            // frames, even when another profile reused the same panel UUID.
            if (!sourcePanel) return;

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
                void capturePanel(sourceIframe, sourcePanel, event.data);
                return;
            }
            if (event.data.action === 'dashbridgeCapturePreparedChanged'
                && typeof event.data.enabled === 'boolean') {
                setCapturePrepared(event.data.enabled);
                return;
            }
            if (event.data.action === 'dashbridgePanelTitle') {
                const panel = sourcePanel;
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
                const panel = sourcePanel;
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
                acceptLegendSeries(event.data, sourcePanel);
                return;
            }
            if (event.data.action === 'panelThresholdStatus') {
                acceptThresholdStatus(event.data, sourcePanel);
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

    root.DashBridgeIframeMessageController = Object.freeze({ create, getFrameOrigin, post, navigate });
})(globalThis);
