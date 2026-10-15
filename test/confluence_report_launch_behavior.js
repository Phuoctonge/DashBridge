'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'popup', 'popup.html'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'pages', 'popup', 'popup-core.js'), 'utf8');
const batchHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'batch', 'batch.html'), 'utf8');
const batchSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'batch', 'batch.js'), 'utf8');
const reportHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report.html'), 'utf8');
assert(core.includes('openReportImageReplacementBtn'), 'Popup controller must own the mass-collection launcher');
assert(html.includes('id="openReportImageReplacementCard"'), 'Popup must provide a report replacement card');
assert(html.includes('id="openReportImageReplacementBtn"'), 'Report replacement card must provide its launcher');
assert(html.indexOf('id="openReportImageReplacementCard"') < html.indexOf('id="openReportImageReplacementBtn"'), 'Report replacement button must be inside its card');
assert(/<button id="openReportImageReplacementBtn"[^>]*>[\s\S]*?<svg class="ic"/.test(html), 'Report replacement launcher must include an icon');
assert(core.includes('pages/confluence-report/confluence-report.html'), 'Popup launcher must open the existing report page');
const batchSectionStart = html.indexOf('<div id="grafana-batch"');
const debugSectionStart = html.indexOf('<div id="grafana-debug"');
const replacementCardStart = html.indexOf('id="openReportImageReplacementCard"');
assert(batchSectionStart >= 0 && replacementCardStart > batchSectionStart && replacementCardStart < debugSectionStart,
    'Report replacement card must be scoped to the Batch subtab, not the Debug subtab');
assert(!batchHtml.includes('id="openReportImageReplacementBtn"'), 'Full Batch page must not duplicate the Popup launcher');
assert(!batchSource.includes('pages/confluence-report/confluence-report.html'), 'Batch controller must not own the Popup launcher');
assert(!core.includes('sourceTabId'));
const reportScript = fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report.js'), 'utf8');
assert(reportScript.includes('chrome.windows.create') && reportScript.includes('Открываю отдельное окно Confluence'));
assert(reportHtml.includes('id="scanLiveButton"') && reportHtml.includes('id="pageUrlInput"') && reportHtml.includes('confluence-report-live-client.js'));
assert(reportHtml.includes('id="metricSelect"') && reportHtml.includes('id="previewList"') && reportHtml.includes('confluence-report-preview.js'));
assert(reportHtml.includes('id="archiveAnalysis"') && reportHtml.includes('confluence-report-archive.js') && reportHtml.includes('archiveRangeRows') && reportHtml.includes('archiveTestRows') && reportHtml.includes('archivePanelRows'));
assert(reportHtml.includes('id="operationAction"') && reportHtml.includes('id="operationSource"') && reportHtml.includes('id="operationTarget"') && reportHtml.includes('confluence-report-operations.js'));
assert(reportHtml.includes('id="mappingBoard"') && reportHtml.includes('id="mappingTargets"') && reportHtml.includes('id="mappingSources"') && reportHtml.includes('confluence-report-mapping-board.js'));
assert(reportHtml.includes('id="mappingBoardCard"') && reportHtml.includes('id="archiveInput"'));
assert(reportScript.includes('archiveCard.hidden = false') && reportScript.includes('archiveInput.disabled = false'));
assert(reportHtml.indexOf('id="pageHeading"') < reportHtml.indexOf('id="archiveHeading"'));
assert(reportHtml.indexOf('id="summaryHeading"') < reportHtml.indexOf('id="archiveHeading"'));
assert(reportHtml.includes('id="archiveCard"') && reportHtml.includes('disabled'));
assert(reportScript.includes('invalidateSources') && reportScript.includes('archiveInput.disabled = !enabled'));
assert(reportHtml.includes('id="applyConfluenceButton"') && reportHtml.includes('confluence-report-apply.js') && reportHtml.includes('confluence-report-storage.js'));
assert(reportScript.includes('chrome.windows.remove') && reportScript.includes('createdWindowId'));
assert(reportScript.includes('await closeCreatedConfluenceWindow(operation)'));
console.log('PASS report replacement launcher wiring');

async function verifyWindowOwnership() {
    const vm = require('vm'); const removed = []; let resolveOld;
    const state = { controller: null, AbortController, DOMException, Date, setTimeout,
        chrome: { windows: {
            create: async ({ url }) => url.endsWith('/old') ? new Promise(resolve => { resolveOld = resolve; })
                : { id: 22, tabs: [{ id: 222 }] },
            remove: async id => { removed.push(id); },
        }, tabs: { get: async () => ({ status: 'complete' }) } },
    };
    vm.createContext(state);
    vm.runInContext(reportScript.slice(reportScript.indexOf('    const isCurrent ='),
        reportScript.indexOf('    async function fetchFromTab(')), state);
    const old = state.beginOperation();
    const oldResult = assert.rejects(state.openVisibleConfluenceWindow({ href: 'https://wiki.test/old' }, old),
        error => error.name === 'AbortError');
    const current = state.beginOperation();
    await state.openVisibleConfluenceWindow({ href: 'https://wiki.test/new' }, current);
    resolveOld({ id: 11, tabs: [{ id: 111 }] }); await oldResult;
    assert.deepStrictEqual(removed, [11], 'late creation must close its own window, preserving the new one');
    await state.closeCreatedConfluenceWindow(old);
    assert.deepStrictEqual(removed, [11], 'old cleanup is idempotent');
    await state.closeCreatedConfluenceWindow(current);
    assert.deepStrictEqual(removed, [11, 22]);
    let resolveTab; let tabStarted;
    const tabRead = new Promise(resolve => { tabStarted = resolve; });
    state.chrome.tabs.get = () => new Promise(resolve => { resolveTab = resolve; tabStarted(); });
    const delayed = state.beginOperation();
    const delayedResult = assert.rejects(state.openVisibleConfluenceWindow({ href: 'https://wiki.test/new' }, delayed),
        error => error.name === 'AbortError');
    await tabRead;
    state.beginOperation();
    resolveTab({ id: 222, status: 'complete' });
    await delayedResult;
    console.log('PASS Confluence late window creation and cleanup preserve the new owner');
}
verifyWindowOwnership().catch(error => { console.error(error); process.exitCode = 1; });

async function verifyScanPublishesAfterWindowCleanup() {
    const vm = require('vm'); let scan; let finishClose; let notifyClose;
    const closeStarted = new Promise(resolve => { notifyClose = resolve; });
    const state = {
        controller: null, liveResult: null, AbortController, DOMException, Date, setTimeout,
        scanLiveButton: { disabled: false, addEventListener: (_, listener) => { scan = listener; } },
        rescanButton: { disabled: false }, liveStatus: {}, pageStatus: {},
        pageUrlInput: { value: 'https://wiki.test/pages/viewpage.action?pageId=42' },
        archiveInput: { disabled: true },
        invalidateSources() { state.archiveInput.disabled = true; },
        setStatus() {}, validatePageUrl: value => new URL(value), pageIdFromUrl: () => '42',
        refreshSummary() { state.archiveInput.disabled = false; },
        createLiveClient: () => ({ scan: async () => ({ page: { pageIdentity: { title: 'P', version: 3 } } }) }),
        chrome: {
            windows: {
                create: async () => ({ id: 11, tabs: [{ id: 111 }] }),
                remove: () => new Promise(resolve => { finishClose = resolve; notifyClose(); }),
            },
            tabs: { get: async () => ({ id: 111, status: 'complete' }) },
        },
    };
    vm.createContext(state);
    vm.runInContext(reportScript.slice(reportScript.indexOf('    const isCurrent ='),
        reportScript.indexOf('    async function fetchFromTab(')), state);
    vm.runInContext(reportScript.slice(reportScript.indexOf("    scanLiveButton.addEventListener('click'"),
        reportScript.indexOf("    pageUrlInput.addEventListener('input'")), state);
    const pending = scan();
    await closeStarted;
    try {
        assert.strictEqual(state.archiveInput.disabled, true,
            'Scan must not allow ZIP to supersede its owner before window cleanup releases Scan/Rescan');
        assert.strictEqual(state.liveResult, null, 'scan snapshot must remain unpublished during cleanup');
    } finally { finishClose(); await pending; }
    assert.strictEqual(state.archiveInput.disabled, false);
    assert.strictEqual(state.scanLiveButton.disabled, false);
    assert.strictEqual(state.rescanButton.disabled, false);
    state.beginOperation(); // A newly enabled ZIP action may now replace the completed scan.
    assert.strictEqual(state.scanLiveButton.disabled, false);
    console.log('PASS Confluence scan publishes ZIP availability after window cleanup');
}
verifyScanPublishesAfterWindowCleanup().catch(error => { console.error(error); process.exitCode = 1; });
