'use strict';

const byId = id => document.getElementById(id);
const labels = globalThis.DashBridgeAnalyticsLabels;
const filters = ['days', 'version', 'feature', 'signal', 'installation', 'surface', 'outcome', 'renderer', 'failure'];
const tables = ['features', 'problems', 'versions', 'installations', 'actions', 'dimensions'];
const number = value => new Intl.NumberFormat('ru-RU').format(Number(value) || 0);
const date = value => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) : '—';
const hour = value => value ? new Date(value).toLocaleString('ru-RU', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—';
const userLabel = id => id ? `Установка ${String(id).slice(0, 8)}…${String(id).slice(-4)}` : '—';
const featureName = id => labels.features[id] || id;
const signalName = signal => labels.signals[signal] || signal;
const valueName = value => labels.values[value] || value || '—';
const failureOwners = { runtime_dependency_missing: 'Расширение', visual_verification_failed: 'Совместимость с Grafana',
    legend_apply_failed: 'Совместимость с Grafana', timeout: 'Проверить условия и задержку', unexpected_exception: 'Расширение' };
let current = null;
let loadGeneration = 0;
let loadController = null;
let appliedFilters = null;
const pages = {};
const sorts = {};

function parseDimensions(value, row = {}) {
    let parsed;
    try { parsed = JSON.parse(value || '{}'); } catch { return '—'; }
    return Object.entries(parsed).map(([key, item]) => {
        if (row.featureId === 'dashbridge.time_absolute_range_applied' && key === 'mode') {
            return 'Режим: устаревшая техническая категория';
        }
        const name = key === 'countBucket' && row.signal === 'configured' ? 'Объектов в снимке'
            : labels.dimensionNames[key] || key;
        return `${name}: ${valueName(String(item))}`;
    }).join(' · ') || '—';
}

function replaceOptions(id, values, label = value => value) {
    const select = byId(id); const selected = select.value;
    // Keep an unavailable selection explicit; silently clearing it would mislabel the response.
    select.replaceChildren(new Option('Все', ''));
    values.forEach(value => select.add(new Option(label(value), value)));
    if (selected && !values.includes(selected)) select.add(new Option(`${label(selected)} — нет данных за период`, selected));
    select.value = selected;
}

function showDetails(title, entries) {
    const dialog = byId('rowDetails');
    byId('rowDetailsTitle').textContent = title;
    const body = byId('rowDetailsBody'); body.replaceChildren();
    entries.forEach(([label, value]) => {
        const term = document.createElement('dt'); term.textContent = label;
        const description = document.createElement('dd'); description.textContent = value;
        body.append(term, description);
    });
    dialog.showModal();
}

function selectInstallation(installationId) {
    if (!installationId) return;
    byId('installation').value = installationId;
    resetPages();
    load();
    byId('filterPanel').open = true;
    byId('installation').focus();
}

function renderTable(id, rows, columns) {
    const table = byId(id); const body = table.querySelector('tbody'); body.replaceChildren();
    const headings = [...table.querySelectorAll('thead th')].map(th => th.textContent);
    if (!rows.length) {
        const row = document.createElement('tr'); const cell = document.createElement('td');
        cell.colSpan = columns.length + 1; cell.className = 'empty'; cell.textContent = 'Нет данных для выбранных фильтров';
        row.appendChild(cell); body.appendChild(row);
    }
    rows.forEach(row => {
        const tr = document.createElement('tr'); const entries = [];
        columns.forEach((column, index) => {
            const value = column.format ? column.format(row[column.key], row) : String(row[column.key] ?? '—');
            entries.push([headings[index], value]);
            const cell = document.createElement('td');
            if (column.key === 'installationId') {
                const button = document.createElement('button'); button.textContent = userLabel(row.installationId);
                button.title = row.installationId; button.addEventListener('click', () => selectInstallation(row.installationId));
                cell.appendChild(button);
            } else cell.textContent = value;
            if (column.key === 'featureId') cell.title = row.featureId;
            tr.appendChild(cell);
        });
        const detailCell = document.createElement('td'); const button = document.createElement('button');
        button.textContent = 'Подробнее';
        button.setAttribute('aria-label', `Подробнее: ${row.featureId ? featureName(row.featureId) : row.installationId ? userLabel(row.installationId) : row.version}`);
        button.addEventListener('click', () => showDetails(table.caption.textContent, entries));
        detailCell.appendChild(button); tr.appendChild(detailCell); body.appendChild(tr);
    });
    table.querySelectorAll('th[data-key]').forEach(th => {
        const sort = sorts[id];
        th.setAttribute('aria-sort', sort?.key === th.dataset.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const navigation = byId(`${id}Pages`); navigation.replaceChildren();
    const meta = current.pagination?.[id];
    if (!meta) return;
    pages[id] = meta.page;
    const previous = document.createElement('button'); previous.textContent = '← Назад'; previous.disabled = meta.page === 0;
    const next = document.createElement('button'); next.textContent = 'Далее →'; next.disabled = !meta.hasMore;
    const status = document.createElement('span');
    status.textContent = `${number(meta.total ? meta.page * meta.pageSize + 1 : 0)}–${number(Math.min(meta.total, (meta.page + 1) * meta.pageSize))} из ${number(meta.total)}`;
    previous.addEventListener('click', () => { pages[id] = meta.page - 1; load({ focusTable: id }); });
    next.addEventListener('click', () => { pages[id] = meta.page + 1; load({ focusTable: id }); });
    navigation.append(previous, status, next);
}

function renderTimeline(data) {
    const timeline = byId('timeline'); timeline.replaceChildren();
    const rows = data.timeline || [];
    const body = byId('timelineData').querySelector('tbody'); body.replaceChildren();
    rows.forEach(row => {
        const tr = document.createElement('tr');
        [row.day, number(row.events), number(row.users)].forEach(value => {
            const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
        });
        body.appendChild(tr);
    });
    const step = rows.length > 60 ? 7 : 1;
    const buckets = [];
    for (let index = 0; index < rows.length; index += step) {
        const chunk = rows.slice(index, index + step);
        buckets.push({ from: chunk[0].day, to: chunk.at(-1).day, events: chunk.reduce((sum, day) => sum + Number(day.events), 0) });
    }
    const maximum = Math.max(1, ...buckets.map(row => row.events));
    byId('timelineHint').textContent = `${step === 7 ? 'Группы по 7 дней' : 'Календарные дни'} UTC, включая текущий неполный день. Шкала сигналов: 0–${number(maximum)}. Нажмите столбик для точного значения; полная дневная таблица ниже.`;
    buckets.forEach(row => {
        const column = document.createElement('div'); column.className = 'day-column';
        const plot = document.createElement('div'); plot.className = 'plot';
        const bar = document.createElement('button'); bar.className = `bar${row.events ? '' : ' zero'}`;
        bar.style.setProperty('--bar-height', `${row.events ? Math.max(2, row.events / maximum * 100) : 1}%`);
        const period = row.from === row.to ? row.from : `${row.from} — ${row.to}`;
        bar.setAttribute('aria-label', `${period}, UTC: ${number(row.events)} сигналов`);
        bar.title = `${period}: ${number(row.events)}`;
        bar.addEventListener('click', () => showDetails('Активность, UTC', [['Период', period], ['Сигналы', number(row.events)], ['Примечание', 'Нет сигналов не означает доказанное отсутствие активности: доставка может задерживаться.']]));
        const label = document.createElement('span'); label.className = 'day-label'; label.textContent = `${row.from.slice(8)}.${row.from.slice(5, 7)}`;
        plot.appendChild(bar); column.append(plot, label); timeline.appendChild(column);
    });
}

function render(data) {
    current = data;
    byId('totalUsers').textContent = number(data.totals.installations);
    byId('totalEvents').textContent = number(data.totals.events);
    byId('totalAggregates').textContent = number(data.totals.aggregates);
    byId('databaseSize').textContent = `${number(data.databaseUsedMiB)} / ${number(data.databaseLimitMiB)} MiB`;
    replaceOptions('version', data.filterOptions.versions.map(item => item.value));
    replaceOptions('feature', data.filterOptions.features.map(item => item.value), featureName);
    replaceOptions('installation', data.filterOptions.installations.map(item => item.value), userLabel);
    const active = Number(data.totals.activeInstallations) || 0;
    const signalCount = (signal, value, row) => !row.supportedSignals?.includes(signal) ? '—'
        : appliedFilters?.signal && appliedFilters.signal !== signal ? '— (фильтр)' : number(value);
    renderTable('features', data.features, [
        { key: 'featureId', format: featureName },
        { key: 'users', format: value => active ? `${number(Math.round(value / active * 100))}% (${number(value)} / ${number(active)})` : 'Нет данных' },
        { key: 'usedUsers', format: (value, row) => signalCount('used', value, row) },
        { key: 'configuredUsers', format: (value, row) => signalCount('configured', value, row) },
        { key: 'effectiveUsers', format: (value, row) => signalCount('effective', value, row) },
        { key: 'successUsers', format: (value, row) => signalCount('outcome', value, row) },
        { key: 'issueUsers', format: (value, row) => signalCount('outcome', value, row) }, { key: 'events', format: number },
    ]);
    renderTable('problems', data.problems, [
        { key: 'featureId', format: featureName }, { key: 'version' }, { key: 'outcome', format: valueName },
        { key: 'failure', format: value => value ? valueName(value) : 'Причина не передана' },
        { key: 'failure', format: (value, row) => ['invalid_input', 'auth_required', 'permission_denied', 'busy', 'unsupported_page'].includes(row.outcome)
            ? 'Проверить условия' : row.outcome === 'no_data' ? 'Нет данных' : row.outcome === 'partial' ? 'Частичный результат' : failureOwners[value] || 'Требуется анализ' },
        { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    renderTable('versions', data.versions, [
        { key: 'version' }, { key: 'users', format: number }, { key: 'events', format: number }, { key: 'issues', format: number },
        { key: 'outcomes', format: (value, row) => value ? `${number(Math.round(row.issues / value * 100))}% (${number(row.issues)} / ${number(value)})` : 'Нет результатов' },
        { key: 'lastSeen', format: date },
    ]);
    renderTable('installations', data.installations, [
        { key: 'installationId' }, { key: 'version', format: value => String(value).split(',').sort().join(', ') },
        { key: 'latestVersion', format: value => value ? String(value).split(',').sort().join(', ') : '—' },
        { key: 'features', format: number }, { key: 'events', format: number }, { key: 'lastSeen', format: date },
    ]);
    renderTable('actions', data.actions, [
        { key: 'periodStart', format: hour }, { key: 'installationId' }, { key: 'featureId', format: featureName },
        { key: 'signal', format: signalName }, { key: 'dimensions', format: parseDimensions }, { key: 'events', format: number }, { key: 'version' },
    ]);
    renderTable('dimensions', data.dimensions, [
        { key: 'featureId', format: featureName }, { key: 'signal', format: signalName },
        { key: 'dimensions', format: parseDimensions }, { key: 'users', format: number }, { key: 'events', format: number },
    ]);
    renderTimeline(data);
    const ops = data.operations || {};
    const operations = byId('operations'); operations.replaceChildren();
    [['Успешных пачек', ops.acceptedBatches], ['Отклонённых пачек', ops.rejectedBatches], ['Принято агрегатов', ops.acceptedAggregates],
        ['Потеряно клиентской очередью', ops.clientDroppedAggregates], ['Ограничено по частоте', ops.rateLimitRejections],
        ['Отклонено из-за размера базы', ops.storageRejections]].forEach(([title, value]) => {
        const p = document.createElement('p'); p.textContent = `${title}: ${number(value)}`; operations.appendChild(p);
    });
    const ingest = document.createElement('p'); ingest.textContent = `Последний приём, UTC: ${date(ops.lastSuccessfulIngest)}`; operations.appendChild(ingest);
    const environment = byId('environment'); environment.hidden = data.environment?.mode !== 'development';
    if (!environment.hidden) environment.textContent = `DEV · ${data.environment.scenario || 'Локальная база без метаданных синтетики'} · fixtures ${data.environment.fixtureVersion || 'неизвестны'} · создано, UTC: ${date(data.environment.createdAt)}`;
    byId('status').textContent = `Отчёт, UTC: ${date(data.generatedAt)} · период: ${date(data.range?.from)} — ${date(data.range?.to)} · последний сигнал: ${date(data.totals.lastPeriod)} · хранение ${data.retentionDays} дней`;
    byId('status').className = '';
}

function resetPages() { tables.forEach(id => { pages[id] = 0; }); }

async function load(options = {}) {
    const generation = ++loadGeneration;
    loadController?.abort();
    const controller = new AbortController(); loadController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const requestedFilters = Object.fromEntries(filters.map(id => [id, byId(id).value]));
    byId('status').textContent = 'Загрузка…'; byId('status').className = '';
    byId('dataWarning').hidden = !current;
    byId('dataWarning').textContent = 'Обновляется. Ниже показан прежний отчёт; новые фильтры ещё не применены.';
    byId('report').setAttribute('aria-busy', 'true');
    const query = new URLSearchParams();
    Object.entries(requestedFilters).forEach(([id, value]) => { if (value) query.set(id, value); });
    tables.forEach(id => {
        if (pages[id]) query.set(`${id}Page`, pages[id]);
        if (sorts[id]) { query.set(`${id}Sort`, sorts[id].key); query.set(`${id}Direction`, sorts[id].direction); }
    });
    try {
        const response = await fetch(`/admin/api/data?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (generation !== loadGeneration || controller.signal.aborted) return;
        appliedFilters = requestedFilters;
        render(data);
        byId('dataWarning').hidden = true;
        if (options.focusTable) byId(options.focusTable).closest('.table-wrap').focus();
    } catch (error) {
        if (generation !== loadGeneration) return;
        byId('status').textContent = `Не удалось обновить отчёт: ${controller.signal.aborted ? 'тайм-аут' : error.message}`;
        byId('status').className = 'error';
        byId('dataWarning').hidden = !current;
        byId('dataWarning').textContent = `Показаны прежние данные от ${date(current?.generatedAt)} UTC. Фильтры на экране могут не соответствовать отчёту. Повторите обновление.`;
    } finally {
        clearTimeout(timeout);
        if (generation === loadGeneration) { loadController = null; byId('report').setAttribute('aria-busy', 'false'); }
    }
}

filters.forEach(id => byId(id).addEventListener('change', () => { resetPages(); load(); }));
byId('refresh').addEventListener('click', () => load());
byId('reset').addEventListener('click', () => {
    filters.forEach(id => { byId(id).value = id === 'days' ? '30' : ''; }); resetPages(); load();
});
document.querySelectorAll('th[data-key] .sort').forEach(button => button.addEventListener('click', () => {
    const header = button.closest('th'); const table = header.closest('table').id; const key = header.dataset.key;
    sorts[table] = { key, direction: sorts[table]?.key === key && sorts[table].direction === 'asc' ? 'desc' : 'asc' };
    pages[table] = 0; load({ focusTable: table });
}));
if (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches) byId('filterPanel').open = false;
load();
