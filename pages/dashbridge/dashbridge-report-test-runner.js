(function initDashBridgeReportTestRunner(root) {
    'use strict';

    const now = () => Date.now();
    const unresolved = (reportEngine, value) => [...new Set(reportEngine.extractTemplateVariables(value))];
    const result = (id, name, source, startedAt, status, details, evidence = '') => ({
        id, name, source, status, details, evidence, durationMs: Math.max(0, now() - startedAt)
    });

    function fixturePanel(reportEngine, state, overrides = {}) {
        const panel = {
            id: `fixture-${state}`, title: `Fixture ${state}`, tools: { thresholdEnabled: true },
            report: {
                enabled: true, key: state, includeMode: 'always',
                sla: { source: 'graph', operator: 'gt', value: 80, warningValue: 70 },
                templates: {
                    normal: 'NORMAL {{panelTitle}} {{aggregateValue}}{{unit}}',
                    warning: 'WARNING {{panelTitle}} {{warningList}}',
                    breached: 'CRITICAL {{panelTitle}} {{criticalList}}',
                    neutral: 'NEUTRAL {{panelTitle}} {{aggregateValue}}{{unit}}',
                    unavailable: 'ERROR {{panelTitle}} {{dataStatus}}',
                    listItem: '{{rawName}}={{value}}{{unit}}[{{level}}]',
                    details: '{{stateQuote}}'
                }
            }
        };
        const snapshot = {
            state, threshold: 80, criticalThreshold: 80, warningThreshold: 70, unit: '%',
            aggregateValue: 91, maxValue: 96, minValue: 55, lastValue: 88,
            averageValue: 76, sumValue: 304, dataStatusText: 'Данные получены',
            series: [
                { name: 'srv-critical', value: 96, level: 'critical', cpuCapacity: 8, threshold: 80 },
                { name: 'srv-warning', value: 75, level: 'warning', cpuCapacity: 4, threshold: 70 },
                { name: 'srv-normal', value: 55, level: 'normal', cpuCapacity: 2, threshold: 80 }
            ],
            ...overrides
        };
        const context = { period: '15 минут', generatedAt: '01.01.2026 12:00' };
        const rendered = reportEngine.renderPanel(panel, snapshot, context);
        return { panel, snapshot, context, rendered };
    }

    function runFixtureSuite(reportEngine, auditEngine) {
        const scenarios = [];
        const run = (id, name, execute) => {
            const startedAt = now();
            try {
                const value = execute();
                scenarios.push(result(id, name, 'fixture', startedAt, value.pass ? 'pass' : 'fail',
                    value.details, value.evidence || ''));
            } catch (error) {
                scenarios.push(result(id, name, 'fixture', startedAt, 'fail', error?.message || String(error)));
            }
        };

        run('engine-contract', 'Все объявленные переменные поддерживаются движком', () => {
            const check = auditEngine.runEngineSelfCheck(reportEngine);
            return { pass: check.ok, details: check.ok
                ? `Разрешено переменных: ${check.checked}.`
                : `Пустые: ${check.panelFailures.join(', ')}; не разрешены: ${check.unresolved.join(', ')}.` };
        });

        for (const state of ['ok', 'warning', 'critical', 'no_threshold']) {
            run(`state-${state}`, `Формирование фразы: ${state}`, () => {
                const fixture = fixturePanel(reportEngine, state);
                const missing = unresolved(reportEngine, fixture.rendered.text);
                return { pass: fixture.rendered.included && !!fixture.rendered.text && !missing.length,
                    details: missing.length ? `Остались переменные: ${missing.join(', ')}.` : 'Фраза сформирована полностью.',
                    evidence: fixture.rendered.text };
            });
        }

        for (const state of ['error', 'timeout', 'no_data']) {
            run(`failure-${state}`, `Диагностическая фраза: ${state}`, () => {
                const fixture = fixturePanel(reportEngine, state, { dataStatusText: `Fixture ${state}` });
                return { pass: fixture.rendered.text.includes(`Fixture ${state}`),
                    details: 'Причина недоступности должна попасть в сообщение.', evidence: fixture.rendered.text };
            });
        }

        run('named-panels', 'Сборка {{panels}} и {{panel:key}}', () => {
            const fixture = fixturePanel(reportEngine, 'critical');
            const profile = { name: 'Fixture profile', report: {
                template: '{{profileName}}\nALL={{panels}}\nNAMED={{panel:critical}}' } };
            const panelResult = { ...fixture.rendered, key: 'critical' };
            const output = reportEngine.compose(profile, [panelResult], fixture.context);
            const count = output.split(fixture.rendered.text).length - 1;
            return { pass: count === 2 && !unresolved(reportEngine, output).length,
                details: `Фраза панели вставлена ${count} раз(а).`, evidence: output };
        });

        run('include-modes', 'Режимы исключения панелей', () => {
            const normal = fixturePanel(reportEngine, 'ok');
            normal.panel.report.includeMode = 'critical_only';
            const excluded = reportEngine.renderPanel(normal.panel, normal.snapshot, normal.context);
            normal.snapshot.state = 'critical';
            const included = reportEngine.renderPanel(normal.panel, normal.snapshot, normal.context);
            return { pass: !excluded.included && included.included,
                details: 'critical_only исключает норму и включает нарушение.' };
        });

        run('large-series-table', 'Большая таблица: 2500 серий', () => {
            const series = Array.from({ length: 2500 }, (_, index) => ({
                name: `srv-${index}`, value: index, level: index > 2400 ? 'critical' : 'normal', threshold: 2400
            }));
            const fixture = fixturePanel(reportEngine, 'critical', { series });
            fixture.panel.report.templates.breached = '{{allSeriesList}}';
            const rendered = reportEngine.renderPanel(fixture.panel, fixture.snapshot, fixture.context);
            return { pass: rendered.text.includes('srv-0=0%') && rendered.text.includes('srv-2499=2 499%')
                    && !unresolved(reportEngine, rendered.text).length,
                details: `Обработано строк: ${series.length}; символов: ${rendered.text.length}.`,
                evidence: `${rendered.text.slice(0, 240)}\n…\n${rendered.text.slice(-240)}` };
        });

        return scenarios;
    }

    function evaluateLiveSuite(reportEngine, auditEngine, collected) {
        const audit = auditEngine.audit(reportEngine, collected);
        const scenarios = [];
        const push = (id, name, status, details, evidence = '') => scenarios.push({
            id, name, source: 'live', status, details, evidence, durationMs: 0
        });
        const configurationIssues = audit.issues.filter(item => [
            'unknown_variable', 'duplicate_panel_key', 'missing_panel_key', 'panels_not_inserted', 'no_panels'
        ].includes(item.code));
        push('live-configuration', 'Шаблоны и ссылки текущего профиля', configurationIssues.some(item => item.level === 'error')
            ? 'fail' : configurationIssues.length ? 'warning' : 'pass',
        configurationIssues.length ? configurationIssues.map(item => item.message).join('\n') : 'Ошибок конфигурации не найдено.');

        for (const panel of audit.panels) {
            const snapshotFailed = ['unavailable', 'timeout', 'no_data', 'error', 'configuration_error'].includes(panel.state);
            push(`live-snapshot-${panel.key}`, `Данные панели: ${panel.title}`,
                snapshotFailed ? 'fail' : 'pass', panel.status || `Состояние: ${panel.state || 'не определено'}.`);
            push(`live-render-${panel.key}`, `Фраза панели: ${panel.title}`,
                !panel.included ? 'skip' : (!panel.text || unresolved(reportEngine, panel.text).length ? 'fail' : 'pass'),
                panel.included ? (panel.text ? 'Фраза сформирована.' : 'Фраза пустая.') : 'Панель исключена её режимом включения.',
                panel.text);
        }

        const outputMissing = unresolved(reportEngine, audit.output);
        push('live-compose', 'Итоговое сообщение текущего профиля', !audit.output.trim() || outputMissing.length ? 'fail' : 'pass',
            outputMissing.length ? `Остались переменные: ${outputMissing.join(', ')}.` : `Символов: ${audit.output.length}.`, audit.output);
        const liveValueIssues = audit.issues.filter(item => item.code === 'empty_live_value');
        push('live-variables', 'Живые значения используемых переменных', liveValueIssues.length ? 'warning' : 'pass',
            liveValueIssues.length ? liveValueIssues.map(item => item.message).join('\n') : 'Все переменные активных фраз получили значения.');
        return { scenarios, audit };
    }

    const appendText = (parent, tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        node.textContent = String(value ?? '');
        parent.appendChild(node);
        return node;
    };

    function create({ reportEngine, auditEngine, collect }) {
        if (!reportEngine?.renderPanel || !auditEngine?.audit || typeof collect !== 'function') {
            throw new TypeError('Message Test Runner requires report engine, audit engine and collector');
        }
        let activeOverlay = null;
        const close = () => {
            activeOverlay?.controller?.abort();
            activeOverlay?.remove();
            activeOverlay = null;
        };
        const renderScenarios = (host, scenarios) => {
            host.textContent = '';
            const counts = Object.fromEntries(['pass', 'fail', 'warning', 'skip'].map(status => [status,
                scenarios.filter(item => item.status === status).length]));
            const summaryTone = counts.fail ? 'is-fail' : counts.warning ? 'is-warning' : 'is-pass';
            const summary = appendText(host, 'section', `report-runner-summary ${summaryTone}`, '');
            appendText(summary, 'strong', '', counts.fail
                ? `Найдены ошибки: ${counts.fail}`
                : counts.warning ? `Работает с предупреждениями: ${counts.warning}` : 'Проверка проходит успешно');
            appendText(summary, 'span', '', `${counts.pass} успешно · ${counts.skip} пропущено · ${scenarios.length} всего`);

            const attention = scenarios.filter(item => item.status === 'fail' || item.status === 'warning');
            if (attention.length) {
                const problems = appendText(host, 'section', 'report-runner-problems', '');
                appendText(problems, 'h4', '', 'Что требует внимания');
                appendText(problems, 'p', '', 'Ниже показаны только ошибки и предупреждения. Нажмите на пункт, чтобы увидеть результат проверки.');
                attention.forEach(item => {
                    const details = document.createElement('details');
                    details.className = `report-runner-problem is-${item.status}`;
                    details.open = item.status === 'fail';
                    problems.appendChild(details);
                    appendText(details, 'summary', '', `${item.status === 'fail' ? 'Ошибка' : 'Предупреждение'} · ${item.name}`);
                    appendText(details, 'pre', 'report-runner-details', item.details || 'Без подробностей.');
                    if (item.evidence) appendText(details, 'pre', 'report-runner-evidence', item.evidence);
                });
            }

            const technical = document.createElement('details');
            technical.className = 'report-runner-technical';
            host.appendChild(technical);
            appendText(technical, 'summary', '', `Технические проверки (${scenarios.length})`);
            const list = appendText(technical, 'section', 'report-runner-scenarios', '');
            scenarios.forEach(item => {
                const details = document.createElement('details');
                details.className = `report-runner-scenario is-${item.status}`; list.appendChild(details);
                const source = item.source === 'live' ? 'РЕАЛЬНЫЕ ДАННЫЕ' : 'ТЕСТОВЫЕ ДАННЫЕ';
                appendText(details, 'summary', '', `${item.status.toUpperCase()} · ${item.name} · ${source} · ${item.durationMs} мс`);
                appendText(details, 'pre', 'report-runner-details', item.details || 'Без подробностей.');
                if (item.evidence) appendText(details, 'pre', 'report-runner-evidence', item.evidence);
            });
        };
        const renderAudit = (host, audit) => {
            host.textContent = '';
            const usedVariables = audit.variables.filter(variable => variable.used);
            const missingVariables = usedVariables.filter(variable => !variable.hasData);
            const disclosure = document.createElement('details');
            disclosure.className = 'report-runner-audit-details';
            host.appendChild(disclosure);
            appendText(disclosure, 'summary', '', missingVariables.length
                ? `Переменные активных шаблонов · без данных: ${missingVariables.length}`
                : `Переменные активных шаблонов · ${usedVariables.length} проверено`);
            appendText(disclosure, 'p', 'report-runner-audit-note',
                `Показаны только переменные, используемые текущим профилем. Неиспользуемые скрыты: ${audit.variables.length - usedVariables.length}.`);
            if (!usedVariables.length) {
                appendText(disclosure, 'p', 'report-runner-empty', 'В активных шаблонах нет переменных.');
                return;
            }
            const tableWrap = appendText(disclosure, 'div', 'report-audit-table-wrap', '');
            const table = document.createElement('table'); table.className = 'report-audit-table'; tableWrap.appendChild(table);
            const head = document.createElement('thead'); const row = document.createElement('tr'); head.appendChild(row);
            ['Переменная', 'Где используется', 'Данные', 'Значение'].forEach(value => appendText(row, 'th', '', value));
            table.appendChild(head); const body = document.createElement('tbody'); table.appendChild(body);
            const scopeLabels = { profile: 'Общий шаблон', panel: 'Фраза панели', list: 'Строка списка' };
            usedVariables.forEach(variable => {
                const current = document.createElement('tr'); body.appendChild(current);
                appendText(current, 'td', 'report-audit-variable', `{{${variable.name}}}`);
                appendText(current, 'td', '', scopeLabels[variable.scope] || variable.scope);
                appendText(current, 'td', variable.hasData ? 'report-audit-pass' : 'report-audit-warning', variable.hasData ? 'Да' : 'Нет');
                appendText(current, 'td', '', variable.value || '—');
            });
        };
        const open = () => {
            if (activeOverlay?.isConnected) { activeOverlay.querySelector('.report-audit-close')?.focus(); return; }
            const overlay = document.createElement('div'); overlay.className = 'modal-overlay report-audit-overlay';
            const modal = document.createElement('section'); modal.className = 'modal-content report-audit-modal report-runner-modal';
            modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); overlay.appendChild(modal);
            const header = appendText(modal, 'div', 'report-audit-header', '');
            appendText(header, 'h3', '', 'Message Test Runner');
            const closeButton = appendText(header, 'button', 'btn btn-outline report-audit-close', 'Закрыть'); closeButton.type = 'button';
            appendText(modal, 'p', 'report-runner-source-note',
                'Сначала проверяем движок на тестовых данных, затем один раз собираем сообщение из активного профиля.');
            const status = appendText(modal, 'p', 'report-audit-status', 'Подготовка…'); status.setAttribute('role', 'status');
            const scenarioHost = appendText(modal, 'div', 'report-audit-content', '');
            const auditHost = appendText(modal, 'section', 'report-audit-section report-runner-audit', '');
            const actions = appendText(modal, 'div', 'modal-actions report-audit-actions', '');
            const rerun = appendText(actions, 'button', 'btn btn-primary report-audit-rerun', 'Запустить повторно'); rerun.type = 'button';
            document.body.appendChild(overlay); overlay.style.display = 'flex'; activeOverlay = overlay;
            let running = false;
            const run = async () => {
                if (running) return;
                running = true; rerun.disabled = true; auditHost.textContent = '';
                const controller = new AbortController(); overlay.controller = controller;
                const scenarios = runFixtureSuite(reportEngine, auditEngine);
                renderScenarios(scenarioHost, scenarios);
                status.textContent = 'Тестовые сценарии завершены. Один раз получаем реальные данные панелей…';
                try {
                    const collected = await collect(controller.signal, message => {
                        if (status.isConnected) status.textContent = `Реальные данные: ${message}`;
                    });
                    const live = evaluateLiveSuite(reportEngine, auditEngine, collected);
                    scenarios.push(...live.scenarios); renderScenarios(scenarioHost, scenarios); renderAudit(auditHost, live.audit);
                    const failures = scenarios.filter(item => item.status === 'fail').length;
                    const warnings = scenarios.filter(item => item.status === 'warning').length;
                    const failureWord = failures === 1 ? 'ошибку'
                        : failures % 10 >= 2 && failures % 10 <= 4 && (failures % 100 < 10 || failures % 100 >= 20)
                            ? 'ошибки' : 'ошибок';
                    status.className = `report-audit-status ${failures ? 'is-fail' : warnings ? 'is-warning' : 'is-pass'}`;
                    status.textContent = failures
                        ? `Проверка завершена: исправьте ${failures} ${failureWord} ниже.`
                        : warnings ? `Проверка завершена: сообщение формируется, но есть предупреждения (${warnings}).`
                            : 'Проверка завершена: сообщение формируется корректно.';
                } catch (error) {
                    if (error?.name !== 'AbortError') {
                        scenarios.push(result('live-collection', 'Получение реальных данных', 'live', now(), 'fail', error?.message || String(error)));
                        renderScenarios(scenarioHost, scenarios);
                        status.className = 'report-audit-status is-fail';
                        status.textContent = 'Тестовые сценарии завершены, но живой прогон не смог получить данные.';
                    }
                } finally {
                    if (overlay.controller === controller) overlay.controller = null;
                    running = false; if (rerun.isConnected) rerun.disabled = false;
                }
            };
            closeButton.addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            rerun.addEventListener('click', run); closeButton.focus(); void run();
        };
        return Object.freeze({ open, close });
    }

    root.DashBridgeReportTestRunner = Object.freeze({ runFixtureSuite, evaluateLiveSuite, create });
})(globalThis);
