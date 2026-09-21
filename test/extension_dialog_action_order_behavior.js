'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function assertOrder(source, cancelPattern, primaryPattern, owner) {
    const cancel = source.search(cancelPattern);
    const primary = source.search(primaryPattern);
    assert(cancel >= 0, `${owner}: cancel/secondary action is missing`);
    assert(primary >= 0, `${owner}: primary action is missing`);
    assert(cancel < primary, `${owner}: cancel/secondary must precede the primary action in DOM order`);
}

assertOrder(read('pages/popup/popup.html'), /id="saveBtn"[\s\S]*?Сохранить/, /id="closeModal"[\s\S]*?Отмена/, 'popup dashboard editor');
const dashbridge = read('pages/dashbridge/dashbridge.html');
assertOrder(dashbridge, /id="savePanelBtn"[\s\S]*?Сохранить/, /id="closeModalBtn"[\s\S]*?Отмена/, 'DashBridge iframe editor');
assertOrder(dashbridge, /id="saveQuickPanelsBtn"[\s\S]*?Добавить графики/, /id="closeQuickAddModalBtn"[\s\S]*?Отмена/, 'DashBridge quick add');
assertOrder(dashbridge, /id="addSelectedDashboardPanelsBtn"[\s\S]*?Добавить выбранные/, /id="cancelDashboardPanelPickerBtn"[\s\S]*?Отмена/, 'DashBridge panel picker');

const jira = read('pages/popup/popup-jira.js');
assertOrder(jira, /data-jira-transfer-mode="move"[\s\S]*?Перенести/, /data-jira-transfer-mode="cancel"[\s\S]*?Отмена/, 'Jira transfer dialog');
assert(jira.indexOf('data-jira-transfer-mode="move"') < jira.indexOf('data-jira-transfer-mode="copy"'), 'Jira transfer: destructive move must be first');

assertOrder(read('pages/batch/batch.html'), /id="applyPanelPickerBtn"[\s\S]*?Использовать выбранные/, /id="cancelPanelPickerBtn"[\s\S]*?Отмена/, 'Batch panel picker');
assertOrder(read('pages/test-runner/test-selector.html'), /id="selectorApply"[\s\S]*?Сохранить выбор/, /id="selectorCancel"[\s\S]*?Отмена/, 'Test Runner selector');

const modal = read('pages/dashbridge/dashbridge-modal.js');
assert(modal.indexOf("'btn btn-primary modal-ok'") < modal.indexOf("'btn btn-outline modal-cancel'"), 'shared DashBridge modal: primary must precede cancel');
assert(!/row-reverse|(?:^|[;{\s])order\s*:\s*-?\d/.test(read('pages/shared/theme.css')), 'shared dialog styling must not reverse keyboard order');
assert(/\.modal-actions \.btn\s*\{[^}]*flex:\s*0\s+0\s+auto/.test(read('pages/dashbridge/dashbridge-interactions.css')), 'modal action buttons must keep intrinsic width on desktop');
assert(!/\.btn-save\s*\{[^}]*flex\s*:/.test(read('pages/popup/popup.css')), 'popup save button must not stretch to fill the modal');

console.log('Extension dialog action order passed');
