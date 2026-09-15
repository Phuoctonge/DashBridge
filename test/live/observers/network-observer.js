'use strict';

function attachNetworkObserver(page, { maxEntries = 100 } = {}) {
    const entries = [];
    const limit = Math.max(1, Math.min(1000, Number(maxEntries) || 100));
    const push = entry => { entries.push(entry); if (entries.length > limit) entries.splice(0, entries.length - limit); };
    const onFailed = request => push({ at: Date.now(), kind: 'failed', method: String(request.method?.() || ''), resourceType: String(request.resourceType?.() || ''), failure: String(request.failure?.()?.errorText || '').slice(0, 160) });
    const onFinished = request => push({ at: Date.now(), kind: 'finished', method: String(request.method?.() || ''), resourceType: String(request.resourceType?.() || '') });
    page.on('requestfailed', onFailed);
    page.on('requestfinished', onFinished);
    let detached = false;
    return {
        snapshot: () => entries.map(entry => ({ ...entry })),
        drain: () => { const value = entries.map(entry => ({ ...entry })); entries.length = 0; return value; },
        detach() { if (detached) return; detached = true; page.off('requestfailed', onFailed); page.off('requestfinished', onFinished); },
    };
}

module.exports = { attachNetworkObserver };
