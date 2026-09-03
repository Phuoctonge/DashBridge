(function initDashBridgeReport(root) {
    'use strict';

    const DEFAULT_PROFILE_TEMPLATE = 'Состояние инфраструктуры за {{period}}:\n\n{{panels}}\n\nОтчёт сформирован: {{generatedAt}}';
    const DEFAULT_NORMAL_TEMPLATE = '🟢 По панели «{{panelTitle}}» превышения SLA {{threshold}} {{unit}} не фиксируются.';
    const DEFAULT_WARNING_TEMPLATE = '⚠️ По панели «{{panelTitle}}» зафиксированы значения предупредительного уровня {{warningThreshold}} {{unit}}.';
    const DEFAULT_BREACH_TEMPLATE = '🔴 По серверам {{servers}} фиксируется значение более {{threshold}} {{unit}}, что превышает установленные требования.';
    const DEFAULT_NEUTRAL_TEMPLATE = '🖥 По панели «{{panelTitle}}»: {{aggregateValue}} {{unit}}.';
    const DEFAULT_UNAVAILABLE_TEMPLATE = '⚠ Не удалось получить данные панели «{{panelTitle}}». Причина: {{dataStatus}}.';
    const DEFAULT_LIST_ITEM_TEMPLATE = '- {{name}} — {{value}}{{unit}};';
    const DEFAULT_DETAILS_TEMPLATE = '{{stateQuote}}';
    const SOURCES = new Set(['graph', 'custom', 'cpu_capacity', 'none']);
    const INCLUDE_MODES = new Set(['always', 'issue_only', 'critical_only']);
    const EVALUATIONS = new Set(['period_max', 'latest', 'period_min', 'period_avg', 'period_sum']);
    const OPERATORS = new Set(['gt', 'gte', 'lt', 'lte']);
    const PROFILE_VARIABLES = Object.freeze([
        'profileName', 'testName', 'environment', 'testStartedAt', 'stableLoadStartedAt',
        'testDuration', 'stableLoadDuration', 'period', 'generatedAt', 'panels'
    ]);
    const PANEL_VARIABLES = Object.freeze([
        'panelTitle', 'threshold', 'criticalThreshold', 'warningThreshold', 'unit',
        'servers', 'serverCount', 'criticalServers', 'criticalCount', 'warningServers',
        'warningCount', 'criticalList', 'warningList', 'breachesList', 'allSeriesList',
        'top3List', 'stateList', 'stateQuote', 'tableMarkdown', 'tableRowCount', 'tableColumnCount',
        'maxValue', 'minValue', 'lastValue',
        'averageValue', 'sumValue', 'aggregateValue', 'cpuCapacityCoefficient',
        'dataStatus', 'period', 'generatedAt'
    ]);
    const LIST_VARIABLES = Object.freeze([
        'name', 'rawName', 'vCpu', 'cpuCapacity', 'seriesThreshold', 'value', 'unit',
        'level', 'panelTitle'
    ]);

    const text = (value, maxLength, fallback = '') => typeof value === 'string'
        ? value.slice(0, maxLength) : fallback;
    const finiteOrNull = value => value !== null && value !== '' && Number.isFinite(Number(value))
        ? Number(value) : null;
    const slug = (value, fallback = 'panel') => {
        const normalized = String(value || '').toLowerCase().replace(/[^a-zа-яё0-9]+/giu, '_')
            .replace(/^_+|_+$/g, '').slice(0, 64);
        return normalized || fallback;
    };

    function normalizeProfile(value = {}) {
        const panelOrder = Array.isArray(value.panelOrder)
            ? [...new Set(value.panelOrder.filter(id => typeof id === 'string' && id.length <= 128))].slice(0, 1000)
            : [];
        return {
            enabled: value.enabled !== false,
            template: text(value.template, 20_000, DEFAULT_PROFILE_TEMPLATE) || DEFAULT_PROFILE_TEMPLATE,
            panelOrder,
            context: {
                testName: text(value?.context?.testName, 500, ''),
                environment: text(value?.context?.environment, 500, ''),
                testStartedAt: text(value?.context?.testStartedAt, 64, ''),
                stableLoadStartedAt: text(value?.context?.stableLoadStartedAt, 64, '')
            }
        };
    }

    function orderPanels(panels, panelOrder) {
        const source = Array.isArray(panels) ? panels : [];
        const ranks = new Map((Array.isArray(panelOrder) ? panelOrder : [])
            .map((id, index) => [id, index]));
        return source.map((panel, index) => ({ panel, index }))
            .sort((left, right) => {
                const leftRank = ranks.has(left.panel?.id) ? ranks.get(left.panel.id) : Number.MAX_SAFE_INTEGER;
                const rightRank = ranks.has(right.panel?.id) ? ranks.get(right.panel.id) : Number.MAX_SAFE_INTEGER;
                return leftRank - rightRank || left.index - right.index;
            })
            .map(item => item.panel);
    }

    function normalizePanel(value = {}, panel = {}) {
        const graphThreshold = !!panel?.tools?.thresholdEnabled;
        const source = SOURCES.has(value?.sla?.source) ? value.sla.source : (graphThreshold ? 'graph' : 'none');
        const requestedIncludeMode = value.includeMode === 'breach_only' ? 'critical_only' : value.includeMode;
        const includeMode = INCLUDE_MODES.has(requestedIncludeMode) ? requestedIncludeMode : 'always';
        return {
            enabled: value.enabled === true,
            key: slug(value.key || panel.title || panel.id, `panel_${String(panel.id || '').slice(0, 8)}`),
            includeMode: source === 'none' ? 'always' : includeMode,
            sla: {
                source,
                operator: OPERATORS.has(value?.sla?.operator) ? value.sla.operator : 'gt',
                value: finiteOrNull(value?.sla?.value),
                warningValue: finiteOrNull(value?.sla?.warningValue),
                unit: text(value?.sla?.unit, 64, ''),
                evaluation: EVALUATIONS.has(value?.sla?.evaluation) ? value.sla.evaluation : 'period_max'
            },
            templates: {
                normal: text(value?.templates?.normal, 10_000, DEFAULT_NORMAL_TEMPLATE),
                warning: text(value?.templates?.warning, 10_000, DEFAULT_WARNING_TEMPLATE),
                breached: text(value?.templates?.breached, 10_000, DEFAULT_BREACH_TEMPLATE),
                neutral: text(value?.templates?.neutral, 10_000, DEFAULT_NEUTRAL_TEMPLATE),
                unavailable: text(value?.templates?.unavailable, 10_000, DEFAULT_UNAVAILABLE_TEMPLATE),
                listItem: text(value?.templates?.listItem, 2_000, DEFAULT_LIST_ITEM_TEMPLATE),
                details: text(value?.templates?.details, 10_000, DEFAULT_DETAILS_TEMPLATE)
            },
            detailsEnabled: value.detailsEnabled === true
        };
    }

    const formatNumber = value => {
        const number = finiteOrNull(value);
        if (number === null) return '';
        return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(number);
    };

    const MESSAGE_DURATION_UNITS = Object.freeze({
        us: 'мкс', 'µs': 'мкс', 'μs': 'мкс', ms: 'мс', s: 'с', min: 'мин', mins: 'мин', h: 'ч', d: 'д'
    });
    function localizeMessageText(value) {
        return String(value ?? '')
            .replace(/(^|_)<_/gu, '$1GET_')
            .replace(/(^|_)>_/gu, '$1POST_')
            .replace(/(^|_)(?:\\)?\*_/gu, '$1DELETE_')
            .replace(/(^|_)\^_/gu, '$1PUT_')
            .replace(/(\d(?:[.,]\d+)?\s*)(µs|μs|us|ms|mins?|s|h|d)\b/giu,
                (_match, amount, unit) => `${amount}${MESSAGE_DURATION_UNITS[unit.toLowerCase()] || unit}`);
    }
    const localizeMessageUnit = value => {
        const unit = String(value ?? '');
        return MESSAGE_DURATION_UNITS[unit.toLowerCase()] || unit;
    };

    const markdownCell = value => localizeMessageText(String(value ?? '').slice(0, 500))
        .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    function formatMarkdownTable(value) {
        const columns = Array.isArray(value?.columns) ? value.columns.slice(0, 20).map(markdownCell) : [];
        const rows = Array.isArray(value?.rows) ? value.rows.slice(0, 100)
            .filter(row => Array.isArray(row))
            .map(row => columns.map((_column, index) => markdownCell(row[index]))) : [];
        if (!columns.length || !rows.length) return '';
        const numericColumns = Array.isArray(value?.numericColumns) ? value.numericColumns : [];
        const line = cells => `| ${cells.join(' | ')} |`;
        const output = [line(columns), line(columns.map((_column, index) => numericColumns[index] ? '---:' : '---')),
            ...rows.map(line)];
        if (value?.truncated) {
            const totalRows = finiteOrNull(value?.totalRows);
            output.push('', `_Таблица сокращена: показано ${rows.length}${totalRows === null ? '' : ` из ${totalRows}`} строк._`);
        }
        return output.join('\n');
    }

    function renderTemplate(template, variables = {}) {
        return String(template || '').replace(/\{\{\s*([a-zA-Zа-яА-ЯёЁ0-9_.:-]+)\s*\}\}/gu,
            (match, key) => Object.prototype.hasOwnProperty.call(variables, key)
                ? String(variables[key] ?? '') : match);
    }

    function extractTemplateVariables(template) {
        const names = [];
        const pattern = /\{\{\s*([a-zA-Zа-яА-ЯёЁ0-9_.:-]+)\s*\}\}/gu;
        let match;
        while ((match = pattern.exec(String(template || '')))) names.push(match[1]);
        return names;
    }

    function panelVariables(panel, snapshot, context = {}) {
        const series = Array.isArray(snapshot?.series) ? snapshot.series : [];
        const config = normalizePanel(panel?.report, panel);
        const levelOf = item => item?.level || (item?.exceeded ? 'critical' : 'normal');
        const descending = !['lt', 'lte'].includes(config.sla.operator);
        const ranked = [...series].sort((a, b) => descending
            ? Number(b?.value) - Number(a?.value) : Number(a?.value) - Number(b?.value));
        const critical = ranked.filter(item => levelOf(item) === 'critical');
        const warning = ranked.filter(item => levelOf(item) === 'warning');
        const cpuCapacityOf = item => {
            const value = finiteOrNull(item?.cpuCapacity);
            return value !== null && value > 0 ? value : null;
        };
        const rawNameOf = item => localizeMessageText(item?.name || '');
        const displayNameOf = item => {
            const rawName = rawNameOf(item);
            const cpuCapacity = cpuCapacityOf(item);
            return cpuCapacity === null ? rawName : `${rawName} (${formatNumber(cpuCapacity)} vCPU)`;
        };
        const itemText = item => renderTemplate(config.templates.listItem, {
            name: displayNameOf(item), rawName: rawNameOf(item),
            vCpu: formatNumber(cpuCapacityOf(item)), cpuCapacity: formatNumber(cpuCapacityOf(item)),
            seriesThreshold: formatNumber(item?.threshold ?? item?.cpuCapacityThreshold),
            value: formatNumber(item?.value), unit: localizeMessageUnit(snapshot?.unit),
            level: levelOf(item), panelTitle: panel?.title || 'Панель Grafana'
        }).trim();
        const list = items => items.map(itemText).filter(Boolean).join('\n');
        const quote = value => String(value || '').split('\n').filter(Boolean).map(line => `> ${line}`).join('\n');
        const criticalList = list(critical);
        const warningList = list(warning);
        const allSeriesList = list(ranked);
        const state = snapshot?.state === 'breached' ? 'critical' : snapshot?.state;
        const stateList = state === 'critical' ? criticalList : state === 'warning' ? warningList : allSeriesList;
        const dynamicThreshold = snapshot?.source === 'cpu_capacity'
            ? `vCPU × ${formatNumber(snapshot?.cpuCapacityCoefficient)}` : '';
        const tableMarkdown = formatMarkdownTable(snapshot?.table);
        return {
            panelTitle: panel?.title || 'Панель Grafana',
            threshold: dynamicThreshold || formatNumber(snapshot?.threshold),
            criticalThreshold: dynamicThreshold || formatNumber(snapshot?.criticalThreshold ?? snapshot?.threshold),
            warningThreshold: formatNumber(snapshot?.warningThreshold),
            unit: localizeMessageUnit(snapshot?.unit),
            servers: critical.map(displayNameOf).filter(Boolean).join(', '),
            serverCount: critical.length,
            criticalServers: critical.map(displayNameOf).filter(Boolean).join(', '),
            criticalCount: critical.length,
            warningServers: warning.map(displayNameOf).filter(Boolean).join(', '),
            warningCount: warning.length,
            criticalList, warningList, breachesList: [criticalList, warningList].filter(Boolean).join('\n'),
            allSeriesList, top3List: list(ranked.slice(0, 3)),
            stateList, stateQuote: quote(stateList),
            tableMarkdown,
            tableRowCount: snapshot?.table?.totalRows ?? snapshot?.table?.rows?.length ?? 0,
            tableColumnCount: snapshot?.table?.columns?.length ?? 0,
            maxValue: formatNumber(snapshot?.maxValue),
            minValue: formatNumber(snapshot?.minValue),
            lastValue: formatNumber(snapshot?.lastValue),
            averageValue: formatNumber(snapshot?.averageValue),
            sumValue: formatNumber(snapshot?.sumValue),
            aggregateValue: formatNumber(snapshot?.aggregateValue),
            cpuCapacityCoefficient: formatNumber(snapshot?.cpuCapacityCoefficient),
            dataStatus: localizeMessageText(snapshot?.dataStatusText || snapshot?.error || ''),
            period: context.period || '',
            generatedAt: context.generatedAt || ''
        };
    }

    function renderPanel(panel, snapshot, context = {}) {
        const config = normalizePanel(panel?.report, panel);
        if (!config.enabled) return { included: false, reason: 'disabled', text: '' };
        const state = snapshot?.state === 'breached' ? 'critical' : (snapshot?.state || 'unavailable');
        if (config.includeMode === 'critical_only' && state !== 'critical') {
            return { included: false, reason: state, text: '' };
        }
        if (config.includeMode === 'issue_only' && !['warning', 'critical'].includes(state)) {
            return { included: false, reason: state, text: '' };
        }
        const variables = panelVariables(panel, snapshot, context);
        const template = state === 'critical' ? config.templates.breached
            : state === 'warning' ? config.templates.warning
            : state === 'ok' ? config.templates.normal
                : state === 'no_threshold' ? config.templates.neutral : config.templates.unavailable;
        let main = renderTemplate(template, variables).trim();
        if (!['critical', 'warning', 'ok', 'no_threshold'].includes(state)
            && variables.dataStatus && !main.includes(variables.dataStatus)) {
            main = `${main} Причина: ${variables.dataStatus}.`;
        }
        const details = config.detailsEnabled && ['warning', 'critical'].includes(state)
            ? renderTemplate(config.templates.details, variables).trim() : '';
        return { included: true, state, text: localizeMessageText([main, details].filter(Boolean).join('\n')), variables };
    }

    const russianPlural = (number, forms) => {
        const value = Math.abs(number) % 100;
        const last = value % 10;
        if (value > 10 && value < 20) return forms[2];
        if (last === 1) return forms[0];
        if (last >= 2 && last <= 4) return forms[1];
        return forms[2];
    };

    function formatDuration(start, end = Date.now()) {
        const from = Date.parse(start);
        const to = end instanceof Date ? end.getTime() : Number(end);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '';
        const totalMinutes = Math.floor((to - from) / 60_000);
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        return [days ? `${days} ${russianPlural(days, ['день', 'дня', 'дней'])}` : '',
            hours ? `${hours} ${russianPlural(hours, ['час', 'часа', 'часов'])}` : '',
            `${minutes} ${russianPlural(minutes, ['минута', 'минуты', 'минут'])}`].filter(Boolean).join(' ');
    }

    function compose(profile, panelResults, context = {}) {
        const config = normalizeProfile(profile?.report);
        const included = panelResults.filter(item => item?.included && item.text);
        const byKey = Object.fromEntries(included.map(item => [item.key, item.text]));
        const variables = {
            ...context,
            profileName: profile?.name || '',
            period: context.period || '',
            generatedAt: context.generatedAt || '',
            panels: included.map(item => item.text).join('\n')
        };
        let output = renderTemplate(config.template, variables);
        output = output.replace(/\{\{\s*panel:([a-zA-Zа-яА-ЯёЁ0-9_]+)\s*\}\}/gu,
            (match, key) => byKey[key] || '');
        return localizeMessageText(output.replace(/\n{3,}/g, '\n\n').trim());
    }

    root.DashBridgeReport = Object.freeze({
        DEFAULT_PROFILE_TEMPLATE, DEFAULT_NORMAL_TEMPLATE, DEFAULT_WARNING_TEMPLATE, DEFAULT_BREACH_TEMPLATE,
        DEFAULT_NEUTRAL_TEMPLATE, DEFAULT_UNAVAILABLE_TEMPLATE, DEFAULT_LIST_ITEM_TEMPLATE, DEFAULT_DETAILS_TEMPLATE,
        PROFILE_VARIABLES, PANEL_VARIABLES, LIST_VARIABLES,
        normalizeProfile, normalizePanel, orderPanels, renderTemplate, extractTemplateVariables, panelVariables,
        renderPanel, compose, formatNumber, formatMarkdownTable, formatDuration, localizeMessageText, slug
    });
})(globalThis);
