(function initDashBridgeOptionsConfigTransfer(root) {
    'use strict';

    const IMPORT_SCHEMA_VERSION = 3;
    // Export uses the same ceiling, so every produced file remains importable.
    const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
    const SYNC_IMPORT_KEYS = new Set([
        'grafanaIdleKeyword', 'grafanaTrimDomain', 'grafanaTrimDomainEnabled', 'grafanaTrimDomainVersion', 'cpuWarnThreshold', 'cpuCritThreshold',
        'grafanaMemTotalKeyword', 'grafanaMemAvailKeyword', 'grafanaMemCalcMode', 'memWarnThreshold', 'memCritThreshold',
        'grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle', 'grafanaCpuCapacityCoefficient',
        'memTemplateFull', 'memTemplateTop3', 'jiraBaseUrl', 'tdmDomain', 'rememberLastTab', 'rememberLastSubTab',
        'cpuTemplateFull', 'cpuTemplateTop3', 'jiraTz', 'wikiDomains', 'grafanaKeepParams', 'grafanaIframeDomains',
        'tdmExcludeUserTextDefault', 'tdmRememberDate', 'tdmSavePhotosDefault', 'tdmExcludeUserDefault',
        'wikiIframeIds', 'confluenceScrollFixEnabled', 'customButtons', 'globalTheme', 'uiScale',
        'grafanaCompactScreenshot', 'grafanaCompactExportWidth', 'grafanaCompactExportHeight',
        'jiraDefaultComment', 'jiraDefaultTimeSpent',
        'tdmLastStart', 'tdmLastEnd', 'lastActiveTab', 'lastActiveGrafanaSubTab',
        'module_grafana', 'module_recorder', 'module_jira', 'module_tdm', 'module_grafana_links',
        'module_grafana_batch', 'module_grafana_debug'
    ]);
    const LOCAL_IMPORT_KEYS = new Set([
        'dashbridge_profiles', 'dashbridge_activeProfileId', 'jiraWorklogs', 'jiraSortOrder', 'jiraIssueCache',
        'batchState', 'batchPanelToolRules'
    ]);
    const analysisThresholdPairs = Object.freeze([
        ['cpuWarnThreshold', 'cpuCritThreshold', 'CPU'],
        ['memWarnThreshold', 'memCritThreshold', 'RAM']
    ]);
    const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
    const pickImportKeys = (source, allowlist, dropped, area) => Object.fromEntries(Object.entries(source || {}).filter(([key]) => {
        if (allowlist.has(key)) return true;
        dropped.push(`${area}.${key}`);
        return false;
    }));
    const setStorageValues = (area, values) => new Promise((resolve, reject) => {
        area.set(values, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
        });
    });

    function create({ parseGrafanaIframeDomains, normalizePanelTitle, getAnalysisThresholdPairError, showStatus }) {
        if (![parseGrafanaIframeDomains, normalizePanelTitle, getAnalysisThresholdPairError, showStatus]
            .every(dependency => typeof dependency === 'function')) {
            throw new TypeError('DashBridgeOptionsConfigTransfer dependencies are incomplete');
        }
        const exportButton = document.getElementById('exportBtn');
        const importButton = document.getElementById('importBtn');
        const importFile = document.getElementById('importFile');
        if (!exportButton || !importButton || !importFile) {
            throw new TypeError('DashBridgeOptionsConfigTransfer controls are incomplete');
        }

        function validateEffectiveImportedThresholds(currentSync, importedSync) {
            const effectiveSync = { ...getGrafanaSettingsDefaults(), ...currentSync, ...importedSync };
            analysisThresholdPairs.forEach(([warningKey, criticalKey, label]) => {
                if (importedSync[warningKey] === undefined && importedSync[criticalKey] === undefined) return;
                const error = getAnalysisThresholdPairError(effectiveSync[warningKey], effectiveSync[criticalKey], label);
                if (error) throw new Error(error);
            });
        }

        function validateImportedConfig(config) {
            if (!isPlainObject(config) || !isPlainObject(config.sync)) {
                throw new Error('Некорректный формат: отсутствует раздел sync.');
            }
            if (config.local !== undefined && !isPlainObject(config.local)) {
                throw new Error('Некорректный формат раздела local.');
            }
            const dropped = [];
            const sync = pickImportKeys(config.sync, SYNC_IMPORT_KEYS, dropped, 'sync');
            let local = pickImportKeys(config.local, LOCAL_IMPORT_KEYS, dropped, 'local');
            if (sync.grafanaMemCalcMode === undefined && typeof sync.grafanaMemAvailKeyword === 'string') {
                sync.grafanaMemCalcMode = sync.grafanaMemAvailKeyword.toLowerCase().includes('used') ? 'used' : 'available';
            }
            if (sync.grafanaIframeDomains !== undefined) {
                if (!Array.isArray(sync.grafanaIframeDomains) || !sync.grafanaIframeDomains.every(item => typeof item === 'string')) {
                    throw new Error('Некорректный список адресов Grafana.');
                }
                sync.grafanaIframeDomains = parseGrafanaIframeDomains(sync.grafanaIframeDomains.join('\n'));
            }
            if (sync.jiraBaseUrl !== undefined) {
                sync.jiraBaseUrl = normalizeHttpBaseUrl(sync.jiraBaseUrl);
                if (!sync.jiraBaseUrl) throw new Error('Некорректный адрес Jira в импортируемых настройках.');
            }
            if (sync.tdmDomain !== undefined) {
                sync.tdmDomain = normalizeHttpHost(sync.tdmDomain);
                if (!sync.tdmDomain) throw new Error('Некорректный адрес TDM в импортируемых настройках.');
            }
            if (sync.grafanaMemCalcMode !== undefined && !['available', 'used'].includes(sync.grafanaMemCalcMode)) {
                throw new Error('Некорректный способ расчёта RAM в импортируемых настройках.');
            }
            if (sync.uiScale !== undefined && !['auto', '90', '100', '110', '125', '150'].includes(String(sync.uiScale))) {
                throw new Error('Некорректный масштаб интерфейса в импортируемых настройках.');
            }
            if (sync.uiScale !== undefined) sync.uiScale = String(sync.uiScale);
            if (sync.grafanaCpuCapacityCoefficient !== undefined
                && (!Number.isFinite(sync.grafanaCpuCapacityCoefficient)
                    || sync.grafanaCpuCapacityCoefficient < 0.01 || sync.grafanaCpuCapacityCoefficient > 10)) {
                throw new Error('Некорректный коэффициент порога Load Average в импортируемых настройках.');
            }
            ['grafanaCompactExportWidth', 'grafanaCompactExportHeight'].forEach(key => {
                if (sync[key] !== undefined && (!Number.isInteger(sync[key]) || sync[key] < 100 || sync[key] > 4096)) {
                    throw new Error(`Некорректный размер компактного снимка в настройке ${key}.`);
                }
            });
            ['grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle'].forEach(key => {
                if (sync[key] !== undefined && (typeof sync[key] !== 'string' || !sync[key].trim() || sync[key].length > 120)) {
                    throw new Error(`Некорректное название панели Grafana в настройке ${key}.`);
                }
                if (sync[key] !== undefined) {
                    sync[key] = normalizePanelTitle(sync[key]);
                    if (!sync[key]) throw new Error(`Некорректное название панели Grafana в настройке ${key}.`);
                }
            });
            ['tdmSavePhotosDefault', 'tdmRememberDate', 'tdmExcludeUserDefault', 'confluenceScrollFixEnabled'].forEach(key => {
                if (sync[key] !== undefined && typeof sync[key] !== 'boolean') {
                    throw new Error(`Некорректное логическое значение настройки ${key}.`);
                }
            });
            if (sync.tdmExcludeUserTextDefault !== undefined
                && (typeof sync.tdmExcludeUserTextDefault !== 'string' || sync.tdmExcludeUserTextDefault.length > 500)) {
                throw new Error('Некорректное имя пользователя TDM по умолчанию.');
            }
            analysisThresholdPairs.forEach(([warningKey, criticalKey, label]) => {
                [warningKey, criticalKey].forEach(key => {
                    if (sync[key] !== undefined && (!Number.isFinite(sync[key]) || sync[key] < 0 || sync[key] > 100)) {
                        throw new Error(`Некорректный порог ${label} в импортируемых настройках.`);
                    }
                });
                if (sync[warningKey] !== undefined && sync[criticalKey] !== undefined) {
                    const error = getAnalysisThresholdPairError(sync[warningKey], sync[criticalKey], label);
                    if (error) throw new Error(error);
                }
            });
            local = DashBridgeLocalStateSchema.normalizeImportedLocal(local);
            if (sync.customButtons !== undefined) {
                sync.customButtons = DashBridgeLocalStateSchema.normalizeCustomButtons(sync.customButtons).items;
            }
            if (local.batchPanelToolRules !== undefined && !isPlainObject(local.batchPanelToolRules)) {
                throw new Error('Некорректные правила Batch для панелей Grafana.');
            }
            return { sync, local, dropped, sourceSchemaVersion: Number(config.schemaVersion) || 1 };
        }

        const handleExport = () => {
            chrome.storage.sync.get(null, syncData => {
                chrome.storage.local.get(null, localData => {
                    const exportSync = pickImportKeys(syncData, SYNC_IMPORT_KEYS, [], 'sync');
                    const exportLocal = pickImportKeys(localData, LOCAL_IMPORT_KEYS, [], 'local');
                    const fullConfig = {
                        schemaVersion: IMPORT_SCHEMA_VERSION,
                        sync: exportSync,
                        local: exportLocal,
                        version: chrome.runtime.getManifest().version,
                        exportedAt: new Date().toISOString()
                    };
                    const blob = new Blob([JSON.stringify(fullConfig, null, 2)], { type: 'application/json' });
                    if (blob.size > MAX_IMPORT_BYTES) {
                        showStatus('Настройки превышают безопасный лимит 16 МиБ. Очистите устаревший кэш Jira или профили и повторите экспорт.', 'red');
                        return;
                    }
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `dashbridge_config_${new Date().toISOString().slice(0, 10)}.json`;
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(url), 0);
                    showStatus('Настройки экспортированы в JSON.', 'green');
                });
            });
        };
        const handleImportClick = () => importFile.click();
        const handleImportChange = event => {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > MAX_IMPORT_BYTES) {
                importFile.value = '';
                showStatus('Файл конфигурации превышает лимит 16 МиБ.', 'red');
                return;
            }
            const reader = new FileReader();
            reader.onload = async loadEvent => {
                try {
                    const imported = validateImportedConfig(JSON.parse(loadEvent.target.result));
                    const preview = `Будут применены: sync ${Object.keys(imported.sync).length}, local ${Object.keys(imported.local).length}.`
                        + (imported.dropped.length ? `\nБудут отброшены неизвестные поля: ${imported.dropped.join(', ')}` : '')
                        + `\nИсходная схема: v${imported.sourceSchemaVersion}. Продолжить?`;
                    if (!window.confirm(preview)) return;
                    const [currentSync, currentLocal] = await Promise.all([
                        chrome.storage.sync.get(null), chrome.storage.local.get(null)
                    ]);
                    validateEffectiveImportedThresholds(currentSync, imported.sync);
                    await setStorageValues(chrome.storage.local, {
                        dashbridge_import_backup: {
                            schemaVersion: IMPORT_SCHEMA_VERSION,
                            createdAt: new Date().toISOString(),
                            sync: currentSync,
                            local: Object.fromEntries(Object.entries(currentLocal)
                                .filter(([key]) => key !== 'dashbridge_import_backup'))
                        }
                    });
                    await setStorageValues(chrome.storage.sync, imported.sync);
                    if (Object.keys(imported.local).length) await setStorageValues(chrome.storage.local, imported.local);
                    showStatus('Настройки импортированы. Обновите открытые страницы Dashboard.', 'green');
                } catch (error) {
                    showStatus(error?.message || 'Ошибка при чтении файла.', 'red');
                } finally {
                    importFile.value = '';
                }
            };
            reader.onerror = () => {
                importFile.value = '';
                showStatus('Не удалось прочитать выбранный файл.', 'red');
            };
            reader.readAsText(file);
        };

        exportButton.addEventListener('click', handleExport);
        importButton.addEventListener('click', handleImportClick);
        importFile.addEventListener('change', handleImportChange);
        const stop = () => {
            exportButton.removeEventListener('click', handleExport);
            importButton.removeEventListener('click', handleImportClick);
            importFile.removeEventListener('change', handleImportChange);
        };
        return Object.freeze({ validateImportedConfig, stop });
    }

    root.DashBridgeOptionsConfigTransfer = Object.freeze({ create });
})(globalThis);
