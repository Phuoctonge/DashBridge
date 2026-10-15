'use strict';
/* global chrome, document */
const assert = require('node:assert/strict');

module.exports = async function inspectWorklogUi(context, extensionId) {
    const result = { name: 'Worklog local UI (no Jira writes)', status: 'passed', checks: [], failures: [] };
    const page = await context.newPage();
    const url = `chrome-extension://${extensionId}/pages/worklog/worklog.html`;
    const writes = [];
    const route = async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (request.method() !== 'GET') { writes.push(request.method()); return route.abort(); }
        if (pathname.endsWith('/myself')) return route.fulfill({ json: { displayName: 'UI fixture' } });
        const key = pathname.split('/').pop();
        await new Promise(resolve => setTimeout(resolve, key === 'UI-SLOW' ? 700 : 80));
        return route.fulfill({ json: { fields: { summary: `Title ${key}` } } });
    };
    const entry = (id, extra = {}) => ({ id, issueId: 'UI-1', issueKey: 'UI-1', summary: 'Fixture',
        dateStarted: '15/10/2026 10:30', timeSpent: '4', description: 'Initial', status: 'new', ...extra });
    const input = field => page.locator(`[data-field="${field}"]`).first();
    const edit = async (field, value) => { await input(field).fill(value); await input(field).press('Tab'); };
    const saved = async () => {
        await page.waitForTimeout(150);
        return page.evaluate(async () => (await chrome.storage.local.get('jiraWorklogs')).jiraWorklogs);
    };
    const seed = async rows => {
        await page.evaluate(rows => chrome.storage.local.set({ jiraWorklogs: rows, jiraSortOrder: 'desc', jiraIssueCache: {} }), rows);
        await page.reload(); await page.waitForSelector('.task-row');
    };
    const check = async (name, action) => {
        try { await action(); result.checks.push(name); }
        catch (error) { result.status = 'failed'; result.failures.push({ name, error: error.message }); }
    };
    let original;
    try {
        await context.route('https://worklog-ui.invalid/**', route);
        await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
        const worker = context.serviceWorkers().find(worker => new URL(worker.url()).host === extensionId);
        original = await worker.evaluate(async () => ({
            local: await chrome.storage.local.get(['jiraWorklogs', 'jiraSortOrder', 'jiraIssueCache']),
            sync: await chrome.storage.sync.get('jiraBaseUrl')
        }));
        await worker.evaluate(() => chrome.storage.sync.set({ jiraBaseUrl: 'https://worklog-ui.invalid' }));
        await page.goto(url); await page.waitForSelector('.task-row');
        await check('calendar trigger and Escape are keyboard accessible', async () => {
            await seed([entry('keyboard-trigger')]);
            await input('dateStarted').focus(); await page.keyboard.press('Tab');
            assert.equal(await page.locator('.calendar-btn').evaluate(node => node === document.activeElement), true,
                'Tab from the date must reach its calendar button');
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('.custom-picker').count(), 1);
            await page.locator('#pH').focus(); await page.keyboard.press('Escape');
            assert.equal(await page.locator('.custom-picker').count(), 0);
            assert.equal(await page.locator('.calendar-btn').evaluate(node => node === document.activeElement), true,
                'Escape must restore focus to the calendar button');
        });
        await check('calendar month, day and Now actions work from the keyboard', async () => {
            await seed([entry('keyboard-actions', { dateStarted: '31/01/2026 10:30' })]);
            await page.locator('.calendar-btn').click();
            await page.locator('#next').focus(); await page.keyboard.press('Enter');
            assert.equal(await page.locator('.picker-title').innerText(), 'Февраль 2026');
            await page.locator('#prev').focus(); await page.keyboard.press('Space');
            assert.equal(await page.locator('.picker-title').innerText(), 'Январь 2026');
            const day = page.locator('.day:not(.prev-month)').filter({ hasText: /^15$/ });
            await day.focus(); await page.keyboard.press('Space');
            assert.equal((await saved())[0].dateStarted, '15/01/2026 10:30');
            await page.locator('.calendar-btn').click();
            await page.locator('#setNow').focus(); await page.keyboard.press('Enter');
            assert.equal((await saved())[0].dateStarted, '15/10/2026 12:00');
            assert.equal(await page.locator('.custom-picker').count(), 0);
        });
        await check('calendar navigates adjacent months, retains time, closes on Escape', async () => {
            await seed([entry('calendar', { dateStarted: '31/01/2026 10:30' })]);
            await page.locator('.calendar-btn').click();
            await page.locator('#pH').fill('12'); await page.locator('#pM').fill('45');
            await page.locator('#next').click();
            assert.equal(await page.locator('.custom-picker').count(), 1, 'month navigation must keep calendar open');
            assert.equal(await page.locator('.picker-title').innerText(), 'Февраль 2026');
            assert.equal(await page.locator('#pH').inputValue(), '12');
            await page.locator('#prev').click();
            assert.equal(await page.locator('.picker-title').innerText(), 'Январь 2026');
            await page.locator('#prev').click();
            assert.equal(await page.locator('.picker-title').innerText(), 'Декабрь 2025');
            await page.locator('#next').click(); await page.locator('#next').click();
            await page.locator('.day:not(.prev-month)').filter({ hasText: /^28$/ }).click();
            assert.equal((await saved())[0].dateStarted, '28/02/2026 12:45');
            await page.locator('.calendar-btn').click();
            await page.keyboard.press('Escape'); assert.equal(await page.locator('.custom-picker').count(), 0);
        });
        await check('reopening calendars retains one owner and outside click closes it', async () => {
            await seed([entry('first'), entry('second')]);
            await page.locator('.calendar-btn').nth(1).click();
            await page.locator('.calendar-btn').nth(0).click();
            await page.locator('#pH').click(); await page.locator('.calendar-btn').nth(0).click();
            assert.equal(await page.locator('.custom-picker').count(), 1);
            await page.locator('h1').click(); assert.equal(await page.locator('.custom-picker').count(), 0);
        });
        await check('invalid calendar time does not change persisted date', async () => {
            await seed([entry('time')]); await page.locator('.calendar-btn').click();
            await page.locator('#pH').fill('99'); await page.locator('#pM').fill('99');
            await page.locator('.day:not(.prev-month)').filter({ hasText: /^15$/ }).click();
            assert.equal((await saved())[0].dateStarted, '15/10/2026 10:30');
            assert.equal(await page.locator('.custom-picker').count(), 1);
        });
        await check('invalid manual date is rejected; valid date and decimal hours regroup', async () => {
            await seed([entry('date')]); await edit('dateStarted', '45/09/2026 10:00');
            assert.equal((await saved())[0].dateStarted, '15/10/2026 10:30');
            await edit('dateStarted', '14/10/2026 09:00'); await edit('timeSpent', '2,5');
            await page.locator('#sortToggle').click();
            assert.match(await page.locator('.day-header').innerText(), /14\/10\/2026.*2\.5/s);
        });
        await check('clone and delete keep daily header consistent with totals', async () => {
            await seed([entry('clone')]); await page.locator('.clone-row').click();
            assert.equal(await page.locator('.day-total').innerText(), '8.0 ч.');
            await page.locator('.delete-row').first().click();
            assert.equal(await page.locator('.day-total').innerText(), '4.0 ч.');
            await page.locator('#undoAction').click(); assert.equal(await page.locator('.task-row').count(), 2);
        });
        await check('calendar and text edits display and persist draft status', async () => {
            await seed([entry('sent', { status: 'sent' })]); await page.locator('.calendar-btn').click();
            await page.locator('.day:not(.prev-month)').filter({ hasText: /^16$/ }).click();
            assert.equal((await saved())[0].status, 'new');
            assert.equal(await page.locator('.status-badge').textContent(), 'Черновик');
            await seed([entry('sent', { status: 'sent' })]); await edit('description', 'Changed');
            assert.equal((await saved())[0].status, 'new');
            assert.equal(await page.locator('.status-badge').textContent(), 'Черновик');
        });
        await check('title responses match current key without replacing active inputs', async () => {
            await seed([entry('lookup')]); await edit('issueId', 'UI-SLOW');
            await edit('issueId', 'UI-FAST');
            await input('description').fill('Still typing');
            await page.waitForTimeout(850);
            assert.equal(await page.locator('.summary-display').innerText(), 'Title UI-FAST');
            assert.equal(await page.locator('.col-key a').getAttribute('href'), 'https://worklog-ui.invalid/browse/UI-FAST');
            assert.equal(await input('description').inputValue(), 'Still typing');
            assert.equal(await input('description').evaluate(node => node === document.activeElement), true);
            await input('description').press('Tab'); assert.equal((await saved())[0].description, 'Still typing');
        });
        await check('Ctrl+Z inside editor does not undo row creation', async () => {
            await seed([entry('history')]); await page.locator('#addRow').click();
            await input('description').pressSequentially('Typed'); await page.keyboard.press('Control+z');
            assert.equal(await page.locator('.task-row').count(), 2);
        });
        await check('undo invalidates pending title response for the previous row object', async () => {
            await seed([entry('undo-lookup')]); await edit('issueId', 'UI-SLOW');
            await page.locator('h1').click(); await page.keyboard.press('Control+z');
            await page.waitForTimeout(800);
            assert.equal(await input('issueId').inputValue(), 'UI-1');
            assert.equal(await page.locator('.summary-display').innerText(), 'Fixture');
        });
        await check('clear sent cancel, confirm and undo; persistence after reload', async () => {
            await seed([entry('sent', { status: 'sent' }), entry('draft')]);
            await page.locator('#clearSent').click(); await page.keyboard.press('Escape');
            assert.equal(await page.locator('.task-row').count(), 2);
            await page.locator('#clearSent').click(); await page.locator('.worklog-confirm-ok').click();
            assert.equal(await page.locator('.task-row').count(), 1);
            await page.locator('h1').click(); await page.keyboard.press('Control+z');
            assert.equal(await page.locator('.task-row').count(), 2);
            await edit('description', 'Persist'); await saved(); await page.reload();
            await page.waitForSelector('.task-row'); assert.equal(await input('description').inputValue(), 'Persist');
        });
        assert.deepEqual(writes, [], 'UI checks must never send Jira writes');
    } catch (error) { result.status = 'failed'; result.failures.push({ name: 'setup', error: error.stack }); }
    finally {
        if (original) await page.evaluate(async original => {
            await chrome.storage.local.remove(['jiraWorklogs', 'jiraSortOrder', 'jiraIssueCache']);
            await chrome.storage.local.set(original.local);
            await chrome.storage.sync.remove('jiraBaseUrl'); await chrome.storage.sync.set(original.sync);
        }, original);
        await context.unroute('https://worklog-ui.invalid/**', route); await page.close();
    }
    return result;
};
