(function initDashBridgeGrafanaNetwork(root) {
    'use strict';
    const readFetchBody = async (input, init) => {
        if (init && Object.prototype.hasOwnProperty.call(init, 'body')) return init.body;
        if (typeof Request !== 'undefined' && input instanceof Request) {
            try { return await input.clone().text(); } catch { return null; }
        }
        return null;
    };
    const safeResponseHeaders = headers => {
        const copy = new Headers(headers || undefined);
        copy.delete('content-length');
        copy.delete('content-encoding');
        return copy;
    };
    const createBodyResponse = (body, original) => new Response(body, {
        status: original.status,
        statusText: original.statusText,
        headers: safeResponseHeaders(original.headers)
    });
    const createJsonResponse = (data, original) => createBodyResponse(JSON.stringify(data), original);
    const readXhrJson = xhr => {
        const type = xhr.responseType || 'text';
        if (type === 'json') return { supported: true, type, data: xhr.response };
        if (type === 'text') {
            try { return { supported: true, type, data: JSON.parse(xhr.responseText) }; }
            catch (error) { return { supported: true, type, error }; }
        }
        return { supported: false, type, data: null };
    };
    root.DashBridgeGrafanaNetwork = Object.freeze({
        readFetchBody, safeResponseHeaders, createBodyResponse, createJsonResponse, readXhrJson
    });
})(globalThis);
