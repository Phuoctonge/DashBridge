(function initDashBridgePanelAnalysisController(root) {
    'use strict';

    function create({ postToDashboardFrame, normalizePanelMetadataText, analysisApi,
        getTransformSettings, findPanelCard,
        documentRef = document, navigatorRef = navigator, setTimer = setTimeout,
        now = () => Date.now(), random = () => Math.random() }) {
        if (typeof postToDashboardFrame !== 'function' || typeof normalizePanelMetadataText !== 'function'
            || typeof getTransformSettings !== 'function' || typeof findPanelCard !== 'function') {
            throw new TypeError('DashBridge panel analysis controller dependencies are incomplete');
        }
        let active = null;

        const getType = panel => analysisApi?.classifyTitle(panel?.title, getTransformSettings()) || null;

        const syncAction = (panel, card = findPanelCard(panel?.id)) => {
            const action = card?.querySelector('.btn-analysis');
            if (!action) return null;
            const type = getType(panel);
            action.hidden = type !== 'cpu' && type !== 'ram';
            action.dataset.analysisType = type || '';
            action.title = type === 'ram' ? 'Анализ RAM' : 'Анализ CPU';
            action.setAttribute('aria-label', action.title);
            return type;
        };

        const request = state => {
            if (!state) return false;
            return postToDashboardFrame(state.iframe, {
                action: 'startEmbeddedPanelAnalysis',
                requestId: state.requestId,
                analysisType: state.type,
                panelTitle: normalizePanelMetadataText(state.panel?.title, 240)
            });
        };

        const close = () => {
            const current = active;
            if (!current) return false;
            active = null;
            postToDashboardFrame(current.iframe, {
                action: 'cancelEmbeddedPanelAnalysis', requestId: current.requestId
            });
            current.overlay.remove();
            return true;
        };

        const open = (panel, iframe, type) => {
            if (!panel || !iframe || !['cpu', 'ram'].includes(type)) return false;
            close();
            const requestId = `dashboard-analysis-${panel.id}-${now()}-${random().toString(36).slice(2)}`;
            const makeElement = (tag, className = '', text = '') => {
                const node = documentRef.createElement(tag);
                if (className) node.className = className;
                if (text) node.textContent = text;
                return node;
            };
            const overlay = makeElement('div', 'modal-overlay dashboard-panel-analysis-overlay');
            const dialog = makeElement('section', 'modal-content dashboard-panel-analysis-modal');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            const header = makeElement('div', 'dashboard-panel-analysis-header');
            const heading = makeElement('h3', '', `Анализ ${type.toUpperCase()} — ${analysisApi?.baseTitle(panel.title) || panel.title || ''}`);
            const closeButton = makeElement('button', 'dashboard-panel-analysis-close');
            closeButton.type = 'button'; closeButton.title = 'Закрыть'; closeButton.setAttribute('aria-label', 'Закрыть');
            closeButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
            header.append(heading, closeButton);
            const modes = makeElement('div', 'dashboard-panel-analysis-modes');
            const period = makeElement('button', 'btn btn-primary active', 'Максимум за период');
            const latest = makeElement('button', 'btn btn-outline', 'Последнее значение');
            period.type = latest.type = 'button';
            modes.append(period, latest);
            const status = makeElement('div', 'dashboard-panel-analysis-status', 'Загрузка данных выбранной панели…');
            const output = makeElement('div', 'dashboard-panel-analysis-output');
            const actions = makeElement('div', 'dashboard-panel-analysis-actions');
            const copyAll = makeElement('button', 'btn btn-outline', 'Скопировать список');
            const copyTop = makeElement('button', 'btn btn-outline', 'Скопировать TOP-3');
            copyAll.type = copyTop.type = 'button';
            actions.append(copyAll, copyTop);
            dialog.append(header, modes, status, output, actions);
            overlay.appendChild(dialog);
            documentRef.body.appendChild(overlay);
            overlay.style.display = 'flex';

            const state = {
                requestId, panel, iframe, type, overlay, mode: 'period', snapshot: null, notice: '', status: 'loading',
                receive(message) {
                    this.status = message.status || 'loading';
                    this.notice = typeof message.notice === 'string' ? message.notice.substring(0, 500) : '';
                    if (message.snapshot && typeof message.snapshot === 'object') this.snapshot = message.snapshot;
                    render();
                }
            };
            active = state;

            const render = () => {
                if (active !== state) return;
                period.classList.toggle('btn-primary', state.mode === 'period');
                period.classList.toggle('btn-outline', state.mode !== 'period');
                latest.classList.toggle('btn-primary', state.mode === 'latest');
                latest.classList.toggle('btn-outline', state.mode !== 'latest');
                period.classList.toggle('active', state.mode === 'period');
                latest.classList.toggle('active', state.mode === 'latest');
                const selected = state.snapshot?.[state.mode];
                const items = Array.isArray(selected?.items) ? selected.items : [];
                output.replaceChildren();
                actions.hidden = !items.length;
                if (state.status === 'loading' && !state.snapshot) {
                    status.textContent = 'Загрузка данных выбранной панели…';
                    return;
                }
                if (!items.length) {
                    status.textContent = state.notice || `Метрики ${type.toUpperCase()} не найдены в ответе выбранной панели.`;
                    return;
                }
                status.textContent = `Найдено серверов: ${items.length}.${state.notice ? ` ${state.notice}` : ''}`;
                const table = makeElement('table', 'dashboard-panel-analysis-table');
                const head = makeElement('thead'); const headRow = makeElement('tr');
                headRow.append(makeElement('th', '', 'Сервер'), makeElement('th', '', `${type.toUpperCase()} (%)`));
                head.appendChild(headRow);
                const body = makeElement('tbody');
                const warning = Number(state.snapshot.warning);
                const critical = Number(state.snapshot.critical);
                items.forEach(item => {
                    const row = makeElement('tr');
                    const server = makeElement('td', '', String(item.server || ''));
                    const valueNumber = Number(item.value);
                    const value = makeElement('td', Number.isFinite(valueNumber) && valueNumber >= critical
                        ? 'critical' : (Number.isFinite(valueNumber) && valueNumber >= warning ? 'warning' : 'normal'));
                    value.textContent = Number.isFinite(valueNumber) ? `${valueNumber.toFixed(2)}%` : '—';
                    row.append(server, value); body.appendChild(row);
                });
                table.append(head, body); output.appendChild(table);
            };
            const copyText = async (button, key) => {
                const selected = state.snapshot?.[state.mode];
                const text = typeof selected?.[key] === 'string' ? selected[key] : '';
                if (!text) return;
                const original = button.textContent;
                try {
                    await navigatorRef.clipboard.writeText(text);
                    button.textContent = 'Скопировано';
                } catch {
                    button.textContent = 'Ошибка копирования';
                }
                setTimer(() => { if (button.isConnected) button.textContent = original; }, 2000);
            };
            period.addEventListener('click', () => { state.mode = 'period'; render(); });
            latest.addEventListener('click', () => { state.mode = 'latest'; render(); });
            copyAll.addEventListener('click', () => { void copyText(copyAll, 'copyAll'); });
            copyTop.addEventListener('click', () => { void copyText(copyTop, 'copyTop'); });
            closeButton.addEventListener('click', close);
            const sent = request(state);
            if (!sent) {
                state.status = 'empty';
                state.notice = 'Панель Grafana ещё не готова к анализу.';
                render();
            }
            closeButton.focus();
            return true;
        };

        const accept = (message, iframe) => {
            if (!active || active.requestId !== message?.requestId || active.iframe !== iframe) return false;
            active.receive(message);
            return true;
        };
        const retryForFrame = iframe => active?.iframe === iframe ? request(active) : false;
        const isPanel = panelOrId => active?.panel?.id === (typeof panelOrId === 'object' ? panelOrId?.id : panelOrId);

        return Object.freeze({ open, close, accept, retryForFrame, isPanel, getType, syncAction,
            get active() { return !!active; } });
    }

    root.DashBridgePanelAnalysisController = Object.freeze({ create });
})(globalThis);
