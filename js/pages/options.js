document.addEventListener('DOMContentLoaded', () => {
    const memCalcModeEl = document.getElementById('settingGrafanaMemCalcMode');
    const memSecondKeywordEl = document.getElementById('settingGrafanaMemAvailKeyword');
    const memSecondKeywordLabel = document.getElementById('settingGrafanaMemSecondKeywordLabel');
    const memFormulaEl = document.getElementById('settingGrafanaMemFormula');
    const tdmExcludeUserEl = document.getElementById('settingTdmExcludeUserDefault');
    const tdmExcludeUserTextGroup = document.getElementById('settingTdmExcludeUserTextGroup');
    const syncTdmExcludeUserField = () => {
        tdmExcludeUserTextGroup.hidden = !tdmExcludeUserEl.checked;
    };
    const normalizeMemCalcMode = value => value === 'used' ? 'used' : 'available';
    const normalizePanelTitle = (value, fallback = '') => String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s+calculated$/i, '')
        .trim()
        .slice(0, 120) || fallback;
    const syncMemCalcFields = (replaceDefault = false) => {
        const nextMode = normalizeMemCalcMode(memCalcModeEl.value);
        const previousMode = normalizeMemCalcMode(memCalcModeEl.dataset.previousMode);
        if (replaceDefault) {
            const previousDefault = previousMode === 'used' ? 'Used' : 'Available';
            if (!memSecondKeywordEl.value.trim() || memSecondKeywordEl.value.trim().toLowerCase() === previousDefault.toLowerCase()) {
                memSecondKeywordEl.value = nextMode === 'used' ? 'Used' : 'Available';
            }
        }
        const metricName = nextMode === 'used' ? 'Used' : 'Available';
        memSecondKeywordLabel.textContent = `Название серии ${metricName}:`;
        memSecondKeywordEl.placeholder = metricName;
        memFormulaEl.textContent = nextMode === 'used'
            ? 'Used % = Used / Total × 100'
            : 'Used % = (Total − Available) / Total × 100';
        memCalcModeEl.dataset.previousMode = nextMode;
    };
    memCalcModeEl.addEventListener('change', () => syncMemCalcFields(true));
    tdmExcludeUserEl.addEventListener('change', syncTdmExcludeUserField);

    // Восстановление настроек
    chrome.storage.sync.get([
        'grafanaIdleKeyword', 'grafanaTrimDomain', 'grafanaTrimDomainEnabled', 'grafanaTrimDomainVersion', 'cpuWarnThreshold', 'cpuCritThreshold',
        'grafanaMemTotalKeyword', 'grafanaMemAvailKeyword', 'grafanaMemCalcMode', 'memWarnThreshold', 'memCritThreshold',
        'grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle', 'grafanaCpuCapacityCoefficient',
        'grafanaCompactExportWidth', 'grafanaCompactExportHeight',
        'memTemplateFull', 'memTemplateTop3',
        'jiraBaseUrl', 'tdmDomain',
        'rememberLastTab', 'rememberLastSubTab', 'confluenceScrollFixEnabled', 'uiScale',
        'cpuTemplateFull', 'cpuTemplateTop3', 'jiraTz', 'wikiDomains', 'grafanaKeepParams', 'grafanaIframeDomains',
        'tdmExcludeUserTextDefault', 'tdmRememberDate',
        'tdmSavePhotosDefault', 'tdmExcludeUserDefault', 'wikiIframeIds',
        'module_grafana', 'module_recorder', 'module_jira', 'module_tdm',
        'module_grafana_links', 'module_grafana_batch', 'module_grafana_debug'
    ], (data) => {
        // Устанавливаем значения, используя дефолты если данных нет
        const defaults = {
            jiraBaseUrl: 'https://jira.lanit.ru',
            jiraTz: 'local',
            tdmDomain: 'web.tdm.mos.ru',
            confluenceScrollFixEnabled: false,
            rememberLastTab: true,
            rememberLastSubTab: true,
            uiScale: 'auto',
            cpuTemplateFull: '{server} до {cpu}%',
            cpuTemplateTop3: 'до {cpu1}% для {server1}, до {cpu2}% для {server2}, для остальных до {cpu3}%',
            memTemplateFull: '{server} до {mem}%',
            memTemplateTop3: 'до {mem1}% для {server1}, до {mem2}% для {server2}, для остальных до {mem3}%',
            wikiDomains: "itpm-wiki.mos.ru\nwiki.mos-team.ru\nwiki.lanit.ru",
            wikiIframeIds: "wysiwygTextarea_ifr, mce_0_ifr",
            tdmExcludeUserTextDefault: "",
            tdmRememberDate: false,
            tdmSavePhotosDefault: true,
            tdmExcludeUserDefault: false,
            module_grafana: true,
            module_recorder: true,
            module_jira: true,
            module_tdm: true,
            module_grafana_links: true,
            module_grafana_batch: true,
            module_grafana_debug: true,
            ...getGrafanaSettingsDefaults()
        };

        const config = { ...defaults, ...data };
        if (Number(data.grafanaTrimDomainVersion) !== 2) config.grafanaTrimDomainEnabled = true;

        document.getElementById("settingGrafanaKeyword").value = config.grafanaIdleKeyword;
        document.getElementById("settingGrafanaCpuPanelTitle").value = normalizePanelTitle(config.grafanaCpuPanelTitle, defaults.grafanaCpuPanelTitle);
        document.getElementById("settingGrafanaMemPanelTitle").value = normalizePanelTitle(config.grafanaMemPanelTitle, defaults.grafanaMemPanelTitle);
        document.getElementById("settingGrafanaLoadPanelTitle").value = normalizePanelTitle(config.grafanaLoadPanelTitle, defaults.grafanaLoadPanelTitle);
        document.getElementById("settingGrafanaCpuCapacityCoefficient").value = config.grafanaCpuCapacityCoefficient;
        document.getElementById("settingGrafanaMemTotalKeyword").value = config.grafanaMemTotalKeyword;
        document.getElementById("settingGrafanaMemAvailKeyword").value = config.grafanaMemAvailKeyword;
        memCalcModeEl.value = data.grafanaMemCalcMode === 'available' || data.grafanaMemCalcMode === 'used'
            ? data.grafanaMemCalcMode
            : (String(config.grafanaMemAvailKeyword).toLowerCase().includes('used') ? 'used' : 'available');
        syncMemCalcFields();
        document.getElementById("settingGrafanaDomain").value = config.grafanaTrimDomain;
        document.getElementById("settingGrafanaTrimDomainEnabled").checked = config.grafanaTrimDomainEnabled;
        document.getElementById("settingGrafanaCompactExportWidth").value = config.grafanaCompactExportWidth;
        document.getElementById("settingGrafanaCompactExportHeight").value = config.grafanaCompactExportHeight;
        document.getElementById("settingGrafanaKeepParams").value = config.grafanaKeepParams;
        const grafanaIframeDomainsEl = document.getElementById("settingGrafanaIframeDomains");
        grafanaIframeDomainsEl.value = Array.isArray(config.grafanaIframeDomains)
            ? config.grafanaIframeDomains.join('\n')
            : '';
        autoResize(grafanaIframeDomainsEl);
        document.getElementById("settingCpuWarn").value = config.cpuWarnThreshold;
        document.getElementById("settingCpuCrit").value = config.cpuCritThreshold;
        document.getElementById("settingMemWarn").value = config.memWarnThreshold;
        document.getElementById("settingMemCrit").value = config.memCritThreshold;
        document.getElementById("settingJiraUrl").value = config.jiraBaseUrl;
        document.getElementById("settingJiraTz").value = config.jiraTz;
        document.getElementById("settingTdmDomain").value = config.tdmDomain;
        document.getElementById("settingTdmSavePhotosDefault").checked = config.tdmSavePhotosDefault !== false;
        document.getElementById("settingTdmRememberDate").checked = config.tdmRememberDate === true;
        document.getElementById("settingTdmExcludeUserDefault").checked = config.tdmExcludeUserDefault === true;
        document.getElementById("settingTdmExcludeUserTextDefault").value = config.tdmExcludeUserTextDefault;
        document.getElementById("settingConfluenceScrollFixEnabled").checked = config.confluenceScrollFixEnabled === true;
        syncTdmExcludeUserField();

        document.getElementById("settingRememberTab").checked = config.rememberLastTab;
        document.getElementById("settingRememberSubTab").checked = config.rememberLastSubTab;
        document.getElementById("settingUiScale").value = ['auto', '90', '100', '110', '125', '150'].includes(String(config.uiScale))
            ? String(config.uiScale) : 'auto';

        document.getElementById("settingModuleGrafana").checked = config.module_grafana;
        document.getElementById("settingModuleRecorder").checked = config.module_recorder;
        document.getElementById("settingModuleJira").checked = config.module_jira;
        document.getElementById("settingModuleTdm").checked = config.module_tdm;
        document.getElementById("settingModuleGrafanaLinks").checked = config.module_grafana_links;
        document.getElementById("settingModuleGrafanaBatch").checked = config.module_grafana_batch;
        document.getElementById("settingModuleGrafanaDebug").checked = config.module_grafana_debug;

        document.getElementById("settingCpuTemplateFull").value = config.cpuTemplateFull;
        document.getElementById("settingCpuTemplateTop3").value = config.cpuTemplateTop3;
        document.getElementById("settingMemTemplateFull").value = config.memTemplateFull;
        document.getElementById("settingMemTemplateTop3").value = config.memTemplateTop3;

        document.getElementById("settingWikiIframeIds").value = config.wikiIframeIds;

        const wikiEl = document.getElementById("settingWikiDomains");
        wikiEl.value = config.wikiDomains;
        autoResize(wikiEl);

        // Логика раскрывающегося списка для Grafana
        const collapsibleHeader = document.querySelector(".collapsible-header");
        const parentToggle = document.getElementById("settingModuleGrafana");
        const subContainer = document.querySelector(".collapsible-content");
        const subCheckboxes = subContainer.querySelectorAll("input[type='checkbox']");

        const updateSubtabsState = () => {
            const isParentActive = parentToggle.checked;
            subContainer.style.opacity = isParentActive ? "1" : "0.5";
            subCheckboxes.forEach(chk => {
                chk.disabled = !isParentActive;
            });
        };

        if (collapsibleHeader) {
            collapsibleHeader.onclick = () => {
                const group = collapsibleHeader.parentElement;
                const content = group.querySelector(".collapsible-content");
                const arrow = group.querySelector(".arrow-icon");
                const isOpen = group.classList.contains("open");

                if (isOpen) {
                    group.classList.remove("open");
                    content.style.maxHeight = "0";
                    arrow.style.transform = "rotate(0deg)";
                } else {
                    group.classList.add("open");
                    content.style.maxHeight = content.scrollHeight + "px";
                    arrow.style.transform = "rotate(90deg)";
                }
            };
        }

        parentToggle.addEventListener("change", updateSubtabsState);

        // Инициализируем состояние подвкладок Grafana при загрузке
        updateSubtabsState();
    });

    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    }

    function getAnalysisThresholdPairError(warning, critical, label) {
        if (![warning, critical].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
            return `Пороги ${label} должны быть числами от 0 до 100.`;
        }
        if (warning >= critical) {
            return `Предупредительный порог ${label} должен быть меньше критического.`;
        }
        return '';
    }

    const analysisThresholdPairs = Object.freeze([
        ['cpuWarnThreshold', 'cpuCritThreshold', 'CPU'],
        ['memWarnThreshold', 'memCritThreshold', 'RAM']
    ]);

    function validateEffectiveImportedThresholds(currentSync, importedSync) {
        const effectiveSync = { ...getGrafanaSettingsDefaults(), ...currentSync, ...importedSync };
        analysisThresholdPairs.forEach(([warningKey, criticalKey, label]) => {
            if (importedSync[warningKey] === undefined && importedSync[criticalKey] === undefined) return;
            const error = getAnalysisThresholdPairError(
                effectiveSync[warningKey], effectiveSync[criticalKey], label
            );
            if (error) throw new Error(error);
        });
    }

    function readAnalysisThreshold(inputId) {
        const raw = document.getElementById(inputId).value.trim();
        return raw === '' ? Number.NaN : Number(raw);
    }

    // Авто-изменение высоты для текстового поля Wiki
    document.getElementById("settingWikiDomains").oninput = (e) => {
        autoResize(e.target);
    };

    document.getElementById("settingGrafanaIframeDomains").oninput = (e) => {
        autoResize(e.target);
    };

    function parseGrafanaIframeDomains(value) {
        const hosts = new Set();
        const invalid = [];

        value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean).forEach((item) => {
            try {
                const host = normalizeHttpHost(item);
                if (!host) throw new Error('unsupported URL');
                hosts.add(host);
            } catch (e) {
                invalid.push(item);
            }
        });

        if (invalid.length) {
            throw new Error(`Некорректные адреса Grafana: ${invalid.join(', ')}`);
        }
        return [...hosts];
    }

    // Сохранение основных настроек
    document.getElementById('saveBtn').addEventListener('click', () => {
        const grafanaDefaults = getGrafanaSettingsDefaults();
        const kw = document.getElementById("settingGrafanaKeyword").value.trim() || grafanaDefaults.grafanaIdleKeyword;
        const memTotalKw = document.getElementById("settingGrafanaMemTotalKeyword").value.trim() || grafanaDefaults.grafanaMemTotalKeyword;
        const memCalcMode = normalizeMemCalcMode(memCalcModeEl.value);
        const memAvailKw = document.getElementById("settingGrafanaMemAvailKeyword").value.trim()
            || (memCalcMode === 'used' ? 'Used' : grafanaDefaults.grafanaMemAvailKeyword);
        const cpuPanelTitle = normalizePanelTitle(document.getElementById("settingGrafanaCpuPanelTitle").value, grafanaDefaults.grafanaCpuPanelTitle);
        const memPanelTitle = normalizePanelTitle(document.getElementById("settingGrafanaMemPanelTitle").value, grafanaDefaults.grafanaMemPanelTitle);
        const loadPanelTitle = normalizePanelTitle(document.getElementById("settingGrafanaLoadPanelTitle").value, grafanaDefaults.grafanaLoadPanelTitle);
        const cpuCapacityCoefficient = Number(document.getElementById("settingGrafanaCpuCapacityCoefficient").value);
        if (!Number.isFinite(cpuCapacityCoefficient) || cpuCapacityCoefficient < 0.01 || cpuCapacityCoefficient > 10) {
            showMaintStatus('Коэффициент порога Load Average должен быть от 0,01 до 10.', 'red');
            return;
        }
        const compactWidth = Number(document.getElementById("settingGrafanaCompactExportWidth").value);
        const compactHeight = Number(document.getElementById("settingGrafanaCompactExportHeight").value);
        if (![compactWidth, compactHeight].every(value => Number.isInteger(value) && value >= 100 && value <= 4096)) {
            showMaintStatus('Размер компактного снимка должен быть целым числом от 100 до 4096 px.', 'red');
            return;
        }
        if (new Set([cpuPanelTitle, memPanelTitle, loadPanelTitle].map(value => value.toLowerCase())).size !== 3) {
            showMaintStatus('Названия панелей CPU, RAM и Load Average должны отличаться.', 'red');
            return;
        }
        const dom = document.getElementById("settingGrafanaDomain").value.trim() || grafanaDefaults.grafanaTrimDomain;
        const trimDomainEnabled = document.getElementById("settingGrafanaTrimDomainEnabled").checked;
        const keepParams = document.getElementById("settingGrafanaKeepParams").value.trim() || grafanaDefaults.grafanaKeepParams;
        const warn = readAnalysisThreshold('settingCpuWarn');
        const crit = readAnalysisThreshold('settingCpuCrit');
        const memWarn = readAnalysisThreshold('settingMemWarn');
        const memCrit = readAnalysisThreshold('settingMemCrit');
        const thresholdError = getAnalysisThresholdPairError(warn, crit, 'CPU')
            || getAnalysisThresholdPairError(memWarn, memCrit, 'RAM');
        if (thresholdError) {
            showMaintStatus(thresholdError, 'red');
            return;
        }
        const jiraInput = document.getElementById("settingJiraUrl").value.trim() || 'https://jira.lanit.ru';
        const jiraTz = document.getElementById("settingJiraTz").value || 'local';
        const tdmInput = document.getElementById("settingTdmDomain").value.trim() || 'web.tdm.mos.ru';
        const tdmExcludeUserTextDefault = document.getElementById("settingTdmExcludeUserTextDefault").value.trim();
        const tplFull = document.getElementById("settingCpuTemplateFull").value || '{server} до {cpu}%';
        const tplTop3 = document.getElementById("settingCpuTemplateTop3").value || 'до {cpu1}% для {server1}, до {cpu2}% для {server2}, для остальных до {cpu3}%';
        const memTplFull = document.getElementById("settingMemTemplateFull").value || '{server} до {mem}%';
        const memTplTop3 = document.getElementById("settingMemTemplateTop3").value || 'до {mem1}% для {server1}, до {mem2}% для {server2}, для остальных до {mem3}%';
        const wikiDom = document.getElementById("settingWikiDomains").value.trim();
        const wikiIframeIds = document.getElementById("settingWikiIframeIds").value.trim();
        let grafanaIframeDomains;
        let jiraUrl;
        let tdm;
        try {
            grafanaIframeDomains = parseGrafanaIframeDomains(document.getElementById("settingGrafanaIframeDomains").value);
            jiraUrl = normalizeHttpBaseUrl(jiraInput);
            if (!jiraUrl) throw new Error('Адрес Jira должен быть HTTP(S) URL без параметров и учётных данных.');
            tdm = normalizeHttpHost(tdmInput);
            if (!tdm) throw new Error('Некорректный HTTP(S) адрес или домен TDM.');
        } catch (e) {
            showMaintStatus(e.message, "red");
            return;
        }

        chrome.storage.sync.set({
            grafanaIdleKeyword: kw,
            grafanaMemTotalKeyword: memTotalKw,
            grafanaMemAvailKeyword: memAvailKw,
            grafanaMemCalcMode: memCalcMode,
            grafanaCpuPanelTitle: cpuPanelTitle,
            grafanaMemPanelTitle: memPanelTitle,
            grafanaLoadPanelTitle: loadPanelTitle,
            grafanaCpuCapacityCoefficient: cpuCapacityCoefficient,
            grafanaCompactExportWidth: compactWidth,
            grafanaCompactExportHeight: compactHeight,
            grafanaTrimDomain: dom,
            grafanaTrimDomainEnabled: trimDomainEnabled,
            grafanaTrimDomainVersion: 2,
            cpuWarnThreshold: warn,
            cpuCritThreshold: crit,
            memWarnThreshold: memWarn,
            memCritThreshold: memCrit,
            jiraBaseUrl: jiraUrl,
            jiraTz: jiraTz,
            tdmDomain: tdm,
            tdmSavePhotosDefault: document.getElementById("settingTdmSavePhotosDefault").checked,
            tdmRememberDate: document.getElementById("settingTdmRememberDate").checked,
            tdmExcludeUserDefault: document.getElementById("settingTdmExcludeUserDefault").checked,
            tdmExcludeUserTextDefault: tdmExcludeUserTextDefault,
            confluenceScrollFixEnabled: document.getElementById("settingConfluenceScrollFixEnabled").checked,
            cpuTemplateFull: tplFull,
            cpuTemplateTop3: tplTop3,
            memTemplateFull: memTplFull,
            memTemplateTop3: memTplTop3,
            wikiDomains: wikiDom,
            wikiIframeIds: wikiIframeIds,
            grafanaKeepParams: keepParams,
            grafanaIframeDomains: grafanaIframeDomains,
            rememberLastTab: document.getElementById("settingRememberTab").checked,
            rememberLastSubTab: document.getElementById("settingRememberSubTab").checked,
            uiScale: document.getElementById("settingUiScale").value,
            module_grafana: document.getElementById("settingModuleGrafana").checked,
            module_recorder: document.getElementById("settingModuleRecorder").checked,
            module_jira: document.getElementById("settingModuleJira").checked,
            module_tdm: document.getElementById("settingModuleTdm").checked,
            module_grafana_links: document.getElementById("settingModuleGrafanaLinks").checked,
            module_grafana_batch: document.getElementById("settingModuleGrafanaBatch").checked,
            module_grafana_debug: document.getElementById("settingModuleGrafanaDebug").checked
        }, () => {
            const saveError = chrome.runtime.lastError;
            if (saveError) {
                showMaintStatus(`Не удалось сохранить настройки: ${saveError.message}`, 'red');
                return;
            }
            const btn = document.getElementById('saveBtn');
            const text = document.getElementById('saveBtnText');
            if (text) {
                const originalText = text.innerText;
                btn.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
                text.innerText = '✅ Настройки сохранены!';

                setTimeout(() => {
                    btn.style.background = ''; // Возврат к CSS
                    text.innerText = originalText;
                }, 2500);
            }
        });
    });

    function isPlainObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    const IMPORT_SCHEMA_VERSION = 3;
    // The exporter enforces the same ceiling before offering a download, so
    // every configuration file produced here is guaranteed to be importable.
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
    const pickImportKeys = (source, allowlist, dropped, area) => Object.fromEntries(Object.entries(source || {}).filter(([key]) => {
        if (allowlist.has(key)) return true;
        dropped.push(`${area}.${key}`);
        return false;
    }));

    function setStorageValues(area, values) {
        return new Promise((resolve, reject) => {
            area.set(values, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
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
            if (sync[key] !== undefined
                && (!Number.isInteger(sync[key]) || sync[key] < 100 || sync[key] > 4096)) {
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
                if (sync[key] !== undefined
                    && (!Number.isFinite(sync[key]) || sync[key] < 0 || sync[key] > 100)) {
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

    // Экспорт настроек
    document.getElementById('exportBtn').addEventListener('click', () => {
        chrome.storage.sync.get(null, (syncData) => {
            chrome.storage.local.get(null, (localData) => {
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
                    showMaintStatus('Настройки превышают безопасный лимит 16 МиБ. Очистите устаревший кэш Jira или профили и повторите экспорт.', 'red');
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dashbridge_config_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
                showMaintStatus('Настройки экспортированы в JSON.', 'green');
            });
        });
    });

    // Импорт настроек
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const maintStatus = document.getElementById('maintenanceStatus');

    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) {
            importFile.value = '';
            showMaintStatus('Файл конфигурации превышает лимит 16 МиБ.', 'red');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = validateImportedConfig(JSON.parse(event.target.result));
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
                        local: Object.fromEntries(Object.entries(currentLocal).filter(([key]) => key !== 'dashbridge_import_backup'))
                    }
                });
                await setStorageValues(chrome.storage.sync, imported.sync);
                if (Object.keys(imported.local).length) {
                    await setStorageValues(chrome.storage.local, imported.local);
                }
                showMaintStatus('Настройки импортированы. Обновите открытые страницы Dashboard.', 'green');
            } catch (err) {
                const message = err && err.message ? err.message : 'Ошибка при чтении файла.';
                showMaintStatus(message, 'red');
            } finally {
                importFile.value = '';
            }
        };
        reader.onerror = () => {
            importFile.value = '';
            showMaintStatus('Не удалось прочитать выбранный файл.', 'red');
        };
        reader.readAsText(file);
    });

    function showMaintStatus(text, color) {
        maintStatus.textContent = text;
        maintStatus.style.color = color;
        maintStatus.style.display = 'block';
        setTimeout(() => { maintStatus.style.display = 'none'; }, 5000);
    }

    // Обработчики для inline-разметки с data-атрибутами (CSP-совместимость)
    document.querySelectorAll('[data-stop-propagation]').forEach((el) => {
        el.addEventListener('click', (e) => e.stopPropagation());
    });
});
