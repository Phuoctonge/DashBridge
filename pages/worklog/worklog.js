/* global DashBridgeAnalytics, DashBridgeAnalyticsContract */
globalThis.DashBridgeWorklogMetrics = Object.freeze({
    parseDate(value) {
        const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/.exec(String(value || '').trim());
        if (!match) return new Date(NaN);
        const [, d, m, y, h = 0, min = 0] = match.map((part, index) => index && part !== undefined ? Number(part) : part);
        const date = new Date(y, m - 1, d, h, min);
        return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
            && date.getHours() === Number(h) && date.getMinutes() === Number(min) ? date : new Date(NaN);
    },
    calculateTotals(worklogs, now = new Date()) {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfDay);
        startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
        const startOfNextWeek = new Date(startOfWeek); startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);
        let day = 0; let week = 0;
        for (const log of Array.isArray(worklogs) ? worklogs : []) {
            const hours = parseFloat(String(log?.timeSpent ?? '').replace(',', '.')) || 0;
            const date = globalThis.DashBridgeWorklogMetrics.parseDate(log?.dateStarted);
            if (isNaN(date.getTime())) continue;
            if (date >= startOfWeek && date < startOfNextWeek) week += hours;
            if (date >= startOfDay && date < new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)) day += hours;
        }
        return { day, week };
    },
});

document.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.getElementById("logTableBody");
    const addRowBtn = document.getElementById("addRow");
    const sendAllBtn = document.getElementById("sendAll");
    const clearSentBtn = document.getElementById("clearSent");
    const dayTotalEl = document.getElementById("dayTotal");
    const weekTotalEl = document.getElementById("weekTotal");
    const authDot = document.getElementById("authDot");
    const authText = document.getElementById("authText");

    let worklogs = [];
    let sendingWorklogs = false;
    for (const type of ['click', 'input', 'change', 'keydown']) {
        document.addEventListener(type, event => {
            if (!sendingWorklogs) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
    }
    let issueCache = {};
    const issueRequests = new WeakMap();
    let sortOrder = 'desc';
    let historyStack = [];
    let redoStack = [];
    let activePicker = null;
    let jiraBaseUrl = "";
    let jiraTz = "local";
    let jiraDefaultComment = "";
    let jiraDefaultTimeSpent = "";
    const MAX_HISTORY = 5;
    const worklogWriter = DashBridgeStorageWriter.createLocal();
    const jiraClient = DashBridgeWorklogJiraClient.create({
        getBaseUrl: () => jiraBaseUrl,
        getTimeZone: () => jiraTz
    });

    function confirmWorklogAction(message) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = '<div class="modal-content" style="max-width:420px"><p class="worklog-confirm-message" style="margin:0"></p><div class="modal-actions"><button type="button" class="btn btn-danger worklog-confirm-ok">Очистить</button><button type="button" class="btn btn-outline worklog-confirm-cancel">Отмена</button></div></div>';
            overlay.querySelector('.worklog-confirm-message').textContent = message;
            document.body.appendChild(overlay);
            const finish = value => { overlay.remove(); resolve(value); };
            overlay.querySelector('.worklog-confirm-cancel').addEventListener('click', () => finish(false));
            overlay.querySelector('.worklog-confirm-ok').addEventListener('click', () => finish(true));
            overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
            overlay.addEventListener('keydown', event => { if (event.key === 'Escape') finish(false); });
            overlay.querySelector('.worklog-confirm-cancel').focus();
        });
    }

    // --- Storage & History ---
    chrome.storage.local.get(["jiraWorklogs", "jiraSortOrder", "jiraIssueCache", "jiraWorklogs_rejected_backup"], (data) => {
        chrome.storage.sync.get({ jiraBaseUrl: "https://jira.lanit.ru", jiraTz: "local", jiraDefaultComment: "", jiraDefaultTimeSpent: "" }, (syncData) => {
            jiraBaseUrl = syncData.jiraBaseUrl;
            jiraTz = syncData.jiraTz;
            jiraDefaultComment = syncData.jiraDefaultComment || "";
            jiraDefaultTimeSpent = syncData.jiraDefaultTimeSpent || "";
            const normalizedWorklogs = DashBridgeLocalStateSchema.normalizeWorklogs(
                Array.isArray(data.jiraWorklogs) ? data.jiraWorklogs : [],
                { mode: 'load' }
            );
            worklogs = normalizedWorklogs.items;
            if (normalizedWorklogs.skipped && !data.jiraWorklogs_rejected_backup) {
                void chrome.storage.local.set({
                    jiraWorklogs_rejected_backup: {
                        createdAt: new Date().toISOString(),
                        jiraWorklogs: data.jiraWorklogs
                    }
                }).catch(error => console.warn('Не удалось сохранить backup повреждённых Worklog:', error));
            }
            issueCache = data.jiraIssueCache || {};
            sortOrder = data.jiraSortOrder || 'desc';
            updateSortButtonUI();
            if (worklogs.length === 0) addNewRow();
            else renderTable();
            if (normalizedWorklogs.skipped) {
                showToast(`Пропущено повреждённых записей Worklog: ${normalizedWorklogs.skipped}`, { type: 'error' });
            }
            checkJiraAuth();
        });
    });

    function saveToStorage() {
        worklogWriter.write({
            jiraWorklogs: worklogs,
            jiraSortOrder: sortOrder,
            jiraIssueCache: issueCache
        }).catch(error => {
            console.error('Failed to persist worklogs:', error);
            showToast('Не удалось сохранить изменения. Повторите действие.', { type: 'error' });
        });
        updateStats();
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void worklogWriter.flush().catch(() => undefined);
    });
    window.addEventListener('pagehide', () => { void worklogWriter.checkpoint().catch(() => undefined); });

    function saveToHistory() {
        historyStack.push(JSON.stringify(worklogs));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        redoStack = [];
    }

    function acknowledgeHistory(logId) {
        // Undo can restore draft fields or removed rows, but cannot undo a Jira POST.
        // Reconcile both branches before persistence, even if the local commit fails.
        const reconcile = snapshot => JSON.stringify(JSON.parse(snapshot).map(log =>
            log.id === logId ? { ...log, status: 'sent' } : log));
        historyStack = historyStack.map(reconcile);
        redoStack = redoStack.map(reconcile);
    }

    function undo() {
        if (historyStack.length === 0) return;
        const popped = historyStack.pop();
        try {
            redoStack.push(JSON.stringify(worklogs));
            worklogs = JSON.parse(popped);
            renderTable();
            saveToStorage();
            showToast("Действие отменено");
            DashBridgeAnalytics?.opened('jira.undo');
        } catch (e) {
            console.error("Failed to undo:", e);
            showToast("Ошибка при отмене действия", { type: 'error' });
        }
    }

    function redo() {
        if (redoStack.length === 0) return;
        const popped = redoStack.pop();
        try {
            historyStack.push(JSON.stringify(worklogs));
            worklogs = JSON.parse(popped);
            renderTable();
            saveToStorage();
            showToast("Действие возвращено");
            DashBridgeAnalytics?.opened('jira.redo');
        } catch (e) {
            console.error("Failed to redo:", e);
            showToast("Ошибка при возврате действия", { type: 'error' });
        }
    }

    // --- Helpers ---
    function updateStats() {
        const totals = DashBridgeWorklogMetrics.calculateTotals(worklogs);
        if (dayTotalEl) dayTotalEl.textContent = totals.day.toFixed(1);
        if (weekTotalEl) weekTotalEl.textContent = totals.week.toFixed(1);
    }

    function parseDate(str) {
        return DashBridgeWorklogMetrics.parseDate(str);
    }

    function parseShortDate(s) {
        if (!s || !s.includes('/')) return new Date(0);
        const [d, m, y] = s.split('/').map(Number);
        return new Date(y, m - 1, d);
    }

    function formatDate(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function cleanLink(val) {
        if (!val) return val;
        let cleaned = val.trim();
        const browseMatch = cleaned.match(/browse\/([A-Z0-9-]+)/i);
        const selectedMatch = cleaned.match(/selectedIssue=([A-Z0-9-]+)/i);
        if (browseMatch) return browseMatch[1].toUpperCase();
        if (selectedMatch) return selectedMatch[1].toUpperCase();
        return cleaned.toUpperCase();
    }

    function getProgressColor(hours) {
        if (hours === 0) return '#94a3b8';
        // Норма: 8 часов (допуск ±0.01 для погрешности округления)
        if (hours >= 7.99 && hours < 8.01) return '#15803d';
        // Переработка: 8.01 и выше
        if (hours >= 8.01) return '#2563eb';
        const ratio = hours / 8;
        return `hsl(0, 85%, ${45 + (ratio * 35)}%)`;
    }

    // --- API Calls ---
    async function fetchIssueTitle(logId) {
        const log = worklogs.find(l => l.id === logId);
        if (!log) return;
        const key = log.issueKey || log.issueId;
        const request = Symbol(); issueRequests.set(log, request);
        if (!key || key.length < 3) { log.summary = ''; updateRowUI(logId); return; }

        if (issueCache[key]) {
            log.summary = issueCache[key];
            updateRowUI(logId);
            return;
        }

        log.summary = "Загрузка...";
        updateRowUI(logId);

        const result = await jiraClient.fetchIssueTitle(key);
        // A response belongs to this object and edit, including an A -> B -> A edit.
        if (!worklogs.includes(log) || issueRequests.get(log) !== request || (log.issueKey || log.issueId) !== key) return;
        if (result.ok) {
            log.summary = result.title;
            issueCache[key] = result.title;
            saveToStorage();
        } else {
            log.summary = result.reason === 'not-found' ? 'Задача не найдена' : 'Ошибка загрузки';
        }
        updateRowUI(logId);
    }

    // --- Row UI Update ---
    function updateRowUI(logId) {
        const row = findWorklogRow(logId);
        if (!row) return;
        const log = worklogs.find(l => l.id === logId);
        if (!log) return;

        // Title lookup must not replace live input nodes or their native undo stack.
        const summary = row.querySelector('.summary-display');
        summary.textContent = log.summary || 'Введите ключ задачи...'; summary.title = log.summary || '';
        summary.classList.toggle('summary-empty', !log.summary?.trim());
        const template = document.createElement('template'); template.innerHTML = getRowHtml(log);
        const link = template.content.querySelector('a'); row.querySelector('.col-key a')?.remove();
        if (link) row.querySelector('.col-key input').parentElement.appendChild(link);
    }

    // --- Rendering ---
    function getStatusText(status) {
        if (status === 'sent') return 'Отправлено';
        if (status === 'error') return 'Ошибка';
        return 'Черновик';
    }

    function getSafeStatus(status) {
        return ['new', 'error', 'sent'].includes(status) ? status : 'new';
    }

    function findWorklogRow(logId) {
        return Array.from(document.querySelectorAll('.task-row')).find(row => row.dataset.id === logId) || null;
    }

    function findWorklogInput(logId, field) {
        return Array.from(document.querySelectorAll('input[data-id][data-field]'))
            .find(input => input.dataset.id === logId && input.dataset.field === field) || null;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getRowHtml(log) {
        const safeStatus = getSafeStatus(log.status);
        const isErr = safeStatus === 'error';
        const hasSummary = log.summary && log.summary.trim().length > 0;
        return `
            <td class="col-key cell-center">
                <div style="position:relative; display:flex; align-items:center; justify-content:center; width: 100%;">
                    <input type="text" value="${escapeHtml(log.issueId)}" data-id="${escapeHtml(log.id)}" data-field="issueId" aria-label="Задача Jira" placeholder="ID или ссылка"
                        style="text-align:center; width: 100%;" class="${isErr && !log.issueId ? 'error-field' : ''}">
                    ${log.issueKey ? `<a href="${escapeHtml(jiraBaseUrl)}/browse/${encodeURIComponent(log.issueKey)}" target="_blank" rel="noopener noreferrer" style="position:absolute; right: -18px; text-decoration:none; display: flex; align-items: center; top: 50%; transform: translateY(-50%); z-index: 5;" title="Открыть в Jira"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></a>` : ''}
                </div>
            </td>
            <td class="col-task">
                <div class="summary-display ${!hasSummary ? 'summary-empty' : ''}" title="${escapeHtml(log.summary)}">${escapeHtml(log.summary || 'Введите ключ задачи...')}</div>
            </td>
            <td class="col-time cell-center"><input type="text" data-id="${escapeHtml(log.id)}" data-field="timeSpent" aria-label="Затраченное время" value="${escapeHtml(log.timeSpent)}" class="${isErr && !log.timeSpent ? 'error-field' : ''}" placeholder="0"></td>
            <td class="col-date cell-center"><div class="date-input-group"><input type="text" data-id="${escapeHtml(log.id)}" data-field="dateStarted" aria-label="Дата работы" value="${escapeHtml(log.dateStarted)}" class="${isErr && !log.dateStarted ? 'error-field' : ''}"><button type="button" class="calendar-btn" aria-label="Выбрать дату работы" data-id="${escapeHtml(log.id)}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></td>
            <td class="col-desc"><textarea data-id="${escapeHtml(log.id)}" data-field="description" aria-label="Описание работы" placeholder="Описание..." style="min-height:32px;">${escapeHtml(log.description)}</textarea></td>
            <td class="col-status cell-center"><span class="status-badge status-${safeStatus}">${getStatusText(safeStatus)}</span></td>
            <td class="col-actions"><div class="actions"><button class="btn btn-clone clone-row" data-id="${escapeHtml(log.id)}" title="Дублировать"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin:0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button><button class="btn btn-danger delete-row" data-id="${escapeHtml(log.id)}" title="Удалить">✕</button></div></td>
        `;
    }

    function createDayHeader(date, sum) {
        let display = date;
        if (date !== "Без даты" && date.includes('/')) {
            try {
                const [d, m, y] = date.split('/').map(Number);
                const dt = new Date(y, m - 1, d);
                const day = dt.toLocaleDateString('ru-RU', { weekday: 'long' });
                display = `${date} (${day.charAt(0).toUpperCase() + day.slice(1)})`;
            } catch (e) { }
        }
        const color = getProgressColor(sum);
        const width = Math.min((sum / 8) * 100, 100);
        const tr = document.createElement("tr");
        tr.className = "day-header";
        tr.dataset.date = date;
        tr.innerHTML = `<td colspan="7"><div style="display:flex; align-items:center; justify-content:space-between;"><div style="display:flex; align-items:center; gap:6px;"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px; color:var(--text-muted);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${escapeHtml(display)} <span class="day-total" style="background: ${color}15; color: ${color}; border: 2px solid ${color};">${sum.toFixed(1)} ч.</span></div><div class="progress-container"><div class="progress-bar" style="width: ${width}%; background: ${color}"></div></div></div></td>`;
        return tr;
    }

    function renderTable() {
        if (activePicker) activePicker();
        if (worklogs.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7"><div class="worklog-empty-state" role="status"><strong>Нет записей Worklog</strong><span>Добавьте первую запись, чтобы начать учёт времени.</span><button type="button" class="btn btn-primary" id="emptyAddRow">Добавить запись</button></div></td></tr>';
            document.getElementById('emptyAddRow')?.addEventListener('click', () => addRowBtn.click());
            updateStats();
            return;
        }
        const positions = new Map();
        document.querySelectorAll('.task-row').forEach(row => { const id = row.getAttribute('data-id'); if (id) positions.set(id, row.getBoundingClientRect()); });
        worklogs.sort((a, b) => { const da = parseDate(a.dateStarted); const db = parseDate(b.dateStarted); return sortOrder === 'desc' ? db - da : da - db; });
        const groups = {};
        const dailyTotals = {};
        worklogs.forEach((log) => {
            const dStr = log.dateStarted ? log.dateStarted.split(' ')[0] : 'Без даты';
            if (!groups[dStr]) groups[dStr] = [];
            groups[dStr].push(log);
            dailyTotals[dStr] = (dailyTotals[dStr] || 0) + (parseFloat(String(log.timeSpent).replace(',', '.')) || 0);
        });
        const fragment = document.createDocumentFragment();
        Object.keys(groups).sort((a, b) => { if (a === "Без даты") return -1; if (b === "Без даты") return 1; return sortOrder === 'desc' ? parseShortDate(b) - parseShortDate(a) : parseShortDate(a) - parseShortDate(b); }).forEach(d => {
            fragment.appendChild(createDayHeader(d, dailyTotals[d]));
            groups[d].forEach(log => { const tr = document.createElement("tr"); tr.className = "task-row"; tr.setAttribute('data-id', log.id); tr.innerHTML = getRowHtml(log); fragment.appendChild(tr); });
        });
        tableBody.innerHTML = "";
        tableBody.appendChild(fragment);
        setTimeout(() => {
            document.querySelectorAll('.task-row').forEach(row => {
                const id = row.getAttribute('data-id'); const old = positions.get(id);
                if (old) { const dy = old.top - row.getBoundingClientRect().top; if (Math.abs(dy) > 1) { row.animate([{ transform: `translateY(${dy}px)`, opacity: 0.8 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }); } }
            });
        }, 0);
        attachListeners();
        updateStats();
    }

    function attachListeners() {
        document.onkeydown = (e) => {
            if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
            if (e.ctrlKey && (e.key === 'z' || e.key === 'я')) { e.preventDefault(); undo(); }
            if (e.ctrlKey && (e.key === 'y' || e.key === 'н' || (e.shiftKey && (e.key === 'Z' || e.key === 'Я')))) { e.preventDefault(); redo(); }
        };
        document.querySelectorAll('textarea').forEach(el => autoResizeTextarea(el));
        document.querySelectorAll('.calendar-btn').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); openPicker(btn.dataset.id, btn.parentElement.parentElement); };
        });
        document.querySelectorAll('input, textarea').forEach(el => {
            if (el.tagName === 'TEXTAREA') el.oninput = () => autoResizeTextarea(el);
            el.onchange = (e) => {
                const id = e.target.dataset.id; const field = e.target.dataset.field;
                if (!field || !id) return;
                const log = worklogs.find(l => l.id === id);
                if (!log) return;
                let val = e.target.value;
                if (field === 'dateStarted' && isNaN(parseDate(val).getTime())) {
                    e.target.value = log.dateStarted;
                    showToast('Введите существующую дату и время: ДД/ММ/ГГГГ ЧЧ:ММ.', { type: 'error' }); return;
                }
                saveToHistory();
                if (field === 'issueId') { val = cleanLink(val); e.target.value = val; log.issueKey = val; }
                log[field] = val;
                if (field === 'issueId') fetchIssueTitle(id);
                if (field === 'dateStarted') showRefreshIndicator();
                if (field === 'timeSpent') { updateStats(); showRefreshIndicator(); }
                markEdited(log);
                saveToStorage();
            };
        });
        document.querySelectorAll('.delete-row').forEach(b => b.onclick = (e) => {
            const row = e.target.closest('.task-row');
            const id = row.dataset.id;
            saveToHistory();

            worklogs = worklogs.filter(l => l.id !== id);
            updateDayHeader(row);
            row.remove();

            if (worklogs.length === 0) addNewRow();

            saveToStorage();
            updateStats();
            showToast("Строка удалена", true);
            DashBridgeAnalytics?.opened('jira.row_deleted');
        });
        document.querySelectorAll('.clone-row').forEach(b => b.onclick = (e) => {
            const btn = e.target.closest('button');
            const id = btn.dataset.id;
            const currentRow = btn.closest('tr');

            saveToHistory();
            const originalIndex = worklogs.findIndex(l => l.id === id);
            const originalLog = worklogs[originalIndex];
            if (!originalLog) return;

            const newLog = {
                ...originalLog,
                id: crypto.randomUUID(),
                status: 'new'
            };

            // Вставляем в массив сразу после оригинала
            worklogs.splice(originalIndex + 1, 0, newLog);

            // Визуально вставляем сразу после текущей строки
            const newTr = document.createElement("tr");
            newTr.className = "task-row";
            newTr.setAttribute('data-id', newLog.id);
            newTr.innerHTML = getRowHtml(newLog);

            currentRow.after(newTr);
            updateDayHeader(newTr);

            saveToStorage();
            updateStats();
            attachListeners();
            DashBridgeAnalytics?.opened('jira.row_cloned');
        });
    }

    function markEdited(log) {
        if (log.status === 'sent') log.status = 'new';
        const badge = findWorklogRow(log.id)?.querySelector('.status-badge');
        if (badge) { badge.className = `status-badge status-${getSafeStatus(log.status)}`; badge.textContent = getStatusText(log.status); }
    }

    function updateDayHeader(row) {
        let header = row.previousElementSibling;
        while (header && !header.classList.contains('day-header')) header = header.previousElementSibling;
        if (!header) return;
        let sum = 0, count = 0;
        for (let next = header.nextElementSibling; next && !next.classList.contains('day-header'); next = next.nextElementSibling) {
            const log = worklogs.find(item => item.id === next.dataset.id);
            if (log) { sum += parseFloat(String(log.timeSpent).replace(',', '.')) || 0; count++; }
        }
        if (count) header.replaceWith(createDayHeader(header.dataset.date, sum)); else header.remove();
    }

    // --- Picker & UI ---
    function openPicker(logId, anchor) {
        if (activePicker) activePicker();
        const log = worklogs.find(l => l.id === logId);
        if (!log) return;
        let current = parseDate(log.dateStarted);
        if (isNaN(current.getTime())) current = new Date();
        const picker = document.createElement('div');
        picker.className = 'custom-picker active';
        const opener = anchor.querySelector('.calendar-btn');
        const close = () => {
            const restoreFocus = picker.contains(document.activeElement);
            picker.remove(); document.removeEventListener('click', outside, true);
            document.removeEventListener('keydown', escape); if (activePicker === close) activePicker = null;
            if (restoreFocus && opener?.isConnected) opener.focus();
        };
        // Capture runs before month rendering replaces the clicked DOM node.
        const outside = event => { if (!picker.contains(event.target)) close(); };
        const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        const chooseDate = date => {
            if (!worklogs.includes(log)) { close(); return; }
            saveToHistory(); log.dateStarted = formatDate(date); markEdited(log);
            const input = findWorklogInput(logId, 'dateStarted'); if (input) input.value = log.dateStarted;
            showRefreshIndicator(); saveToStorage(); close();
        };
        let hours = String(current.getHours()).padStart(2, '0'), minutes = String(current.getMinutes()).padStart(2, '0');
        const moveMonth = delta => {
            const focusedId = picker.contains(document.activeElement) ? document.activeElement.id : '';
            hours = picker.querySelector('#pH').value; minutes = picker.querySelector('#pM').value;
            current.setDate(1); current.setMonth(current.getMonth() + delta); renderPicker();
            if (focusedId === 'prev' || focusedId === 'next') picker.querySelector(`#${focusedId}`).focus();
        };
        function renderPicker() {
            const year = current.getFullYear(), month = current.getMonth();
            const names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
            picker.innerHTML = `
                <div class="picker-header"><div class="picker-title">${names[month]} ${year}</div><div class="picker-nav"><button type="button" class="nav-btn" id="prev" aria-label="Предыдущий месяц">‹</button><button type="button" class="nav-btn" id="next" aria-label="Следующий месяц">›</button></div></div>
                <div class="picker-grid"><div class="weekday">Пн</div><div class="weekday">Вт</div><div class="weekday">Ср</div><div class="weekday">Чт</div><div class="weekday">Пт</div><div class="weekday">Сб</div><div class="weekday">Вс</div></div>
                <div class="time-picker"><div class="time-group"><span class="time-label">Время:</span><input type="text" class="time-input" id="pH" aria-label="Часы" value="${escapeHtml(hours)}" maxlength="2"><span>:</span><input type="text" class="time-input" id="pM" aria-label="Минуты" value="${escapeHtml(minutes)}" maxlength="2"></div><button type="button" class="time-label" id="setNow">Сейчас</button></div>
            `;
            const grid = picker.querySelector('.picker-grid'), first = new Date(year, month, 1).getDay(), off = first === 0 ? 6 : first - 1, days = new Date(year, month + 1, 0).getDate(), prev = new Date(year, month, 0).getDate();
            for (let i = off; i > 0; i--) { const d = document.createElement('div'); d.className = 'day prev-month'; d.textContent = prev - i + 1; grid.appendChild(d); }
            for (let d = 1; d <= days; d++) {
                const div = document.createElement('button'); div.type = 'button'; div.className = 'day';
                div.setAttribute('aria-label', `${d} ${names[month]} ${year}`);
                if (d === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear()) div.classList.add('today');
                div.textContent = d; div.onclick = () => {
                    const h = picker.querySelector('#pH').value, m = picker.querySelector('#pM').value;
                    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m) || Number(h) > 23 || Number(m) > 59) {
                        showToast('Часы: 00–23, минуты: 00–59.', { type: 'error' }); return;
                    }
                    chooseDate(new Date(year, month, d, Number(h), Number(m)));
                }; grid.appendChild(div);
            }
            picker.querySelector('#prev').onclick = () => moveMonth(-1);
            picker.querySelector('#next').onclick = () => moveMonth(1);
            picker.querySelector('#setNow').onclick = () => chooseDate(new Date());
        }
        renderPicker(); document.body.appendChild(picker);
        const r = anchor.getBoundingClientRect(); let t = r.bottom + 5, l = r.right - 230;
        if (t + 280 > window.innerHeight - 10) t = r.top - 285; if (l < 10) l = 10;
        picker.style.top = t + 'px'; picker.style.left = l + 'px'; activePicker = close;
        document.addEventListener('click', outside, true); document.addEventListener('keydown', escape);
        picker.querySelector('#prev').focus();
    }

    function showToast(text, options = false) {
        const withUndo = options === true || options?.withUndo === true;
        const type = typeof options === 'object' ? options.type : null;
        const ex = document.querySelector('.toast-notify'); if (ex) ex.remove();
        const toast = document.createElement('div'); toast.className = 'toast-notify';
        if (type === 'error') toast.classList.add('error');
        const message = document.createElement('span'); message.textContent = String(text || ''); toast.appendChild(message);
        if (withUndo) {
            const undoButton = document.createElement('button'); undoButton.id = 'undoAction'; undoButton.textContent = 'Отменить';
            undoButton.onclick = () => { undo(); toast.remove(); }; toast.appendChild(undoButton);
        }
        document.body.appendChild(toast);
        setTimeout(() => { toast.classList.add('show'); setTimeout(() => { if (toast.parentElement) { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); } }, 3000); }, 10);
    }

    function addNewRow(data = null) {
        const entry = data ? { ...data, id: crypto.randomUUID() } : {
            id: crypto.randomUUID(), issueId: "", issueKey: "", summary: "", timeSpent: jiraDefaultTimeSpent, dateStarted: formatDate(new Date()), description: jiraDefaultComment, status: "new"
        };
        worklogs.unshift(entry); renderTable(); saveToStorage();
    }

    async function checkJiraAuth() {
        if (!authText) return;
        authText.textContent = "Проверка...";
        const result = await jiraClient.checkAuth();
        DashBridgeAnalytics?.outcome('jira.auth_checked', result.ok ? 'success'
            : (result.reason === 'network' ? 'error' : 'auth_required'));
        if (result.ok) {
            authText.textContent = `Авторизован: ${result.displayName}`;
            authDot.className = "auth-dot auth-ok";
        } else {
            authText.textContent = result.reason === 'network' ? 'Ошибка связи' : 'Не авторизован';
            authDot.className = "auth-dot auth-fail";
        }
    }

    function showRefreshIndicator() {
        const btn = document.getElementById("sortToggle");
        if (btn) {
            btn.classList.add("needs-refresh");
            btn.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg> Перегруппировать<span class="refresh-dot"></span>`;
            btn.style.background = "#fff8e1"; btn.style.color = "#b45309"; btn.style.borderColor = "#ffab00";
        }
    }
    function updateSortButtonUI() {
        const btn = document.getElementById("sortToggle");
        if (btn) {
            btn.classList.remove("needs-refresh");
            btn.innerHTML = sortOrder === 'desc'
                ? `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg> По убыванию`
                : `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg> По возрастанию`;
            btn.style.background = "#ebecf0"; btn.style.color = "#42526e"; btn.style.borderColor = "transparent";
        }
    }
    function autoResizeTextarea(el) { if (!el) return; el.style.height = 'auto'; el.style.height = (el.scrollHeight) + 'px'; }

    document.getElementById("sortToggle").onclick = () => {
        const btn = document.getElementById("sortToggle");
        if (btn.classList.contains("needs-refresh")) { renderTable(); updateSortButtonUI(); }
        else { sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'; updateSortButtonUI(); renderTable(); }
        saveToStorage();
        DashBridgeAnalytics?.opened('jira.sort_changed');
    };
    document.getElementById("checkAuth").onclick = checkJiraAuth;
    addRowBtn.onclick = () => { saveToHistory(); addNewRow(); };
    clearSentBtn.onclick = async () => {
        const sentCount = worklogs.filter(log => log.status === 'sent').length;
        if (!sentCount) return;
        const confirmed = await confirmWorklogAction(`Удалить отправленные записи: ${sentCount}? Это действие можно отменить кнопкой «Назад».`);
        if (!confirmed) return;
        saveToHistory();
        worklogs = worklogs.filter(log => log.status !== 'sent');
        if (worklogs.length === 0) addNewRow();
        renderTable();
        saveToStorage();
        DashBridgeAnalytics?.outcome('jira.sent_rows_cleared', 'success', {
            countBucket: DashBridgeAnalytics.bucket(sentCount)
        });
    };

    sendAllBtn.onclick = async () => {
        if (sendingWorklogs) return;
        let hasErrors = false;
        for (let l of worklogs) { if (l.status !== 'sent' && (!l.issueId || !l.timeSpent || !l.dateStarted)) { hasErrors = true; l.status = 'error'; } }
        if (hasErrors) {
            DashBridgeAnalytics?.outcome('jira.batch_send', 'invalid_input');
            renderTable(); alert("Заполните обязательные поля!"); return;
        }
        sendAllBtn.disabled = true;
        sendingWorklogs = true;
        const lockedControls = new Map([...document.querySelectorAll('button,input,select,textarea')]
            .map(control => [control, control.disabled]));
        lockedControls.forEach((_, control) => { control.disabled = true; });
        const batch = worklogs.filter(log => log.status !== 'sent').map(log => ({ ...log }));
        let attempted = 0;
        let succeeded = 0;
        let persistenceFailed = false;
        try {
        for (const log of batch) {
            const key = log.issueKey || log.issueId;
            attempted += 1;
            let status = 'error';
            try {
                const d = parseDate(log.dateStarted);
                if (isNaN(d.getTime())) throw new Error("Invalid date");
                const result = await jiraClient.submitWorklog({
                    key,
                    timeSpent: log.timeSpent,
                    description: log.description,
                    date: d
                });
                if (!result.ok) {
                    console.error(`[Jira Error] ${result.status}: ${result.errorText}`);
                }
                status = result.ok ? 'sent' : 'error';
                if (result.ok) { succeeded += 1; acknowledgeHistory(log.id); }
            } catch (e) {
                console.error("[Worklog Error]", e);
                status = 'error';
            }
            const current = worklogs.find(item => item.id === log.id);
            if (current) current.status = status;
            // Commit each acknowledged POST before starting another one. A failed
            // local commit stops the batch; it must not silently invite a retry.
            await worklogWriter.write({ jiraWorklogs: worklogs, jiraSortOrder: sortOrder, jiraIssueCache: issueCache });

            // Обновляем только статус конкретной строки без полной перерисовки таблицы
            const row = findWorklogRow(log.id);
            if (row) {
                const statusCell = row.querySelector('.col-status');
                if (statusCell) {
                    const st = status;
                    statusCell.innerHTML = `<span class="status-badge status-${st}">${getStatusText(st)}</span>`;
                }
            }

            // Небольшая задержка между запросами
            await new Promise(r => setTimeout(r, 600));
        }
        // Одна полная перерисовка по завершении для корректной группировки и анимации
        } catch (error) {
            persistenceFailed = true;
            console.error('Worklog batch persistence failed:', error);
            alert('Отправка остановлена: не удалось сохранить результат локально. Проверьте записи в Jira перед повторной отправкой.');
        } finally {
            sendingWorklogs = false;
            lockedControls.forEach((disabled, control) => { control.disabled = disabled; });
            renderTable(); updateStats(); sendAllBtn.disabled = false;
        }
        DashBridgeAnalytics?.outcome('jira.batch_send', persistenceFailed ? (succeeded ? 'partial' : 'error') : !attempted ? 'no_data'
            : (succeeded === attempted ? 'success' : (succeeded ? 'partial' : 'error')),
        { countBucket: DashBridgeAnalyticsContract?.bucket?.(attempted) || (attempted > 10 ? '11_plus' : '1') });
    };
});
