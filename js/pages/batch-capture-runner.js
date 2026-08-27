// Owns the temporary browser window used by Batch capture.
function createBatchCaptureWindowRunner() {
    let windowId = null;
    const neutralizeBeforeUnload = async id => {
        try {
            const win = await chrome.windows.get(id, { populate: true });
            const tabId = win?.tabs?.[0]?.id;
            if (!tabId) return;
            await chrome.scripting.executeScript({
                target: { tabId, allFrames: true }, world: 'MAIN',
                func: () => {
                    window.onbeforeunload = null;
                    if (window.BeforeUnloadEvent) {
                        Object.defineProperty(window.BeforeUnloadEvent.prototype, 'returnValue', {
                            configurable: true, get: () => '', set: () => {}
                        });
                        window.BeforeUnloadEvent.prototype.preventDefault = () => {};
                    }
                    if (window.Event) window.Event.prototype.preventDefault = () => {};
                }
            });
        } catch (_) { /* the temporary page can already be gone */ }
    };
    return {
        async acquire({ focused = true } = {}) {
            if (windowId) {
                try { return await chrome.windows.get(windowId); } catch (_) { windowId = null; }
            }
            const win = await chrome.windows.create({
                url: 'about:blank',
                focused,
                state: focused ? 'maximized' : 'normal'
            });
            windowId = win.id;
            return win;
        },
        async release() {
            if (!windowId) return;
            await neutralizeBeforeUnload(windowId);
            try { await chrome.windows.remove(windowId); } catch (_) { /* already closed */ }
            windowId = null;
        },
        get id() { return windowId; }
    };
}
