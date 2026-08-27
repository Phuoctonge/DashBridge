// Canonical defaults for Grafana features.  Keep runtime fallbacks here so
// Popup, Dashboard, Options and injected tools cannot drift apart.
globalThis.getGrafanaSettingsDefaults = () => ({
    grafanaIdleKeyword: 'idle',
    grafanaMemTotalKeyword: 'Total',
    grafanaMemAvailKeyword: 'Available',
    grafanaMemCalcMode: 'available',
    grafanaCpuPanelTitle: 'CPU Usage',
    grafanaMemPanelTitle: 'Memory',
    grafanaLoadPanelTitle: 'Load Average',
    grafanaCpuCapacityCoefficient: 0.8,
    grafanaTrimDomain: '.passport.local:9182',
    grafanaTrimDomainEnabled: true,
    grafanaTrimDomainVersion: 2,
    grafanaKeepParams: 'from, to, var-project',
    grafanaIframeDomains: ['grafanakns.mos.ru', 'mon-dc.mos.ru'],
    grafanaCompactScreenshot: false,
    grafanaCompactExportWidth: 1000,
    grafanaCompactExportHeight: 520,
    cpuWarnThreshold: 50,
    cpuCritThreshold: 80,
    memWarnThreshold: 80,
    memCritThreshold: 90,
    cpuTemplateFull: '{server} до {cpu}%',
    cpuTemplateTop3: 'до {cpu1}% для {server1}, до {cpu2}% для {server2}, для остальных до {cpu3}%',
    memTemplateFull: '{server} до {mem}%',
    memTemplateTop3: 'до {mem1}% для {server1}, до {mem2}% для {server2}, для остальных до {mem3}%'
});

globalThis.normalizeGrafanaSettings = settings => {
    const source = settings && typeof settings === 'object' ? settings : {};
    const normalized = { ...globalThis.getGrafanaSettingsDefaults(), ...source };
    const defaults = globalThis.getGrafanaSettingsDefaults();
    // Version 2 expands shortening from calculated CPU/RAM/Load rows to every
    // Grafana series. Migrate the old default `false` once; an explicitly saved
    // v2 value remains user-controllable afterwards.
    if (Number(source.grafanaTrimDomainVersion) !== 2) {
        normalized.grafanaTrimDomainEnabled = true;
    }
    normalized.grafanaTrimDomainVersion = 2;
    const normalizePanelTitle = key => {
        const value = typeof source[key] === 'string' ? source[key] : normalized[key];
        let cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
            .replace(/\s+calculated$/i, '').trim().slice(0, 120);
        // CPU/RAM were temporary defaults before panel-specific controls were
        // narrowed to the real Grafana titles. Migrate only those exact legacy
        // defaults; user-defined names remain untouched.
        if (key === 'grafanaCpuPanelTitle' && cleaned.toLowerCase() === 'cpu') cleaned = defaults[key];
        if (key === 'grafanaMemPanelTitle' && cleaned.toLowerCase() === 'ram') cleaned = defaults[key];
        normalized[key] = cleaned || defaults[key];
    };
    ['grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle'].forEach(normalizePanelTitle);
    const cpuCapacityCoefficient = Number(source.grafanaCpuCapacityCoefficient);
    normalized.grafanaCpuCapacityCoefficient = Number.isFinite(cpuCapacityCoefficient)
        && cpuCapacityCoefficient >= 0.01 && cpuCapacityCoefficient <= 10
        ? cpuCapacityCoefficient
        : defaults.grafanaCpuCapacityCoefficient;
    const normalizeCaptureDimension = key => {
        const value = Number(source[key]);
        normalized[key] = Number.isFinite(value) && value >= 100 && value <= 4096
            ? Math.round(value)
            : defaults[key];
    };
    normalizeCaptureDimension('grafanaCompactExportWidth');
    normalizeCaptureDimension('grafanaCompactExportHeight');
    if (source.grafanaMemCalcMode !== 'available' && source.grafanaMemCalcMode !== 'used') {
        normalized.grafanaMemCalcMode = String(source.grafanaMemAvailKeyword || normalized.grafanaMemAvailKeyword)
            .toLowerCase().includes('used') ? 'used' : 'available';
    }
    return normalized;
};

globalThis.getGrafanaSettingsStorageKeys = () => Object.keys(globalThis.getGrafanaSettingsDefaults());
