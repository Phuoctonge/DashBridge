(function initConfluenceReportPage(root) {
    'use strict';

    const archiveInput = document.getElementById('archiveInput');
    const archiveStatus = document.getElementById('archiveStatus');
    const liveStatus = document.getElementById('liveStatus');
    const pageUrlInput = document.getElementById('pageUrlInput');
    const scanLiveButton = document.getElementById('scanLiveButton');
    const summaryCard = document.getElementById('summaryCard');
    const previewCard = document.getElementById('previewCard');
    const archiveCard = document.getElementById('archiveCard');
    const metricSelect = document.getElementById('metricSelect');
    const targetTree = document.getElementById('targetTree');
    const previewStatus = document.getElementById('previewStatus');
    const previewList = document.getElementById('previewList');
    const archiveAnalysis = document.getElementById('archiveAnalysis');
    const archiveSummary = document.getElementById('archiveSummary');
    const archiveRangeRows = document.getElementById('archiveRangeRows');
    const archiveTestRows = document.getElementById('archiveTestRows');
    const archivePanelRows = document.getElementById('archivePanelRows');
    const operationAction = document.getElementById('operationAction');
    const operationSource = document.getElementById('operationSource');
    const operationTarget = document.getElementById('operationTarget');
    const operationScope = document.getElementById('operationScope');
    const operationCaption = document.getElementById('operationCaption');
    const operationAnchor = document.getElementById('operationAnchor');
    const operationTestPicker = document.getElementById('operationTestPicker');
    const operationList = document.getElementById('operationList');
    const addOperationButton = document.getElementById('addOperationButton');
    const mappingBoardCard = document.getElementById('mappingBoardCard');
    const mappingBoard = document.getElementById('mappingBoard');
    const mappingTargets = document.getElementById('mappingTargets');
    const mappingSources = document.getElementById('mappingSources');
    const mappingLinks = document.getElementById('mappingLinks');
    const mappingBoardStatus = document.getElementById('mappingBoardStatus');
    const clearConnectionsButton = document.getElementById('clearConnectionsButton');
    const applyConfluenceButton = document.getElementById('applyConfluenceButton');
    const testCount = document.getElementById('testCount');
    const imageCount = document.getElementById('imageCount');
    const targetCount = document.getElementById('targetCount');
    const pageStatus = document.getElementById('pageStatus');
    let controller = null;
    let archive = null;
    let liveResult = null;
    let metricOptions = [];
    let selectedTargets = new Set();
    let archiveAnalysisData = null;
    const archivePanelMappings = new Map();
    let operations = [];
    let connections = [];
    let draggedSourceKey = null;
    let draggedAddedItem = null;
    let createdWindowId = null;
    let customSections = [];
    let customGraphs = [];
    const uploadedAttachments = new Map();

    function invalidateSources() {
        archive = null;
        archiveAnalysisData = null; archivePanelMappings.clear();
        archiveInput.value = '';
        archiveInput.disabled = true;
        archiveCard.hidden = true;
        archiveAnalysis.hidden = true;
        operations = []; operationList.replaceChildren();
        connections = []; mappingBoardCard.hidden = true;
        customSections = []; customGraphs = [];
        previewCard.hidden = true;
        previewList.replaceChildren();
        setStatus(archiveStatus, 'Сначала просканируйте страницу и выберите цели.');
        targetCount.textContent = '0';
    }

    const setStatus = (element, value, error = false) => {
        element.textContent = value;
        element.toggleAttribute('data-error', error);
    };
    const countImages = snapshot => (snapshot?.tests || []).reduce((sum, test) => sum + test.groups.reduce((groupSum, group) => groupSum + group.images.length, 0), 0);
    const pageIdFromUrl = value => new URL(value).searchParams.get('pageId');

    function validatePageUrl(value) {
        const url = new URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL должен быть HTTP(S) без логина и пароля');
        if (!pageIdFromUrl(url.href)) throw new Error('В URL не найден параметр pageId');
        return url;
    }

    async function openVisibleConfluenceWindow(url, signal) {
        createdWindowId = null;
        const created = await chrome.windows.create({ url: url.href, type: 'normal', focused: true });
        const tab = created?.tabs?.[0];
        if (!tab?.id) throw new Error('Не удалось открыть отдельное окно Confluence');
        createdWindowId = created.id ?? null;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const current = await chrome.tabs.get(tab.id).catch(() => null);
            if (current?.status === 'complete') return current;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('Confluence не завершил загрузку за 30 секунд');
    }

    async function closeCreatedConfluenceWindow() {
        const windowId = createdWindowId;
        createdWindowId = null;
        if (windowId == null) return;
        await chrome.windows.remove(windowId).catch(() => undefined);
    }

    async function fetchFromTab(tabId, url, signal) {
        const [execution] = await chrome.scripting.executeScript({
            target: { tabId },
            func: async requestUrl => {
                const response = await fetch(requestUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                let data = null;
                try { data = await response.json(); } catch { /* preserve status for a useful error */ }
                return { ok: response.ok, status: response.status, url: response.url, data };
            },
            args: [url],
        });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const result = execution?.result;
        if (!result?.ok) throw new Error(`Confluence request failed (${result?.status || 'unknown'})`);
        return { ok: true, status: result.status, url: result.url, json: async () => result.data };
    }

    async function requestTab(tabId, request, signal) {
        // chrome.scripting arguments use structured-clone serialization, but
        // ArrayBuffer is rejected by some Chromium builds. Send attachment
        // bytes as a bounded plain array and rebuild the buffer in MAIN.
        const serializableRequest = { ...request };
        if (request?.bytes instanceof ArrayBuffer) {
            serializableRequest.bytes = [...new Uint8Array(request.bytes)];
        }
        const [execution] = await chrome.scripting.executeScript({ target: { tabId }, func: async input => { const headers = { Accept: 'application/json', ...(input.headers || {}) }; const init = { method: input.method || 'GET', credentials: 'same-origin', headers }; if (input.json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(input.json); } if (Array.isArray(input.bytes)) { const form = new FormData(); form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.contentType || 'application/octet-stream' }), input.filename); init.body = form; delete headers['Content-Type']; } const response = await fetch(input.url, init); let data = null; try { data = await response.json(); } catch { /* empty response */ } return { ok: response.ok, status: response.status, data }; }, args: [serializableRequest] });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); const result = execution?.result; if (!result?.ok) throw new Error(`Confluence request failed (${result?.status || 'unknown'})`); return result.data;
    }

    function sourceForKey(sourceKey) { const parts = String(sourceKey || '').split('\0'); const panelId = parts.at(-2); const title = parts.at(-1); return archiveAnalysisData?.ranges.flatMap(range => range.panels).find(panel => String(panel.panelId || '') === panelId && panel.title === title)?.source || null; }
    function buildApplyPlan() { const replacements = []; const additions = []; const targets = liveResult?.snapshot?.tests?.flatMap(test => test.groups.flatMap(group => group.images.map(image => ({ test, group, image })))); const findSource = key => { const source = sourceForKey(key); return source?.path?.replace(/\\/g, '/').split('/').at(-1) || null; }; for (const link of connections) { const filename = findSource(link.sourceKey); if (!filename) continue; const parts = link.targetKey.split('\0'); if (link.targetKey.startsWith('metric\0')) { const groupTitle = parts[1]; const metric = parts[2]; for (const item of targets.filter(candidate => candidate.group.title === groupTitle && (candidate.image.captionLead || candidate.image.caption || '').toLocaleLowerCase('ru-RU') === metric)) if (item.image.imageReference.filename) replacements.push({ oldFilename: item.image.imageReference.filename, newFilename: filename }); } else if (link.targetKey.startsWith('added-')) { const section = customSections.find(candidate => candidate.items.some(item => item.targetKey === link.targetKey)); const item = [...customGraphs, ...customSections.flatMap(section => section.items)].find(candidate => candidate.targetKey === link.targetKey); if (item) { const groupTitle = section?.groupTitle || item.groupTitle || null; const isNewGroup = link.targetKey.startsWith('added-group'); additions.push({ newFilename: filename, caption: item.caption, insertion: { kind: isNewGroup ? 'group' : (groupTitle ? 'group-item' : 'section'), testKey: parts[1] || item.testKey || '', testTitle: liveResult?.snapshot?.tests?.find(test => test.testKey === (parts[1] || item.testKey))?.title || '', groupTitle, beforeFilename: item.insertionBeforeFilename || null, sectionTitle: section?.title || (isNewGroup ? 'Новая группа' : 'Новый раздел') } }); } } else { const target = targets.find(candidate => [candidate.test.testKey, candidate.group.title, (candidate.image.captionLead || candidate.image.caption || '').toLocaleLowerCase('ru-RU'), candidate.image.occurrence].join('\0') === link.targetKey); if (target?.image.imageReference.filename) replacements.push({ oldFilename: target.image.imageReference.filename, newFilename: filename }); } } return { replacements, additions }; }

    function createLiveClient(tabId) {
        return root.DashBridgeConfluenceReportLiveClient.create({
            schema: root.DashBridgeConfluenceReportLiveSchema,
            fetchRef: (url, options = {}) => fetchFromTab(tabId, url, options.signal),
            scanner: root.DashBridgeConfluenceReportScanner,
        });
    }

    function selectedMetric() {
        const index = Number(metricSelect.value);
        return Number.isInteger(index) ? metricOptions[index] || null : null;
    }

    function renderTargetTree(snapshot) {
        targetTree.replaceChildren();
        selectedTargets = new Set();
        for (const test of snapshot.tests) {
            const testDetails = document.createElement('details'); testDetails.open = true; testDetails.className = 'target-test';
            const testSummary = document.createElement('summary'); testSummary.textContent = `${test.title} (${test.groups.reduce((n, g) => n + g.images.length, 0)})`; testDetails.append(testSummary);
            for (const group of test.groups) {
                const groupDetails = document.createElement('details'); groupDetails.open = true; groupDetails.className = 'target-group';
                const groupSummary = document.createElement('summary'); groupSummary.textContent = `${group.title || 'Без группы'} (${group.images.length})`; groupDetails.append(groupSummary);
                for (const image of group.images) {
                    const key = `${test.testKey}:${group.title}:${image.occurrence}`; const label = document.createElement('label'); label.className = 'target-image';
                    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.targetKey = key;
                    checkbox.addEventListener('change', () => { if (checkbox.checked) selectedTargets.add(key); else selectedTargets.delete(key); updateTargetSelection(); });
                    const text = document.createElement('span'); text.textContent = image.captionLead || image.imageReference.filename || image.imageReference.src || `Изображение ${image.occurrence + 1}`; label.append(checkbox, text); groupDetails.append(label);
                }
                groupDetails.querySelector('summary').addEventListener('click', event => { if (event.altKey) groupDetails.querySelectorAll('input').forEach(input => { input.checked = !input.checked; input.dispatchEvent(new Event('change')); }); });
                testDetails.append(groupDetails);
            }
            targetTree.append(testDetails);
        }
    }

    function renderArchiveAnalysis() {
        archiveRangeRows.replaceChildren(); archiveTestRows.replaceChildren(); archivePanelRows.replaceChildren();
        if (!archiveAnalysisData) { archiveAnalysis.hidden = true; return; }
        archiveAnalysis.hidden = false;
        renderMappingBoard();
        archiveSummary.textContent = `${archiveAnalysisData.ranges.length} диапазонов · ${archiveAnalysisData.captureCount} файлов`;
        operationSource.replaceChildren();
        for (const panel of archiveAnalysisData.panels) { const option = document.createElement('option'); option.value = `${panel.panelId || ''}\0${panel.title}`; option.textContent = `${panel.title}${panel.panelId ? ` · panel ${panel.panelId}` : ''} (${archiveAnalysisData.ranges.filter(range => range.panels.some(item => item.panelId === panel.panelId && item.title === panel.title)).length})`; operationSource.append(option); }
        operationTarget.replaceChildren();
        for (const item of metricOptions) { const option = document.createElement('option'); option.value = item.metric; option.textContent = `${item.metricGroup} → ${item.metric}`; operationTarget.append(option); }
        if (!operations.length) {
            const suggestions = archiveAnalysisData.panels.map(panel => { const title = panel.title.toLocaleLowerCase('ru-RU'); const target = metricOptions.find(item => (title.includes('cpu') && item.metric.includes('cpu')) || (title.includes('memory') && item.metric.includes('памят')) || (title.includes('load average') && item.metric.includes('загруж'))); return target ? root.DashBridgeConfluenceReportOperations.create({ action: 'replace', sourceKey: `${panel.panelId || ''}\0${panel.title}`, targetMetric: target.metric, scope: 'all' }) : null; }).filter(Boolean); operations = suggestions; }
        operationTestPicker.replaceChildren();
        for (const test of (liveResult?.snapshot.tests || [])) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = test.testKey; input.checked = true; label.append(input, document.createTextNode(test.title)); operationTestPicker.append(label); }
        renderOperationControls(); renderOperations();
        for (const range of archiveAnalysisData.ranges) {
            const row = document.createElement('tr'); const name = document.createElement('td'); name.textContent = range.label; const panels = document.createElement('td'); panels.textContent = range.panels.map(panel => `${panel.title} (${panel.panelId || '?'})`).join(', '); const count = document.createElement('td'); count.textContent = String(range.panelCount); row.append(name, panels, count); archiveRangeRows.append(row);
        }
        for (const [index, test] of (liveResult?.snapshot.tests || []).entries()) {
            const row = document.createElement('tr'); const title = document.createElement('td'); title.textContent = test.title; const cell = document.createElement('td'); const select = document.createElement('select'); select.name = `archive-test-${test.testKey}`; const automatic = archiveAnalysisData.ranges[index]; const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Не назначен'; select.append(empty);
            for (const range of archiveAnalysisData.ranges) { const option = document.createElement('option'); option.value = range.rangeKey; option.textContent = `${range.rangeIndex ? `${range.rangeIndex}. ` : ''}${range.label}`; option.selected = range === automatic; select.append(option); }
            cell.append(select); row.append(title, cell); archiveTestRows.append(row);
        }
        for (const panel of archiveAnalysisData.panels) {
            const row = document.createElement('tr'); const title = document.createElement('td'); title.textContent = `${panel.title}${panel.panelId ? ` · ID ${panel.panelId}` : ''}`; const targetCell = document.createElement('td'); const select = document.createElement('select'); select.name = `archive-panel-${panel.panelId || panel.title}`; const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Не сопоставлять'; select.append(empty);
            for (const optionData of metricOptions) { const option = document.createElement('option'); option.value = optionData.metric; option.textContent = `${optionData.metricGroup} → ${optionData.metric}`; select.append(option); }
            select.addEventListener('change', () => { const key = `${panel.panelId || ''}\0${panel.title}`; if (select.value) archivePanelMappings.set(key, select.value); else archivePanelMappings.delete(key); setStatus(archiveStatus, select.value ? `Панель «${panel.title}» сопоставлена с «${select.value}».` : 'Сопоставление панели снято.'); renderPreview(); }); targetCell.append(select); const ranges = document.createElement('td'); ranges.textContent = String(archiveAnalysisData.ranges.filter(range => range.panels.some(item => item.panelId === panel.panelId && item.title === panel.title)).length); row.append(title, targetCell, ranges); archivePanelRows.append(row);
        }
    }

    function appendMappingGrip(node, item, ownerSection = null, batchItems = null) { const grip = document.createElement('span'); grip.className = 'mapping-target-grip'; grip.textContent = '⠿'; grip.draggable = true; grip.setAttribute('role', 'button'); grip.setAttribute('aria-label', 'Переместить добавленную панель'); grip.title = 'Перетащить панель в промежуток между графиками'; grip.addEventListener('dragstart', event => { draggedAddedItem = { item, ownerSection, batchItems }; event.dataTransfer?.setData('text/plain', item.targetKey); event.dataTransfer?.setDragImage(node, Math.max(0, node.clientWidth - 20), Math.round(node.clientHeight / 2)); mappingBoard.classList.add('mapping-reorder-active'); mappingBoardStatus.textContent = batchItems?.length > 1 ? 'Отпустите общую панель в промежуток между графиками.' : 'Отпустите панель в промежуток между графиками.'; }); grip.addEventListener('dragend', () => { draggedAddedItem = null; mappingBoard.classList.remove('mapping-reorder-active'); }); node.append(grip); }
    function createReorderDropzone(groupNode, test, group, beforeFilename = null) { const zone = document.createElement('div'); zone.className = 'mapping-reorder-dropzone'; zone.setAttribute('aria-label', beforeFilename ? 'Вставить панель перед этим графиком' : 'Вставить панель в конец группы'); zone.addEventListener('dragover', event => { if (!draggedAddedItem) return; event.preventDefault(); zone.classList.add('mapping-drop-active'); }); zone.addEventListener('dragleave', () => zone.classList.remove('mapping-drop-active')); zone.addEventListener('drop', event => { if (!draggedAddedItem) return; event.preventDefault(); zone.classList.remove('mapping-drop-active'); moveAddedItem({ kind: 'group', testKey: test.testKey, groupTitle: group.title, beforeFilename }); }); groupNode.append(zone); return zone; }
    function moveAddedItem(target) { if (!draggedAddedItem || !target) return false; const { item, ownerSection, batchItems = [item] } = draggedAddedItem; const moving = batchItems.length ? batchItems : [item]; if (ownerSection) ownerSection.items = ownerSection.items.filter(candidate => !moving.includes(candidate)); else customGraphs = customGraphs.filter(candidate => !moving.includes(candidate)); for (const entry of moving) delete entry.insertionBeforeFilename; if (target.kind === 'section') { const index = target.section.items.indexOf(target.beforeItem); target.section.items.splice(index < 0 ? target.section.items.length : index, 0, ...moving); } else { for (const entry of moving) { if (moving.length === 1) entry.testKey = target.testKey || entry.testKey; entry.groupTitle = target.groupTitle; if (moving.length === 1 && target.beforeFilename) entry.insertionBeforeFilename = target.beforeFilename; } const index = customGraphs.indexOf(target.beforeItem); customGraphs.splice(index < 0 ? customGraphs.length : index, 0, ...moving); } draggedAddedItem = null; mappingBoard.classList.remove('mapping-reorder-active'); mappingBoardStatus.textContent = moving.length > 1 ? 'Общая панель перемещена во всех тестах.' : 'Панель перемещена. Изменения будут применены при сохранении.'; applyConfluenceButton.disabled = false; renderMappingBoard(); return true; }
    function renderMappingBoard() {
        if (!liveResult?.snapshot || !archiveAnalysisData) { mappingBoardCard.hidden = true; return; }
        mappingBoardCard.hidden = false; const aggregateOpen = mappingSources.querySelector('.mapping-aggregates')?.open ?? false; mappingTargets.replaceChildren(); mappingSources.replaceChildren();
        const targetRecords = liveResult.snapshot.tests.flatMap(test => test.groups.flatMap(group => group.images.map(image => ({ test, group, image }))));
        const metrics = new Map(); const criteriaGroups = new Map();
        for (const item of targetRecords) { const metric = item.image.captionLead || item.image.caption || 'Без подписи'; const groupTitle = item.group.title || 'Без раздела'; const key = `metric\0${groupTitle}\0${metric.toLocaleLowerCase('ru-RU')}`; if (!metrics.has(key)) { metrics.set(key, { key, metric, groupTitle, count: 0, occurrences: [] }); if (!criteriaGroups.has(groupTitle)) criteriaGroups.set(groupTitle, []); criteriaGroups.get(groupTitle).push(metrics.get(key)); } metrics.get(key).count += 1; metrics.get(key).occurrences.push(item); }
        for (const range of archiveAnalysisData.ranges) { const rangeNode = document.createElement('details'); rangeNode.open = false; rangeNode.className = 'mapping-range'; const summary = document.createElement('summary'); summary.textContent = `${range.rangeIndex ? `${range.rangeIndex}. ` : ''}${range.label} (${range.panels.length})`; rangeNode.append(summary); for (const panel of range.panels) { const node = document.createElement('div'); node.className = 'mapping-node source-node'; node.draggable = true; node.dataset.sourceKey = `${range.rangeKey}\0${panel.panelId || ''}\0${panel.title}`; node.textContent = `${panel.title}${panel.panelId ? ` · panel ${panel.panelId}` : ''}`; node.addEventListener('dragstart', () => { draggedSourceKey = node.dataset.sourceKey; mappingBoardStatus.textContent = 'Отпустите панель на пунктирной зоне справа.'; mappingBoard.classList.add('mapping-drag-active'); }); node.addEventListener('dragend', () => { draggedSourceKey = null; mappingBoard.classList.remove('mapping-drag-active'); }); rangeNode.append(node); } mappingSources.append(rangeNode); }
        for (const test of liveResult.snapshot.tests) { const testNode = document.createElement('details'); testNode.open = true; testNode.className = 'mapping-test'; const summary = document.createElement('summary'); summary.textContent = test.title; testNode.append(summary); for (const group of test.groups) { const groupNode = document.createElement('details'); groupNode.open = true; groupNode.className = 'mapping-group'; const groupSummary = document.createElement('summary'); groupSummary.textContent = group.title; groupNode.append(groupSummary); groupNode.addEventListener('dragover', event => { if (draggedAddedItem) event.preventDefault(); }); groupNode.addEventListener('drop', event => { if (draggedAddedItem) { event.preventDefault(); moveAddedItem({ kind: 'group', testKey: test.testKey, groupTitle: group.title }); } }); for (const image of group.images) { const node = document.createElement('div'); node.className = 'mapping-node target-node specific-node'; node.dataset.targetKey = [test.testKey, group.title, (image.captionLead || image.caption || '').toLocaleLowerCase('ru-RU'), image.occurrence].join('\0'); node.dataset.mode = 'specific'; node.textContent = image.captionLead || image.caption || 'Без подписи'; node.addEventListener('dragover', event => event.preventDefault()); node.addEventListener('drop', event => { if (draggedAddedItem) { event.preventDefault(); moveAddedItem({ kind: 'group', testKey: test.testKey, groupTitle: group.title, beforeFilename: image.imageReference?.filename }); } else connectDragged(node); }); groupNode.append(node); } appendInlineGraphItems(groupNode, test, group); appendInlineSections(groupNode, test, group.title); const addGraph = document.createElement('div'); addGraph.className = 'mapping-add-graph'; addGraph.textContent = '＋ Добавить график'; addGraph.addEventListener('dragover', event => event.preventDefault()); addGraph.addEventListener('drop', () => createInlineGraph(addGraph, test, group)); groupNode.append(addGraph); const addGroup = document.createElement('div'); addGroup.className = 'mapping-add-section mapping-add-group'; addGroup.textContent = '＋ Добавить группу сюда'; addGroup.addEventListener('dragover', event => event.preventDefault()); addGroup.addEventListener('drop', () => createInlineGroup(addGroup, test, group)); groupNode.append(addGroup); testNode.append(groupNode); } appendInlineSections(testNode, test, null); const addSection = document.createElement('div'); addSection.className = 'mapping-add-section'; addSection.textContent = '＋ Добавить новый раздел'; addSection.addEventListener('dragover', event => event.preventDefault()); addSection.addEventListener('drop', () => createInlineSection(addSection, test)); testNode.append(addSection); mappingTargets.append(testNode); }
        const criteriaNode = document.createElement('details'); criteriaNode.className = 'mapping-criteria';
        const criteriaSummary = document.createElement('summary'); criteriaSummary.textContent = `Общие критерии (${metrics.size})`; criteriaNode.append(criteriaSummary);
        for (const [groupTitle, groupMetrics] of criteriaGroups) { const criteriaGroup = document.createElement('details'); criteriaGroup.open = true; criteriaGroup.className = 'mapping-criteria-group'; const groupSummary = document.createElement('summary'); groupSummary.textContent = `${groupTitle} (${groupMetrics.reduce((sum, item) => sum + item.count, 0)})`; criteriaGroup.append(groupSummary); for (const item of groupMetrics) { const node = document.createElement('div'); node.className = 'mapping-node target-node group-node'; node.dataset.targetKey = item.key; node.dataset.mode = 'group'; node.textContent = `${item.metric} (${item.count})`; node.addEventListener('dragover', event => event.preventDefault()); node.addEventListener('drop', () => connectDragged(node)); criteriaGroup.append(node); } const wide = customGraphs.find(item => item.criteriaWide && item.groupTitle === groupTitle); if (wide) criteriaGroup.append(renderAddedGraph(wide, null, customGraphs.filter(item => item.criteriaWideId === wide.criteriaWideId))); const addGraph = document.createElement('div'); addGraph.className = 'mapping-add-graph mapping-criteria-add-graph'; addGraph.textContent = '＋ Добавить график во все тесты'; addGraph.addEventListener('dragover', event => event.preventDefault()); addGraph.addEventListener('drop', () => createInlineCriteriaGraph(addGraph, groupTitle)); criteriaGroup.append(addGraph); criteriaNode.append(criteriaGroup); }
        for (const section of customSections.filter(candidate => candidate.testKey === '*')) { const criteriaGroup = document.createElement('details'); criteriaGroup.open = true; criteriaGroup.className = 'mapping-criteria-group mapping-added-section'; const summary = document.createElement('summary'); const title = document.createElement('input'); title.value = section.title; title.addEventListener('change', () => { section.title = title.value.trim() || 'Новый раздел'; }); summary.append(title); criteriaGroup.append(summary); for (const item of section.items) criteriaGroup.append(renderAddedGraph(item, section)); criteriaNode.append(criteriaGroup); }
        const addCriteriaSection = document.createElement('div'); addCriteriaSection.className = 'mapping-add-section mapping-criteria-add'; addCriteriaSection.textContent = '＋ Добавить новый раздел во все тесты'; addCriteriaSection.addEventListener('dragover', event => event.preventDefault()); addCriteriaSection.addEventListener('drop', () => createInlineCriteriaSection(addCriteriaSection)); criteriaNode.append(addCriteriaSection); mappingTargets.append(criteriaNode);
        const aggregateNode = document.createElement('details'); aggregateNode.className = 'mapping-aggregates'; aggregateNode.open = aggregateOpen;
        const aggregateSummary = document.createElement('summary'); aggregateSummary.textContent = 'Комбинированные панели'; aggregateNode.append(aggregateSummary);
        const aggregatePanels = new Map();
        for (const range of archiveAnalysisData.ranges) for (const panel of range.panels) { const key = `${panel.panelId || ''}\0${panel.title}`; if (!aggregatePanels.has(key)) aggregatePanels.set(key, { panel, count: 0 }); aggregatePanels.get(key).count += 1; }
        for (const [key, item] of aggregatePanels) { const node = document.createElement('div'); node.className = 'mapping-node source-node aggregate-node'; node.draggable = true; node.dataset.sourceKey = `aggregate\0${key}`; node.textContent = `${item.panel.title}${item.panel.panelId ? ` · panel ${item.panel.panelId}` : ''} (${item.count})`; node.addEventListener('dragstart', () => { draggedSourceKey = node.dataset.sourceKey; mappingBoardStatus.textContent = 'Отпустите панель на пунктирной зоне справа.'; mappingBoard.classList.add('mapping-drag-active'); }); node.addEventListener('dragend', () => { draggedSourceKey = null; mappingBoard.classList.remove('mapping-drag-active'); }); aggregateNode.append(node); }
        mappingSources.append(aggregateNode);
        drawMappingLinks(); ensureArrowMarker();
    }
    function ensureArrowMarker() {
        const markers = [...mappingLinks.querySelectorAll('marker')];
        for (const marker of markers) {
            const path = marker.querySelector('path');
            if (path) path.setAttribute('fill', 'context-stroke');
        }
        return mappingLinks.querySelector('#mapping-arrow-group') && mappingLinks.querySelector('#mapping-arrow-specific');
    }
    function refreshMappingAfterAdd(sourceKey) { renderMappingBoard(); const source = root.DashBridgeConfluenceReportMappingBoard.findNode(mappingSources.querySelectorAll('[data-source-key]'), 'sourceKey', sourceKey); const parent = source?.closest('details'); if (parent) parent.open = true; drawMappingLinks(); }
    function createInlineGraph(dropzone, test, group) { if (!draggedSourceKey) return; if (draggedSourceKey.startsWith('aggregate\0')) { createInlineCriteriaGraph(dropzone, group.title); return; } const sourceKey = draggedSourceKey; const targetKey = `added-graph\0${test.testKey}\0${group.title}\0${Date.now()}`; customGraphs = [...customGraphs, { testKey: test.testKey, groupTitle: group.title, targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график' }]; connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; refreshMappingAfterAdd(sourceKey); }
    function createInlineSection(dropzone, test) { if (!draggedSourceKey) return; const sourceKey = draggedSourceKey; const targetKey = `added-section\0${test.testKey}\0${Date.now()}`; const item = { targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график' }; customSections = [...customSections, { testKey: test.testKey, groupTitle: null, title: 'Новый раздел', items: [item] }]; connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; refreshMappingAfterAdd(sourceKey); }
    function createInlineGroup(dropzone, test, group) { if (!draggedSourceKey) return; const sourceKey = draggedSourceKey; const targetKey = `added-group\0${test.testKey}\0${Date.now()}`; const item = { targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график' }; customSections = [...customSections, { testKey: test.testKey, groupTitle: group.title, title: 'Новая группа', items: [item] }]; connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; refreshMappingAfterAdd(sourceKey); }
    function createInlineCriteriaSection(dropzone) { if (!draggedSourceKey || !liveResult?.snapshot?.tests?.length) return; const sourceKey = draggedSourceKey; const section = { testKey: '*', title: 'Новый раздел', items: [] }; for (const test of liveResult.snapshot.tests) { const targetKey = `added-section\0${test.testKey}\0${Date.now()}\0${section.items.length}`; section.items.push({ targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график' }); connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; } customSections = [...customSections, section]; refreshMappingAfterAdd(sourceKey); }
    function createInlineCriteriaGraph(dropzone, groupTitle) { if (!draggedSourceKey || !liveResult?.snapshot?.tests?.length) return; const sourceKey = draggedSourceKey; const stamp = Date.now(); const criteriaWideId = `criteria-wide\0${groupTitle}\0${stamp}`; for (const test of liveResult.snapshot.tests) { if (!test.groups.some(group => group.title === groupTitle)) continue; const targetKey = `added-graph\0${test.testKey}\0${groupTitle}\0${stamp}`; customGraphs = [...customGraphs, { testKey: test.testKey, groupTitle, targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график', criteriaWide: true, criteriaWideId }]; connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; } refreshMappingAfterAdd(sourceKey); }
    function renderAddedGraph(item, ownerSection = null, batchItems = null) { const row = document.createElement('div'); row.className = 'mapping-node target-node specific-node mapping-added-graph'; row.dataset.targetKey = item.targetKey; row.dataset.mode = 'specific'; const label = document.createElement('span'); label.className = 'mapping-added-graph-label'; label.textContent = item.criteriaWide ? 'Общая панель для всех тестов' : 'Приписка перед графиком'; const input = document.createElement('input'); input.value = item.caption; input.placeholder = 'Например: Метрики Radius'; input.setAttribute('aria-label', 'Приписка перед графиком'); input.addEventListener('change', () => { item.caption = input.value.trim() || 'Новый график'; }); row.addEventListener('dragover', event => { if (draggedAddedItem && draggedAddedItem.item !== item) event.preventDefault(); }); row.addEventListener('drop', event => { if (draggedAddedItem && draggedAddedItem.item !== item) { event.preventDefault(); moveAddedItem(ownerSection ? { kind: 'section', section: ownerSection, beforeItem: item } : { kind: 'group', testKey: item.testKey, groupTitle: item.groupTitle, beforeItem: item }); } }); row.append(label, input); appendMappingGrip(row, item, ownerSection, batchItems); return row; }
    function appendInlineGraphItems(groupNode, test, group) { const existing = [...groupNode.querySelectorAll('.specific-node:not(.mapping-added-graph)')]; for (const image of group.images) { const target = existing[group.images.indexOf(image)]; if (target) groupNode.insertBefore(createReorderDropzone(groupNode, test, group, image.imageReference?.filename), target); } createReorderDropzone(groupNode, test, group); for (const item of customGraphs.filter(candidate => candidate.testKey === test.testKey && candidate.groupTitle === group.title)) { const batchItems = item.criteriaWideId ? customGraphs.filter(candidate => candidate.criteriaWideId === item.criteriaWideId) : null; const row = renderAddedGraph(item, null, batchItems); const index = item.insertionBeforeFilename ? group.images.findIndex(image => image.imageReference?.filename === item.insertionBeforeFilename) : -1; if (index >= 0 && existing[index]) groupNode.insertBefore(row, existing[index]); else groupNode.append(row); } }
    function appendInlineSections(parentNode, test, groupTitle = null) { for (const section of customSections.filter(candidate => (candidate.testKey === test.testKey || candidate.testKey === '*') && (candidate.groupTitle || null) === (groupTitle || null))) { const node = document.createElement('details'); node.open = true; node.className = 'mapping-added-section'; const summary = document.createElement('summary'); const title = document.createElement('input'); title.value = section.title; title.addEventListener('change', () => { section.title = title.value.trim() || (section.groupTitle ? 'Новая группа' : 'Новый раздел'); }); summary.append(title); node.append(summary); const dropzone = document.createElement('div'); dropzone.className = 'mapping-section-dropzone'; dropzone.textContent = section.items.length ? '' : 'Перетащите сюда панели ZIP'; dropzone.addEventListener('dragover', event => event.preventDefault()); dropzone.addEventListener('drop', event => { if (draggedAddedItem) { event.preventDefault(); moveAddedItem({ kind: 'section', section }); return; } if (!draggedSourceKey) return; const sourceKey = draggedSourceKey; const targetKey = `added-section\0${test.testKey}\0${Date.now()}`; const item = { targetKey, sourceKey, caption: sourceKey.split('\0').at(-1) || 'Новый график' }; section.items.push(item); connections = [...connections, root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey, targetKey, mode: 'specific' })]; refreshMappingAfterAdd(sourceKey); }); for (const item of section.items.filter(candidate => candidate.targetKey.includes(`\0${test.testKey}\0`))) dropzone.append(renderAddedGraph(item, section)); node.append(dropzone); parentNode.append(node); } }
    function connectDragged(node) { if (!draggedSourceKey) return; const connection = root.DashBridgeConfluenceReportMappingBoard.createConnection({ sourceKey: draggedSourceKey, targetKey: node.dataset.targetKey, mode: node.dataset.mode }); connections = [...connections.filter(item => item.targetKey !== node.dataset.targetKey), connection]; drawMappingLinks(); ensureArrowMarker(); applyConfluenceButton.disabled = false; mappingBoardStatus.textContent = node.dataset.mode === 'group' ? 'Создана массовая связь для всех подходящих тестов.' : 'Создана точечная связь для выбранного теста.'; }
    function drawMappingLinks() { mappingLinks.querySelectorAll('path.mapping-connection').forEach(line => line.remove()); mappingSources.querySelectorAll('[data-source-key]').forEach(node => node.style.removeProperty('--connection-color')); mappingTargets.querySelectorAll('[data-target-key]').forEach(node => node.style.removeProperty('--connection-color')); mappingLinks.setAttribute('width', mappingBoard.clientWidth); mappingLinks.setAttribute('height', mappingBoard.clientHeight); const boardRect = mappingBoard.getBoundingClientRect(); const finder = root.DashBridgeConfluenceReportMappingBoard.findNode; for (const link of connections) { const source = finder(mappingSources.querySelectorAll('[data-source-key]'), 'sourceKey', link.sourceKey); const target = finder(mappingTargets.querySelectorAll('[data-target-key]'), 'targetKey', link.targetKey); if (!source || !target) continue; const color = link.color || root.DashBridgeConfluenceReportMappingBoard.randomConnectionColor(); source.style.setProperty('--connection-color', color); target.style.setProperty('--connection-color', color); const a = source.getBoundingClientRect(); const b = target.getBoundingClientRect(); const x1 = a.right - boardRect.left; const y1 = a.top + a.height / 2 - boardRect.top; const x2 = b.left - boardRect.left; const y2 = b.top + b.height / 2 - boardRect.top; const bend = Math.max(32, (x2 - x1) * .35); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); path.setAttribute('marker-end', `url(#mapping-arrow-${link.mode})`); path.style.stroke = color; path.classList.add('mapping-connection'); mappingLinks.append(path); } ensureArrowMarker(); }

    function renderOperationControls() { const adding = operationAction.value === 'add'; document.querySelector('.operation-caption-field').hidden = !adding; document.querySelector('.operation-anchor-field').hidden = !adding; operationTestPicker.hidden = operationScope.value !== 'selected'; }
    function renderOperations() { operationList.replaceChildren(); for (const operation of operations) { const row = document.createElement('div'); row.className = 'operation-row'; const text = document.createElement('span'); text.textContent = `${operation.action === 'add' ? 'Добавить' : 'Заменить'} · ${operation.targetMetric} · ${operation.scope === 'all' ? 'все тесты' : `${operation.testKeys.length} тест.`}`; const source = document.createElement('small'); source.textContent = `Источник: ${operation.sourceKey.split('\0')[1] || 'не выбран'}`; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-quiet'; remove.textContent = 'Удалить'; remove.addEventListener('click', () => { operations = operations.filter(item => item.id !== operation.id); renderOperations(); renderPreview(); }); row.append(text, source, remove); operationList.append(row); } }

    function renderMetricOptions(snapshot) {
        metricOptions = [...root.DashBridgeConfluenceReportPreview.metricOptions(snapshot)];
        metricSelect.replaceChildren();
        for (let index = 0; index < metricOptions.length; index++) {
            const item = metricOptions[index];
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `${item.metric} · ${item.metricGroup || 'Без группы'} (${item.count})`;
            metricSelect.append(option);
        }
        previewCard.hidden = true;
        archiveCard.hidden = false;
        archiveInput.disabled = false;
        targetCount.textContent = '0';
        updateTargetSelection();
    }

    function updateTargetSelection() {
        const selection = selectedMetric();
        const count = selectedTargets.size;
        targetCount.textContent = String(count);
        const enabled = Boolean(liveResult);
        archiveInput.disabled = !enabled;
        archiveCard.hidden = !enabled;
        if (enabled && !archive) setStatus(archiveStatus, 'Страница готова. Загрузите ZIP Batch — затем настройте операции.');
        renderPreview();
    }

    function renderPreview() {
        previewList.replaceChildren();
        const selection = {};
        if (!liveResult || !selectedTargets.size) return;
        if (!archive) {
            setStatus(previewStatus, 'Загрузите ZIP Batch, чтобы сопоставить новые изображения.');
            return;
        }
        const panelMappings = Object.fromEntries([...archivePanelMappings.entries()].map(([key, metric]) => [metric, key.split('\0')[1]]));
        const plan = root.DashBridgeConfluenceReportPreview.plan(liveResult.snapshot, archive, { ...selection, targetKeys: [...selectedTargets], panelMappings });
        const operationSources = archiveAnalysisData?.panels || [];
        const operationPlan = root.DashBridgeConfluenceReportOperations.expand(operations, liveResult.snapshot, operationSources);
        let exact = 0;
        for (const item of plan) {
            if (item.status === 'exact') exact += 1;
            const row = document.createElement('div');
            row.className = 'image-item';
            row.dataset.status = item.status;
            const target = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = `${item.target.testTitle} / ${item.target.metricGroup}`;
            const oldFile = document.createElement('small');
            oldFile.textContent = `Было: ${item.target.image.imageReference.filename || item.target.image.imageReference.src || 'изображение'}`;
            target.append(title, oldFile);
            const source = document.createElement('div');
            const status = document.createElement('strong');
            status.textContent = item.status === 'exact' ? 'Точное совпадение' : (item.status === 'ambiguous' ? 'Нужно выбрать файл' : 'Источник не найден');
            const newFile = document.createElement('small');
            newFile.textContent = item.source ? `Станет: ${item.source.path}` : `Кандидатов: ${item.candidates.length}`;
            source.append(status, newFile);
            const evidence = document.createElement('div');
            const evidenceTitle = document.createElement('strong'); evidenceTitle.textContent = item.capture ? 'Основание' : 'Основание';
            const evidenceText = document.createElement('small'); evidenceText.textContent = item.capture ? [item.capture.panelTitle, item.capture.panelId, item.capture.from && item.capture.to ? `${item.capture.from} → ${item.capture.to}` : ''].filter(Boolean).join(' · ') || 'Структура и occurrence' : 'Совпадение по подписи/имени файла';
            evidence.append(evidenceTitle, evidenceText);
            row.append(target, source, evidence);
            previewList.append(row);
        }
        for (const item of operationPlan) {
            const row = document.createElement('div'); row.className = 'image-item'; row.dataset.status = item.source ? 'exact' : 'ambiguous';
            const target = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${item.action === 'add' ? 'Добавить' : 'Заменить'} · ${item.testTitle} / ${item.groupTitle}`; const detail = document.createElement('small'); detail.textContent = item.caption; target.append(title, detail);
            const source = document.createElement('div'); const sourceTitle = document.createElement('strong'); sourceTitle.textContent = item.source ? `Источник: ${item.source.title}` : 'Источник не выбран'; const sourceDetail = document.createElement('small'); sourceDetail.textContent = item.source ? `${item.source.panelId ? `panel ${item.source.panelId}` : ''} · ${item.action === 'add' ? item.anchor : 'будет заменено'}` : 'Проверьте операцию'; source.append(sourceTitle, sourceDetail); row.append(target, source); previewList.append(row);
        }
        previewCard.hidden = false;
        const total = plan.length + operationPlan.length; const ready = total > 0 && exact === plan.length && operationPlan.every(item => item.source);
        setStatus(previewStatus, ready ? `Готово к применению: ${total} операций.` : `Подготовлено операций: ${total}. Проверьте неоднозначные строки.`, !ready);
    }

    function refreshSummary() {
        const snapshot = liveResult?.snapshot;
        if (!snapshot) return;
        testCount.textContent = snapshot.tests.length;
        imageCount.textContent = countImages(snapshot);
        summaryCard.hidden = false;
        renderMetricOptions(snapshot);
        renderTargetTree(snapshot);
        renderPreview();
    }

    archiveInput.addEventListener('change', async () => {
        const file = archiveInput.files?.[0];
        if (!file) return;
        controller?.abort();
        controller = new AbortController();
        try {
            setStatus(archiveStatus, 'Чтение архива…');
            archivePanelMappings.clear();
            operations = []; operationList.replaceChildren();
            const zip = root.DashBridgeConfluenceReportZip.create({ JSZip: root.JSZip, schema: root.DashBridgeConfluenceReportSchema });
            archive = await zip.load(file, controller.signal);
            archiveAnalysisData = root.DashBridgeConfluenceReportArchive.analyze(archive);
            setStatus(archiveStatus, `Архив прочитан: ${archive.sources.size} источников.`);
            pageStatus.textContent = liveResult ? 'Архив сопоставлен с текущей страницей.' : 'Теперь можно просканировать страницу Confluence.';
            renderPreview();
            renderArchiveAnalysis();
        } catch (error) {
            if (error?.name !== 'AbortError') setStatus(archiveStatus, error?.message || 'Не удалось прочитать архив.', true);
        }
    });

    metricSelect.addEventListener('change', updateTargetSelection);
    operationAction.addEventListener('change', renderOperationControls);
    operationScope.addEventListener('change', renderOperationControls);
    addOperationButton.addEventListener('click', () => {
        const testKeys = [...operationTestPicker.querySelectorAll('input:checked')].map(input => input.value);
        const operation = root.DashBridgeConfluenceReportOperations.create({ action: operationAction.value, sourceKey: operationSource.value, targetMetric: operationTarget.value, scope: operationScope.value, testKeys, caption: operationCaption.value, anchor: operationAnchor.value });
        operations = [...operations, operation];
        if (liveResult?.snapshot) for (const test of liveResult.snapshot.tests) for (const group of test.groups) for (const image of group.images) if ((!operation.targetMetric || (image.captionLead || image.caption) === operation.targetMetric) && (operation.scope === 'all' || testKeys.includes(test.testKey))) selectedTargets.add(`${test.testKey}:${group.title}:${image.occurrence}`);
        targetCount.textContent = String(selectedTargets.size);
        renderOperations(); renderPreview();
    });
    clearConnectionsButton.addEventListener('click', () => { connections = []; drawMappingLinks(); mappingBoardStatus.textContent = 'Связи очищены.'; });
    applyConfluenceButton.addEventListener('click', async () => {
        if (!liveResult || !archive || !connections.length) return;
        applyConfluenceButton.disabled = true;
        try {
            const plan = buildApplyPlan();
            if (!plan.replacements.length && !plan.additions.length) throw new Error('Нет применимых операций.');
            const origin = liveResult.source.origin; const pageId = liveResult.page.pageIdentity.pageId; const tab = await openVisibleConfluenceWindow(new URL(`${origin}/pages/viewpage.action?pageId=${pageId}`), controller?.signal); const applyTabId = tab.id;
            const runner = root.DashBridgeConfluenceReportApply.create({
                uploadAttachment: async ({ filename, blob, existing, signal }) => { const bytes = await blob.arrayBuffer(); const endpoint = existing?.id ? `${origin}/rest/api/content/${pageId}/child/attachment/${existing.id}/data` : `${origin}/rest/api/content/${pageId}/child/attachment`; const data = await requestTab(applyTabId, { url: endpoint, method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, filename, bytes, contentType: blob.type }, signal); return data?.results?.[0] || data || { title: filename }; },
                updatePage: async ({ page, storageHtml, signal }) => requestTab(applyTabId, { url: `${origin}/rest/api/content/${pageId}`, method: 'PUT', json: { id: pageId, type: 'page', title: page.pageIdentity.title, version: { number: page.pageIdentity.version + 1 }, body: { storage: { value: storageHtml, representation: 'storage' } } } }, signal),
                verifyPage: async ({ expectedVersion, filenames, signal }) => { const data = await requestTab(applyTabId, { url: `${origin}/rest/api/content/${pageId}?expand=body.storage,version`, method: 'GET' }, signal); const html = data?.body?.storage?.value || ''; return Number(data?.version?.number) === Number(expectedVersion) && filenames.every(filename => html.includes(`ri:filename=\"${filename}\"`)); },
            });
            const result = await runner.apply({ page: liveResult.page, replacements: plan.replacements, additions: plan.additions, sources: new Map([...archive.sources.entries()].map(([key, value]) => [key.split('/').at(-1), value])), uploaded: uploadedAttachments, onProgress: progress => { mappingBoardStatus.textContent = progress.stage === 'upload' ? `Загрузка ${progress.filename}…` : 'Сохранение страницы Confluence…'; } });
            mappingBoardStatus.textContent = `Готово: загружено ${result.attachments.length}, страница проверена.`;
            await closeCreatedConfluenceWindow();
        } catch (error) { await closeCreatedConfluenceWindow(); mappingBoardStatus.textContent = error?.message || 'Не удалось применить изменения.'; mappingBoardStatus.toggleAttribute('data-error', true); applyConfluenceButton.disabled = false; }
    });
    mappingTargets.addEventListener('scroll', drawMappingLinks);
    mappingSources.addEventListener('scroll', drawMappingLinks);
    window.addEventListener('resize', drawMappingLinks);

    scanLiveButton.addEventListener('click', async () => {
        controller?.abort();
        controller = new AbortController();
        invalidateSources();
        scanLiveButton.disabled = true;
        try {
            setStatus(liveStatus, 'Сканирование страницы…');
            const url = validatePageUrl(pageUrlInput.value);
            setStatus(liveStatus, 'Открываю отдельное окно Confluence…');
            const tab = await openVisibleConfluenceWindow(url, controller.signal);
            setStatus(liveStatus, 'Окно открыто, читаю данные страницы…');
            const pageId = pageIdFromUrl(url.href);
            liveResult = await createLiveClient(tab.id).scan({ baseUrl: url.origin, pageId, signal: controller.signal });
            await closeCreatedConfluenceWindow();
            setStatus(liveStatus, `Страница: ${liveResult.page.pageIdentity.title} · версия ${liveResult.page.pageIdentity.version || 'неизвестна'}`);
            pageStatus.textContent = 'Структура прочитана. Изменения не применяются.';
            refreshSummary();
        } catch (error) {
            if (error?.name !== 'AbortError') setStatus(liveStatus, error?.message || 'Не удалось просканировать страницу.', true);
        } finally {
            scanLiveButton.disabled = false;
        }
    });
})(globalThis);
