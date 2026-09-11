// Batch requests a worker-owned window. Disconnect destroys only that window.
function createBatchCaptureWindowRunner() {
    let port = null;
    let nextId = 0;
    let windowId = null;
    let generation = 0;
    let heartbeat = null;
    const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = null; };
    const pending = new Map();
    const request = (type, options = {}) => {
        if (!port) {
            const connected = chrome.runtime.connect({ name: 'dashbridge-batch-capture' });
            port = connected;
            connected.onMessage.addListener(message => {
                const waiter = pending.get(message.id);
                if (!waiter) return;
                pending.delete(message.id);
                if (message.ok) waiter.resolve(message.window);
                else waiter.reject(new Error(message.error || 'Не удалось подготовить окно захвата.'));
            });
            connected.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                if (port !== connected) return;
                port = null; windowId = null; generation++;
                stopHeartbeat();
                pending.forEach(waiter => waiter.reject(new Error('Сессия захвата закрыта. Запустите сбор заново.')));
                pending.clear();
            });
        }
        const id = ++nextId;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            try { port.postMessage({ id, type, ...options }); }
            catch (error) { pending.delete(id); reject(error); }
        });
    };
    window.addEventListener('pagehide', () => { stopHeartbeat(); port?.disconnect(); });
    return {
        async acquire({ focused = true } = {}) {
            const current = generation;
            const win = await request('acquire', { focused });
            if (current !== generation) throw new Error('Сбор отменён.');
            windowId = win.id;
            stopHeartbeat();
            // Port traffic keeps the MV3 owner alive only while a capture window is leased.
            heartbeat = setInterval(() => {
                try { port?.postMessage({ id: ++nextId, type: 'ping' }); } catch { stopHeartbeat(); }
            }, 20_000);
            return win;
        },
        async release() {
            generation++;
            stopHeartbeat();
            if (!port) return;
            await request('release');
            windowId = null;
        },
        get id() { return windowId; },
    };
}
