(function initGrafanaVariablesBridge() {
    'use strict';
    if (window.name !== 'dashbridge-iframe') return;
    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
    let pending = null;
    let timer = null;
    const clear = () => { pending = null; clearTimeout(timer); };
    const request = event => {
        const data = event.data;
        if (!data || !(data.action === 'dashbridgeVariablesRequest')) return;
        if (event.source !== window.parent || event.origin !== extensionOrigin
            || pending
            || typeof data.requestId !== 'string' || data.requestId.length > 100
            || !['read', 'refresh', 'set'].includes(data.operation)) return;
        if (data.operation === 'set' && (!Array.isArray(data.values) || data.values.length > 5000
            || data.values.some(value => typeof value !== 'string' || value.length > 16000)
            || data.values.join('').length > 100000)) return;
        pending = data.requestId;
        timer = setTimeout(clear, 25000);
        document.dispatchEvent(new CustomEvent('dashbridgeVariablesRequest', {
            detail: { requestId: pending, operation: data.operation, name: String(data.name || '').slice(0, 200),
                ...(data.operation === 'set' ? { values: [...data.values] } : {}) }
        }));
    };
    const response = event => {
        if (!pending || event.detail?.requestId !== pending) return;
        let encoded;
        try { encoded = JSON.stringify(event.detail); } catch { return; }
        if (encoded.length > 2000000) return;
        const data = JSON.parse(encoded);
        clear();
        window.parent.postMessage({ ...data, action: 'dashbridgeVariablesResponse' }, extensionOrigin);
    };
    window.addEventListener('message', request);
    document.addEventListener('dashbridgeVariablesResponse', response);
    window.addEventListener('pagehide', () => {
        clear();
        window.removeEventListener('message', request);
        document.removeEventListener('dashbridgeVariablesResponse', response);
    }, { once: true });
})();
