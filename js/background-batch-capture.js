(function initBackgroundBatchCapture(root) {
    'use strict';
    // Only windows created by this owner can be released by a Batch port.
    function create({ chromeRef = chrome } = {}) {
        const key = 'dashbridgeBatchCaptureWindows';
        const windows = new Set();
        let storageQueue = Promise.resolve();
        const persist = () => {
            const value = [...windows];
            storageQueue = storageQueue.catch(() => undefined)
                .then(() => chromeRef.storage.session.set({ [key]: value }));
            return storageQueue;
        };
        const close = async id => {
            if (!Number.isInteger(id)) return;
            try {
                const win = await chromeRef.windows.get(id, { populate: true });
                const tabId = win.tabs?.[0]?.id;
                if (Number.isInteger(tabId)) await chromeRef.scripting.executeScript({
                    target: { tabId, allFrames: true }, world: 'MAIN',
                    func: () => {
                        window.onbeforeunload = null;
                        if (window.BeforeUnloadEvent) {
                            Object.defineProperty(window.BeforeUnloadEvent.prototype, 'returnValue', {
                                configurable: true, get: () => '', set: () => {},
                            });
                            window.BeforeUnloadEvent.prototype.preventDefault = () => {};
                        }
                    },
                }).catch(() => undefined);
                await chromeRef.windows.remove(id);
            } catch (error) {
                const exists = await chromeRef.windows.get(id).catch(() => null);
                if (exists) throw error;
            }
            windows.delete(id);
            await persist();
        };
        // A restarted worker cannot retain the old ports: close orphan windows.
        const ready = (async () => {
            const stored = await chromeRef.storage.session.get(key);
            for (const id of (Array.isArray(stored[key]) ? stored[key] : []).filter(Number.isInteger)) windows.add(id);
            for (const id of [...windows]) await close(id);
        })();
        void ready.catch(error => console.warn('Batch cleanup failed:', error));
        const connect = port => {
            if (port.name !== 'dashbridge-batch-capture'
                || port.sender?.id !== chromeRef.runtime.id
                || port.sender?.url !== chromeRef.runtime.getURL('pages/batch/batch.html')) return;
            let closed = false;
            let windowId = null;
            let queue = ready;
            const release = async () => {
                const id = windowId;
                if (id === null) return;
                await close(id);
                if (windowId === id) windowId = null;
            };
            port.onMessage.addListener(message => {
                if (closed || !Number.isSafeInteger(message?.id)
                    || !['acquire', 'release'].includes(message.type)) return;
                queue = queue.catch(() => undefined).then(async () => {
                    try {
                        if (closed) return;
                        let win;
                        if (message.type === 'release') await release();
                        else {
                            if (windowId !== null) win = await chromeRef.windows.get(windowId).catch(() => null);
                            if (!win) {
                                win = await chromeRef.windows.create({ url: 'about:blank', focused: message.focused !== false,
                                    state: message.focused !== false ? 'maximized' : 'normal' });
                                windowId = win.id; windows.add(windowId);
                                try { await persist(); } catch (error) { await release(); throw error; }
                            }
                        }
                        if (closed) { await release(); return; }
                        port.postMessage({ id: message.id, ok: true, window: win });
                    } catch (error) {
                        if (!closed) port.postMessage({ id: message.id, ok: false, error: error.message });
                    }
                });
            });
            port.onDisconnect.addListener(() => {
                closed = true;
                queue = queue.catch(() => undefined).then(release);
                void queue.catch(error => console.warn('Batch disconnect cleanup failed:', error));
            });
        };
        chromeRef.runtime.onConnect.addListener(connect);
        return Object.freeze({ ready });
    }
    root.DashBridgeBackgroundBatchCapture = Object.freeze({ create });
})(globalThis);
