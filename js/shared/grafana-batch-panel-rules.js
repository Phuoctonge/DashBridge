// Persisted, per-dashboard rules for Batch-only Grafana panel transformations.
// Rules deliberately live in local storage: a dashboard may contain many panels,
// while sync has strict per-item and total quotas.
window.BatchPanelRules = (() => {
    const STORAGE_KEY = 'batchPanelToolRules';
    const BOOLEAN_FIELDS = ['removeFill', 'thickenLines', 'invertLegend', 'invertIdle', 'convertMemToUsed', 'forceMemByteUnit',
        'seriesQueryFilterEnabled', 'seriesQueryFilterHighlightEnabled', 'cpuCapacityFilterEnabled',
        'cpuCapacityFilterHighlightEnabled', 'cpuCapacityFilterLoad1', 'cpuCapacityFilterLoad5',
        'cpuCapacityFilterLoad15', 'thresholdEnabled'];

    const dashboardKey = url => {
        const dashboard = parseGrafanaDashboardUrl(url);
        return dashboard ? `${dashboard.baseUrl}|org:${dashboard.orgId || 'default'}|${dashboard.uid}` : null;
    };
    const legacyDashboardKey = url => {
        const dashboard = parseGrafanaDashboardUrl(url);
        return dashboard ? `${dashboard.baseUrl}|${dashboard.uid}` : null;
    };

    const normalizeRule = (rule = {}) => {
        const normalized = {};
        BOOLEAN_FIELDS.forEach(field => {
            if (rule[field] === true) normalized[field] = true;
        });
        if (normalized.convertMemToUsed) delete normalized.forceMemByteUnit;
        if (normalized.seriesQueryFilterEnabled) delete normalized.cpuCapacityFilterEnabled;
        if (normalized.thickenLines) {
            const width = Number(rule.thickenLinesValue);
            normalized.thickenLinesValue = Number.isFinite(width)
                ? Math.min(5, Math.max(0.5, width))
                : 1.5;
        }
        for (const prefix of ['seriesQueryFilter', 'threshold']) {
            if (!normalized[`${prefix}Enabled`]) continue;
            const value = Number(rule[`${prefix}Value`]);
            normalized[`${prefix}Value`] = Number.isFinite(value) ? value : 0;
            normalized[`${prefix}RawValue`] = normalized[`${prefix}Value`];
        }
        if (normalized.seriesQueryFilterEnabled) {
            normalized.seriesFilterSettingsVersion = 2;
            normalized.seriesQueryFilterMode = rule.seriesQueryFilterMode === 'last' ? 'last' : 'max';
            normalized.seriesQueryFilterHighlightEnabled = rule.seriesQueryFilterHighlightEnabled !== false;
        }
        if (normalized.cpuCapacityFilterEnabled) {
            const coefficient = Number(rule.cpuCapacityFilterCoefficient);
            normalized.cpuCapacityFilterCoefficient = Number.isFinite(coefficient)
                ? Math.min(10, Math.max(0.01, coefficient)) : 0.8;
            normalized.cpuCapacityFilterMode = rule.cpuCapacityFilterMode === 'last' ? 'last' : 'max';
            normalized.cpuCapacityFilterHighlightEnabled = rule.cpuCapacityFilterHighlightEnabled !== false;
            normalized.cpuCapacityFilterLoad1 = rule.cpuCapacityFilterLoad1 !== false;
            if (rule.cpuCapacityFilterLoad5 === true) normalized.cpuCapacityFilterLoad5 = true;
            if (rule.cpuCapacityFilterLoad15 === true) normalized.cpuCapacityFilterLoad15 = true;
        }
        if (normalized.thresholdEnabled) normalized.thresholdNotifyEnabled = false;
        return normalized;
    };

    const normalizeRules = (rules = {}) => Object.entries(rules).reduce((normalized, [panelId, rule]) => {
        if (!/^\d+$/.test(String(panelId))) return normalized;
        const next = normalizeRule(rule);
        if (Object.keys(next).length) normalized[String(panelId)] = next;
        return normalized;
    }, {});

    const load = async url => {
        const key = dashboardKey(url);
        if (!key) return {};
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const profiles = stored[STORAGE_KEY] || {};
        return normalizeRules(profiles[key] ?? profiles[legacyDashboardKey(url)]);
    };

    const save = async (url, rules) => {
        // Web Locks serialize writers across Batch documents of this extension.
        // Do not silently fall back to a page-local queue: it loses other tabs' writes.
        if (!globalThis.navigator?.locks?.request) throw new Error('Браузер не поддерживает безопасное сохранение Batch rules');
        return navigator.locks.request(STORAGE_KEY, () => saveLocked(url, rules));
    };
    const saveLocked = async (url, rules) => {
        const key = dashboardKey(url);
        if (!key) throw new Error('Введите корректный URL дашборда Grafana');
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const profiles = { ...(stored[STORAGE_KEY] || {}) };
        const normalized = normalizeRules(rules);
        if (Object.keys(normalized).length) profiles[key] = normalized;
        // Keep an empty org-specific tombstone so clearing migrated legacy
        // rules does not make the old unscoped profile appear again.
        else profiles[key] = {};
        await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
        return normalized;
    };

    const forPanel = (rules, panelId) => {
        const rule = normalizeRule(rules?.[String(panelId)]);
        return Object.keys(rule).length ? { ...rule, targetPanelId: String(panelId) } : null;
    };

    return { dashboardKey, load, save, forPanel };
})();
