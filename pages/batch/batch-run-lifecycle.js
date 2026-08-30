// Batch lifecycle keeps cancelled runs from changing a newer run.
window.BatchRunLifecycle = (() => {
    let nextId = 0;
    let activeId = null;
    let activeController = null;
    let cleanup = new Set();

    const begin = () => {
        activeId = ++nextId;
        activeController = new AbortController();
        cleanup = new Set();
        return activeId;
    };
    const isActive = runId => activeId === runId;
    const finish = runId => {
        if (!isActive(runId)) return false;
        cleanup.forEach(dispose => { try { dispose(); } catch (_) { } });
        cleanup.clear();
        activeId = null;
        activeController = null;
        return true;
    };
    const cancel = () => {
        activeController?.abort();
        cleanup.forEach(dispose => { try { dispose(); } catch (_) { } });
        cleanup.clear();
        activeId = null;
        activeController = null;
    };
    const signal = runId => isActive(runId) ? activeController.signal : null;
    const registerCleanup = (runId, dispose) => {
        if (!isActive(runId) || typeof dispose !== 'function') return () => undefined;
        cleanup.add(dispose);
        return () => cleanup.delete(dispose);
    };

    return { begin, isActive, finish, cancel, signal, registerCleanup };
})();
