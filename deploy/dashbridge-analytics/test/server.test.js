'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appDir = path.resolve(__dirname, '..');
const port = 18765;
let child; let dataDir;
let publicDir;

test.before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-analytics-'));
    publicDir = path.join(dataDir, 'public');
    fs.cpSync(path.join(appDir, 'public'), publicDir, { recursive: true });
    child = spawn(process.execPath, ['server.js'], {
        cwd: appDir,
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir,
            PUBLIC_DIR: publicDir, ADMIN_GATEWAY_USER: 'admin' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server-start-timeout')), 5000);
        child.once('exit', code => reject(new Error(`server-exited-${code}`)));
        child.stdout.on('data', chunk => {
            if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
        });
    });
});

test('admin assets update without restarting ingestion', async () => {
    const assetPath = path.join(publicDir, 'style-extra.css');
    const original = fs.readFileSync(assetPath, 'utf8');
    const marker = `/* live-${Date.now()} */`;
    fs.writeFileSync(assetPath, original + marker);
    const response = await fetch(`http://127.0.0.1:${port}/admin/style-extra.css`, {
        headers: { 'x-dashbridge-admin': 'admin' },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(marker.replace(/[/*]/g, '\\$&')));
});

test.after(async () => {
    if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('ingestion is public, deduplicated and admin data is authenticated', async () => {
    const event = {
        eventId: '00000000-0000-4000-8000-000000000010',
        periodStart: new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString(),
        featureId: 'popup.opened', signal: 'used', dimensions: {}, count: 3,
        extensionVersion: '2.4.2',
    };
    const categorizedEvent = {
        ...event, eventId: '00000000-0000-4000-8000-000000000011',
        featureId: 'dashbridge.report_panel_settings_saved', signal: 'configured',
        dimensions: { countBucket: '6_10' }, count: 1,
    };
    const body = JSON.stringify({ schemaVersion: 1,
        installationId: '00000000-0000-4000-8000-000000000020', droppedAggregates: 2,
        events: [event, categorizedEvent] });
    const ingest = () => fetch(`http://127.0.0.1:${port}/v1/events/batch`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal((await ingest()).status, 202);
    const duplicate = await ingest();
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).accepted, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/data`, {
        headers: { authorization: 'Basic attacker-controlled-value', 'x-dashbridge-admin': 'attacker' },
    })).status, 401, 'the app must not implement or trust browser Basic Auth');
    const admin = await fetch(`http://127.0.0.1:${port}/admin/api/data`, {
        headers: { 'x-dashbridge-admin': 'admin' },
    });
    assert.equal(admin.status, 200);
    const report = await admin.json();
    assert.equal(report.totals.installations, 1);
    assert.equal(report.totals.events, 4);
    assert.deepEqual(report.dimensions, [{
        featureId: 'dashbridge.report_panel_settings_saved', signal: 'configured',
        dimensions: '{"countBucket":"6_10"}', events: 1, users: 1,
    }]);
    assert.equal(report.operations.acceptedBatches, 2);
    assert.equal(report.operations.clientDroppedAggregates, 2);
    assert.equal(JSON.stringify(report).includes('127.0.0.1'), false);
});

test('reports preserve calendar gaps, filter versions, dimensions and page stable complete results', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const timestamp = Date.parse(today);
    const installationId = '00000000-0000-4000-9000-000000000001';
    const make = (index, age, version, featureId = 'popup.opened', signal = 'used', dimensions = {}) => ({
        eventId: `00000000-0000-4000-9000-${String(index + 100).padStart(12, '0')}`,
        periodStart: new Date(timestamp - age * 86400000).toISOString(),
        featureId, signal, dimensions, count: 1, extensionVersion: version
    });
    const events = Array.from({ length: 130 }, (_, index) => make(index, 2, '2.4.2'));
    events.push(make(131, 0, '2.4.3'), make(132, 0, '2.4.4'),
        make(133, 0, '2.4.3', 'grafana.panel.fill_removed', 'effective', { surface: 'dashbridge', renderer: 'flot' }),
        make(134, 0, '2.4.3', 'internal.panel_tools_apply', 'outcome', { surface: 'dashbridge', failure: 'timeout', outcome: 'error' }));
    for (let start = 0; start < events.length; start += 100) {
        const response = await fetch(`http://127.0.0.1:${port}/v1/events/batch`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1,
                installationId, droppedAggregates: 0, events: events.slice(start, start + 100) }) });
        assert.equal(response.status, 202);
    }
    const get = async query => {
        const response = await fetch(`http://127.0.0.1:${port}/admin/api/data?days=7&installation=${installationId}&${query}`, {
            headers: { 'x-dashbridge-admin': 'admin' }
        });
        assert.equal(response.status, 200);
        return response.json();
    };
    const old = await get('version=2.4.2');
    assert.equal(old.installations[0].version, '2.4.2');
    assert.deepEqual(old.installations[0].latestVersion.split(',').sort(), ['2.4.3', '2.4.4']);
    assert.equal(old.timeline.length, 7);
    assert.equal(old.timeline.at(-1).events, 0);
    assert.equal(old.timeline.at(-2).events, 0);
    assert.equal(old.timeline.at(-3).events, 130);
    assert.equal(old.pagination.actions.total, 130);
    assert.equal(old.actions.length, 100);
    assert.equal(old.pagination.actions.hasMore, true);
    const second = await get('version=2.4.2&actionsPage=1');
    assert.equal(second.actions.length, 30);
    assert.equal(second.pagination.actions.hasMore, false);
    const empty = await get('surface=direct_grafana');
    assert.equal(empty.totals.events, 0);
    assert.equal(empty.timeline.length, 7);
    const filtered = await get('surface=dashbridge&renderer=flot');
    assert.equal(filtered.totals.events, 1);
    assert.equal(filtered.features[0].effectiveUsers, 1);
    assert(!filtered.features[0].supportedSignals.includes('used'));
    const failure = await get('outcome=error&failure=timeout');
    assert.equal(failure.problems.length, 1);
    assert.equal(failure.problems[0].failure, 'timeout');
    const sorted = await get('actionsSort=version&actionsDirection=desc');
    assert.equal(sorted.actions[0].version, '2.4.4');
    assert.equal((await get('actionsPage=Infinity&actionsSort=event_id%3BDELETE')).pagination.actions.page, 1);
    assert.equal((await get('signal=used')).versions.every(row => row.outcomes === 0), true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
