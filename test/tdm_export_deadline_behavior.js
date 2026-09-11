'use strict';
// Real serialized exporter with a controlled DOM/clock and external image I/O.
// A deadline checked only between messages must fail these suspended-I/O cases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

async function runExport(mode) {
    let now = 0, nextTimer = 0, restored = 0, top = 600, canvasDraws = 0, fetchSignal, readerAborted = false;
    const timers = new Map();
    const clock = {
        setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { at: now + ms, callback }); return id; },
        clearTimeout(id) { timers.delete(id); },
    };
    class Clock extends Date { static now() { return now; } }
    const image = { src: 'https://fixture.example/image.png', className: '', complete: true, naturalWidth: 10, naturalHeight: 10,
        closest: () => null };
    const message = { id: 'message-1', querySelector: () => null, querySelectorAll: selector => selector === 'img' ? [image] : [] };
    const chat = { scrollHeight: 1000, get scrollTop() { return top; }, set scrollTop(value) { top = value; if (value === 600) restored++; } };
    const context = { console, Date: Clock, AbortController, ...clock,
        document: { querySelector: () => chat, querySelectorAll: () => [message], createElement: () => ({
            getContext: () => ({ drawImage() { canvasDraws++; } }), toDataURL: () => 'data:image/png;base64,' + 'A'.repeat(120),
        }) },
        fetch: async (url, options) => {
            fetchSignal = options?.signal;
            if (mode === 'headers') return new Promise(() => {});
            if (mode === 'network-error') throw new Error('Network unavailable');
            return { blob: async () => mode === 'body' ? new Promise(() => {}) : { type: 'image/png' } };
        },
        FileReader: class {
            readAsDataURL() { if (mode !== 'reader') { this.result = 'data:image/png;base64,' + 'A'.repeat(120); this.onloadend(); } }
            abort() { readerAborted = true; this.onabort?.(); }
        },
        chrome: { runtime: { sendMessage: async message => message.action === 'tdmExportPhoto' && mode === 'photo-transfer'
            ? new Promise(() => {}) : { ok: true } } },
    };
    vm.createContext(context); vm.runInContext(fs.readFileSync('pages/popup/popup-tdm-page-export.js', 'utf8'), context);
    let outcome;
    context._tdmExportScriptInternal({ savePhotos: true, format: 'html', photoExportId: 'fixture' })
        .then(value => { outcome = { value }; }, error => { outcome = { error }; });
    for (let turn = 0; turn < 1000 && !outcome; turn++) {
        for (let tick = 0; tick < 15; tick++) await Promise.resolve();
        if (outcome) break;
        const pending = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending || pending[1].at > 660_000) { now = 660_000; break; }
        timers.delete(pending[0]); now = pending[1].at; pending[1].callback();
    }
    for (let tick = 0; tick < 15; tick++) await Promise.resolve();
    return { outcome, restored, top, now, canvasDraws, fetchSignal, readerAborted, timers: timers.size };
}
for (const mode of ['headers', 'body', 'reader', 'photo-transfer']) test(`TDM aborts ${mode} wait at the total deadline and restores scroll`, async () => {
    const result = await runExport(mode);
    assert(result.outcome, `${mode} must settle instead of waiting forever`);
    assert.match(result.outcome.error?.message || '', /10 минут/);
    assert.equal(result.top, 600); assert.equal(result.restored, 1); assert.equal(result.timers, 0);
    assert(result.now <= 600_000, 'no fallback may restart work after the total deadline');
    if (mode === 'headers' || mode === 'body') assert.equal(result.fetchSignal?.aborted, true);
    if (mode === 'reader') assert.equal(result.readerAborted, true);
});
test('Ordinary image network failure preserves canvas fallback and successful export cleanup', async () => {
    const result = await runExport('network-error');
    assert.equal(result.outcome?.value?.success, true);
    assert.equal(result.outcome.value.photoCount, 1); assert.equal(result.canvasDraws, 1);
    assert.equal(result.top, 600); assert.equal(result.timers, 0);
});
test('Successful image fetch still exports photo bytes and clears the watchdog', async () => {
    const result = await runExport('success');
    assert.equal(result.outcome?.value?.success, true); assert.equal(result.outcome.value.photoCount, 1);
    assert.equal(result.canvasDraws, 0); assert.equal(result.top, 600); assert.equal(result.timers, 0);
});
