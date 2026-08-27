(function initDashBridgeLocalStateSchema(root) {
    'use strict';

    // IDs are storage keys, not security boundaries. Accept legacy identifiers
    // while excluding control characters and HTML/template delimiters.
    const SAFE_ID_PATTERN = /^[^\u0000-\u001f\u007f<>"'`\\]{1,128}$/;
    const WORKLOG_STATUSES = new Set(['new', 'error', 'sent']);
    const PANEL_WIDTHS = new Set(['33%', '50%', '100%']);
    const BATCH_THEME_VALUES = new Set(['current', 'light', 'dark']);
    const REPORT_SOURCES = new Set(['graph', 'custom', 'cpu_capacity', 'none']);
    const REPORT_INCLUDE_MODES = new Set(['always', 'breach_only', 'issue_only', 'critical_only']);
    const REPORT_EVALUATIONS = new Set(['period_max', 'latest', 'period_min', 'period_avg', 'period_sum']);
    const REPORT_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte']);
    const BATCH_FIELD_RULES = Object.freeze({
        dashUrl: 4096, panelsMode: new Set(['all', 'whitelist', 'blacklist']), userPanels: 100_000,
        timestamps: 100_000, seriesDashUrl: 4096, seriesTimestamps: 100_000,
        seriesIncludeFilter: 10_000, seriesIgnoreFilter: 10_000,
        seriesCaptureMode: new Set(['group', 'standalone']),
        compactCaptureMain: new Set([true, false]), compactCaptureSeries: new Set([true, false]),
    });
    const BOOLEAN_TOOL_KEYS = new Set([
        'removeFill', 'thickenLines', 'invertLegend', 'invertIdle', 'convertMemToUsed', 'forceMemByteUnit',
        'seriesQueryFilterEnabled', 'seriesQueryFilterHighlightEnabled',
        'cpuCapacityFilterEnabled', 'cpuCapacityFilterHighlightEnabled', 'cpuCapacityFilterLoad1',
        'cpuCapacityFilterLoad5', 'cpuCapacityFilterLoad15', 'thresholdEnabled', 'thresholdNotifyEnabled',
        'capturePrepared'
    ]);
    const NUMBER_TOOL_KEYS = new Set([
        'thickenLinesValue', 'seriesQueryFilterValue', 'seriesQueryFilterRawValue', 'cpuCapacityFilterCoefficient',
        'thresholdValue', 'thresholdRawValue', 'seriesFilterSettingsVersion',
        'legendSelectionVersion'
    ]);
    const STRING_TOOL_KEYS = new Set([
        'legendSelectFilter', 'legendIgnoreFilter', 'legendMode',
        'seriesQueryFilterMode', 'cpuCapacityFilterMode', 'thresholdUnit'
    ]);

    const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
    const fail = message => { throw new TypeError(message); };
    const stringField = (value, label, maxLength, allowEmpty = true) => {
        if (typeof value !== 'string') fail(`${label}: ожидается строка.`);
        if (!allowEmpty && !value.trim()) fail(`${label}: пустое значение недопустимо.`);
        if (value.length > maxLength) fail(`${label}: превышена максимальная длина ${maxLength}.`);
        return value;
    };
    const idField = (value, label) => {
        if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) fail(`${label}: некорректный идентификатор.`);
        return value;
    };
    const httpUrlField = (value, label) => {
        const source = stringField(value, label, 4096, false);
        let parsed;
        try { parsed = new URL(source); } catch { fail(`${label}: некорректный URL.`); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            fail(`${label}: разрешены только HTTP(S) URL без учётных данных.`);
        }
        return parsed.toString();
    };
    const optionalString = (value, label, maxLength, fallback = '') => value === undefined
        ? fallback : stringField(value, label, maxLength);

    function normalizeTools(value, label) {
        if (value === undefined) return undefined;
        if (!isPlainObject(value)) fail(`${label}: ожидается объект.`);
        const normalized = { ...value };
        for (const [key, item] of Object.entries(value)) {
            if (BOOLEAN_TOOL_KEYS.has(key)) {
                if (typeof item !== 'boolean') fail(`${label}.${key}: ожидается boolean.`);
                normalized[key] = item;
            } else if (NUMBER_TOOL_KEYS.has(key)) {
                if (item !== null && !Number.isFinite(Number(item))) fail(`${label}.${key}: ожидается число или null.`);
                normalized[key] = item === null ? null : Number(item);
            } else if (STRING_TOOL_KEYS.has(key)) {
                normalized[key] = stringField(item, `${label}.${key}`, 512);
            } else if (key === 'legendFilter' || key === 'legendVisibleSeries') {
                if (!Array.isArray(item) || item.length > 1000 || !item.every(entry => typeof entry === 'string' && entry.length <= 512)) {
                    fail(`${label}.${key}: некорректный список серий.`);
                }
                normalized[key] = [...item];
            }
        }
        return normalized;
    }

    function normalizePanelReport(value, label) {
        if (value === undefined) return undefined;
        if (!isPlainObject(value)) fail(`${label}: ожидается объект.`);
        if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail(`${label}.enabled: ожидается boolean.`);
        if (value.detailsEnabled !== undefined && typeof value.detailsEnabled !== 'boolean') fail(`${label}.detailsEnabled: ожидается boolean.`);
        const source = value.sla?.source === undefined ? 'none' : value.sla.source;
        if (value.sla !== undefined && !isPlainObject(value.sla)) fail(`${label}.sla: ожидается объект.`);
        if (!REPORT_SOURCES.has(source)) fail(`${label}.sla.source: недопустимый источник.`);
        const includeMode = value.includeMode === undefined ? 'always' : value.includeMode;
        if (!REPORT_INCLUDE_MODES.has(includeMode)) fail(`${label}.includeMode: недопустимый режим.`);
        const evaluation = value.sla?.evaluation === undefined ? 'period_max' : value.sla.evaluation;
        if (!REPORT_EVALUATIONS.has(evaluation)) fail(`${label}.sla.evaluation: недопустимый режим.`);
        const operator = value.sla?.operator === undefined ? 'gt' : value.sla.operator;
        if (!REPORT_OPERATORS.has(operator)) fail(`${label}.sla.operator: недопустимый оператор.`);
        const customValue = value.sla?.value;
        if (customValue !== undefined && customValue !== null && !Number.isFinite(Number(customValue))) {
            fail(`${label}.sla.value: ожидается число или null.`);
        }
        const warningValue = value.sla?.warningValue;
        if (warningValue !== undefined && warningValue !== null && !Number.isFinite(Number(warningValue))) {
            fail(`${label}.sla.warningValue: ожидается число или null.`);
        }
        const templates = value.templates;
        if (templates !== undefined) {
            if (!isPlainObject(templates)) fail(`${label}.templates: ожидается объект.`);
            for (const key of ['normal', 'warning', 'breached', 'neutral', 'unavailable', 'details']) {
                if (templates[key] !== undefined) stringField(templates[key], `${label}.templates.${key}`, 10_000);
            }
            if (templates.listItem !== undefined) stringField(templates.listItem, `${label}.templates.listItem`, 2_000);
        }
        return {
            ...value,
            enabled: value.enabled === true,
            key: optionalString(value.key, `${label}.key`, 64),
            includeMode: source === 'none' ? 'always' : (includeMode === 'breach_only' ? 'critical_only' : includeMode),
            sla: { ...(value.sla || {}), source, operator, evaluation,
                value: customValue === undefined || customValue === null ? null : Number(customValue),
                warningValue: warningValue === undefined || warningValue === null ? null : Number(warningValue),
                unit: optionalString(value.sla?.unit, `${label}.sla.unit`, 64) },
            templates: templates ? { ...templates } : undefined,
            detailsEnabled: value.detailsEnabled === true
        };
    }

    function normalizeProfileReport(value, label) {
        if (value === undefined) return undefined;
        if (!isPlainObject(value)) fail(`${label}: ожидается объект.`);
        if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail(`${label}.enabled: ожидается boolean.`);
        if (value.context !== undefined && !isPlainObject(value.context)) fail(`${label}.context: ожидается объект.`);
        return { ...value, enabled: value.enabled !== false,
            template: optionalString(value.template, `${label}.template`, 20_000),
            context: value.context ? {
                ...value.context,
                testName: optionalString(value.context.testName, `${label}.context.testName`, 500),
                environment: optionalString(value.context.environment, `${label}.context.environment`, 500),
                testStartedAt: optionalString(value.context.testStartedAt, `${label}.context.testStartedAt`, 64),
                stableLoadStartedAt: optionalString(value.context.stableLoadStartedAt, `${label}.context.stableLoadStartedAt`, 64)
            } : undefined };
    }

    function normalizePanel(value, label, mode) {
        if (!isPlainObject(value)) fail(`${label}: ожидается объект.`);
        let heightNumber = Number.parseInt(value.height ?? '350px', 10);
        if (mode === 'load' && (!Number.isFinite(heightNumber) || heightNumber < 180 || heightNumber > 3000)) heightNumber = 350;
        if (!Number.isFinite(heightNumber) || heightNumber < 180 || heightNumber > 3000) {
            fail(`${label}.height: высота должна быть от 180 до 3000 px.`);
        }
        let width = value.width === undefined ? '50%' : stringField(value.width, `${label}.width`, 32, false);
        if (mode === 'load' && !PANEL_WIDTHS.has(width)) width = '50%';
        if (!PANEL_WIDTHS.has(width)) fail(`${label}.width: недопустимая ширина.`);
        const panel = {
            ...value,
            id: idField(value.id, `${label}.id`),
            src: httpUrlField(value.src, `${label}.src`),
            width,
            height: `${heightNumber}px`
        };
        if (value.title !== undefined) panel.title = stringField(value.title, `${label}.title`, 240);
        if (value.paused !== undefined) {
            if (typeof value.paused !== 'boolean') fail(`${label}.paused: ожидается boolean.`);
            panel.paused = value.paused;
        }
        if (value.grafanaTheme !== undefined) {
            if (!['follow', 'light', 'dark'].includes(value.grafanaTheme)) fail(`${label}.grafanaTheme: недопустимая тема.`);
            panel.grafanaTheme = value.grafanaTheme;
        }
        const tools = mode === 'load'
            ? (isPlainObject(value.tools) ? { ...value.tools } : undefined)
            : normalizeTools(value.tools, `${label}.tools`);
        if (tools !== undefined) panel.tools = tools;
        else if (value.tools !== undefined) delete panel.tools;
        const report = mode === 'load'
            ? (isPlainObject(value.report) ? { ...value.report } : undefined)
            : normalizePanelReport(value.report, `${label}.report`);
        if (report !== undefined) panel.report = report;
        else if (value.report !== undefined) delete panel.report;
        return panel;
    }

    function normalizeProfiles(value, { mode = 'import', randomUUID = () => crypto.randomUUID() } = {}) {
        if (!Array.isArray(value)) fail('dashbridge_profiles: ожидается массив.');
        const profiles = [];
        const profileIds = new Set();
        let skippedProfiles = 0;
        let skippedPanels = 0;
        value.forEach((source, profileIndex) => {
            try {
                if (!isPlainObject(source)) fail(`dashbridge_profiles[${profileIndex}]: ожидается объект.`);
                const id = source.id === undefined && mode === 'load'
                    ? randomUUID() : idField(source.id, `dashbridge_profiles[${profileIndex}].id`);
                if (profileIds.has(id)) fail(`dashbridge_profiles[${profileIndex}].id: идентификатор повторяется.`);
                const name = stringField(source.name, `dashbridge_profiles[${profileIndex}].name`, 2000, false).trim();
                if (!Array.isArray(source.panels)) {
                    fail(`dashbridge_profiles[${profileIndex}].panels: некорректный массив.`);
                }
                const panels = [];
                const panelIds = new Set();
                source.panels.forEach((panel, panelIndex) => {
                    try {
                        const normalizedPanel = normalizePanel(panel, `dashbridge_profiles[${profileIndex}].panels[${panelIndex}]`, mode);
                        if (panelIds.has(normalizedPanel.id)) fail(`dashbridge_profiles[${profileIndex}].panels[${panelIndex}].id: идентификатор повторяется.`);
                        panelIds.add(normalizedPanel.id);
                        panels.push(normalizedPanel);
                    }
                    catch (error) {
                        if (mode !== 'load') throw error;
                        skippedPanels += 1;
                    }
                });
                profileIds.add(id);
                const report = mode === 'load'
                    ? (isPlainObject(source.report) ? { ...source.report } : undefined)
                    : normalizeProfileReport(source.report, `dashbridge_profiles[${profileIndex}].report`);
                profiles.push({ ...source, id, name, panels, ...(report === undefined ? {} : { report }) });
            } catch (error) {
                if (mode !== 'load') throw error;
                skippedProfiles += 1;
            }
        });
        return { items: profiles, skippedProfiles, skippedPanels };
    }

    function normalizeWorklog(value, label, { mode, randomUUID }) {
        if (!isPlainObject(value)) fail(`${label}: ожидается объект.`);
        const id = value.id === undefined && mode === 'load'
            ? randomUUID() : idField(value.id, `${label}.id`);
        const status = value.status === undefined ? 'new' : value.status;
        if (!WORKLOG_STATUSES.has(status)) fail(`${label}.status: недопустимое состояние.`);
        return {
            ...value,
            id,
            issueId: optionalString(value.issueId, `${label}.issueId`, 2048),
            issueKey: optionalString(value.issueKey, `${label}.issueKey`, 128),
            summary: optionalString(value.summary, `${label}.summary`, 2000),
            description: optionalString(value.description, `${label}.description`, 20000),
            timeSpent: optionalString(value.timeSpent, `${label}.timeSpent`, 64),
            dateStarted: optionalString(value.dateStarted, `${label}.dateStarted`, 64),
            status
        };
    }

    function normalizeWorklogs(value, { mode = 'import', randomUUID = () => crypto.randomUUID() } = {}) {
        if (!Array.isArray(value)) fail('jiraWorklogs: ожидается массив.');
        const items = [];
        const ids = new Set();
        let skipped = 0;
        value.forEach((entry, index) => {
            try {
                const normalized = normalizeWorklog(entry, `jiraWorklogs[${index}]`, { mode, randomUUID });
                if (ids.has(normalized.id)) fail(`jiraWorklogs[${index}].id: идентификатор повторяется.`);
                ids.add(normalized.id);
                items.push(normalized);
            }
            catch (error) {
                if (mode !== 'load') throw error;
                skipped += 1;
            }
        });
        return { items, skipped };
    }

    function normalizeCustomButtons(value, { mode = 'import' } = {}) {
        if (!Array.isArray(value)) fail('customButtons: ожидается массив.');
        if (value.length > 100 && mode !== 'load') fail('customButtons: допускается не более 100 ссылок.');
        const items = []; const ids = new Set(); let skipped = 0;
        value.slice(0, 100).forEach((entry, index) => {
            try {
                if (!isPlainObject(entry)) fail(`customButtons[${index}]: ожидается объект.`);
                const id = entry.id;
                if (!((typeof id === 'string' && SAFE_ID_PATTERN.test(id)) || (Number.isSafeInteger(id) && id >= 0))) {
                    fail(`customButtons[${index}].id: некорректный идентификатор.`);
                }
                const identity = String(id);
                if (ids.has(identity)) fail(`customButtons[${index}].id: идентификатор повторяется.`);
                const name = stringField(entry.name, `customButtons[${index}].name`, 120, false).trim();
                const url = httpUrlField(entry.url, `customButtons[${index}].url`);
                ids.add(identity); items.push({ id, name, url });
            } catch (error) {
                if (mode !== 'load') throw error;
                skipped += 1;
            }
        });
        skipped += Math.max(0, value.length - 100);
        return { items, skipped };
    }

    function normalizeBatchState(value, { mode = 'import' } = {}) {
        if (!isPlainObject(value)) fail('batchState: ожидается объект.');
        const normalized = {};
        for (const [key, rule] of Object.entries(BATCH_FIELD_RULES)) {
            if (value[key] === undefined) continue;
            try {
                if (rule instanceof Set) {
                    if (!rule.has(value[key])) fail(`batchState.${key}: недопустимое значение.`);
                    normalized[key] = value[key];
                } else normalized[key] = stringField(value[key], `batchState.${key}`, rule);
            } catch (error) { if (mode !== 'load') throw error; }
        }
        for (const name of ['captureThemeMain', 'captureThemeSeries']) {
            const key = `radio_${name}`;
            if (value[key] === undefined) continue;
            if (BATCH_THEME_VALUES.has(value[key])) normalized[key] = value[key];
            else if (mode !== 'load') fail(`batchState.${name}: недопустимая тема.`);
        }
        return normalized;
    }

    function normalizeImportedLocal(local) {
        if (!isPlainObject(local)) fail('local: ожидается объект.');
        const normalized = { ...local };
        let profileIds = null;
        if (local.dashbridge_profiles !== undefined) {
            const result = normalizeProfiles(local.dashbridge_profiles);
            normalized.dashbridge_profiles = result.items;
            profileIds = new Set(result.items.map(profile => profile.id));
        }
        if (local.dashbridge_activeProfileId !== undefined) {
            normalized.dashbridge_activeProfileId = idField(local.dashbridge_activeProfileId, 'dashbridge_activeProfileId');
            if (profileIds && !profileIds.has(normalized.dashbridge_activeProfileId)) {
                fail('dashbridge_activeProfileId: профиль отсутствует в импортируемом списке.');
            }
        }
        if (local.jiraWorklogs !== undefined) normalized.jiraWorklogs = normalizeWorklogs(local.jiraWorklogs).items;
        if (local.batchState !== undefined) normalized.batchState = normalizeBatchState(local.batchState);
        return normalized;
    }

    root.DashBridgeLocalStateSchema = Object.freeze({
        isSafeId: value => typeof value === 'string' && SAFE_ID_PATTERN.test(value),
        normalizeProfiles,
        normalizeWorklogs,
        normalizeCustomButtons,
        normalizeBatchState,
        normalizeImportedLocal
    });
})(globalThis);
