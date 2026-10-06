'use strict';

function createTestSelectorController(root = document, { onClose = () => {}, standalone = false } = {}) {
    let profile = 'fast';
    let profileTests = [];
    const selected = new Set();
    let history = { tests: {} };
    const query = selector => root.querySelector(selector);
    const outcomeLabel = outcome => ({ pass: 'PASS', fail: 'FAIL', skip: 'SKIP', 'not-run': 'NOT RUN' }[outcome] || 'нет истории');
    const estimateSeconds = test => Math.max(1, Math.round((Number(test.expectedRefreshCount) || 0) * 3.2));
    const selectionForProfile = () => profileTests.filter(test => selected.has(test.id));

function createBadge(text, className = 'selector-badge') {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
}

function renderSummary() {
    const chosen = selectionForProfile();
    const seconds = chosen.reduce((sum, test) => sum + estimateSeconds(test), 0);
    const minutes = Math.ceil(seconds / 60);
    query('#selectorSummary').textContent = `Выбрано ${chosen.length} из ${profileTests.length} · ориентировочно ${minutes || 0} мин`;
    query('#selectorApply').disabled = chosen.length === 0;
}

function renderList() {
    const list = query('#selectorList');
    const search = query('#selectorSearch').value.trim().toLowerCase();
    const visible = profileTests.filter(test => [test.id, test.name, test.technicalName, test.description, ...(test.featureIds || [])]
        .join(' ').toLowerCase().includes(search));
    list.replaceChildren();
    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'selector-empty';
        empty.textContent = 'По этому запросу сценарии не найдены';
        list.appendChild(empty);
        renderSummary();
        return;
    }
    visible.forEach(test => {
        const card = document.createElement('article');
        card.className = 'selector-test';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(test.id);
        checkbox.setAttribute('aria-label', `Выбрать ${test.name}`);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(test.id); else selected.delete(test.id);
            renderSummary();
        });
        const body = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'selector-title';
        title.append(createBadge(test.id, 'selector-id'), document.createTextNode(test.name));
        (test.runModes || ['fast', 'full']).forEach(mode => title.appendChild(createBadge(mode === 'fast' ? 'Fast' : 'Full')));
        const description = document.createElement('p');
        description.className = 'selector-description';
        description.textContent = test.description || 'Причинная проверка DashBridge в живой Grafana.';
        body.append(title, description);
        const steps = test.steps || [];
        if (steps.length) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = `Что делает тест · ${steps.length} шагов`;
            const ordered = document.createElement('ol');
            steps.forEach(step => {
                const item = document.createElement('li');
                item.textContent = step.replace(/^\d+\.\s*/, '');
                ordered.appendChild(item);
            });
            details.append(summary, ordered);
            body.appendChild(details);
        }
        const meta = document.createElement('div');
        meta.className = 'selector-meta';
        meta.appendChild(document.createTextNode(`≈ ${estimateSeconds(test)} сек`));
        const previous = history.tests?.[test.id];
        if (previous?.outcome) meta.appendChild(createBadge(outcomeLabel(previous.outcome), `selector-outcome outcome-${previous.outcome}`));
        card.append(checkbox, body, meta);
        list.appendChild(card);
    });
    renderSummary();
}

function applyPreset(preset) {
    selected.clear();
    let candidates = [];
    if (preset === 'all') candidates = profileTests;
    if (preset === 'fast') candidates = profileTests.filter(test => test.runModes?.includes('fast'));
    if (preset === 'failed') candidates = profileTests.filter(test => history.tests?.[test.id]?.outcome === 'fail');
    if (preset === 'not-run') candidates = profileTests.filter(test => history.tests?.[test.id]?.outcome === 'not-run');
    candidates.forEach(test => selected.add(test.id));
    renderList();
    if (!candidates.length && ['failed', 'not-run'].includes(preset)) {
        query('#selectorStatus').textContent = 'В последнем запуске таких результатов нет';
    } else {
        query('#selectorStatus').textContent = '';
    }
}

async function load(mode = 'fast') {
    profile = mode === 'full' ? 'full' : 'fast';
    selected.clear();
    const suite = typeof DASHBRIDGE_TEST_SUITE === 'undefined' ? [] : DASHBRIDGE_TEST_SUITE;
    profileTests = suite.filter(test => !Array.isArray(test.runModes) || test.runModes.includes(profile));
    query('#selectorProfile').textContent = profile === 'full'
        ? `Полный профиль · доступно ${profileTests.length} сценариев`
        : `Быстрый профиль · доступно ${profileTests.length} сценариев`;
    const stored = await chrome.storage.local.get(['trTestSelection', 'trTestHistory']).catch(() => ({}));
    history = stored.trTestHistory && typeof stored.trTestHistory === 'object' ? stored.trTestHistory : { tests: {} };
    const saved = stored.trTestSelection;
    if (saved?.scope === 'selected' && Array.isArray(saved.ids)) saved.ids.forEach(id => selected.add(id));
    else profileTests.forEach(test => selected.add(test.id));
    renderList();
    query('#selectorSearch').value = '';
    renderList();
}

async function closeSelector() {
    const dialog = root.querySelector('dialog');
    if (dialog?.open) dialog.close('cancel');
    if (standalone) {
        try {
            const currentWindow = await chrome.windows.getCurrent();
            if (Number.isInteger(currentWindow?.id)) {
                await chrome.windows.remove(currentWindow.id);
                return;
            }
        } catch (_) { }
        window.close();
    }
    onClose();
}

async function saveSelection() {
        const ids = selectionForProfile().map(test => test.id);
        const allSelected = ids.length === profileTests.length;
        await chrome.storage.local.set({
            trTestSelection: allSelected ? { scope: 'all', ids: [] } : { scope: 'selected', ids },
        });
        await closeSelector();
}

function initTestSelector() {
    query('#selectorSearch').addEventListener('input', renderList);
    root.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
    query('#selectorClose').addEventListener('click', closeSelector);
    query('#selectorCancel').addEventListener('click', closeSelector);
    query('#selectorApply').addEventListener('click', saveSelection);
    root.addEventListener('cancel', event => { event.preventDefault(); closeSelector(); });
    root.addEventListener('click', event => {
        const dialog = root.querySelector('dialog');
        if (!dialog || event.target !== dialog || 'closedBy' in (globalThis.HTMLDialogElement?.prototype || {})) return;
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) closeSelector();
    });
    return Object.freeze({ open: async mode => {
        await load(mode);
        const dialog = root.querySelector('dialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
        query('#selectorSearch').focus();
    }, close: closeSelector });
}

    return initTestSelector();
}

if (document.getElementById('testSelectorDialog')) {
    window.DashBridgeTestSelector = createTestSelectorController(document);
} else {
    document.addEventListener('DOMContentLoaded', async () => {
        const controller = createTestSelectorController(document, { standalone: true });
        await controller.open(new URLSearchParams(location.search).get('mode'));
    });
}
