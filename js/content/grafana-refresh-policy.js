// Runs at document_start before Grafana reads its saved dashboard refresh.
// It changes only the small dashboard-definition response for DashBridge
// iframes whose URL fragment explicitly requests Off.
(() => {
    'use strict';

    const isDashboardIframe = window.name === 'dashbridge-iframe';
    const bootstrap = window.DashBridgeGrafanaPanelBootstrap;
    const policy = bootstrap?.readRefreshPolicyFromUrl?.(location.href);
    if (!isDashboardIframe || policy !== 'off' || typeof window.fetch !== 'function') return;
    if (window.__dashbridgeRefreshPolicyInstalled) return;
    window.__dashbridgeRefreshPolicyInstalled = true;

    const diagnostic = window.__dashbridgeRefreshPolicyDiagnostic = {
        policy: 'off', matched: 0, applied: 0, failed: 0
    };
    const originalFetch = window.fetch;
    let pending = true;

    const requestUrl = input => typeof input === 'string' || input instanceof URL
        ? String(input) : String(input?.url || '');
    const requestMethod = (input, init) => String(
        init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const isDashboardDefinitionRequest = (input, init) => {
        if (requestMethod(input, init) !== 'GET') return false;
        try {
            const url = new URL(requestUrl(input), location.href);
            return url.origin === location.origin
                && /\/api\/dashboards\/(?:uid|db)\/[^/?#]+\/?$/.test(url.pathname);
        } catch {
            return false;
        }
    };
    const createBodyResponse = (body, original) => {
        const headers = new Headers(original.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(body, {
            status: original.status,
            statusText: original.statusText,
            headers
        });
    };

    window.fetch = async (...args) => {
        if (!pending || !isDashboardDefinitionRequest(args[0], args[1])) {
            return originalFetch(...args);
        }
        diagnostic.matched += 1;
        const response = await originalFetch(...args);
        if (!response.ok) return response;

        let originalText;
        try {
            originalText = await response.text();
            const payload = JSON.parse(originalText);
            if (!payload?.dashboard || typeof payload.dashboard !== 'object' || Array.isArray(payload.dashboard)) {
                return createBodyResponse(originalText, response);
            }
            payload.dashboard.refresh = '';
            pending = false;
            diagnostic.applied += 1;
            return createBodyResponse(JSON.stringify(payload), response);
        } catch (_) {
            diagnostic.failed += 1;
            return originalText === undefined ? response : createBodyResponse(originalText, response);
        }
    };
})();
