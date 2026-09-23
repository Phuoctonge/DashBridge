// One extension-page -> Grafana MAIN-world command envelope.
async function runGrafanaCommand({ tabId = null, command, payload = {}, refresh = false } = {}) {
    let targetTabId = tabId;
    const tab = targetTabId
        ? await chrome.tabs.get(targetTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    targetTabId ||= tab?.id;
    if (!targetTabId || !tab?.url || !/^https?:/.test(tab.url)) return { ok: false, reason: 'unsupported-page' };
    const runtime = await ensureGrafanaRuntime(targetTabId);
    if (!runtime.ok) return runtime;
    const requestId = `dashbridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId }, world: 'MAIN', args: [command, payload, requestId],
        func: (action, data, id) => new Promise(resolve => {
            const onApplied = event => {
                if (event.source !== window || event.origin !== location.origin || event.data?.action !== 'panelToolsApplied' || event.data.requestId !== id) return;
                clearTimeout(timeout); window.removeEventListener('message', onApplied);
                resolve(event.data.commandStatus === 'applied'
                    ? { ok: true } : { ok: false, reason: event.data.failureCode || 'apply-error' });
            };
            const timeout = setTimeout(() => { window.removeEventListener('message', onApplied); resolve({ ok: false, reason: 'apply-timeout' }); }, 20000);
            window.addEventListener('message', onApplied);
            window.postMessage({ action, requestId: id, ...data }, location.origin);
        })
    });
    const applied = result?.[0]?.result;
    if (!applied?.ok) return applied || { ok: false, reason: 'empty-apply-result' };
    if (refresh) {
        const refreshed = await chrome.scripting.executeScript({
            target: { tabId: targetTabId }, world: 'MAIN', args: [payload.tools || {}],
            func: requestedTools => new Promise(resolve => {
                const button = document.querySelector('button[aria-label="Refresh dashboard"], .refresh-picker button, [data-testid="data-toolbar-refresh"], button[title="Refresh dashboard"]');
                if (!button) return resolve({ ok: false, reason: 'refresh-unavailable' });
                const requiresTransform = requestedTools.invertIdle === true || requestedTools.convertMemToUsed === true
                    || requestedTools.seriesQueryFilterEnabled === true;
                const diagnostic = window.__dashbridgeDataInterceptorDiagnostic;
                if (requiresTransform && !diagnostic) return resolve({ ok: false, reason: 'transform-runtime-unavailable' });
                // Only a request started after this refresh can confirm the new
                // settings. A completed older request or unrelated panel cannot.
                const baseline = diagnostic?.nextEventId || 0;
                const startedAt = Date.now();
                const inspect = () => {
                    if (window.__dashbridgeDataInterceptorDiagnostic !== diagnostic) {
                        return resolve({ ok: false, reason: 'transform-runtime-replaced' });
                    }
                    const events = (diagnostic.events || []).filter(event => event.id > baseline);
                    const started = new Set(events.filter(event => event.stage === 'request-start').map(event => event.requestId));
                    const transformed = events.filter(event => event.stage === 'transform' && started.has(event.requestId)
                        && (!requestedTools.invertIdle || event.invertIdle === true)
                        && (!requestedTools.convertMemToUsed || event.convertMemToUsed === true)
                        && (!requestedTools.seriesQueryFilterEnabled || event.sourceFilterEnabled === true));
                    const completed = events.filter(event => event.stage === 'request-complete' && started.has(event.requestId));
                    if (transformed.some(event => event.memoryTransform?.applied === false)) {
                        return resolve({ ok: false, reason: 'memory-transform-not-applied' });
                    }
                    if (completed.some(event => ['http-error', 'network-error', 'decode-error'].includes(event.outcome))) {
                        return resolve({ ok: false, reason: 'refresh-query-error' });
                    }
                    if (!diagnostic.activeRequests && transformed.length && transformed.every(event =>
                        completed.some(done => done.requestId === event.requestId && done.outcome === 'transformed'))) {
                        return resolve({ ok: true });
                    }
                    if (Date.now() - startedAt >= 20000) return resolve({ ok: false, reason: 'transform-timeout' });
                    setTimeout(inspect, 100);
                };
                button.click();
                if (!requiresTransform) return resolve({ ok: true });
                inspect();
            })
        });
        const ready = refreshed?.[0]?.result;
        if (!ready?.ok) return ready || { ok: false, reason: 'empty-refresh-result' };
    }
    return { ok: true, confirmed: true };
}

// Applies the canonical panel-tools settings through the shared MAIN-world
// command envelope. Batch callers keep one stable public function while the
// transport and settings enrichment remain in the same owner module.
async function applySharedGrafanaPanelTools(tools, { refresh = true, tabId = null } = {}) {
    const storedTransformSettings = await chrome.storage.sync.get(getGrafanaSettingsStorageKeys());
    const commandTransformSettings = normalizeGrafanaSettings(storedTransformSettings);
    return runGrafanaCommand({
        tabId,
        command: 'applyPanelTools',
        payload: { tools, transformSettings: commandTransformSettings },
        refresh
    });
}
