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
                if (event.origin !== location.origin || event.data?.action !== 'panelToolsApplied' || event.data.requestId !== id) return;
                clearTimeout(timeout); window.removeEventListener('message', onApplied); resolve({ ok: true });
            };
            const timeout = setTimeout(() => { window.removeEventListener('message', onApplied); resolve({ ok: false, reason: 'apply-timeout' }); }, 20000);
            window.addEventListener('message', onApplied);
            window.postMessage({ action, requestId: id, ...data }, location.origin);
        })
    });
    const applied = result?.[0]?.result;
    if (!applied?.ok) return applied || { ok: false, reason: 'empty-apply-result' };
    if (refresh) await chrome.scripting.executeScript({ target: { tabId: targetTabId }, world: 'MAIN', func: () => document.querySelector('button[aria-label="Refresh dashboard"], .refresh-picker button, [data-testid="data-toolbar-refresh"], button[title="Refresh dashboard"]')?.click() });
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
