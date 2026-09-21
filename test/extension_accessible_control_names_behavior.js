'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const popup = fs.readFileSync('pages/popup/popup.html', 'utf8');
const dashboard = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
const worklog = fs.readFileSync('pages/worklog/worklog.js', 'utf8');

for (const id of ['tdmExportStart', 'tdmExportEnd', 'tdmExportFormat', 'tdmExcludeUserText', 'newBtnName', 'newBtnUrl']) {
    assert.match(popup, new RegExp(`id="${id}"[^>]*aria-label=`), `${id} must have an accessible name`);
}
for (const id of ['absTimeFrom', 'absTimeTo', 'quickRangeSearch', 'crosshairThicknessSlider', 'newPanelUrl', 'newPanelWidth']) {
    assert.match(dashboard, new RegExp(`(?:aria-label="[^"]+"[^>]*id="${id}"|id="${id}"[^>]*aria-label=)`), `${id} must have an accessible name`);
}
assert.match(dashboard, /class="gtp-icon-btn calendar-btn"[^>]*aria-label="Открыть календарь начала диапазона"/);
assert.match(dashboard, /class="gtp-icon-btn calendar-btn"[^>]*aria-label="Открыть календарь конца диапазона"/);
assert.match(worklog, /data-field="issueId"[^>]*aria-label="Задача Jira"/);
assert.match(worklog, /data-field="timeSpent"[^>]*aria-label="Затраченное время"/);
assert.match(worklog, /data-field="description"[^>]*aria-label="Описание работы"/);

console.log('Extension accessible control names passed');
