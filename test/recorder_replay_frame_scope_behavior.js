'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(urls, { cancelAfterProbe = false, navigateAfterProbe = false, cancelAfterWait = false } = {}) {
    let navigated = false;
    const frames = urls.map((url, index) => {
        let clicks = 0;
        class Element {
            getAttribute() { return null; }
            hasAttribute() { return false; }
            getClientRects() { return [{}]; }
            scrollIntoView() {}
            click() { clicks += 1; }
        }
        const button = Object.assign(new Element(), { id: 'send', localName: 'button', isConnected: true });
        const context = { location: { href: url }, Element,
            document: { getElementById: id => id === 'send' ? button : null } };
        vm.createContext(context);
        return { context, frameId: index, documentId: `document-${index}`, clicks: () => clicks };
    });
    const state = { tabId: 7, stopRequested: false, inFlight: new Set(), lastNetworkAt: 0, steps: [{}] };
    const chrome = { scripting: { executeScript: async options => {
        const selected = frames.filter(frame => options.target.allFrames
            || options.target.frameIds?.includes(frame.frameId)
            || options.target.documentIds?.includes(frame.documentId));
        const results = selected.map(frame => {
            frame.context.args = options.args;
            return { frameId: frame.frameId, documentId: frame.documentId,
                result: vm.runInContext(`(${options.func.toString()})(...args)`, frame.context) };
        });
        if (cancelAfterProbe && options.args?.[1] === true) state.stopRequested = true;
        if (navigateAfterProbe && !navigated && options.args?.[1] === true) {
            navigated = true;
            for (const frame of selected) frame.documentId += '-replacement';
        }
        return results;
    } } };
    const context = { chrome, Date, console, setTimeout, clearTimeout, setInterval, clearInterval };
    context.globalThis = context; vm.createContext(context);
    vm.runInContext(fs.readFileSync('pages/recorder/recorder-replay.js', 'utf8'), context);
    const replay = context.DashBridgeRecorderReplay.create({ state, ui: {}, delay: async () => { if (cancelAfterWait) state.stopRequested = true; },
        networkIdleMs: 0, networkIdleTimeoutMs: 1, setStatus() {}, stepLabel() {}, getOperationProgressController() {} });
    return { replay, clicks: () => frames.map(frame => frame.clicks()) };
}
const step = metadata => ({ type: 'click', target: 'main',
    _dashbridge: { locator: { id: 'send', tag: 'button', css: '#send' }, ...metadata } });

test('same-URL sibling frames fail before either button is clicked', async () => {
    const f = fixture(['https://site.example/', 'https://site.example/embed', 'https://site.example/embed']);
    await assert.rejects(f.replay.executeStep(step({ frameUrl: 'https://site.example/embed', frameId: 17 }), 0), /frame|фрейм/i);
    assert.deepEqual(f.clicks(), [0, 0, 0]);
});
test('unique current frame is resolved independently of old recording frame ID', async () => {
    const f = fixture(['https://site.example/', 'https://site.example/embed']);
    await f.replay.executeStep(step({ frameUrl: 'https://site.example/embed', frameId: 91 }), 0);
    assert.deepEqual(f.clicks(), [0, 1]);
});
test('recorded main frame remains scoped to main when a child shares its URL', async () => {
    const f = fixture(['https://site.example/', 'https://site.example/']);
    await f.replay.executeStep(step({ frameUrl: 'https://site.example/', frameId: 0 }), 0);
    assert.deepEqual(f.clicks(), [1, 0]);
});

test('recorded child never falls back to a matching main document', async () => {
    const f = fixture(['https://site.example/', 'about:blank'], { cancelAfterWait: true });
    await assert.rejects(f.replay.executeStep(step({ frameUrl: 'https://site.example/', frameId: 91 }), 0), /остановлена/);
    assert.deepEqual(f.clicks(), [0, 0]);
});

test('recorded child sharing the main URL only selects the current child', async () => {
    const f = fixture(['https://site.example/', 'https://site.example/']);
    await f.replay.executeStep(step({ frameUrl: 'https://site.example/', frameId: 91 }), 0);
    assert.deepEqual(f.clicks(), [0, 1]);
});
test('legacy step without frame metadata keeps main-frame behavior', async () => {
    const f = fixture(['https://site.example/', 'https://site.example/embed']);
    await f.replay.executeStep(step({}), 0);
    assert.deepEqual(f.clicks(), [1, 0]);
});
test('Stop after read-only frame discovery prevents the action', async () => {
    const f = fixture(['https://site.example/'], { cancelAfterProbe: true });
    await assert.rejects(f.replay.executeStep(step({ frameId: 0 }), 0), /остановлена/);
    assert.deepEqual(f.clicks(), [0]);
});
test('document replacement after discovery never clicks the replacement', async () => {
    const f = fixture(['https://site.example/'], { navigateAfterProbe: true });
    await assert.rejects(f.replay.executeStep(step({ frameId: 0 }), 0), /измен|document/i);
    assert.deepEqual(f.clicks(), [0]);
});
