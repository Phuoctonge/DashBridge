(function initDashBridgeWorklogJiraClient(root) {
    'use strict';

    function create({ getBaseUrl, getTimeZone, request = fetch }) {
        if (typeof getBaseUrl !== 'function' || typeof getTimeZone !== 'function' || typeof request !== 'function') {
            throw new TypeError('DashBridgeWorklogJiraClient dependencies are incomplete');
        }
        const headers = { 'X-Atlassian-Token': 'no-check' };
        const pad = value => String(value).padStart(2, '0');
        const localStarted = date => {
            const offset = -date.getTimezoneOffset();
            const absoluteOffset = Math.abs(offset);
            const zone = (offset >= 0 ? '+' : '-')
                + pad(Math.floor(absoluteOffset / 60)) + pad(absoluteOffset % 60);
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
                + `T${pad(date.getHours())}:${pad(date.getMinutes())}:00.000${zone}`;
        };
        const formatStarted = (date, timeZone = getTimeZone()) => {
            if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date');
            if (!timeZone || timeZone === 'local') return localStarted(date);
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                }).formatToParts(date);
                const getValue = type => parts.find(part => part.type === type).value;
                const zoneParts = new Intl.DateTimeFormat('en-US', {
                    timeZone, timeZoneName: 'longOffset'
                }).formatToParts(date);
                const zoneName = zoneParts.find(part => part.type === 'timeZoneName').value;
                let zone = '+0000';
                if (zoneName !== 'GMT') {
                    const match = zoneName.match(/GMT([+-])(\d+)(?::(\d+))?/);
                    if (match) zone = match[1] + match[2].padStart(2, '0') + (match[3] || '00').padStart(2, '0');
                }
                return `${getValue('year')}-${getValue('month')}-${getValue('day')}`
                    + `T${getValue('hour')}:${getValue('minute')}:00.000${zone}`;
            } catch (error) {
                console.error('Timezone conversion error, falling back to local:', error);
                return localStarted(date);
            }
        };

        const checkAuth = async () => {
            try {
                const response = await request(`${getBaseUrl()}/rest/api/2/myself`, { headers });
                if (!response.ok) return { ok: false, reason: 'unauthorized' };
                const data = await response.json();
                return { ok: true, displayName: data.displayName || '' };
            } catch (error) {
                return { ok: false, reason: 'network', error };
            }
        };
        const fetchIssueTitle = async key => {
            try {
                const response = await request(`${getBaseUrl()}/rest/api/2/issue/${key}?fields=summary,parent`, { headers });
                if (!response.ok) return { ok: false, reason: 'not-found' };
                const data = await response.json();
                let title = data.fields?.summary || 'Без названия';
                if (data.fields?.parent) {
                    title = `${data.fields.parent.key} ${data.fields.parent.fields.summary} \n↳ ${key} ${title}`;
                }
                return { ok: true, title };
            } catch (error) {
                return { ok: false, reason: 'network', error };
            }
        };
        const submitWorklog = async ({ key, timeSpent, description, date }) => {
            const started = formatStarted(date);
            const response = await request(`${getBaseUrl()}/rest/api/2/issue/${key}/worklog`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timeSpent: `${String(timeSpent).replace(',', '.')}h`,
                    comment: description || '',
                    started
                })
            });
            const errorText = response.ok ? '' : await response.text();
            return { ok: response.ok, status: response.status, errorText, started };
        };
        return Object.freeze({ checkAuth, fetchIssueTitle, submitWorklog, formatStarted });
    }

    root.DashBridgeWorklogJiraClient = Object.freeze({ create });
})(globalThis);
