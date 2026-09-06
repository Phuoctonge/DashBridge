'use strict';

const byId = id => document.getElementById(id);
const labels = globalThis.DashBridgeAnalyticsLabels;
const filters = ['days', 'version', 'feature', 'signal', 'installation'];
const number = value => new Intl.NumberFormat('ru-RU').format(Number(value) || 0);
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
const hour = value => value ? new Date(value).toLocaleString('ru-RU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—';
const userLabel = id => id ? `Установка ${String(id).slice(0, 8)}…${String(id).slice(-4)}` : '—';
const featureName = id => labels.features[id] || id;
const signalName = signal => labels.signals[signal] || signal;
const failureOwners = Object.freeze({ runtime_dependency_missing: 'Расширение',
    visual_verification_failed: 'Расширение / совместимость с Grafana',
    legend_apply_failed: 'Совместимость с Grafana', timeout: 'Требуется анализ причины задержки',
    unexpected_exception: 'Расширение' });
let current = null;
let loadGeneration = 0;
let loadController = null;
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
            tr.title = 'Показать только действия этой установки';
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
        featureName: featureName(item.featureId), adoption: active ? Number(item.usedUsers) / active * 100 : 0,
    })), [
        { key: 'featureName', title: (_value, row) => row.featureId },
        { key: 'adoption', format: (value, row) => `${number(Math.round(value))}% (${number(row.usedUsers)} / ${number(active)})` },
        { key: 'usedUsers', format: number }, { key: 'configuredUsers', format: number },
        { key: 'effectiveUsers', format: number }, { key: 'successUsers', format: number },
        { key: 'issueUsers', format: number }, { key: 'events', format: number },
    ]);
    renderTable('problems', data.problems.map(item => ({ ...item,
        featureName: featureName(item.featureId), outcomeName: labels.values[item.outcome] || item.outcome,
        failureName: item.failure ? (labels.values[item.failure] || item.failure) : 'Не собиралась в этой версии',
        ownerName: ['invalid_input', 'auth_required', 'permission_denied', 'busy', 'unsupported_page'].includes(item.outcome)
            ? 'Требуется действие / проверка условий' : item.outcome === 'no_data' ? 'Нет данных'
                : item.outcome === 'partial' ? 'Частичный результат'
                    : item.failure ? (failureOwners[item.failure] || 'Требуется анализ') : 'Ошибка: требуется анализ',
    })), [
        { key: 'featureName', title: (_value, row) => row.featureId }, { key: 'version' },
        { key: 'outcomeName' }, { key: 'failureName' }, { key: 'ownerName' },
        { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    renderTable('versions', data.versions.map(item => ({ ...item,
        issueRate: Number(item.outcomes) ? Number(item.issues) / Number(item.outcomes) * 100 : 0,
    })), [
        { key: 'version' }, { key: 'users', format: number }, { key: 'events', format: number },
        { key: 'issues', format: number }, { key: 'issueRate', format: (value, row) => `${number(Math.round(value))}% (${number(row.issues)} / ${number(row.outcomes)})` },
        { key: 'lastSeen', format: date },
    ]);
    renderTable('installations', data.installations.map(item => ({ ...item, userLabel: userLabel(item.installationId) })), [
        { key: 'userLabel', title: (_value, row) => row.installationId }, { key: 'version' },
        { key: 'features', format: number }, { key: 'events', format: number }, { key: 'lastSeen', format: date },
    ], 'installationId');
    renderTable('dimensions', data.dimensions.map(item => ({ ...item,
        featureName: featureName(item.featureId), signalName: signalName(item.signal),
        details: parseDimensions(item.dimensions),
    })), [
        { key: 'featureName', title: (_value, row) => row.featureId }, { key: 'signalName' },
        { key: 'details' }, { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    const timeline = byId('timeline'); timeline.replaceChildren();
    timeline.classList.toggle('is-empty', data.timeline.length === 0);
    if (!data.timeline.length) {
        const empty = document.createElement('p'); empty.className = 'empty';
        empty.textContent = 'Нет данных для выбранных фильтров'; timeline.appendChild(empty);
    }
    const maximum = Math.max(1, ...data.timeline.map(item => Number(item.events)));
    data.timeline.forEach((item, index) => {
        const bar = document.createElement('div'); bar.className = 'bar';
        bar.style.height = `${Math.max(3, Number(item.events) / maximum * 100)}%`;
        const eventCount = number(item.events); const userCount = number(item.users);
        bar.setAttribute('aria-label', `${item.day}: сигналов ${eventCount}, установок ${userCount}`);
        const tooltip = document.createElement('span'); tooltip.className = 'bar-tooltip';
        const day = document.createElement('strong'); day.textContent = item.day;
        const totals = document.createElement('span');
        totals.textContent = `Сигналов: ${eventCount} · Установок: ${userCount}`;
        tooltip.append(day, totals); bar.appendChild(tooltip);
        bar.addEventListener('pointerenter', () => {
            tooltip.style.left = '50%'; tooltip.style.transform = 'translateX(-50%)';
            const timelineRect = timeline.getBoundingClientRect(); const barRect = bar.getBoundingClientRect();
            const tooltipWidth = tooltip.getBoundingClientRect().width;
            const centeredLeft = barRect.width / 2 - tooltipWidth / 2;
            const minimumLeft = timelineRect.left - barRect.left;
            const maximumLeft = timelineRect.right - barRect.left - tooltipWidth;
            tooltip.style.left = `${Math.min(Math.max(centeredLeft, minimumLeft), maximumLeft)}px`;
            tooltip.style.transform = 'none';
        });
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
    const limits = { actions: 1000, features: 500, problems: 500, installations: 500, dimensions: 500, versions: 100 };
    const capped = Object.entries(limits).filter(([key, limit]) => data[key]?.length >= limit).map(([key]) => byId(key).closest('section').querySelector('h2').textContent);
    byId('status').textContent = `Отчёт: ${date(data.generatedAt)} · загружен: ${date(new Date().toISOString())} · последнее событие: ${date(data.totals.lastPeriod)} · хранение ${data.retentionDays} дней`
        + (capped.length ? ` · Достигнут лимит, таблицы могут быть неполными: ${capped.join(', ')}` : '')
        + (selected ? ` · выбран ${userLabel(selected)}` : '');
    byId('status').className = '';
}

async function load() {
    const generation = ++loadGeneration;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    byId('status').textContent = 'Загрузка…'; byId('status').className = '';
    const query = new URLSearchParams();
    filters.forEach(id => { if (byId(id).value) query.set(id, byId(id).value); });
    try {
        const response = await fetch(`/admin/api/data?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (generation !== loadGeneration || controller.signal.aborted) return;
        render(data);
    } catch (error) {
        if (generation !== loadGeneration) return;
        byId('status').textContent = `Ошибка загрузки: ${error.message}`; byId('status').className = 'error';
    } finally {
        clearTimeout(timeout);
        if (generation === loadGeneration) loadController = null;
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
