'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'shared', 'dashflow-schema.js'), 'utf8'), context);

const schema = context.DashBridgeFlowSchema;
const manifest = schema.createManifest({
    title: 'Login / prod', startUrl: 'https://site.example/login', requestCount: 4, stepCount: 2, containsSecrets: true,
    networkMode: { cacheDisabled: true, ephemeralCookies: true },
});
assert.strictEqual(manifest.format, 'dashbridge-flow');
assert.strictEqual(manifest.version, 2);
assert.strictEqual(manifest.network, 'network.json');
assert.strictEqual(manifest.streams, 'streams.json');
assert.strictEqual(manifest.containsSecrets, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(manifest.networkMode)), { cacheDisabled: true, bypassServiceWorker: true, ephemeralCookies: true });
assert.strictEqual(schema.safeFilename('Login / prod'), 'Login_prod');
assert.strictEqual(schema.normalizeHttpUrl('site.example/login'), 'https://site.example/login');
assert.strictEqual(schema.normalizeHttpUrl('site.example:8443/login'), 'https://site.example:8443/login');
assert.strictEqual(schema.normalizeHttpUrl('javascript:alert(1)'), null);
assert.strictEqual(schema.normalizeHttpUrl('https://user:pass@site.example'), null);
assert.strictEqual(schema.base64DecodedByteLength(''), 0);
assert.strictEqual(schema.base64DecodedByteLength('TQ=='), 1, 'double Base64 padding must not inflate bodyBytes');
assert.strictEqual(schema.base64DecodedByteLength('TWE='), 2, 'single Base64 padding must not inflate bodyBytes');
assert.strictEqual(schema.base64DecodedByteLength('TWFu'), 3, 'unpadded Base64 length must stay exact');

const captureLimits = { maxBodyBytes: 5 * 1024 * 1024, totalBodyBytes: 0, maxTotalBodyBytes: 100 * 1024 * 1024 };
assert.deepStrictEqual(JSON.parse(JSON.stringify(schema.classifyResponseBodyCapture({ failed: true }, captureLimits))),
    { status: 'unavailable', reason: 'loading-failed' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(schema.classifyResponseBodyCapture({ resourceType: 'Preflight' }, captureLimits))),
    { status: 'empty', reason: 'no-body-expected' }, 'Preflight must not count as a failed body capture');
assert.deepStrictEqual(JSON.parse(JSON.stringify(schema.classifyResponseBodyCapture({
    resourceType: 'Fetch', encodedDataLength: 1024, decodedDataLength: 6 * 1024 * 1024,
}, captureLimits))), { status: 'skipped', reason: 'too-large' }, 'decoded responses above the cap must be skipped before CDP eviction');
assert.deepStrictEqual(JSON.parse(JSON.stringify(schema.classifyResponseBodyCapture({
    resourceType: 'Fetch', encodedDataLength: 6 * 1024 * 1024, decodedDataLength: 1024,
}, captureLimits))), { status: 'skipped', reason: 'too-large' }, 'encoded responses above the cap must also be skipped');
assert.strictEqual(schema.classifyResponseBodyCapture({
    resourceType: 'Fetch', encodedDataLength: 1024, decodedDataLength: 2048,
}, captureLimits), null, 'ordinary responses must continue to CDP body capture');
const reusedConnectionTiming = schema.buildHarTimings({
    startedMonotonic: 10,
    responseTiming: { requestTime: 10.1, sendStart: 0, sendEnd: 1, receiveHeadersStart: 50, receiveHeadersEnd: 52 },
}, 200);
assert.deepStrictEqual(JSON.parse(JSON.stringify(reusedConnectionTiming)), {
    blocked: 100, dns: -1, connect: -1, ssl: -1, send: 1, wait: 51, receive: 48,
});
assert.strictEqual(Object.entries(reusedConnectionTiming).filter(([name, value]) => name !== 'ssl' && value >= 0)
    .reduce((total, [, value]) => total + value, 0), 200, 'HAR timing phases must sum to the request duration');
const inconsistentCdpTiming = schema.buildHarTimings({
    startedMonotonic: 10,
    responseTiming: { requestTime: 9.999, sendStart: 30, sendEnd: 31, receiveHeadersEnd: 70 },
}, 60);
assert.strictEqual(Object.entries(inconsistentCdpTiming).filter(([name, value]) => name !== 'ssl' && value >= 0)
    .reduce((total, [, value]) => total + value, 0), 60,
'HAR phases must remain bounded when CDP monotonic clocks disagree');
assert.throws(() => schema.validateManifest({ ...manifest, version: 999 }), /не поддерживается/);
assert.throws(() => schema.validateManifest({ ...manifest, version: 1 }), /не поддерживается/);
assert.throws(() => schema.validateFlow({ steps: [{ type: 'navigate', url: 'file:///secret' }] }), /URL/);
assert.throws(() => schema.validateFlow({ steps: [{ type: 'setViewport' }] }), /не поддерживается/);
assert.throws(() => schema.validateFlow({ steps: [{ type: 'click', _dashbridge: {} }] }), /локатор/);
assert.throws(() => schema.validateFlow({ steps: [{
    type: 'change', value: 'x'.repeat(1024 * 1024 + 1), _dashbridge: { locator: { css: '#field' } },
}] }), /значение/);
assert.strictEqual(schema.validateFlow({ steps: [
    { type: 'navigate', url: 'https://site.example/' },
    { type: 'click', _dashbridge: { locator: { css: '#submit' }, frameUrl: 'https://site.example/' } },
] }).steps.length, 2);
assert.strictEqual(schema.validateNetwork({ version: 2, requests: [{ url: 'https://site.example/', method: 'GET' }] }).requests.length, 1);
assert.throws(() => schema.validateNetwork({ version: 2, requests: [{ url: 42, method: 'GET' }] }), /сетевого запроса/);
assert.strictEqual(schema.validateStreams({ version: 1, events: [] }).events.length, 0);

const extensionManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert(extensionManifest.permissions.includes('debugger'), 'Chrome requires debugger to be declared as a required permission');
assert(!extensionManifest.optional_permissions?.includes('debugger'), 'Chrome rejects debugger as an optional permission');
assert(!extensionManifest.content_scripts.some(script => (script.js || []).includes('js/content/scenario-recorder.js')),
    'the generic action recorder must not run outside an explicitly controlled tab');

const html = fs.readFileSync(path.join(root, 'pages/recorder/recorder.html'), 'utf8');
const recorderCss = fs.readFileSync(path.join(root, 'pages/recorder/recorder.css'), 'utf8');
assert(html.includes('id="disableCache"') && html.includes('id="disableCookies"'), 'Recorder must expose independent cache and cookie switches');
assert(html.includes('id="incognitoSetup"') && html.includes('id="openIncognitoSettings"'), 'Recorder must expose conditional incognito setup help');
assert(html.includes('incognito-instructions') && html.includes('Chrome перезапускает расширение'),
    'incognito setup must explain how to grant access and why Recorder needs reopening');
assert(!html.includes('Google Chrome не может запретить расширениям записывать историю браузера'),
    'Recorder must not repeat the generic Chrome history warning');
assert(html.includes('id="comparisonUrlFilter"') && html.includes('placeholder="Фильтр URL"'), 'comparison must expose a URL filter');
assert(html.includes('id="exportComparisonButton"'), 'comparison must expose an Excel export button');
for (const id of ['trafficMethodFilter', 'trafficStatusFilter', 'trafficTypeFilter', 'clearTrafficFilters', 'showAllSteps']) {
    assert(html.includes(`id="${id}"`), `Recorder must expose the ${id} traffic control`);
}
assert(html.includes('id="toggleSensitiveDetailsButton"') && html.includes('id="copyRequestUrlButton"'),
    'request details must support safe reveal and URL copying');
assert(html.includes('class="request-details-zone"') && recorderCss.includes('.request-details-zone { position: relative; z-index: 4; flex: 0 0 auto;'),
    'request details must have a dedicated footer that traffic rows cannot enter');
assert(html.includes('<caption class="sr-only">'), 'traffic and comparison tables must have accessible captions');
assert(html.includes('class="file-button" role="button" tabindex="0"'), 'dashflow import must remain keyboard accessible');
assert(recorderCss.includes('box-shadow: 0 0 0 3px rgba(var(--primary-rgb), .16)'),
    'Recorder focus styles must use one consistent, unclipped focus ring');
assert(recorderCss.includes('.comparison-panel tbody tr:not(.comparison-step-group) td { background-color: transparent; }'),
    'dark theme cells must not cover comparison result colors');
assert(recorderCss.includes('.comparison-step-group td { position: static;'),
    'comparison step headings must not overlap while scrolling');
assert(recorderCss.includes('.traffic-step-group td { position: sticky;') && recorderCss.includes('background: var(--bg-elevated);'),
    'traffic step headings must remain sticky with an opaque background while scrolling');
assert(recorderCss.includes('th { position: sticky; top: 0; z-index: 3;') && recorderCss.includes('background: var(--bg-elevated);'),
    'sticky traffic column headers must be opaque above sticky step headings');
assert(recorderCss.includes('.comparison-controls > :not(.sr-only) { flex: 1 1 100%'),
    'comparison controls must fill narrow layouts without overflow');
assert(recorderCss.includes('.network-switches { display: grid; grid-template-columns: minmax(0,1fr);'),
    'cache and cookie switches must be arranged vertically');
for (const asset of ['vendor/jszip.min.js', 'js/shared/dashflow-schema.js', 'js/shared/dashflow-compare.js', 'js/shared/dashflow-xlsx.js', '../shared/operation-progress-window.js', 'recorder-dashflow-export.js', 'recorder-dashflow-io.js', 'recorder-view.js', 'recorder.js']) {
    assert(html.includes(asset), `recorder page must load ${asset}`);
}
assert(html.indexOf('vendor/jszip.min.js') < html.indexOf('recorder.js'), 'JSZip must load before the recorder controller');
assert(html.indexOf('recorder-dashflow-io.js') < html.indexOf('recorder.js'),
    'DashFlow I/O must load before the recorder controller');
assert(html.indexOf('recorder-dashflow-export.js') < html.indexOf('recorder.js'),
    'DashFlow export builders must load before the recorder controller');
assert(html.indexOf('recorder-view.js') < html.indexOf('recorder.js'),
    'Recorder view must load before the lifecycle controller');

const recorder = fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder.js'), 'utf8');
const recorderView = fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder-view.js'), 'utf8');
const dashflowIo = fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder-dashflow-io.js'), 'utf8');
const dashflowExport = fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder-dashflow-export.js'), 'utf8');
assert(recorder.includes('Network.getResponseBody'), 'network recorder must capture response bodies through CDP');
assert(recorder.includes('Network.getRequestPostData'), 'request bodies missing from requestWillBeSent must be retrieved through CDP');
assert(recorder.includes('function headerValue(headers, wantedName)')
    && recorder.includes("headerValue(request.requestHeaders, 'content-type')"),
    'multipart request-body detection must retain its local case-insensitive header lookup');
assert(recorder.includes('schema.classifyResponseBodyCapture'), 'response body capture must use the tested no-body and size policy');
assert(recorder.includes('schema.base64DecodedByteLength'), 'binary response metadata must use exact Base64 padding-aware size');
assert(dashflowExport.includes('schema.buildHarTimings'), 'HAR export must use the tested CDP timing conversion');
assert(dashflowIo.includes('assertEntrySize') && recorder.includes('estimateDashflowWorkingSet'),
    'DashFlow import and save must reject oversized decompressed entries before expensive processing');
assert(dashflowIo.includes("zip.file('network.json'") && dashflowIo.includes("zip.file('streams.json'"),
    'DashFlow v2 must persist canonical network data and streaming protocols separately from HAR');
assert(recorder.includes("String(bodyIndex).padStart(6, '0')"),
    'response body paths must remain unique even when sanitized CDP request IDs collide');
assert(recorder.includes('responseBodyCapture') && recorder.includes('requestBodyCapture') && recorder.includes('pendingCapturesAtStop'),
    'every body capture must have an explicit completeness status');
assert(recorder.includes('Network.dataReceived') && recorder.includes('Network.requestServedFromCache')
    && recorder.includes('Network.resourceChangedPriority'), 'canonical capture must retain transfer size, cache and priority events');
assert(recorder.includes('webSocket|eventSourceMessageReceived|webTransport') && recorder.includes('MAX_STREAM_PAYLOAD_BYTES'),
    'bounded WebSocket, SSE and WebTransport metadata must be captured');
assert(recorder.includes('Page.navigatedWithinDocument') && recorder.includes('Page.lifecycleEvent'),
    'same-document navigation and page lifecycle events must be retained');
assert(dashflowExport.includes('queryString = [...new URLRef(request.url).searchParams]')
    && dashflowExport.includes('serverIPAddress') && dashflowExport.includes('_dashbridgeCdpTiming'),
    'derived HAR must include query parameters, connection endpoint and CDP timing metadata');
assert(recorder.includes('Network.requestWillBeSentExtraInfo'), 'network recorder must retain auth/cookie request headers');
assert(recorder.includes('Network.setCacheDisabled'), 'record and replay must bypass the browser cache');
assert(recorder.includes('Network.setBypassServiceWorker'), 'record and replay must bypass Service Worker caches');
assert(recorder.includes('isAllowedIncognitoAccess'), 'ephemeral cookies require explicit Chrome incognito access');
assert(recorder.includes('incognitoSetup.hidden = !ui.disableCookies.checked || state.incognitoAllowed'), 'incognito setup button visibility must follow live permission state');
assert(recorder.includes('cookies: требуется разрешение incognito'), 'network mode must not claim an incognito session before access is granted');
assert(recorder.includes('dashbridgeRecorderDraft'), 'Recorder must preserve its draft while Chrome reloads the extension for an incognito permission change');
assert(recorder.includes('dashbridgeRecorderSettings') && recorder.includes('restoreRecorderSettings') && recorder.includes('scheduleRecorderSettingsSave'),
    'Recorder must persist the site, Disable Cache and Disable Cookies choices between page openings');
assert(recorder.includes('performDomActionWithWait'), 'replay must wait for asynchronously rendered elements');
assert(recorder.includes('waitForExpectedNavigation'), 'replay must wait for navigation caused by a recorded click');
assert(recorder.includes('normalizeReplaySteps'), 'replay must remove delayed duplicate input events from legacy recordings');
assert(!recorder.includes('document.elementFromPoint') && !recorder.includes('clickPoint') && !recorder.includes('viewportWidth'),
    'record and replay must never locate elements by viewport coordinates');
assert(recorder.includes('document.getElementById(locator.id)') && recorder.includes('matchesFingerprint'),
    'replay must prefer stable locator attributes and validate structural CSS fallbacks');
assert(recorder.includes('Неоднозначный локатор') && recorder.includes('Надёжный элемент не найден'),
    'replay must stop instead of guessing when a locator is ambiguous or stale');
assert(recorder.includes('activeStepId: null'), 'traffic requests must be attributed to the active scenario step');
assert(recorderView.includes("heading.className = 'traffic-step-group'"), 'traffic table must render a heading for every scenario step');
assert(recorderView.includes("heading.className = 'comparison-step-group'"), 'comparison table must render a heading for every visible scenario step');
assert(recorder.includes('selectedStepId: null'), 'steps sidebar must support filtering traffic by a selected step');
assert(recorderView.includes('sensitiveNamePattern'), 'request details must mask credential-like fields by default');
assert(recorderView.includes('200 - (performance.now() - lastRenderAt)'), 'live traffic rendering must be throttled');
assert(recorder.includes('DashBridgeOperationProgress?.create'), 'record and replay must expose the shared cancellable progress window');
assert(recorder.includes("title: 'Traffic Recorder · Replay'") && recorder.includes("unit: 'запросов'"),
    'progress window must distinguish recording traffic from replay steps');
assert(recorder.includes('openPictureInPicture') && recorder.includes('function buildRecorderWindowLayout()') && recorder.includes('...(layout?.controlled || {})'),
    'Recorder must use an always-on-top PiP controller without reserving space for a side popup');
assert(!recorder.includes('operationProgressController?.open({') && !recorder.includes('layout.progress'),
    'Recorder must not open the removed popup side panel');
assert(recorder.includes("if (state.stopRequested) throw new Error('Операция остановлена пользователем')"),
    'forced replay cancellation must interrupt asynchronous waits');
assert(recorderView.includes('→ navigate ${step._dashbridge.navigationUrl}'), 'traffic group heading must expose navigation caused by an action');
assert(recorderView.match(/→ navigate \$\{step\._dashbridge\.navigationUrl\}/g)?.length >= 2, 'steps sidebar and traffic groups must both expose action navigation');
assert(recorderView.includes("String(url || '').toLowerCase().includes(fragment)"), 'comparison URL filter must match domains, paths and query parameters');
assert(recorderView.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'comparison export must download a real XLSX workbook');
assert(recorder.includes('function postLifecycle(message)'), 'lifecycle messages must tolerate a disconnected extension port');
assert(!recorder.includes("lifecyclePort.postMessage({ type: 'unbind' })"), 'cleanup must not write directly to a possibly disconnected port');
assert(recorder.includes('state.importing') && dashflowIo.includes('const requests = new Map()'),
    'DashFlow import must validate into local state and disable concurrent controls before committing');
assert(dashflowIo.includes('assertWorkingSet'), 'DashFlow import must cap the aggregate decompressed working set');
const importRead = recorder.indexOf('const imported = await dashflowIo.read(file)');
const importCommit = recorder.indexOf('await stopActiveSession(false); resetSession();', importRead);
assert(importRead >= 0 && importCommit > importRead,
    'Recorder must not reset the live session until the archive has fully validated');
assert(recorder.includes('earlyPlaceholder && !earlyPlaceholder.url') && recorder.includes('chain[index] = key'),
    'request placeholders must preserve out-of-order ExtraInfo, including redirect chains');
assert(recorder.includes('request.associatedCookies !== undefined') && recorder.includes('request.blockedCookies !== undefined'),
    'early request and response ExtraInfo headers must not be overwritten by the basic CDP events');
assert(recorder.includes('finalizeUnexpectedSession'),
    'closing the controlled tab or losing the debugger must finalize pending capture state');
const actionRecorder = fs.readFileSync(path.join(root, 'js', 'content', 'scenario-recorder.js'), 'utf8');
assert(actionRecorder.includes('pendingInputs.delete(target)'), 'native change must cancel the delayed input snapshot');
assert(actionRecorder.includes('event.composedPath'), 'click recording must resolve the narrowest interactive composed-path element');
assert(actionRecorder.match(/if \(!event\.isTrusted\) return;/g)?.length >= 5,
    'click, change, input, keydown and submit recording must ignore synthetic site events');
assert(!actionRecorder.includes('clientX') && !actionRecorder.includes('clientY')
    && !actionRecorder.includes('viewportWidth') && !actionRecorder.includes('viewportHeight'),
    'new recordings must not store click coordinates');
assert(actionRecorder.includes("['data-testid', 'data-test-id', 'data-qa', 'data-cy']")
    && actionRecorder.includes('accessibleName'),
    'new recordings must capture several stable semantic locator strategies');
assert(recorder.includes('incognito: state.sessionOptions.disableCookies'), 'Disable Cookies must use an isolated off-the-record window');
assert(!/cookies\.(?:remove|set)|removeCookies/.test(recorder), 'Recorder must never delete or overwrite cookies in the normal user profile');
assert(recorder.includes('containsSecrets'), 'the archive manifest must disclose sensitive content');
assert(recorder.includes('.dashflow'), 'downloads must use the agreed recording extension');
assert(dashflowIo.includes("mimeType: 'application/octet-stream'"), 'Chrome save dialog must preserve the .dashflow extension');
const background = fs.readFileSync(path.join(root, 'js', 'background.js'), 'utf8');
assert(background.includes('dashbridge-recorder-lifecycle'), 'service worker must detach CDP when the recorder page disappears');

console.log('PASS DashFlow recorder keeps portable schema, scoped injection and CDP capture contracts');
