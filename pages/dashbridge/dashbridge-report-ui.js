'use strict';

(() => {
    function create({
        getPanels,
        getActiveProfile,
        savePanels,
        normalizePanelMetadataText,
        escapeHtml,
    }) {
        const reportEngine = window.DashBridgeReport;

        function reportSourceLabel(config, panel) {
            if (config.sla.source === 'cpu_capacity') {
                if (!panel.tools?.cpuCapacityFilterEnabled) return 'Фильтр Load Average по vCPU выключен.';
                const coefficient = reportEngine.formatNumber(panel.tools.cpuCapacityFilterCoefficient ?? 0.8);
                const mode = panel.tools.cpuCapacityFilterMode === 'last'
                    ? 'последнему значению' : 'максимуму за период';
                return `Для каждой VM используется SLA: Load больше vCPU × ${coefficient}, расчёт по ${mode}.`;
            }
            if (config.sla.source !== 'graph') return '';
            if (!panel.tools?.thresholdEnabled) return 'Порог на графике выключен.';
            const value = reportEngine.formatNumber(panel.tools.thresholdValue);
            const unit = normalizePanelMetadataText(panel.tools.thresholdUnit, 64);
            return `Используется порог на графике: больше ${value}${unit ? ` ${unit}` : ''}.`;
        }

        function reportPanelCardMarkup(panel) {
            const config = reportEngine.normalizePanel(panel.report, panel);
            const checked = value => value ? 'checked' : '';
            const sourceLabel = config.sla.source === 'graph' ? 'Порог графика'
                : config.sla.source === 'custom' ? 'Собственный SLA'
                    : config.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Информационная панель';
            const includeLabel = config.includeMode === 'always'
                ? 'показывать всегда' : 'только при нарушении';
            return `
                <section class="report-panel-card report-overview-card" data-panel-id="${escapeHtml(panel.id)}" data-report-enabled="${config.enabled}">
                    <div class="report-panel-card-header">
                        <div class="report-panel-card-main">
                            <span class="report-panel-drag-handle" draggable="true" aria-hidden="true" title="Перетащите панель">⠿</span>
                            <div><h4>${escapeHtml(panel.title || 'Панель Grafana')}</h4><span class="report-panel-auto-status">${escapeHtml(config.enabled ? `${sourceLabel} · ${includeLabel}` : 'Не добавляется в сообщение')}</span></div>
                        </div>
                        <div class="report-panel-card-actions">
                            <label class="report-switch"><input class="report-enabled" type="checkbox" ${checked(config.enabled)}> Добавлять</label>
                            <button class="btn btn-outline report-open-panel-editor" type="button">Редактировать фразы</button>
                        </div>
                    </div>
                </section>`;
        }

        function openPanelEditor(panel, onSaved = null) {
            const config = reportEngine.normalizePanel(panel.report, panel);
            const graphEnabled = !!panel.tools?.thresholdEnabled;
            const cpuCapacityEnabled = !!panel.tools?.cpuCapacityFilterEnabled;
            const source = (config.sla.source === 'graph' && !graphEnabled)
                || (config.sla.source === 'cpu_capacity' && !cpuCapacityEnabled) ? 'none' : config.sla.source;
            const selected = (value, current) => value === current ? 'selected' : '';
            const checked = value => value ? 'checked' : '';
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay report-panel-editor-overlay';
            overlay.innerHTML = `
                <section class="modal-content report-panel-editor-modal" role="dialog" aria-modal="true">
                    <div class="report-settings-header">
                        <div><h3>${escapeHtml(panel.title || 'Панель Grafana')}</h3><p class="report-wizard-caption">Фраза этой панели для сводного сообщения.</p></div>
                        <button type="button" class="btn btn-outline report-panel-editor-close">Закрыть</button>
                    </div>
                    <div class="report-panel-editor-setup">
                        <section class="report-editor-setup-card">
                            <h4>Добавление в сводку</h4>
                            <label class="report-switch"><input class="report-editor-enabled" type="checkbox" ${checked(config.enabled)}> Добавлять эту панель</label>
                            <label class="report-field">Показывать фразу
                                <select class="report-editor-include-mode">
                                    <option value="always" ${selected('always', config.includeMode)}>Всегда</option>
                                    <option value="critical_only" ${selected('critical_only', config.includeMode)}>Только при нарушении SLA</option>
                                </select>
                            </label>
                        </section>
                        <section class="report-editor-setup-card report-panel-editor-source">
                            <h4>Результат панели</h4>
                            <label class="report-field">Источник результата
                                <select class="report-editor-source">
                                    <option value="graph" ${selected('graph', source)} ${graphEnabled ? '' : 'disabled'}>Автоматически по порогу графика${graphEnabled ? '' : ' — не настроен'}</option>
                                    <option value="cpu_capacity" ${selected('cpu_capacity', source)} ${cpuCapacityEnabled ? '' : 'disabled'}>По фильтру Load Average: vCPU × коэффициент${cpuCapacityEnabled ? '' : ' — не настроен'}</option>
                                    <option value="none" ${selected('none', source)}>Без SLA — информационная фраза</option>
                                    <option value="custom" ${selected('custom', source)}>Собственный SLA</option>
                                </select>
                            </label>
                            <div class="report-effective-threshold">${escapeHtml(source === 'cpu_capacity'
                                ? reportSourceLabel({ ...config, sla: { ...config.sla, source: 'cpu_capacity' } }, panel)
                                : graphEnabled ? reportSourceLabel({ ...config, sla: { ...config.sla, source: 'graph' } }, panel)
                                    : 'Порог на графике не настроен.')}</div>
                            <div class="report-field-grid report-editor-custom-sla" hidden>
                                <label class="report-field">Значение SLA<input class="report-editor-sla-value" type="number" step="any" value="${config.sla.value ?? ''}"></label>
                                <label class="report-field">Условие<select class="report-editor-operator"><option value="gt" ${selected('gt', config.sla.operator)}>Больше</option><option value="gte" ${selected('gte', config.sla.operator)}>Больше или равно</option><option value="lt" ${selected('lt', config.sla.operator)}>Меньше</option><option value="lte" ${selected('lte', config.sla.operator)}>Меньше или равно</option></select></label>
                            </div>
                        </section>
                    </div>
                    <div class="report-panel-editor-copy">
                        <div class="report-subsection-heading"><h5>Текст для сообщения</h5><span>Порог, единица и серверы подставятся автоматически. Выберите поле и нажмите значок, чтобы вставить его.</span></div>
                        <div class="report-emoji-toolbar" aria-label="Вставить значок">${['🟢','⚠️','🔴','⏱️','✅','❌','🖥','🛠'].map(icon => `<button type="button" data-emoji="${icon}">${icon}</button>`).join('')}</div>
                        <div class="report-template-grid report-editor-threshold-templates">
                            <label class="report-field">Если требования соблюдены<textarea class="report-editor-normal">${escapeHtml(config.templates.normal)}</textarea></label>
                            <label class="report-field">Если требования нарушены<textarea class="report-editor-breached">${escapeHtml(config.templates.breached)}</textarea></label>
                        </div>
                        <label class="report-field report-editor-neutral-template" hidden>Информационная фраза<textarea class="report-editor-neutral">${escapeHtml(config.templates.neutral)}</textarea></label>
                    </div>
                    <details class="report-editor-advanced">
                        <summary>Дополнительные настройки</summary>
                        <div class="report-advanced-settings-body">
                            <div class="report-field-grid">
                                <label class="report-field">Расчёт по данным<select class="report-editor-evaluation"><option value="period_max" ${selected('period_max', config.sla.evaluation)}>Максимум за период</option><option value="latest" ${selected('latest', config.sla.evaluation)}>Последнее значение</option><option value="period_min" ${selected('period_min', config.sla.evaluation)}>Минимум за период</option><option value="period_avg" ${selected('period_avg', config.sla.evaluation)}>Среднее за период</option><option value="period_sum" ${selected('period_sum', config.sla.evaluation)}>Сумма за период</option></select></label>
                                <label class="report-field report-editor-warning-fields">Предупредительный уровень<input class="report-editor-warning-value" type="number" step="any" value="${config.sla.warningValue ?? ''}" placeholder="необязательно"></label>
                            </div>
                            <label class="report-field report-editor-warning-fields">Если достигнут предупредительный уровень<textarea class="report-editor-warning">${escapeHtml(config.templates.warning)}</textarea></label>
                            <label class="report-switch"><input class="report-editor-details-enabled" type="checkbox" ${checked(config.detailsEnabled)}> Добавлять подробный список серверов</label>
                            <label class="report-field">Если данные графика недоступны<textarea class="report-editor-unavailable">${escapeHtml(config.templates.unavailable)}</textarea></label>
                        </div>
                    </details>
                    <div class="report-panel-editor-error" role="alert" hidden></div>
                    <div class="modal-actions report-panel-editor-actions"><button type="button" class="btn btn-outline report-panel-editor-cancel">Отмена</button><button type="button" class="btn btn-primary report-panel-editor-save">Сохранить фразы</button></div>
                </section>`;
            document.body.appendChild(overlay);
            overlay.style.display = 'flex';
            const sourceControl = overlay.querySelector('.report-editor-source');
            const sync = () => {
                const currentSource = sourceControl.value;
                overlay.querySelector('.report-editor-custom-sla').hidden = currentSource !== 'custom';
                overlay.querySelector('.report-editor-threshold-templates').hidden = currentSource === 'none';
                overlay.querySelector('.report-editor-neutral-template').hidden = currentSource !== 'none';
                overlay.querySelectorAll('.report-editor-warning-fields').forEach(field => {
                    field.hidden = currentSource === 'none' || currentSource === 'cpu_capacity';
                });
                const sourceHint = overlay.querySelector('.report-effective-threshold');
                if (currentSource === 'cpu_capacity') {
                    sourceHint.textContent = reportSourceLabel({ ...config, sla: { ...config.sla, source: 'cpu_capacity' } }, panel);
                } else if (currentSource === 'graph') {
                    sourceHint.textContent = reportSourceLabel({ ...config, sla: { ...config.sla, source: 'graph' } }, panel);
                } else if (currentSource === 'custom') {
                    sourceHint.textContent = 'Порог задаётся числом ниже.';
                } else {
                    sourceHint.textContent = 'SLA не проверяется; в сообщение попадёт рассчитанное значение панели.';
                }
                const include = overlay.querySelector('.report-editor-include-mode');
                if (currentSource === 'none') include.value = 'always';
                include.disabled = currentSource === 'none';
                include.querySelector('[value="critical_only"]').disabled = currentSource === 'none';
            };
            const close = () => overlay.remove();
            overlay.querySelector('.report-panel-editor-close').addEventListener('click', close);
            overlay.querySelector('.report-panel-editor-cancel').addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            sourceControl.addEventListener('change', sync);
            let activeTextarea = overlay.querySelector('textarea');
            overlay.querySelectorAll('textarea').forEach(area => area.addEventListener('focus', () => {
                activeTextarea = area;
            }));
            overlay.querySelectorAll('[data-emoji]').forEach(button => button.addEventListener('click', () => {
                const start = activeTextarea.selectionStart ?? activeTextarea.value.length;
                activeTextarea.setRangeText(button.dataset.emoji, start, activeTextarea.selectionEnd ?? start, 'end');
                activeTextarea.focus();
            }));
            overlay.querySelector('.report-panel-editor-save').addEventListener('click', async () => {
                const currentSource = sourceControl.value;
                const valueText = overlay.querySelector('.report-editor-sla-value').value.trim();
                const value = valueText === '' ? null : Number(valueText);
                const warningText = overlay.querySelector('.report-editor-warning-value').value.trim();
                const warningValue = warningText === '' ? null : Number(warningText);
                const error = overlay.querySelector('.report-panel-editor-error');
                if (currentSource === 'custom' && !Number.isFinite(value)) {
                    error.textContent = 'Укажите числовое значение собственного SLA.';
                    error.hidden = false;
                    return;
                }
                if (currentSource !== 'cpu_capacity' && warningText !== '' && !Number.isFinite(warningValue)) {
                    error.textContent = 'Укажите корректный предупредительный уровень.';
                    error.hidden = false;
                    return;
                }
                const operator = overlay.querySelector('.report-editor-operator').value;
                const criticalValue = currentSource === 'graph' ? Number(panel.tools?.thresholdValue) : value;
                if (!['none', 'cpu_capacity'].includes(currentSource)
                    && Number.isFinite(warningValue) && Number.isFinite(criticalValue)) {
                    const invalidOrder = ['gt', 'gte'].includes(operator)
                        ? warningValue >= criticalValue : warningValue <= criticalValue;
                    if (invalidOrder) {
                        error.textContent = 'Предупредительный уровень должен наступать раньше нарушения SLA.';
                        error.hidden = false;
                        return;
                    }
                }
                panel.report = reportEngine.normalizePanel({
                    enabled: overlay.querySelector('.report-editor-enabled').checked,
                    key: config.key,
                    includeMode: overlay.querySelector('.report-editor-include-mode').value,
                    sla: {
                        source: currentSource,
                        operator,
                        value: ['none', 'cpu_capacity'].includes(currentSource) ? null : value,
                        warningValue: ['none', 'cpu_capacity'].includes(currentSource) ? null : warningValue,
                        unit: '',
                        evaluation: currentSource === 'cpu_capacity'
                            ? (panel.tools?.cpuCapacityFilterMode === 'last' ? 'latest' : 'period_max')
                            : overlay.querySelector('.report-editor-evaluation').value,
                    },
                    templates: {
                        normal: overlay.querySelector('.report-editor-normal').value,
                        warning: overlay.querySelector('.report-editor-warning').value,
                        breached: overlay.querySelector('.report-editor-breached').value,
                        neutral: overlay.querySelector('.report-editor-neutral').value,
                        unavailable: overlay.querySelector('.report-editor-unavailable').value,
                        listItem: config.templates.listItem,
                        details: config.templates.details,
                    },
                    detailsEnabled: overlay.querySelector('.report-editor-details-enabled').checked,
                }, panel);
                await savePanels();
                onSaved?.(panel);
                close();
            });
            sync();
        }

        function reportVariableReferenceMarkup() {
            const group = (title, entries) => `<section class="report-variable-group"><h4>${title}</h4><dl>${entries.map(([name, description]) => `
                <div class="report-variable-row"><dt><code>${name}</code></dt><dd>${description}</dd></div>`).join('')}</dl></section>`;
            return `<details class="report-variable-reference">
                <summary>Справочник переменных шаблона</summary>
                <p>Переменные можно вставлять в общий шаблон, фразы панели, строки списков и блок подробностей.</p>
                <div class="report-variable-groups">
                    ${group('Общие переменные', [
                        ['{{profileName}}', 'Название текущего профиля DashBridge.'],
                        ['{{testName}}', 'Название нагрузочного теста из блока «Контекст теста».'],
                        ['{{environment}}', 'Контур или окружение проведения теста.'],
                        ['{{testDuration}}', 'Время, прошедшее с указанного начала теста.'],
                        ['{{stableLoadDuration}}', 'Продолжительность удержания стабильной нагрузки.'],
                        ['{{period}}', 'Выбранный на сводном дашборде период Grafana.'],
                        ['{{generatedAt}}', 'Дата и время формирования сообщения.'],
                        ['{{panels}}', 'Все включённые фразы панелей в порядке карточек дашборда.'],
                        ['{{panel:ключ}}', 'Фраза конкретной панели. Вместо «ключ» используется значение поля «Ключ панели».'],
                    ])}
                    ${group('Переменные панели', [
                        ['{{panelTitle}}', 'Название панели Grafana.'],
                        ['{{warningThreshold}}', 'Предупредительное значение SLA.'],
                        ['{{criticalThreshold}}', 'Критическое значение SLA.'],
                        ['{{threshold}}', 'Совместимое имя критического порога для старых шаблонов.'],
                        ['{{unit}}', 'Единица измерения: %, ms, req/s и т. п.'],
                        ['{{criticalServers}}', 'Названия серверов с критическим нарушением через запятую.'],
                        ['{{warningServers}}', 'Названия серверов предупредительного уровня через запятую.'],
                        ['{{criticalCount}} / {{warningCount}}', 'Количество критических и предупредительных рядов.'],
                        ['{{criticalList}}', 'Построчный список критических рядов.'],
                        ['{{warningList}}', 'Построчный список рядов предупредительного уровня.'],
                        ['{{breachesList}}', 'Объединённый список критических и предупредительных рядов.'],
                        ['{{allSeriesList}}', 'Все видимые ряды панели с рассчитанными значениями.'],
                        ['{{tableMarkdown}}', 'Видимая таблица Grafana в формате Markdown с исходным отображением значений.'],
                        ['{{tableRowCount}} / {{tableColumnCount}}', 'Количество строк и колонок распознанной таблицы Grafana.'],
                        ['{{top3List}}', 'Три худших ряда с учётом направления SLA.'],
                        ['{{stateList}}', 'Список, соответствующий текущему состоянию панели.'],
                        ['{{stateQuote}}', 'Тот же список, где каждая строка начинается с > для цитатного блока.'],
                        ['{{aggregateValue}}', 'Итог выбранного расчёта: максимум, минимум, среднее, сумма или последнее.'],
                        ['{{cpuCapacityCoefficient}}', 'Коэффициент динамического SLA Load Average по vCPU.'],
                        ['{{dataStatus}}', 'Точная причина недоступности данных: пустой datasource, HTTP/сетевая ошибка, ошибка разбора или таймаут.'],
                        ['{{maxValue}} / {{minValue}}', 'Максимальное и минимальное значение панели за период.'],
                        ['{{lastValue}}', 'Последнее доступное значение.'],
                        ['{{averageValue}} / {{sumValue}}', 'Среднее значение и сумма значений за период.'],
                    ])}
                    ${group('Переменные строки списка', [
                        ['{{name}}', 'Название текущего ряда; для Load Average автоматически включает количество vCPU.'],
                        ['{{rawName}}', 'Исходное название ряда без автоматически добавленного vCPU.'],
                        ['{{vCpu}} / {{cpuCapacity}}', 'Количество vCPU для Load Average; пусто, если определить его не удалось.'],
                        ['{{seriesThreshold}}', 'Индивидуальный порог Load Average: vCPU × коэффициент.'],
                        ['{{value}}', 'Рассчитанное значение текущего ряда.'],
                        ['{{unit}}', 'Единица измерения текущего ряда.'],
                        ['{{level}}', 'Уровень строки: normal, warning или critical.'],
                    ])}
                </div>
            </details>`;
        }

        function openSettings(focusPanelId = null) {
            const profile = getActiveProfile();
            if (!profile) return;
            const profileConfig = reportEngine.normalizeProfile(profile.report);
            const orderedPanels = reportEngine.orderPanels(getPanels(), profileConfig.panelOrder);
            const loadTestTemplate = '{{testName}}\nКонтур: {{environment}}\n\nПрошло {{stableLoadDuration}} удержания стабильной нагрузки, {{testDuration}} с начала теста.\n\n{{panels}}';
            const hasTestHeader = profileConfig.template.includes('{{testName}}')
                || profileConfig.template.includes('{{testDuration}}')
                || profileConfig.template.includes('{{stableLoadDuration}}');
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay report-settings-overlay';
            overlay.innerHTML = `
                <section class="modal-content report-settings-modal" role="dialog" aria-modal="true">
                    <div class="report-settings-header"><h3>Настройка сообщения — ${escapeHtml(profile.name)}</h3><button type="button" class="btn btn-outline report-close">Закрыть</button></div>
                    <p class="report-settings-intro">Здесь задаётся структура общей сводки. Фразы каждой панели редактируются рядом с её графиком или кнопкой в списке ниже.</p>
                    <details class="report-editor-section report-collapsible-section">
                        <summary class="report-section-heading"><h4>Шапка сообщения</h4><span>необязательно</span></summary>
                        <div class="report-section-body">
                        <label class="report-switch"><input class="report-test-header" type="checkbox" ${hasTestHeader ? 'checked' : ''}> Добавить сведения о нагрузочном тесте</label>
                        <div class="report-field-grid report-context-fields" ${hasTestHeader ? '' : 'hidden'}>
                            <label class="report-field">Название теста<input class="report-test-name" maxlength="500" value="${escapeHtml(profileConfig.context.testName)}"></label>
                            <label class="report-field">Контур / окружение<input class="report-environment" maxlength="500" value="${escapeHtml(profileConfig.context.environment)}"></label>
                            <label class="report-field">Начало теста<input class="report-test-started" type="datetime-local" value="${escapeHtml(profileConfig.context.testStartedAt)}"><small>Указывается вручную; {{testDuration}} = время от этой даты до формирования сообщения.</small></label>
                            <label class="report-field">Начало стабильной нагрузки<input class="report-stable-started" type="datetime-local" value="${escapeHtml(profileConfig.context.stableLoadStartedAt)}"><small>Указывается вручную; {{stableLoadDuration}} = время от этой даты до формирования сообщения.</small></label>
                        </div>
                        </div>
                    </details>
                    <details class="report-editor-section report-collapsible-section">
                        <summary class="report-section-heading"><h4>Изменить структуру сообщения</h4><span>для нестандартного формата</span></summary>
                        <div class="report-section-body">
                        <label class="report-field"><textarea class="report-profile-template">${escapeHtml(profileConfig.template)}</textarea></label>
                        </div>
                    </details>
                    <div class="report-panel-list-heading"><h3>Панели сообщения</h3><p>Перетаскивайте панели, чтобы изменить порядок фраз, и подключайте их одной галочкой. Расположение графиков не изменится.</p></div>
                    <div class="report-panel-list">${orderedPanels.map(panel => reportPanelCardMarkup(panel)).join('')}</div>
                    ${reportVariableReferenceMarkup()}
                    <div class="modal-actions report-settings-actions"><button type="button" class="btn btn-outline report-cancel">Отмена</button><button type="button" class="btn btn-primary report-save">Сохранить</button></div>
                </section>`;
            document.body.appendChild(overlay);
            overlay.style.display = 'flex';
            const close = () => overlay.remove();
            overlay.querySelector('.report-close').addEventListener('click', close);
            overlay.querySelector('.report-cancel').addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            overlay.querySelector('.report-test-header').addEventListener('change', event => {
                const template = overlay.querySelector('.report-profile-template');
                overlay.querySelector('.report-context-fields').hidden = !event.currentTarget.checked;
                if (event.currentTarget.checked
                    && template.value.trim() === reportEngine.DEFAULT_PROFILE_TEMPLATE.trim()) {
                    template.value = loadTestTemplate;
                } else if (!event.currentTarget.checked && template.value.trim() === loadTestTemplate.trim()) {
                    template.value = reportEngine.DEFAULT_PROFILE_TEMPLATE;
                }
            });
            const panelList = overlay.querySelector('.report-panel-list');
            let draggedCard = null;
            const clearDragState = () => {
                draggedCard?.classList.remove('is-dragging');
                panelList.querySelectorAll('.report-panel-card').forEach(card => card.classList.remove('is-drag-target'));
                draggedCard = null;
            };
            panelList.addEventListener('dragstart', event => {
                const handle = event.target.closest?.('.report-panel-drag-handle');
                const card = handle?.closest('.report-panel-card');
                if (!card) return;
                draggedCard = card;
                card.classList.add('is-dragging');
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', card.dataset.panelId);
                }
            });
            panelList.addEventListener('dragover', event => {
                if (!draggedCard) return;
                const target = event.target.closest?.('.report-panel-card');
                if (!target || target === draggedCard) return;
                event.preventDefault();
                panelList.querySelectorAll('.report-panel-card').forEach(card => card.classList.remove('is-drag-target'));
                target.classList.add('is-drag-target');
                const rect = target.getBoundingClientRect();
                const after = event.clientY > rect.top + rect.height / 2;
                panelList.insertBefore(draggedCard, after ? target.nextSibling : target);
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            });
            panelList.addEventListener('drop', event => { event.preventDefault(); clearDragState(); });
            panelList.addEventListener('dragend', clearDragState);
            overlay.querySelectorAll('.report-panel-card').forEach(card => {
                const enabled = card.querySelector('.report-enabled');
                enabled.addEventListener('change', () => {
                    const panel = getPanels().find(item => item.id === card.dataset.panelId);
                    if (!panel) return;
                    const report = reportEngine.normalizePanel(panel.report, panel);
                    card.dataset.reportEnabled = String(enabled.checked);
                    card.querySelector('.report-panel-auto-status').textContent = enabled.checked
                        ? (report.sla.source === 'none' ? 'Информационная панель · показывать всегда'
                            : `${report.sla.source === 'graph' ? 'Порог графика' : report.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Собственный SLA'} · ${report.includeMode === 'always' ? 'показывать всегда' : 'только при нарушении'}`)
                        : 'Не добавляется в сообщение';
                });
                card.querySelector('.report-open-panel-editor').addEventListener('click', () => {
                    const panel = getPanels().find(item => item.id === card.dataset.panelId);
                    if (!panel) return;
                    openPanelEditor(panel, updated => {
                        const next = reportEngine.normalizePanel(updated.report, updated);
                        enabled.checked = next.enabled;
                        card.dataset.reportEnabled = String(next.enabled);
                        card.querySelector('.report-panel-auto-status').textContent = next.enabled
                            ? `${next.sla.source === 'graph' ? 'Порог графика' : next.sla.source === 'custom' ? 'Собственный SLA' : next.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Информационная панель'} · ${next.includeMode === 'always' ? 'показывать всегда' : 'только при нарушении'}`
                            : 'Не добавляется в сообщение';
                    });
                });
            });
            overlay.querySelector('.report-save').addEventListener('click', async () => {
                overlay.querySelectorAll('.report-panel-card').forEach(card => {
                    const panel = getPanels().find(item => item.id === card.dataset.panelId);
                    if (!panel) return;
                    panel.report = reportEngine.normalizePanel({
                        ...panel.report,
                        enabled: card.querySelector('.report-enabled').checked,
                    }, panel);
                });
                profile.report = reportEngine.normalizeProfile({
                    ...profile.report,
                    template: overlay.querySelector('.report-profile-template').value,
                    panelOrder: [...overlay.querySelectorAll('.report-panel-card')]
                        .map(card => card.dataset.panelId),
                    context: {
                        testName: overlay.querySelector('.report-test-name').value,
                        environment: overlay.querySelector('.report-environment').value,
                        testStartedAt: overlay.querySelector('.report-test-started').value,
                        stableLoadStartedAt: overlay.querySelector('.report-stable-started').value,
                    },
                });
                await savePanels();
                close();
            });
            const focused = focusPanelId
                && overlay.querySelector(`.report-panel-card[data-panel-id="${CSS.escape(focusPanelId)}"]`);
            if (focused) {
                const panel = getPanels().find(item => item.id === focusPanelId);
                if (panel) openPanelEditor(panel, () => close());
            }
        }

        return Object.freeze({ openPanelEditor, openReportSettings: openSettings });
    }

    window.DashBridgeReportUi = Object.freeze({ create });
})();
