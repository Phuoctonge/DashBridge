(function initBatchPanelRulesUi(root) {
    'use strict';
    const visualLabels = [['removeFill', 'Убрать заливку графика'], ['thickenLines', 'Утолщить линии графика'],
        ['invertLegend', 'Переместить легенду: справа ↔ снизу']];
    const transformLabels = [['invertIdle', 'Инвертировать CPU-график: Idle → Load'],
        ['convertMemToUsed', 'Конвертировать RAM-график в % Used']];
    const filterLabels = [['seriesQueryFilterEnabled', 'Фильтр отображаемых серий'],
        ['cpuCapacityFilterEnabled', 'Фильтр Load Average по vCPU'], ['thresholdEnabled', 'Порог на графике']];
    const allLabels = [...visualLabels, ...transformLabels, ...filterLabels];
    function create({ dashboardUrl, container, status, store, parseUrl }) {
        let loadVersion = 0; let saveTimer = null;
        const setStatus = value => { status.textContent = value; };
        const option = (key, label, checked) => {
            const node = document.createElement('label'); const input = document.createElement('input');
            node.className = 'batch-panel-rule-toggle';
            input.type = 'checkbox'; input.dataset.ruleField = key; input.checked = checked === true;
            input.setAttribute('role', 'switch');
            const track = document.createElement('span'); track.className = 'batch-switch';
            const slider = document.createElement('span'); slider.className = 'batch-switch-slider'; slider.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span'); text.textContent = label;
            track.append(input, slider); node.append(track, text); return node;
        };
        const addRow = (panelId = '', rule = {}) => {
            const row = document.createElement('article'); row.className = 'batch-panel-rule';
            const idBox = document.createElement('div'); idBox.className = 'batch-panel-rule-id';
            const idLabel = document.createElement('label'); idLabel.textContent = 'ID панели';
            const idInput = document.createElement('input'); idInput.type = 'number'; idInput.min = '1'; idInput.step = '1';
            idInput.inputMode = 'numeric'; idInput.className = 'batch-panel-rule-id-input'; idInput.value = panelId; idInput.placeholder = '12';
            idLabel.append(idInput); idBox.append(idLabel);
            const options = document.createElement('div'); options.className = 'batch-panel-rule-options';
            [...visualLabels, ...transformLabels, ...filterLabels].forEach(([key, label]) => {
                const setting = document.createElement('div'); setting.className = 'batch-panel-rule-setting';
                setting.dataset.setting = key; setting.append(option(key, label, rule[key])); options.append(setting);
            });
            const width = document.createElement('label'); width.className = 'batch-panel-rule-width'; width.append(document.createTextNode('Толщина '));
            const widthInput = document.createElement('input'); widthInput.type = 'range'; widthInput.min = '0.5'; widthInput.max = '5';
            widthInput.step = '0.5'; widthInput.dataset.ruleField = 'thickenLinesValue'; widthInput.value = Number(rule.thickenLinesValue) || 1.5;
            const widthValue = document.createElement('span'); widthValue.className = 'batch-panel-rule-width-value';
            const updateWidthValue = () => { widthValue.textContent = `+${Number(widthInput.value).toFixed(1)}`; };
            widthInput.addEventListener('input', updateWidthValue); updateWidthValue();
            width.append(widthInput, widthValue);
            options.querySelector('[data-setting="thickenLines"]').append(width);
            const thick = options.querySelector('[data-rule-field="thickenLines"]');
            const syncWidth = () => { widthInput.disabled = thick?.checked !== true; };
            thick?.addEventListener('change', syncWidth); syncWidth();
            const convertMem = options.querySelector('[data-rule-field="convertMemToUsed"]');
            const syncMemoryModes = (source) => {
                if (convertMem) convertMem.disabled = false;
            };
            convertMem?.addEventListener('change', () => syncMemoryModes(convertMem));
            syncMemoryModes();
            const addFilterDetails = (prefix, label, modeOptions = null) => {
                const setting = options.querySelector(`[data-setting="${prefix}Enabled"]`);
                const details = document.createElement('div'); details.className = 'batch-panel-rule-details';
                const valueLabel = document.createElement('label'); valueLabel.textContent = label;
                const value = document.createElement('input'); value.type = 'number'; value.step = 'any';
                value.dataset.ruleField = `${prefix}Value`; value.value = rule[`${prefix}Value`] ?? 0;
                valueLabel.append(value); details.append(valueLabel);
                if (modeOptions) {
                    const modeLabel = document.createElement('label'); modeLabel.textContent = 'Сравнивать';
                    const mode = document.createElement('select'); mode.dataset.ruleField = 'seriesQueryFilterMode';
                    for (const [key, text] of modeOptions) {
                        const item = document.createElement('option'); item.value = key; item.textContent = text; mode.append(item);
                    }
                    mode.value = rule.seriesQueryFilterMode === 'last' ? 'last' : 'max'; modeLabel.append(mode); details.append(modeLabel);
                    details.append(option('seriesQueryFilterHighlightEnabled', 'Подсвечивать превышения', rule.seriesQueryFilterHighlightEnabled !== false));
                }
                const hint = document.createElement('small');
                hint.textContent = 'В единицах данных: память - байты, после CPU/RAM-преобразования - проценты (0–100).';
                details.append(hint); setting.append(details);
                const toggle = setting.querySelector(`[data-rule-field="${prefix}Enabled"]`);
                const sync = () => {
                    details.hidden = !toggle.checked;
                    details.querySelectorAll('input, select').forEach(input => { input.disabled = !toggle.checked; });
                };
                toggle.addEventListener('change', sync); sync();
            };
            addFilterDetails('seriesQueryFilter', 'Показывать серии выше', [['max', 'Максимум за период'], ['last', 'Последнее значение']]);
            addFilterDetails('threshold', 'Значение порога');
            const capacity = options.querySelector('[data-setting="cpuCapacityFilterEnabled"]');
            const capacityDetails = document.createElement('div'); capacityDetails.className = 'batch-panel-rule-details';
            capacityDetails.innerHTML = '<label>Порог: количество vCPU × <input type="number" min="0.01" max="10" step="0.05" data-rule-field="cpuCapacityFilterCoefficient"></label>'
                + '<label>Сравнивать <select data-rule-field="cpuCapacityFilterMode"><option value="max">Максимум за период</option><option value="last">Последнее значение</option></select></label>';
            capacityDetails.append(option('cpuCapacityFilterLoad1', 'Load 1m', rule.cpuCapacityFilterLoad1 !== false));
            capacityDetails.append(option('cpuCapacityFilterLoad5', 'Load 5m', rule.cpuCapacityFilterLoad5 === true));
            capacityDetails.append(option('cpuCapacityFilterLoad15', 'Load 15m', rule.cpuCapacityFilterLoad15 === true));
            capacityDetails.append(option('cpuCapacityFilterHighlightEnabled', 'Подсвечивать превышения', rule.cpuCapacityFilterHighlightEnabled !== false));
            capacity.append(capacityDetails);
            capacityDetails.querySelector('[data-rule-field="cpuCapacityFilterCoefficient"]').value = rule.cpuCapacityFilterCoefficient ?? 0.8;
            capacityDetails.querySelector('[data-rule-field="cpuCapacityFilterMode"]').value = rule.cpuCapacityFilterMode === 'last' ? 'last' : 'max';
            const capacityToggle = capacity.querySelector('[data-rule-field="cpuCapacityFilterEnabled"]');
            const syncCapacity = () => { capacityDetails.hidden = !capacityToggle.checked; capacityDetails.querySelectorAll('input,select').forEach(input => { input.disabled = !capacityToggle.checked; }); };
            capacityToggle.addEventListener('change', syncCapacity); syncCapacity();
            const seriesToggle = options.querySelector('[data-rule-field="seriesQueryFilterEnabled"]');
            seriesToggle?.addEventListener('change', () => {
                if (seriesToggle.checked && capacityToggle.checked) {
                    capacityToggle.checked = false;
                    syncCapacity();
                }
            });
            capacityToggle.addEventListener('change', () => {
                if (capacityToggle.checked && seriesToggle?.checked) {
                    seriesToggle.checked = false;
                    seriesToggle.dispatchEvent(new Event('change'));
                }
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn batch-panel-rule-remove'; remove.textContent = 'Удалить';
            remove.addEventListener('click', () => {
                row.remove(); scheduleSave();
                root.DashBridgeAnalytics?.opened('batch.panel_rule_removed');
            });
            const disclosure = document.createElement('details'); disclosure.className = 'batch-rule-disclosure'; disclosure.open = true;
            const summary = document.createElement('summary');
            const updateSummary = () => {
                const active = allLabels.filter(([key]) => options.querySelector(`[data-rule-field="${key}"]`)?.checked);
                const names = { removeFill: 'без заливки', thickenLines: `линии ${widthInput.value}`,
                    invertLegend: 'легенда', invertIdle: 'CPU → Load', convertMemToUsed: 'RAM → %',
                    seriesQueryFilterEnabled: 'фильтр серий',
                    cpuCapacityFilterEnabled: 'Load по vCPU', thresholdEnabled: 'порог' };
                summary.textContent = active.length ? `Настройки · ${active.map(([key]) => names[key]).join(' · ')}` : 'Настройки · ничего не включено';
            };
            options.addEventListener('input', updateSummary); options.addEventListener('change', updateSummary); updateSummary();
            disclosure.append(summary, options); row.append(idBox, disclosure, remove);
            row.querySelectorAll('input, select').forEach(input => { input.addEventListener('input', scheduleSave); input.addEventListener('change', scheduleSave); });
            container.append(row);
        };
        const render = (rules = {}) => { container.replaceChildren(); Object.entries(rules).sort(([a], [b]) => Number(a) - Number(b)).forEach(([id, rule]) => addRow(id, rule)); };
        const collect = () => {
            const rules = {};
            container.querySelectorAll('.batch-panel-rule').forEach(row => {
                const id = row.querySelector('.batch-panel-rule-id-input')?.value.trim(); if (!id) return;
                if (!/^\d+$/.test(id) || Number(id) < 1) throw new Error(`Некорректный ID панели: ${id}`);
                const rule = {}; row.querySelectorAll('[data-rule-field]').forEach(input => { if (input.type === 'checkbox' && input.checked && !input.disabled) rule[input.dataset.ruleField] = true; });
                if (rule.thickenLines) rule.thickenLinesValue = Number(row.querySelector('[data-rule-field="thickenLinesValue"]')?.value); rules[id] = rule;
                for (const prefix of ['seriesQueryFilter', 'threshold']) {
                    if (!rule[`${prefix}Enabled`]) continue;
                    const input = row.querySelector(`[data-rule-field="${prefix}Value"]`);
                    if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error(`Укажите числовое значение для панели ${id}`);
                    rule[`${prefix}Value`] = Number(input.value);
                }
                if (rule.seriesQueryFilterEnabled) {
                    rule.seriesQueryFilterMode = row.querySelector('[data-rule-field="seriesQueryFilterMode"]').value;
                    rule.seriesQueryFilterHighlightEnabled = row.querySelector('[data-rule-field="seriesQueryFilterHighlightEnabled"]').checked;
                }
                if (rule.cpuCapacityFilterEnabled) {
                    rule.cpuCapacityFilterCoefficient = Number(row.querySelector('[data-rule-field="cpuCapacityFilterCoefficient"]')?.value);
                    rule.cpuCapacityFilterMode = row.querySelector('[data-rule-field="cpuCapacityFilterMode"]')?.value;
                    rule.cpuCapacityFilterHighlightEnabled = row.querySelector('[data-rule-field="cpuCapacityFilterHighlightEnabled"]')?.checked;
                }
            }); return rules;
        };
        const load = async () => {
            const url = dashboardUrl.value.trim(); const version = ++loadVersion;
            if (!parseUrl(url)) { render(); setStatus('Введите URL Grafana, чтобы загрузить правила этого дашборда.'); return; }
            try {
                const rules = await store.load(url); if (version !== loadVersion || url !== dashboardUrl.value.trim()) return;
                render(rules); document.getElementById('resetBatchPanelRulesBtn').hidden = !Object.keys(rules).length;
                setStatus(Object.keys(rules).length ? `Загружено правил: ${Object.keys(rules).length}.` : 'Для этого дашборда правил пока нет.');
            } catch (error) { setStatus(`Не удалось загрузить правила: ${error.message}`); }
        };
        const incomplete = () => Array.from(container.querySelectorAll('.batch-panel-rule')).some(row => {
            const id = row.querySelector('.batch-panel-rule-id-input')?.value.trim();
            return !id || !/^\d+$/.test(id) || Number(id) < 1 || !Array.from(row.querySelectorAll('input[type="checkbox"]')).some(input => input.checked);
        });
        function scheduleSave() {
            clearTimeout(saveTimer); const url = dashboardUrl.value.trim(); setStatus('Сохранение…');
            saveTimer = setTimeout(async () => {
                if (url !== dashboardUrl.value.trim()) return;
                if (!parseUrl(url)) return setStatus('Введите URL Grafana, чтобы сохранить правила.');
                if (incomplete()) return setStatus('Укажите корректный ID панели и выберите хотя бы одну настройку.');
                try {
                    const rules = await store.save(url, collect()); if (url !== dashboardUrl.value.trim()) return;
                    document.getElementById('resetBatchPanelRulesBtn').hidden = !Object.keys(rules).length;
                    setStatus(Object.keys(rules).length ? `Сохранено правил: ${Object.keys(rules).length}.` : 'Нет сохранённых правил для этого дашборда.');
                } catch (error) { setStatus(`Не удалось сохранить правила: ${error.message}`); }
            }, 350);
        }
        document.getElementById('addBatchPanelRuleBtn').addEventListener('click', () => { addRow(); scheduleSave(); });
        document.getElementById('resetBatchPanelRulesBtn').addEventListener('click', () => { render(); scheduleSave(); });
        dashboardUrl.addEventListener('change', () => { clearTimeout(saveTimer); void load(); });
        return Object.freeze({ load, render, collect, addRow, scheduleSave });
    }
    root.BatchPanelRulesUi = Object.freeze({ create });
})(globalThis);
