'use strict';

const byId = id => document.getElementById(id);
const labels = globalThis.DashBridgeAnalyticsLabels;
const filters = ['days', 'version', 'feature', 'signal', 'installation'];
const number = value => new Intl.NumberFormat('ru-RU').format(Number(value) || 0);
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
const hour = value => value ? new Date(value).toLocaleString('ru-RU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—';
const userLabel = id => id ? `Пользователь ${String(id).slice(0, 8)}…${String(id).slice(-4)}` : '—';
const featureName = id => labels.features[id] || id;
const signalName = signal => labels.signals[signal] || signal;
let current = null;
let sortState = { table: 'features', key: 'events', direction: -1 };

function parseDimensions(value) {
    let parsed = {};
    try { parsed = JSON.parse(value || '{}'); } catch { return '—'; }
    const result = Object.entries(parsed).map(([key, item]) => {
        const name = labels.dimensionNames[key] || key;
        return `${name}: ${labels.values[String(item)] || item}`;
    });
    return result.join(' · ') || '—';
}

function replaceOptions(id, values, label = value => value) {
    const select = byId(id); const selected = select.value;
    select.replaceChildren(new Option('Все', ''));
    values.forEach(value => select.add(new Option(label(value), value)));
    select.value = values.includes(selected) ? selected : '';
}

function cells(row, columns) {
    const fragment = document.createDocumentFragment();
    columns.forEach(column => {
        const cell = document.createElement('td');
        cell.textContent = column.format ? column.format(row[column.key], row) : String(row[column.key] ?? '—');
        if (column.title) cell.title = column.title(row[column.key], row);
        fragment.appendChild(cell);
    });
    return fragment;
}

function selectInstallation(installationId) {
    if (!installationId) return;
    byId('installation').value = installationId;
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTable(id, rows, columns, installationKey = '') {
    const body = byId(id).querySelector('tbody'); body.replaceChildren();
    if (!rows.length) {
        const row = document.createElement('tr'); const cell = document.createElement('td');
        cell.colSpan = columns.length; cell.className = 'empty'; cell.textContent = 'Нет данных для выбранных фильтров';
        row.appendChild(cell); body.appendChild(row); return;
    }
    const sorted = [...rows];
    if (sortState.table === id) sorted.sort((left, right) => {
        const a = left[sortState.key]; const b = right[sortState.key];
        return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
            * sortState.direction;
    });
    sorted.forEach(row => {
        const tr = document.createElement('tr'); tr.appendChild(cells(row, columns));
        if (installationKey && row[installationKey]) {
            tr.dataset.installation = row[installationKey];
            tr.title = 'Показать только действия этого пользователя';
            tr.addEventListener('click', () => selectInstallation(row[installationKey]));
        }
        body.appendChild(tr);
    });
}

function render(data) {
    current = data;
    byId('totalUsers').textContent = number(data.totals.installations);
    byId('totalEvents').textContent = number(data.totals.events);
    byId('totalAggregates').textContent = number(data.totals.aggregates);
    byId('databaseSize').textContent = `${data.databaseUsedMiB} / ${data.databaseLimitMiB} MiB`;
    replaceOptions('version', data.filterOptions.versions.map(item => item.value));
    replaceOptions('feature', data.filterOptions.features.map(item => item.value), featureName);
    replaceOptions('installation', data.filterOptions.installations.map(item => item.value), userLabel);
    renderTable('actions', data.actions.map(item => ({ ...item,
        userLabel: userLabel(item.installationId), featureName: featureName(item.featureId),
        signalName: signalName(item.signal), details: parseDimensions(item.dimensions),
    })), [
        { key: 'periodStart', format: hour },
        { key: 'userLabel', title: (_value, row) => row.installationId },
        { key: 'featureName' }, { key: 'signalName' }, { key: 'details' }, { key: 'events', format: number },
    ], 'installationId');
    const active = Number(data.totals.activeInstallations) || 0;
    renderTable('features', data.features.map(item => ({ ...item,
        featureName: featureName(item.featureId), adoption: active ? Number(item.users) / active * 100 : 0,
    })), [
        { key: 'featureName', title: (_value, row) => row.featureId },
        { key: 'adoption', format: value => `${number(Math.round(value))}%` },
        { key: 'usedUsers', format: number }, { key: 'configuredUsers', format: number },
        { key: 'effectiveUsers', format: number }, { key: 'successUsers', format: number },
        { key: 'issueUsers', format: number }, { key: 'events', format: number },
    ]);
    renderTable('problems', data.problems.map(item => ({ ...item,
        featureName: featureName(item.featureId), outcomeName: labels.values[item.outcome] || item.outcome,
    })), [
        { key: 'featureName', title: (_value, row) => row.featureId }, { key: 'version' },
        { key: 'outcomeName' }, { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    renderTable('versions', data.versions.map(item => ({ ...item,
        issueRate: Number(item.outcomes) ? Number(item.issues) / Number(item.outcomes) * 100 : 0,
    })), [
        { key: 'version' }, { key: 'users', format: number }, { key: 'events', format: number },
        { key: 'issues', format: number }, { key: 'issueRate', format: value => `${number(Math.round(value))}%` },
        { key: 'lastSeen', format: date },
    ]);
    renderTable('installations', data.installations.map(item => ({ ...item, userLabel: userLabel(item.installationId) })), [
        { key: 'userLabel', title: (_value, row) => row.installationId }, { key: 'version' },
        { key: 'features', format: number }, { key: 'events', format: number }, { key: 'lastSeen', format: date },
    ], 'installationId');
    renderTable('dimensions', data.dimensions.map(item => ({ ...item, details: parseDimensions(item.dimensions) })), [
        { key: 'details' }, { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    const timeline = byId('timeline'); timeline.replaceChildren();
    timeline.classList.toggle('is-empty', data.timeline.length === 0);
    if (!data.timeline.length) {
        const empty = document.createElement('p'); empty.className = 'empty';
        empty.textContent = 'Нет данных для выбранных фильтров'; timeline.appendChild(empty);
    }
    const maximum = Math.max(1, ...data.timeline.map(item => Number(item.events)));
    data.timeline.forEach(item => {
        const bar = document.createElement('div'); bar.className = 'bar';
        bar.style.height = `${Math.max(3, Number(item.events) / maximum * 100)}%`;
        bar.dataset.label = `${item.day}: ${number(item.events)}, пользователей: ${number(item.users)}`;
        timeline.appendChild(bar);
    });
    const operations = data.operations || {};
    byId('operations').textContent = [
        `Успешных пачек: ${number(operations.acceptedBatches)}`,
        `Отклонённых: ${number(operations.rejectedBatches)}`,
        `Принято агрегатов: ${number(operations.acceptedAggregates)}`,
        `Потеряно клиентской очередью: ${number(operations.clientDroppedAggregates)}`,
        `Ограничено по частоте: ${number(operations.rateLimitRejections)}`,
        `Отклонено из-за размера базы: ${number(operations.storageRejections)}`,
        `Последний приём: ${date(operations.lastSuccessfulIngest)}`,
    ].join(' · ');
    const selected = byId('installation').value;
    byId('status').textContent = `Обновлено ${date(data.generatedAt)} · хранение ${data.retentionDays} дней`
        + (selected ? ` · выбран ${userLabel(selected)}` : '');
    byId('status').className = '';
}

async function load() {
    byId('status').textContent = 'Загрузка…'; byId('status').className = '';
    const query = new URLSearchParams();
    filters.forEach(id => { if (byId(id).value) query.set(id, byId(id).value); });
    try {
        const response = await fetch(`/admin/api/data?${query}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        render(await response.json());
    } catch (error) {
        byId('status').textContent = `Ошибка загрузки: ${error.message}`; byId('status').className = 'error';
    }
}

filters.forEach(id => byId(id).addEventListener('change', load));
byId('refresh').addEventListener('click', load);
byId('reset').addEventListener('click', () => {
    filters.forEach(id => { byId(id).value = id === 'days' ? '30' : ''; });
    load();
});
document.querySelectorAll('th[data-key]').forEach(header => header.addEventListener('click', () => {
    const table = header.closest('table').id; const key = header.dataset.key;
    sortState = sortState.table === table && sortState.key === key
        ? { table, key, direction: -sortState.direction } : { table, key, direction: 1 };
    if (current) render(current);
}));
load();
