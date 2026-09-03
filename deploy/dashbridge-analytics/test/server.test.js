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

test.before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-analytics-'));
    child = spawn(process.execPath, ['server.js'], {
        cwd: appDir,
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_GATEWAY_USER: 'admin' },
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
    const body = JSON.stringify({ schemaVersion: 1,
        installationId: '00000000-0000-4000-8000-000000000020', droppedAggregates: 2, events: [event] });
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
    assert.equal(report.totals.events, 3);
    assert.equal(report.operations.acceptedBatches, 2);
    assert.equal(report.operations.clientDroppedAggregates, 2);
    assert.equal(JSON.stringify(report).includes('127.0.0.1'), false);
});
