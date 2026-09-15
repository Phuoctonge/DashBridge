'use strict';

function attachWorkerObserver(context, { maxEntries = 100 } = {}) {
    const entries = [];
    const limit = Math.max(1, Math.min(1000, Number(maxEntries) || 100));
    const workers = new Set();
    const handlers = new Map();
    const push = entry => { entries.push(entry); if (entries.length > limit) entries.splice(0, entries.length - limit); };
    const attach = worker => {
        if (!worker || workers.has(worker)) return;
        workers.add(worker);
        const onConsole = message => push({ at: Date.now(), kind: 'console', type: String(message.type?.() || ''), text: String(message.text?.() || '').slice(0, 512) });
        const onError = error => push({ at: Date.now(), kind: 'error', text: String(error.message || error).slice(0, 512) });
        worker.on('console', onConsole);
        worker.on('pageerror', onError);
        handlers.set(worker, { onConsole, onError });
    };
    for (const worker of context.serviceWorkers?.() || []) attach(worker);
    const onWorker = worker => attach(worker);
    context.on?.('serviceworker', onWorker);
    let detached = false;
    return {
        snapshot: () => entries.map(entry => ({ ...entry })),
        drain: () => { const result = entries.map(entry => ({ ...entry })); entries.length = 0; return result; },
        detach() {
            if (detached) return;
            detached = true;
            context.off?.('serviceworker', onWorker);
            for (const worker of workers) { const handler = handlers.get(worker); worker.off?.('console', handler.onConsole); worker.off?.('pageerror', handler.onError); }
            workers.clear(); handlers.clear();
        },
    };
}
module.exports = { attachWorkerObserver };
