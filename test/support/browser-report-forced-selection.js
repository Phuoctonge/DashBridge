'use strict';
/* global window, document, Blob */
const assert = require('node:assert/strict');

module.exports = async function inspectForcedSelection(context, extensionId) {
    const page = await context.newPage();
    try {
        await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await page.evaluate(() => {
            const overlay = document.createElement('div'); document.body.append(overlay);
            const panels = Array.from({ length: 10 }, (_, index) => ({ id: `forced-test-${index}`, title: `Панель ${index}` }));
            panels[9].paused = true;
            const fixture = window.forcedFixture = { panels, preferences: {}, calls: [], version: 0 };
            fixture.mount = () => {
                fixture.owner?.stop(); overlay.innerHTML = '';
                fixture.owner = window.DashBridgeReportAttachments.create({ host: overlay, overlay,
                    getPanels: () => panels, getContext: () => ({ version: fixture.version }),
                    preferences: fixture.preferences,
                    onPreferencesChange: async value => { fixture.preferences = value; },
                    collage: window.DashBridgeReportCollage, copyImage: async () => {},
                    captureSelection: async selected => { fixture.calls.push(selected.map(panel => panel.id)); return { images: [], errors: [] }; }
                });
                fixture.refresh = () => { fixture.owner.setReport({ panelResults: panels.slice(0, 8).map(panel => ({ panel, state: 'critical' })) }); fixture.owner.setCollecting(false); };
                fixture.refresh();
            };
            fixture.mount();
        });
        const selected = () => page.locator('.attachment-select:checked').evaluateAll(nodes => nodes.map(node => node.dataset.panelId));
        const pin = index => page.locator(`.attachment-panel-row[data-panel-id="forced-test-${index}"] .attachment-always`);
        assert.equal(await page.locator('.attachment-panel-row label label').count(), 0, 'screenshot controls must have independent labels');
        assert.equal(await pin(8).count(), 1, 'a panel excluded from the text/SLA report needs an independent always-in-collage control');
        await pin(8).check();
        assert.deepEqual(await selected(), ['forced-test-0', 'forced-test-1', 'forced-test-2', 'forced-test-3', 'forced-test-4', 'forced-test-5', 'forced-test-6', 'forced-test-8']);
        assert.deepEqual(await page.evaluate(() => window.forcedFixture.preferences.forcedIds), ['forced-test-8']);
        await pin(9).check();
        assert.equal((await selected()).length, 8, 'paused pinned panel must not be captured');
        await page.evaluate(() => window.forcedFixture.mount());
        assert(await pin(8).isChecked(), 'saved preference survives reopening');
        await page.locator('.attachment-none').click();
        assert.deepEqual(await selected(), ['forced-test-8'], 'clear ordinary selection retains always-in-collage panels');
        await page.evaluate(() => { const f = window.forcedFixture; f.owner.setCollecting(true); f.refresh(); });
        assert.deepEqual(await selected(), ['forced-test-8'], 'refresh retains pinned selection without a text result');
        await pin(8).uncheck();
        assert.deepEqual(await selected(), [], 'unpin respects explicitly empty ordinary selection');
        await pin(0).check(); await pin(1).check(); await pin(8).check();
        assert.match(await page.locator('.attachment-layout-hint').textContent(), /1 колонка × 3/);
        await page.evaluate(() => window.forcedFixture.owner.captureReport());
        assert.deepEqual(await page.evaluate(() => window.forcedFixture.calls.at(-1)), ['forced-test-0', 'forced-test-1', 'forced-test-8']);
        await page.locator('.attachment-sla').uncheck();
        assert((await selected()).includes('forced-test-8'), 'filter changes preserve forced panels');
        await page.locator('.attachment-sla').check();
        for (const index of [2, 3, 4, 5]) await pin(index).check();
        assert(await pin(6).isDisabled(), 'eight stored forced IDs including paused panel cap further pins');
        await pin(9).uncheck();
        assert(!await pin(6).isDisabled(), 'unpinning frees a forced slot');
        await page.evaluate(() => { const f = window.forcedFixture; f.preferences = { selectedIds: ['forced-test-0', 'forced-test-1'], forcedIds: [] }; f.mount(); });
        await pin(0).check();
        await page.locator('.attachment-select[data-panel-id="forced-test-1"]').uncheck();
        await pin(0).uncheck();
        assert.deepEqual(await selected(), ['forced-test-0'], 'unpinning restores the original manual choice after another panel changes');
        await page.evaluate(() => {
            const f = window.forcedFixture;
            f.preferences = { selectedIds: f.panels.slice(0, 8).map(panel => panel.id) }; f.mount();
            f.owner.setReport({ panelResults: [f.panels[0], f.panels[8]].map(panel => ({ panel, state: 'critical' })) });
        });
        await page.locator('.attachment-select[data-panel-id="forced-test-8"]').check();
        const saved = await page.evaluate(() => window.forcedFixture.preferences.selectedIds);
        assert(saved.includes('forced-test-8'), 'a new explicit choice must survive persistence when old intentions fill the limit');
        assert.equal(saved.length, 8);
        await page.evaluate(() => window.forcedFixture.owner.stop());
        return 'forced screenshot selection: persistence, priority, text independence, pause, cap, refresh and unpin';
    } finally { await page.close(); }
};
