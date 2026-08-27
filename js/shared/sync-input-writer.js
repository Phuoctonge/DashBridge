(function initDashBridgeSyncInputWriter(root) {
    'use strict';

    const writeSync = values => new Promise((resolve, reject) => {
        chrome.storage.sync.set(values, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message || String(error)));
            else resolve();
        });
    });

    function create({ key, delay = 500, onError = error => console.error('Не удалось сохранить настройку:', error) }) {
        let timer = null;
        let pending = false;
        let latestValue;
        let chain = Promise.resolve();
        const report = error => { onError(error); return undefined; };
        const commit = () => {
            if (!pending) return chain;
            const value = latestValue;
            pending = false;
            chain = chain.catch(() => undefined).then(() => writeSync({ [key]: value }));
            return chain;
        };
        return {
            schedule(value) {
                latestValue = value;
                pending = true;
                if (timer !== null) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    void commit().catch(report);
                }, delay);
            },
            flush() {
                if (timer !== null) clearTimeout(timer);
                timer = null;
                return commit();
            },
            get pending() { return pending; }
        };
    }

    function bind({ element, key, delay = 500, onError }) {
        if (!element) return null;
        const writer = create({ key, delay, onError });
        const schedule = () => writer.schedule(element.value);
        const flush = () => { void writer.flush().catch(error => onError?.(error)); };
        const flushWhenHidden = () => { if (document.visibilityState === 'hidden') flush(); };
        element.addEventListener('input', schedule);
        element.addEventListener('change', flush);
        element.addEventListener('blur', flush);
        document.addEventListener('visibilitychange', flushWhenHidden);
        window.addEventListener('pagehide', flush);
        return writer;
    }

    root.DashBridgeSyncInputWriter = Object.freeze({ create, bind });
})(globalThis);
