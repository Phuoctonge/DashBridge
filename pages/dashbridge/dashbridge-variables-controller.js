(function initDashBridgeVariablesController(root) {
    'use strict';
    function create({ getPanels, getActiveProfile, getPanelForIframe, applyPanelParamsToUrl,
        navigateDashboardFrame, savePanels, invalidate, replacePanelCard, updatePanelCard,
        documentRef = document, windowRef = window }) {
        const codec = root.DashBridgeVariablesState;
        const host = documentRef.getElementById('dashboardVariables');
        const toggle = documentRef.getElementById('dashboardVariablesToggle');
        const dialog = documentRef.getElementById('dashboardVariablesDialog');
        const closeButton = documentRef.getElementById('closeDashboardVariables');
        function closeDialog() {
            host.querySelectorAll('.dashboard-variable[open]').forEach(details => { details.open = false; });
            host.hidden = true;
            toggle?.setAttribute('aria-expanded', 'false');
            if (dialog.open) { dialog.close(); toggle?.focus(); }
        }
        function updateVisibility() {
            const available = [...groups.values()].some(group => !group.snapshot || !group.element.hidden);
            if (toggle) {
                toggle.hidden = !available;
                toggle.setAttribute('aria-expanded', String(available && dialog.open));
                toggle.title = 'Открыть переменные дашборда';
            }
            if (!available) closeDialog();
            host.hidden = !available || !dialog.open;
        }
        function toggleVisibility() {
            if (dialog.open) closeDialog();
            else {
                host.hidden = false; dialog.showModal();
                for (const group of groups.values()) {
                    if (group.pending || group.reloading || group.transaction) continue;
                    if (group.snapshot && !group.failed && Date.now() - group.updatedAt < 60000) continue;
                    group.failed = false;
                    status(group, group.snapshot ? 'Актуализация списка полей…' : 'Загрузка полей…');
                    request(group);
                }
            }
            updateVisibility();
        }
        function onDialogKeydown(event) {
            if (event.key !== 'Escape') return;
            event.preventDefault(); event.stopPropagation();
            const details = host.querySelector('.dashboard-variable[open]');
            if (details) { details.open = false; details.querySelector('summary')?.focus(); }
            else closeDialog();
        }
        function onDialogCancel(event) { event.preventDefault(); closeDialog(); }
        function onDialogClick(event) {
            if (event.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
        }
        let profileId = '';
        let stopped = false;
        let syncTimer;
        const delayed = new Set();
        const groups = new Map();
        const frames = () => Array.from(documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]'));
        const frameFor = panel => frames().find(frame => getPanelForIframe(frame)?.id === panel.id);
        const members = group => getPanels().filter(panel => codec.scope(panel.src) === group.key);
        const alive = group => !stopped && groups.get(group.key) === group && profileId === String(getActiveProfile()?.id || '');
        const status = (group, text) => { group.status.textContent = text; updateVisibility(); };
        function positionOptions(event) {
            // Scrolling the menu's own list/actions must not resize that same
            // scrollport and move the button the user is trying to reach.
            if (event?.type === 'scroll' && event.target?.closest?.('.dashboard-variable-options')) return;
            const details = host.querySelector('.dashboard-variable[open]');
            if (!details?.getBoundingClientRect) return;
            const body = details.querySelector('.dashboard-variable-options');
            const rect = details.getBoundingClientRect();
            const width = documentRef.documentElement.clientWidth;
            const height = windowRef.innerHeight;
            const gap = 12;
            if (rect.bottom < 0 || rect.top > height) { details.open = false; return; }
            body.style.maxHeight = `${Math.max(0, height - 2 * gap)}px`;
            const size = body.getBoundingClientRect();
            const below = height - rect.bottom - gap;
            const above = rect.top - gap;
            const upwards = below < Math.min(size.height, 240) && above > below;
            const available = Math.max(0, upwards ? above - 6 : below - 6);
            body.style.maxHeight = `${available}px`;
            body.style.left = `${Math.max(gap, Math.min(rect.left, width - size.width - gap))}px`;
            body.style.top = `${upwards ? Math.max(gap, rect.top - Math.min(size.height, available) - 6) : Math.max(gap, rect.bottom + 6)}px`;
        }
        const cancel = group => {
            clearTimeout(group.timer);
            group.pending = null;
            group.reloading = false;
        };
        const schedule = () => {
            clearTimeout(syncTimer);
            syncTimer = setTimeout(sync, 150);
        };
        function fail(group, message) {
            cancel(group);
            if (group.transaction) {
                const { frame, panel } = group.transaction;
                if (frame.isConnected) replacePanelCard(panel.id);
                group.transaction = null;
            }
            group.failed = true;
            group.element.removeAttribute('aria-busy');
            status(group, message);
            group.controls.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
        }
        function request(group, operation = 'read', name = '', values) {
            if (!alive(group) || group.pending || group.reloading) return;
            const panel = members(group).find(item => !item.paused && frameFor(item));
            const frame = group.transaction?.frame || (panel && frameFor(panel));
            if (!frame || frame.dataset.dashbridgeLoaded !== 'true') {
                status(group, 'Ожидание активной панели Grafana…');
                return;
            }
            const id = crypto.randomUUID();
            group.pending = { id, frame };
            updateVisibility();
            group.element.setAttribute('aria-busy', 'true');
            group.timer = setTimeout(() => fail(group, 'Нет ответа Grafana. Закройте и снова откройте «Переменные дашборда».'), 27000);
            frame.contentWindow.postMessage({ action: 'dashbridgeVariablesRequest', requestId: id, operation, name, values },
                new URL(frame.dataset.src || frame.src).origin);
        }
        function reload(group, nextVariables, changedName) {
            if (group.pending || group.reloading || !alive(group)) return;
            const panel = members(group).find(item => !item.paused && frameFor(item));
            const frame = panel && frameFor(panel);
            if (!frame) { status(group, 'Снимите с паузы хотя бы одну панель этой Grafana.'); return; }
            let next;
            try {
                let src = codec.apply(panel.src, nextVariables);
                if (changedName) src = codec.resetDependents(src, nextVariables, changedName);
                next = applyPanelParamsToUrl(panel, src);
            }
            catch (error) { status(group, error.message); return; }
            group.failed = false;
            group.transaction = { frame, panel };
            invalidate();
            // Navigate once with the chosen value and without stale dependents.
            // Mutating live Scenes first would start an extra query/render cycle.
            group.reloading = true;
            group.element.setAttribute('aria-busy', 'true');
            group.controls.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
            status(group, 'Grafana обновляет значения и зависимые поля…');
            group.timer = setTimeout(() => fail(group, 'Grafana не завершила обновление. Предыдущий выбор сохранён.'), 35000);
            if (!changedName) {
                // Assigning an unchanged URL containing a fragment can be a
                // same-document navigation: no new ready event will arrive.
                // Recreate through the card owner to retain action bindings.
                replacePanelCard(panel.id);
                group.transaction.frame = frameFor(panel);
            } else {
                navigateDashboardFrame(frame, next);
            }
        }
        function refresh(group, name = '') {
            if (group.pending || group.reloading) return;
            group.failed = false;
            if (group.snapshot?.adapter === 'template') reload(group, group.snapshot.variables);
            else {
                if (name) {
                    const panel = members(group).find(item => !item.paused && frameFor(item));
                    if (panel) group.transaction = { panel, frame: frameFor(panel), reloadSource: true };
                }
                request(group, name ? 'refresh' : 'read', name);
            }
        }
        function field(group, variable) {
            const details = documentRef.createElement('details');
            details.className = 'dashboard-variable';
            // Native exclusive details also handles keyboard activation and
            // closes the previous field synchronously before toggle events.
            details.setAttribute('name', 'dashbridge-variable-picker');
            const summary = documentRef.createElement('summary');
            const fullText = variable.texts.join(' + ') || variable.values.join(' + ') || '—';
            if (variable.hide !== 1) {
                const label = documentRef.createElement('span');
                label.className = 'dashboard-variable-label';
                label.textContent = variable.label;
                summary.appendChild(label);
            }
            const value = documentRef.createElement('span');
            value.className = 'dashboard-variable-value btn btn-outline';
            value.textContent = variable.values.length > 2 ? `Выбрано: ${variable.values.length}` : fullText;
            summary.appendChild(value);
            summary.setAttribute('aria-label', `${variable.label}: ${value.textContent}`);
            summary.title = `${variable.label}: ${fullText}`;
            details.appendChild(summary);
            const body = documentRef.createElement('div');
            body.className = 'dashboard-variable-options';
            details.appendChild(body);
            if (!variable.supported) {
                const note = documentRef.createElement('p');
                note.textContent = 'Это поле пока доступно только в исходной Grafana.';
                body.appendChild(note);
                return details;
            }
            const selected = new Set(variable.values);
            const apply = () => {
                if (group.pending || group.reloading) { status(group, 'Дождитесь обновления вариантов.'); return; }
                const values = [...selected];
                if (!values.length && variable.type !== 'textbox') {
                    status(group, 'Выберите хотя бы одно значение.'); return;
                }
                details.open = false;
                reload(group, group.snapshot.variables.map(item => item.name === variable.name ? { ...item, values } : item), variable.name);
            };
            const input = documentRef.createElement('input');
            input.className = 'form-input';
            input.type = variable.type === 'textbox' ? 'text' : 'search';
            input.setAttribute('aria-label', variable.type === 'textbox' ? variable.label : `Поиск: ${variable.label}`);
            input.placeholder = variable.type === 'textbox' ? variable.label : 'Поиск вариантов';
            input.autocomplete = 'off';
            input.maxLength = 16000;
            body.appendChild(input);
            const list = documentRef.createElement('div');
            list.className = 'dashboard-variable-list';
            body.appendChild(list);
            const draw = () => {
                list.replaceChildren();
                const options = variable.options.filter(option => option.text.toLocaleLowerCase().includes(input.value.toLocaleLowerCase()));
                for (const option of options) {
                    const label = documentRef.createElement('label');
                    const control = documentRef.createElement('input');
                    control.type = variable.multi ? 'checkbox' : 'radio';
                    control.name = `variable-${group.id}-${variable.name}`;
                    control.checked = selected.has(option.value);
                    control.addEventListener('change', () => {
                        if (!variable.multi || option.value === '$__all') selected.clear();
                        else selected.delete('$__all');
                        if (control.checked) selected.add(option.value); else selected.delete(option.value);
                        if (!variable.multi) apply(); else draw();
                    });
                    label.append(control, documentRef.createTextNode(option.text));
                    list.appendChild(label);
                }
                if (details.open) positionOptions();
            };
            if (variable.type === 'textbox') {
                input.value = variable.values[0] || '';
                input.addEventListener('input', () => { selected.clear(); selected.add(input.value); });
                input.addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
            } else { input.addEventListener('input', draw); draw(); }
            if (variable.multi || variable.type === 'textbox') {
                const button = documentRef.createElement('button');
                button.className = 'btn btn-primary';
                button.type = 'button'; button.textContent = 'Применить';
                button.addEventListener('click', apply); body.appendChild(button);
            }
            if (variable.allowCustomValue && variable.type !== 'textbox') {
                const custom = documentRef.createElement('button');
                custom.className = 'btn btn-outline';
                custom.type = 'button'; custom.textContent = 'Использовать введённое значение';
                custom.addEventListener('click', () => {
                    if (!input.value) return;
                    if (!variable.multi) selected.clear();
                    selected.delete('$__all'); selected.add(input.value); apply();
                });
                body.appendChild(custom);
            }
            const update = documentRef.createElement('button');
            update.className = 'btn btn-outline';
            update.type = 'button'; update.textContent = 'Обновить варианты';
            update.addEventListener('click', () => refresh(group, variable.name));
            body.appendChild(update);
            details.addEventListener('toggle', () => {
                if (details.open) positionOptions();
                if (details.open && Date.now() - group.updatedAt > 60000) refresh(group, variable.name);
            });
            details.addEventListener('keydown', event => {
                if (event.key === 'Escape') { details.open = false; summary.focus(); }
            });
            return details;
        }
        function render(group) {
            const panel = members(group)[0];
            if (panel) {
                const url = new URL(panel.src);
                url.pathname = url.pathname.replace('/d-solo/', '/d/');
                url.searchParams.delete('panelId');
                group.element.querySelector('a').href = url.href;
            }
            group.controls.replaceChildren();
            for (const variable of group.snapshot.variables) {
                if (variable.hide !== 2 && variable.type !== 'constant') group.controls.appendChild(field(group, variable));
            }
            group.element.hidden = group.snapshot.variables.every(variable => variable.hide === 2 || variable.type === 'constant');
            updateVisibility();
        }
        function makeGroup(key, panel) {
            const element = documentRef.createElement('section');
            element.className = 'dashboard-variable-group';
            const title = documentRef.createElement('a');
            const url = new URL(panel.src);
            url.pathname = url.pathname.replace('/d-solo/', '/d/');
            url.searchParams.delete('panelId');
            title.href = url.href; title.target = '_blank'; title.rel = 'noopener noreferrer';
            title.textContent = `${url.hostname} · ${decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1))}`;
            title.title = 'Открыть исходный дашборд Grafana';
            const controls = documentRef.createElement('div'); controls.className = 'dashboard-variable-controls';
            const message = documentRef.createElement('span'); message.setAttribute('role', 'status');
            const group = { key, id: crypto.randomUUID(), element, controls, status: message, updatedAt: 0, ids: new Set() };
            element.append(title, controls, message); host.appendChild(element);
            return group;
        }
        function sync() {
            if (stopped) return;
            const current = String(getActiveProfile()?.id || '');
            if (current !== profileId) {
                closeDialog();
                groups.forEach(cancel); groups.clear(); host.replaceChildren(); profileId = current;
            }
            const keys = new Set();
            for (const panel of getPanels()) {
                const key = codec.scope(panel.src);
                if (!key) continue;
                keys.add(key);
                if (!groups.has(key)) groups.set(key, makeGroup(key, panel));
            }
            for (const [key, group] of groups) {
                if (!keys.has(key)) { cancel(group); group.element.remove(); groups.delete(key); continue; }
                if (group.snapshot && !group.transaction && !group.pending) {
                    let changed = false;
                    for (const panel of members(group)) {
                        if (!group.ids.has(panel.id)) {
                            try {
                                const next = codec.apply(panel.src, group.snapshot.variables);
                                if (next !== panel.src) { panel.src = next; replacePanelCard(panel.id); changed = true; }
                            } catch (error) { status(group, error.message); }
                        }
                    }
                    if (changed) { invalidate(); void savePanels(); }
                }
                group.ids = new Set(members(group).map(panel => panel.id));
                if (!group.snapshot && !group.failed) request(group);
            }
            updateVisibility();
        }
        async function accept(group, data) {
            const snapshot = codec.normalize(data);
            if (!snapshot || snapshot.variables.some(variable => variable.error)) {
                fail(group, 'Grafana вернула ошибку или некорректный список переменных.'); return;
            }
            const initial = !group.snapshot;
            const sourcePanel = group.pending && getPanelForIframe(group.pending.frame);
            cancel(group);
            const transaction = group.transaction;
            group.transaction = null;
            group.snapshot = snapshot; group.updatedAt = Date.now(); group.failed = false;
            if (initial && sourcePanel) {
                group.ids = new Set([sourcePanel.id]);
                schedule();
            }
            group.element.removeAttribute('aria-busy');
            if (transaction) {
                const changes = [];
                try {
                    for (const panel of members(group)) changes.push([panel, codec.apply(panel.src, snapshot.variables)]);
                } catch (error) { group.transaction = transaction; fail(group, error.message); return; }
                invalidate();
                for (const [panel, src] of changes) {
                    if (panel.src === src) continue;
                    panel.src = src;
                    // Selection already navigated the source with new variables;
                    // keep it when committing Grafana-resolved dependencies.
                    // An explicit native options refresh may still need reload.
                    if (!transaction.reloadSource && panel.id === transaction.panel.id && frameFor(panel) === transaction.frame) {
                        updatePanelCard(panel.id, { reloadFrame: false });
                    } else {
                        replacePanelCard(panel.id);
                    }
                }
                const result = await savePanels();
                if (!alive(group)) return;
                if (result?.error) { status(group, 'Выбор применён, но профиль не сохранён. Повторите сохранение.'); render(group); return; }
            }
            status(group, '');
            render(group);
        }
        function onMessage(event) {
            const data = event.data;
            if (!data || !['dashbridgeVariablesResponse', 'dashbridgeIframeReady', 'dashbridgePanelRendered'].includes(data.action)) return;
            const frame = frames().find(item => item.contentWindow === event.source);
            const panel = frame && getPanelForIframe(frame);
            if (!panel || new URL(panel.src).origin !== event.origin) return;
            const group = groups.get(codec.scope(panel.src));
            if (!group || !alive(group)) { schedule(); return; }
            if (data.action === 'dashbridgeVariablesResponse') {
                if (group.pending?.id !== data.requestId || group.pending.frame !== frame) return;
                if (data.error) fail(group, 'Не удалось прочитать поля Grafana. Повторите обновление.');
                else void accept(group, data);
            } else {
                if (group.transaction?.frame === frame && group.reloading) {
                    clearTimeout(group.timer); group.reloading = false;
                }
                schedule();
                const leader = members(group).find(item => !item.paused && frameFor(item));
                if (group.transaction || !group.snapshot || leader?.id === panel.id) {
                    const timer = setTimeout(() => { delayed.delete(timer); if (alive(group)) request(group); }, 300);
                    delayed.add(timer);
                }
            }
        }
        const observer = new MutationObserver(schedule);
        function start() {
            closeButton.addEventListener('click', closeDialog);
            dialog.addEventListener('keydown', onDialogKeydown, true);
            dialog.addEventListener('cancel', onDialogCancel);
            dialog.addEventListener('click', onDialogClick);
            toggle?.addEventListener('click', toggleVisibility);
            observer.observe(documentRef.getElementById('dashboard'), { childList: true });
            windowRef.addEventListener('message', onMessage);
            windowRef.addEventListener('pagehide', stop, { once: true });
            windowRef.addEventListener('resize', positionOptions);
            windowRef.addEventListener('scroll', positionOptions, true);
            sync();
        }
        function stop() {
            closeDialog();
            closeButton.removeEventListener('click', closeDialog);
            dialog.removeEventListener('keydown', onDialogKeydown, true);
            dialog.removeEventListener('cancel', onDialogCancel);
            dialog.removeEventListener('click', onDialogClick);
            toggle?.removeEventListener('click', toggleVisibility);
            if (toggle) { toggle.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
            stopped = true; clearTimeout(syncTimer); groups.forEach(cancel); groups.clear();
            delayed.forEach(clearTimeout); delayed.clear();
            observer.disconnect(); windowRef.removeEventListener('message', onMessage);
            windowRef.removeEventListener('pagehide', stop); host.replaceChildren();
            windowRef.removeEventListener('resize', positionOptions);
            windowRef.removeEventListener('scroll', positionOptions, true);
        }
        return Object.freeze({ start, stop, sync });
    }
    root.DashBridgeVariablesController = Object.freeze({ create });
})(globalThis);
