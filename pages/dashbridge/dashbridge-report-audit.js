(function initDashBridgeReportAudit(root) {
    'use strict';

    const hasValue = value => value !== null && value !== undefined
        && (typeof value !== 'string' || value.trim() !== '');
    const previewValue = value => {
        const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
        return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
    };
    const listVariableValue = (item, series, name) => ({
        name: series?.name || '', rawName: series?.name || '',
        vCpu: series?.cpuCapacity, cpuCapacity: series?.cpuCapacity,
        seriesThreshold: series?.threshold ?? series?.cpuCapacityThreshold,
        value: series?.value, unit: item.snapshot?.unit || '',
        level: series?.level || (series?.exceeded ? 'critical' : 'normal'),
        panelTitle: item.panel?.title || item.panel?.id || 'Панель Grafana'
    })[name];

    function runEngineSelfCheck(reportEngine) {
        const panelTemplate = reportEngine.PANEL_VARIABLES.map(name => `${name}={{${name}}}`).join('\n');
        const listTemplate = reportEngine.LIST_VARIABLES.map(name => `${name}={{${name}}}`).join('|');
        const panel = {
            id: 'audit-panel', title: 'Audit panel', tools: { thresholdEnabled: true },
            report: {
                enabled: true, key: 'audit', sla: { source: 'graph', warningValue: 70 },
                templates: { breached: panelTemplate, listItem: listTemplate }
            }
        };
        const context = {
            testName: 'Audit test', environment: 'audit',
            testStartedAt: '2026-01-01T10:00', stableLoadStartedAt: '2026-01-01T11:00',
            testDuration: '2 часа', stableLoadDuration: '1 час',
            period: '15 минут', generatedAt: '01.01.2026 12:00'
        };
        const rendered = reportEngine.renderPanel(panel, {
            state: 'critical', source: 'cpu_capacity', threshold: 80, criticalThreshold: 80,
            warningThreshold: 70, unit: '%', aggregateValue: 91, maxValue: 96,
            minValue: 55, lastValue: 88, averageValue: 76, sumValue: 304,
            cpuCapacityCoefficient: 0.8, dataStatusText: 'Данные получены',
            series: [
                { name: 'srv-critical', value: 96, level: 'critical', cpuCapacity: 8, threshold: 6.4 },
                { name: 'srv-warning', value: 75, level: 'warning', cpuCapacity: 4, threshold: 3.2 }
            ]
        }, context);
        const panelFailures = reportEngine.PANEL_VARIABLES.filter(name => !hasValue(rendered.variables?.[name]));
        const unresolvedPanel = reportEngine.extractTemplateVariables(rendered.text);
        const profileTemplate = [
            ...reportEngine.PROFILE_VARIABLES.map(name => `${name}={{${name}}}`),
            'selected={{panel:audit}}'
        ].join('\n');
        const output = reportEngine.compose({
            name: 'Audit profile', report: { template: profileTemplate }
        }, [{ included: true, key: 'audit', text: rendered.text }], context);
        const unresolvedProfile = reportEngine.extractTemplateVariables(output);
        return {
            ok: !panelFailures.length && !unresolvedPanel.length && !unresolvedProfile.length,
            panelFailures,
            unresolved: [...new Set([...unresolvedPanel, ...unresolvedProfile])],
            checked: reportEngine.PROFILE_VARIABLES.length
                + reportEngine.PANEL_VARIABLES.length + reportEngine.LIST_VARIABLES.length
        };
    }

    function audit(reportEngine, collected) {
        const profile = collected?.profile || {};
        const reportPanels = Array.isArray(collected?.reportPanels) ? collected.reportPanels : [];
        const panelResults = Array.isArray(collected?.panelResults) ? collected.panelResults : [];
        const context = collected?.context || {};
        const output = String(collected?.output || '');
        const issues = [];
        const usage = {
            profile: new Map(reportEngine.PROFILE_VARIABLES.map(name => [name, []])),
            panel: new Map(reportEngine.PANEL_VARIABLES.map(name => [name, []])),
            list: new Map(reportEngine.LIST_VARIABLES.map(name => [name, []]))
        };
        const namedReferences = [];
        const scan = (scope, template, location) => {
            for (const name of reportEngine.extractTemplateVariables(template)) {
                if (scope === 'profile' && name.startsWith('panel:')) {
                    namedReferences.push({ key: name.slice(6), location });
                    continue;
                }
                const locations = usage[scope].get(name);
                if (locations) locations.push(location);
                else issues.push({ level: 'error', code: 'unknown_variable',
                    message: `Неизвестная переменная {{${name}}} в «${location}».` });
            }
        };

        const profileConfig = reportEngine.normalizeProfile(profile.report);
        scan('profile', profileConfig.template, 'Общий шаблон');
        const keyOwners = new Map();
        reportPanels.forEach(panel => {
            const config = reportEngine.normalizePanel(panel.report, panel);
            const title = panel.title || panel.id || 'Панель';
            if (!keyOwners.has(config.key)) keyOwners.set(config.key, []);
            keyOwners.get(config.key).push(title);
            for (const name of ['normal', 'warning', 'breached', 'neutral', 'unavailable', 'details']) {
                scan('panel', config.templates[name], `${title}: ${name}`);
            }
            scan('list', config.templates.listItem, `${title}: listItem`);
        });
        keyOwners.forEach((owners, key) => {
            if (owners.length > 1) issues.push({ level: 'error', code: 'duplicate_panel_key',
                message: `Ключ panel:${key} назначен нескольким панелям: ${owners.join(', ')}.` });
        });
        namedReferences.forEach(reference => {
            const owners = keyOwners.get(reference.key) || [];
            if (!reference.key || !owners.length) issues.push({ level: 'error', code: 'missing_panel_key',
                message: `Ссылка {{panel:${reference.key}}} из «${reference.location}» не соответствует включённой панели.` });
        });

        const includedTexts = panelResults.filter(item => item?.included && item.text).map(item => item.text);
        const profileValues = {
            ...context,
            profileName: profile.name || '',
            period: context.period || '', generatedAt: context.generatedAt || '',
            panels: includedTexts.join('\n')
        };
        const activePanelVariables = new Map();
        panelResults.forEach(item => {
            const panel = item.panel || {};
            const config = reportEngine.normalizePanel(panel.report, panel);
            const state = item.state || item.snapshot?.state || 'unavailable';
            const activeTemplateName = state === 'critical' || state === 'breached' ? 'breached'
                : state === 'warning' ? 'warning' : state === 'ok' ? 'normal'
                    : state === 'no_threshold' ? 'neutral' : 'unavailable';
            const activeNames = new Set(reportEngine.extractTemplateVariables(config.templates[activeTemplateName]));
            if (config.detailsEnabled && ['critical', 'warning', 'breached'].includes(state)) {
                reportEngine.extractTemplateVariables(config.templates.details).forEach(name => activeNames.add(name));
            }
            const variables = item.variables || reportEngine.panelVariables(panel, item.snapshot, context);
            activePanelVariables.set(panel.id, { names: activeNames, variables });
            activeNames.forEach(name => {
                if (usage.panel.has(name) && !hasValue(variables?.[name])) {
                    issues.push({ level: 'warning', code: 'empty_live_value',
                        message: `Панель «${panel.title || panel.id}»: используемая переменная {{${name}}} сейчас пустая.` });
                }
            });
            const listOutputVariables = new Set([
                'criticalList', 'warningList', 'breachesList', 'allSeriesList',
                'top3List', 'stateList', 'stateQuote'
            ]);
            if ([...activeNames].some(name => listOutputVariables.has(name))) {
                const series = Array.isArray(item.snapshot?.series) ? item.snapshot.series : [];
                for (const name of reportEngine.extractTemplateVariables(config.templates.listItem)) {
                    if (usage.list.has(name) && !series.some(entry => hasValue(listVariableValue(item, entry, name)))) {
                        issues.push({ level: 'warning', code: 'empty_live_value',
                            message: `Панель «${panel.title || panel.id}»: переменная строки списка {{${name}}} сейчас пустая.` });
                    }
                }
            }
            const unresolved = reportEngine.extractTemplateVariables(item.text);
            if (unresolved.length) issues.push({ level: 'error', code: 'unresolved_panel_output',
                message: `Панель «${panel.title || panel.id}» оставила переменные: ${[...new Set(unresolved)].map(name => `{{${name}}}`).join(', ')}.` });
            const snapshotState = String(item.snapshot?.state || '');
            if (['unavailable', 'timeout', 'no_data', 'error', 'configuration_error'].includes(snapshotState)) {
                issues.push({ level: 'error', code: 'panel_data_error',
                    message: `Панель «${panel.title || panel.id}» не подтвердила данные: ${item.snapshot?.dataStatusText || item.snapshot?.error || snapshotState}.` });
            }
        });

        usage.profile.forEach((locations, name) => {
            if (locations.length && !hasValue(profileValues[name])) issues.push({
                level: 'warning', code: 'empty_live_value',
                message: `Используемая переменная {{${name}}} общего шаблона сейчас пустая.`
            });
        });
        const unresolvedOutput = reportEngine.extractTemplateVariables(output);
        if (unresolvedOutput.length) issues.push({ level: 'error', code: 'unresolved_output',
            message: `Итоговое сообщение оставило переменные: ${[...new Set(unresolvedOutput)].map(name => `{{${name}}}`).join(', ')}.` });
        if (!output.trim()) issues.push({ level: 'error', code: 'empty_output', message: 'Итоговое сообщение пустое.' });
        if (!reportPanels.length) issues.push({ level: 'error', code: 'no_panels', message: 'Для сообщения не включена ни одна панель.' });
        const hasPanelInsertion = (usage.profile.get('panels') || []).length > 0 || namedReferences.length > 0;
        if (reportPanels.length && !hasPanelInsertion) issues.push({ level: 'warning', code: 'panels_not_inserted',
            message: 'Общий шаблон не использует {{panels}} и не содержит ссылок {{panel:ключ}}.' });

        const variables = [];
        const addVariableRows = (scope, names) => names.forEach(name => {
            const locations = usage[scope].get(name) || [];
            let values = [];
            if (scope === 'profile') values = [profileValues[name]];
            else if (scope === 'panel') values = [...activePanelVariables.values()].map(item => item.variables?.[name]);
            else {
                values = panelResults.flatMap(item => (Array.isArray(item.snapshot?.series)
                    ? item.snapshot.series : []).map(series => listVariableValue(item, series, name)));
            }
            variables.push({ scope, name, used: locations.length > 0, locations,
                hasData: values.some(hasValue), value: previewValue(values.find(hasValue)) });
        });
        addVariableRows('profile', reportEngine.PROFILE_VARIABLES);
        addVariableRows('panel', reportEngine.PANEL_VARIABLES);
        addVariableRows('list', reportEngine.LIST_VARIABLES);

        const selfCheck = runEngineSelfCheck(reportEngine);
        if (!selfCheck.ok) issues.unshift({ level: 'error', code: 'engine_contract',
            message: `Внутренняя проверка движка переменных не пройдена: ${[...selfCheck.panelFailures, ...selfCheck.unresolved].join(', ')}.` });
        return {
            selfCheck, issues, variables, output,
            panels: panelResults.map(item => ({
                title: item.panel?.title || item.panel?.id || 'Панель',
                key: item.key || '', state: item.state || item.snapshot?.state || '',
                included: !!item.included,
                status: item.snapshot?.dataStatusText || item.snapshot?.error || '',
                text: item.text || ''
            })),
            summary: {
                errors: issues.filter(item => item.level === 'error').length,
                warnings: issues.filter(item => item.level === 'warning').length,
                usedVariables: variables.filter(item => item.used).length,
                variables: variables.length,
                panels: panelResults.length
            }
        };
    }

    root.DashBridgeReportAudit = Object.freeze({ audit, runEngineSelfCheck });
})(globalThis);
