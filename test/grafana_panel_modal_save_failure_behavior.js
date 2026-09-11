'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

(async () => {
    let removed = false, saved = false, complete;
    const button = { disabled: false, addEventListener(_name, callback) { this.click = callback; } };
    const document = { createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }) };
    const overlay = {
        ownerDocument: document,
        querySelector: selector => selector === '.panel-tools-save' ? button : null,
        querySelectorAll: () => [],
        remove() { removed = true; },
    };
    const context = vm.createContext({ console, document, window: {}, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync('js/shared/grafana-panel-settings-modal.js', 'utf8'), context);
    context.window.DashBridgePanelSettingsModal.bindAdvancedControls({ overlay, state: {},
        onSave: () => { saved = true; return new Promise(resolve => { complete = resolve; }); },
    });
    const saving = button.click();
    assert.equal(saved, true); assert.equal(removed, false);
    complete(false);
    await saving;
    assert.equal(removed, false, 'failed save keeps the modal draft open');
    const retry = button.click(); complete(undefined); await retry;
    assert.equal(removed, true, 'successful retry closes the modal');
    console.log('PASS shared modal awaits save, keeps declined draft and preserves direct Grafana undefined-success contract');
})().catch(error => { console.error(error); process.exitCode = 1; });
