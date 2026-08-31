(function initDashBridgeFrameController(root) {
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

    root.DashBridgeFrameController = Object.freeze({ getFrameOrigin, post, navigate });
})(globalThis);
