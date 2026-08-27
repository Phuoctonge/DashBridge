globalThis.DashBridgeStorageWriter = Object.freeze({
    create(area, options = {}) {
        let revision = 0;
        let committedRevision = 0;
        let inFlight = false;
        let pending = null;
        const waiters = [];
        const flushWaiters = [];
        const snapshot = value => typeof structuredClone === 'function'
            ? structuredClone(value) : JSON.parse(JSON.stringify(value));
        const settleFlush = () => {
            if (inFlight || pending) return;
            flushWaiters.splice(0).forEach(resolve => resolve());
        };
        const pump = async () => {
            if (inFlight || !pending) return;
            inFlight = true;
            const current = pending;
            pending = null;
            try {
                await (options.durableWrite
                    ? options.durableWrite(current.payload, current.revision)
                    : area.set(current.payload));
                committedRevision = current.revision;
                const settled = waiters.filter(item => item.revision <= current.revision);
                settled.forEach(item => item.resolve({
                    revision: item.revision,
                    committedRevision: current.revision,
                    current: item.revision === revision
                }));
                settled.forEach(item => waiters.splice(waiters.indexOf(item), 1));
            } catch (error) {
                const failed = waiters.filter(item => item.revision <= current.revision);
                failed.forEach(item => item.reject(error));
                failed.forEach(item => waiters.splice(waiters.indexOf(item), 1));
            } finally {
                inFlight = false;
                if (pending) void pump();
                else settleFlush();
            }
        };
        return {
            write(values) {
                const writeRevision = ++revision;
                pending = { revision: writeRevision, payload: snapshot(values) };
                const result = new Promise((resolve, reject) => {
                    waiters.push({ revision: writeRevision, resolve, reject });
                });
                void pump();
                return result;
            },
            flush() {
                if (!inFlight && !pending) return Promise.resolve();
                return new Promise(resolve => flushWaiters.push(resolve));
            },
            checkpoint() {
                if (!options.durableWrite || !pending) return Promise.resolve({ queued: false });
                const current = pending;
                return options.durableWrite(snapshot(current.payload), current.revision)
                    .then(() => ({ queued: true, revision: current.revision }));
            },
            get revision() { return revision; },
            get committedRevision() { return committedRevision; },
            get dirty() { return committedRevision !== revision; }
        };
    },
    createLocal() {
        const channel = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const durableWrite = (values, revision) => new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'dashbridge-storage-commit', area: 'local', channel, revision, values
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.ok) {
                    reject(new Error(response?.error || 'Storage broker rejected the commit'));
                    return;
                }
                resolve(response);
            });
        });
        return this.create(chrome.storage.local, { durableWrite });
    }
});
