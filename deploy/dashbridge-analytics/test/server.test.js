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
