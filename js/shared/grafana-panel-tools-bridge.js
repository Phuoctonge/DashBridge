// Bridge between extension pages and Grafana's MAIN world.
// Both the Popup and Batch use it so legend filtering has one implementation.
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
