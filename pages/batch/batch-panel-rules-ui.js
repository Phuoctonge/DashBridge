(function initBatchPanelRulesUi(root) {
    'use strict';
    const labels = [['removeFill', 'Убрать заливку графика'], ['thickenLines', 'Утолщить линии графика'],
        ['invertLegend', 'Переместить легенду: справа ↔ снизу'], ['invertIdle', 'Инвертировать CPU-график: Idle → Load'],
        ['convertMemToUsed', 'Конвертировать RAM-график в % Used']];
    function create({ dashboardUrl, container, status, store, parseUrl }) {
        let loadVersion = 0; let saveTimer = null;
        const setStatus = value => { status.textContent = value; };
        const option = (key, label, checked) => {
            const node = document.createElement('label'); const input = document.createElement('input');
            input.type = 'checkbox'; input.dataset.ruleField = key; input.checked = checked === true;
            node.append(input, document.createTextNode(label)); return node;
        };
        const addRow = (panelId = '', rule = {}) => {
            const row = document.createElement('article'); row.className = 'batch-panel-rule';
            const idBox = document.createElement('div'); idBox.className = 'batch-panel-rule-id';
            const idLabel = document.createElement('label'); idLabel.textContent = 'ID панели';
            const idInput = document.createElement('input'); idInput.type = 'number'; idInput.min = '1'; idInput.step = '1';
            idInput.inputMode = 'numeric'; idInput.className = 'batch-panel-rule-id-input'; idInput.value = panelId; idInput.placeholder = '12';
            idLabel.append(idInput); idBox.append(idLabel);
            const options = document.createElement('div'); options.className = 'batch-panel-rule-options';
            labels.forEach(([key, label]) => options.append(option(key, label, rule[key])));
            const width = document.createElement('label'); width.className = 'batch-panel-rule-width'; width.append(document.createTextNode('Толщина '));
            const widthInput = document.createElement('input'); widthInput.type = 'number'; widthInput.min = '1'; widthInput.max = '10';
            widthInput.step = '0.5'; widthInput.dataset.ruleField = 'thickenLinesValue'; widthInput.value = Number(rule.thickenLinesValue) || 1.5;
            width.append(widthInput); options.append(width);
            const thick = options.querySelector('[data-rule-field="thickenLines"]');
            const syncWidth = () => { const enabled = thick?.checked === true; width.hidden = !enabled; widthInput.disabled = !enabled; widthInput.setAttribute('aria-hidden', String(!enabled)); };
            thick?.addEventListener('change', syncWidth); syncWidth();
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn batch-panel-rule-remove'; remove.textContent = 'Удалить';
            remove.addEventListener('click', () => {
                row.remove(); scheduleSave();
                root.DashBridgeAnalytics?.opened('batch.panel_rule_removed');
            }); row.append(idBox, options, remove);
            row.querySelectorAll('input').forEach(input => { input.addEventListener('input', scheduleSave); input.addEventListener('change', scheduleSave); });
            container.append(row);
        };
        const render = (rules = {}) => { container.replaceChildren(); Object.entries(rules).sort(([a], [b]) => Number(a) - Number(b)).forEach(([id, rule]) => addRow(id, rule)); };
        const collect = () => {
            const rules = {};
            container.querySelectorAll('.batch-panel-rule').forEach(row => {
                const id = row.querySelector('.batch-panel-rule-id-input')?.value.trim(); if (!id) return;
                if (!/^\d+$/.test(id) || Number(id) < 1) throw new Error(`Некорректный ID панели: ${id}`);
                const rule = {}; row.querySelectorAll('[data-rule-field]').forEach(input => { if (input.type === 'checkbox' && input.checked) rule[input.dataset.ruleField] = true; });
                if (rule.thickenLines) rule.thickenLinesValue = Number(row.querySelector('[data-rule-field="thickenLinesValue"]')?.value); rules[id] = rule;
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
