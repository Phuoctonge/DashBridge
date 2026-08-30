async function dashbridgeTransferJiraWorklogs(expectedOrigin, expectedBasePath = '') {
    const issueKeyPattern = /^[A-Z][A-Z0-9_]*-\d+$/;
    const normalizeIssueKey = value => {
        const key = String(value || '').trim().toUpperCase();
        return key.length <= 255 && issueKeyPattern.test(key) ? key : null;
    };

    if (location.origin.toLowerCase() !== expectedOrigin) {
        alert('Операция отменена: активная вкладка больше не соответствует настроенному Jira origin.');
        return { status: 'origin-mismatch' };
    }
    const basePath = /^\/(?:[^?#]*)$/.test(expectedBasePath) ? expectedBasePath.replace(/\/+$/, '') : '';
    if (basePath && !location.pathname.startsWith(`${basePath}/`)) {
        alert('Операция отменена: активная страница находится вне настроенного Jira context path.');
        return { status: 'base-path-mismatch' };
    }

    const currentIssueKey = normalizeIssueKey(document.querySelector('meta[name="ajs-issue-key"]')?.content);
    if (!currentIssueKey) {
        alert('Не удалось определить корректный ключ исходной задачи Jira. Откройте страницу задачи, из которой нужно перенести worklog.');
        return { status: 'invalid-source' };
    }

    const targetUser = prompt("В чьих записях будем искать?\n\nВведите Имя/Фамилию.\n\nОставьте пустым, чтобы выбрать ВСЕ записи в задаче:");
    if (targetUser === null) return { status: 'cancelled' };
    const destinationInput = prompt(`Текущая задача: ${currentIssueKey}\n\nВведите ключ НОВОЙ задачи, куда перенести время (например, MOSRU-12345):`);
    if (destinationInput === null || !destinationInput.trim()) return { status: 'cancelled' };
    const newIssueKey = normalizeIssueKey(destinationInput);
    if (!newIssueKey) {
        alert('Некорректный ключ задачи назначения. Пример: MOSRU-12345.');
        return { status: 'invalid-destination' };
    }
    if (newIssueKey === currentIssueKey) {
        alert('Исходная задача и задача назначения должны отличаться.');
        return { status: 'same-issue' };
    }

    let worklogsToTransfer = [];
    try {
        const res = await fetch(`${basePath}/rest/api/2/issue/${encodeURIComponent(currentIssueKey)}/worklog`, {
            headers: { 'Accept': 'application/json', 'X-Atlassian-Token': 'no-check' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.worklogs) || data.worklogs.length === 0) {
            alert('В текущей задаче нет ни одной записи времени.');
            return { status: 'empty' };
        }
        const searchTerms = targetUser.trim().toLowerCase().split(/\s+/).filter(Boolean);
        worklogsToTransfer = searchTerms.length === 0 ? data.worklogs : data.worklogs.filter(wl => {
            const combinedData = [wl.author?.displayName, wl.author?.emailAddress, wl.author?.name, wl.author?.key]
                .map(value => String(value || '').toLowerCase()).join(' ');
            return searchTerms.every(term => combinedData.includes(term));
        });
        if (worklogsToTransfer.length === 0) {
            alert(`Не найдено ни одной записи для пользователя "${targetUser}".`);
            return { status: 'not-found' };
        }
    } catch (error) {
        console.error('Ошибка получения worklog:', error);
        alert('Не удалось получить записи времени из текущей задачи.');
        return { status: 'load-failed' };
    }

    const selection = targetUser.trim()
        ? `Найдено ${worklogsToTransfer.length} записей пользователя "${targetUser}".`
        : `Выбраны ВСЕ записи (${worklogsToTransfer.length} шт).`;
    if (!confirm(`${selection}\nЗадача назначения: ${newIssueKey}\n\nПродолжить?`)) return { status: 'cancelled' };
    const isMove = confirm('Что делаем с исходными записями?\n\n[ОК] — ПЕРЕНЕСТИ\n[Отмена] — ПРОСТО СКОПИРОВАТЬ');

    const totals = { copied: 0, deleted: 0, copyFailed: 0, deleteFailed: 0 };
    for (let index = 0; index < worklogsToTransfer.length; index++) {
        const wl = worklogsToTransfer[index];
        const payload = { timeSpentSeconds: wl.timeSpentSeconds, started: wl.started, comment: wl.comment || '' };
        try {
            const response = await fetch(`${basePath}/rest/api/2/issue/${encodeURIComponent(newIssueKey)}/worklog?adjustEstimate=leave`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Atlassian-Token': 'no-check' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                totals.copyFailed++;
                console.error(`Не удалось скопировать worklog ${wl.id || ''}: HTTP ${response.status}`);
            } else {
                totals.copied++;
                if (isMove) {
                    try {
                        const delRes = await fetch(`${basePath}/rest/api/2/issue/${encodeURIComponent(currentIssueKey)}/worklog/${encodeURIComponent(String(wl.id))}?adjustEstimate=leave`, {
                            method: 'DELETE', headers: { 'X-Atlassian-Token': 'no-check' }
                        });
                        if (delRes.ok) totals.deleted++;
                        else {
                            totals.deleteFailed++;
                            console.error(`Скопированный worklog ${wl.id} не удалён: HTTP ${delRes.status}`);
                        }
                    } catch (error) {
                        totals.deleteFailed++;
                        console.error(`Скопированный worklog ${wl.id} не удалён:`, error);
                    }
                }
            }
        } catch (error) {
            totals.copyFailed++;
            console.error(`Сетевая ошибка при копировании worklog ${wl.id || ''}:`, error);
        }
        if (index + 1 < worklogsToTransfer.length) await new Promise(resolve => setTimeout(resolve, 600));
    }

    const lines = isMove
        ? [`Скопировано: ${totals.copied}`, `Удалено из исходной задачи: ${totals.deleted}`, `Ошибок копирования: ${totals.copyFailed}`, `Скопировано, но не удалено: ${totals.deleteFailed}`]
        : [`Скопировано: ${totals.copied}`, `Ошибок копирования: ${totals.copyFailed}`];
    const fullySuccessful = totals.copyFailed === 0 && (!isMove || totals.deleteFailed === 0);
    alert(`${fullySuccessful ? 'Готово.' : 'Операция завершена частично.'}\n${lines.join('\n')}\nЗадача назначения: ${newIssueKey}\n\nОбновите страницу.`);
    return { status: fullySuccessful ? 'complete' : 'partial', isMove, total: worklogsToTransfer.length, ...totals };
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('openJiraPage').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('html/worklog.html') });
    const transferBtn = document.getElementById('transferWorklogBtn');
    if (!transferBtn) return;
    transferBtn.onclick = async () => {
        try {
            const settings = await chrome.storage.sync.get({ jiraBaseUrl: 'https://jira.lanit.ru' });
            const normalizedBaseUrl = normalizeHttpBaseUrl(settings.jiraBaseUrl);
            const expectedOrigin = normalizedBaseUrl ? normalizeHttpOrigin(normalizedBaseUrl) : null;
            const expectedBasePath = normalizedBaseUrl ? new URL(normalizedBaseUrl).pathname.replace(/\/+$/, '') : '';
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeOrigin = tab?.url ? normalizeHttpOrigin(tab.url) : null;
            if (!expectedOrigin || !tab?.id || activeOrigin !== expectedOrigin) {
                alert(`Откройте задачу на настроенном сервере Jira (${expectedOrigin || 'проверьте настройки Jira'}).`);
                return;
            }
            await chrome.scripting.executeScript({
                target: { tabId: tab.id }, func: dashbridgeTransferJiraWorklogs, args: [expectedOrigin, expectedBasePath]
            });
        } catch (error) {
            console.error('Не удалось запустить перенос worklog:', error);
            alert('Не удалось запустить перенос worklog. Проверьте активную вкладку и разрешения расширения.');
        }
    };
});
