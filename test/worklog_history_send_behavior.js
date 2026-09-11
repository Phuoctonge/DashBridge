'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('pages/worklog/worklog.js', 'utf8');
const historyCode = source.slice(source.indexOf('    function saveToHistory()'), source.indexOf('    // --- Helpers ---'));
const sendCode = source.slice(source.indexOf('    sendAllBtn.onclick = async () => {'), source.lastIndexOf('\n});'));
const row = (id = 'row-1') => ({ id, issueId: 'TEST-1', issueKey: 'TEST-1',
    dateStarted: '09/09/2026 12:00', timeSpent: '1', description: 'initial', status: 'new' });

function fixture({ rows = [row()], failCommit = false, outcomes = [] } = {}) {
    const posted = [], persisted = [], alerts = [];
    const context = vm.createContext({ console: { error() {} }, worklogs: structuredClone(rows),
        historyStack: [], redoStack: [], MAX_HISTORY: 5, sendingWorklogs: false, sendAllBtn: {},
        document: { querySelectorAll: () => [] },
        jiraClient: { submitWorklog: async value => { posted.push(value); return { ok: outcomes.shift() ?? true }; } },
        worklogWriter: { write: async value => {
            if (failCommit) throw new Error('synthetic disk failure');
            persisted.push(structuredClone(value));
        } }, sortOrder: 'desc', issueCache: {},
        parseDate: () => new Date('2026-09-09T12:00:00Z'), findWorklogRow: () => null,
        setTimeout: callback => { callback(); return 1; }, renderTable() {}, updateStats() {},
        saveToStorage() {}, showToast() {}, alert: message => alerts.push(message),
        DashBridgeAnalytics: null, DashBridgeAnalyticsContract: null });
    vm.runInContext(historyCode + '\n' + sendCode, context);
    return { context, posted, persisted, alerts, run: code => vm.runInContext(code, context),
        send: () => context.sendAllBtn.onclick() };
}

(async () => {
    // Removing acknowledgment reconciliation would make the same stable ID POST twice.
    const edited = fixture();
    edited.run("saveToHistory(); worklogs[0].description = 'edited';");
    await edited.send();
    edited.run('undo()');
    assert.equal(edited.context.worklogs[0].description, 'initial', 'draft fields still undo');
    assert.equal(edited.context.worklogs[0].status, 'sent', 'Undo must retain acknowledged POST');
    await edited.send();
    edited.run('redo()');
    await edited.send();
    assert.equal(edited.posted.length, 1, 'Undo/Redo never replays the acknowledged POST');

    // A redo snapshot can exist before Send and must also receive the acknowledgment.
    const redone = fixture();
    redone.run("saveToHistory(); worklogs[0].description = 'later'; undo();");
    await redone.send();
    redone.run('redo()');
    assert.equal(redone.context.worklogs[0].description, 'later');
    await redone.send();
    assert.equal(redone.posted.length, 1, 'preexisting redo snapshot cannot rearm a sent row');

    const recreated = fixture();
    recreated.run('saveToHistory(); worklogs = []; undo();');
    await recreated.send();
    assert.equal(recreated.posted.length, 1);
    recreated.run('redo(); undo(); undo();');
    assert.equal(recreated.context.worklogs[0].status, 'sent');
    await recreated.send();
    assert.equal(recreated.posted.length, 1, 'removal and history recreation retain acknowledgment');

    const partial = fixture({ rows: [row('first'), row('second')], outcomes: [true, false, true] });
    partial.run("saveToHistory(); worklogs[0].description = 'edited';");
    await partial.send();
    partial.run('undo()');
    assert.equal(partial.context.worklogs[0].status, 'sent');
    assert.equal(partial.context.worklogs[1].status, 'new', 'failed POST remains retryable');
    await partial.send();
    assert.equal(partial.posted.length, 3, 'partial retry sends only the unacknowledged row');

    const diskFailure = fixture({ rows: [row('first'), row('second')], failCommit: true });
    diskFailure.run("saveToHistory(); worklogs[0].description = 'edited';");
    await diskFailure.send();
    assert.equal(diskFailure.posted.length, 1, 'failed commit stops the batch');
    assert.equal(diskFailure.alerts.length, 1);
    diskFailure.run('undo(); redo(); undo();');
    assert.equal(diskFailure.context.worklogs[0].status, 'sent', 'ACK survives even when its commit failed');
    assert.equal(diskFailure.context.worklogs[1].status, 'new');
    console.log('PASS Worklog acknowledged sends survive Undo/Redo, recreation, partial send and failed commit');
})().catch(error => { console.error(error); process.exitCode = 1; });
