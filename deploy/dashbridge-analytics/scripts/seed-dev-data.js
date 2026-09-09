'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validateBatch, featureIds, signalsFor } = require('../analytics-contract');
const SCENARIOS = ['normal', 'empty', 'sparse', 'large', 'upgrade', 'catalog', 'outcomes', 'delivery'];
const FIXTURE_VERSION = '2';
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const scenario = argument('scenario', 'normal');
if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
const day = argument('date', new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('Invalid fixture date');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '.dev-data', scenario));
const databasePath = path.join(dataDir, 'analytics.sqlite');
fs.mkdirSync(dataDir, { recursive: true });
if (fs.existsSync(databasePath)) {
    const existing = new DatabaseSync(databasePath, { readOnly: true });
    let metadata;
    try { metadata = existing.prepare("SELECT value FROM service_metrics WHERE metric = 'fixture_version'").get()?.value; }
    catch { /* An unmarked local copy is never overwritten. */ }
    existing.close();
    if (!process.argv.includes('--reset')) {
        console.log(`Keeping existing database (${metadata ? 'fixtures ' + metadata : 'unmarked local data'}): ${databasePath}`);
        console.log('Fixtures are not refreshed automatically. Use a new directory or --reset for marked synthetic data.');
        process.exit(0);
    }
    if (!metadata) throw new Error('Refusing to reset an unmarked database. Choose a new synthetic directory.');
    // Preserve the complete SQLite file set before replacing a marked test fixture.
    const suffix = `.backup-${Date.now()}`;
    for (const extension of ['', '-wal', '-shm']) {
        const source = path.join(dataDir, `analytics.sqlite${extension}`);
        const destination = source + suffix;
        if (path.dirname(source) !== dataDir || path.dirname(destination) !== dataDir) throw new Error('Unsafe fixture path');
        if (fs.existsSync(source)) fs.renameSync(source, destination);
    }
}
const db = new DatabaseSync(databasePath);
db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE events (event_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL,
        period_start TEXT NOT NULL, feature_id TEXT NOT NULL, signal TEXT NOT NULL,
        dimensions_json TEXT NOT NULL, event_count INTEGER NOT NULL, extension_version TEXT NOT NULL) STRICT;
    CREATE TABLE service_metrics (metric TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
`);
const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const writeMetric = db.prepare('INSERT INTO service_metrics VALUES (?, ?)');
const base = Date.parse(day);
const hour = 3_600_000;
let sequence = 0;
const evidence = new Set();
const versions = ['2.4.1', '2.4.2', '2.4.3'];
const idFor = (prefix, value) => `${prefix}0000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function add(user, age, featureId, signal, dimensions = {}, count = 1, version = '2.4.3') {
    const periodStart = new Date(base - age * 24 * hour).toISOString();
    const installationId = idFor('1', user);
    if (signal === 'effective') {
        const key = `${installationId}|${periodStart.slice(0, 10)}|${featureId}|${JSON.stringify(dimensions)}`;
        if (evidence.has(key)) return;
        evidence.add(key); count = 1;
    }
    const event = { eventId: idFor('2', ++sequence), periodStart, featureId, signal, dimensions, count, extensionVersion: version };
    if (!validateBatch({ schemaVersion: 1, installationId, droppedAggregates: 0, events: [event] })) {
        throw new Error(`Invalid fixture: ${featureId}/${signal}`);
    }
    insert.run(event.eventId, installationId, periodStart, featureId, signal,
        JSON.stringify(Object.fromEntries(Object.entries(dimensions).sort())), count, version);
}
db.exec('BEGIN');
try {
    if (scenario !== 'empty') {
        const users = scenario === 'large' ? 120 : 24;
        const days = scenario === 'large' ? 90 : 35;
        for (let age = days - 1; age >= 0; age -= 1) {
            if (scenario === 'sparse' && ![2, 9, 21].includes(age)) continue;
            for (let user = 1; user <= users; user += 1) {
                const version = scenario === 'upgrade' ? versions[age > 20 ? 0 : age > 8 ? 1 : 2] : '2.4.3';
                add(user, age, 'extension.daily_active', 'lifecycle', {}, 1, version);
                add(user, age, 'popup.opened', 'used', {}, 1 + user % 3, version);
                add(user, age, 'grafana.panel.fill_removed', 'configured', { surface: 'dashbridge', countBucket: '2_5' }, 1, version);
                add(user, age, 'grafana.panel.fill_removed', 'effective', { surface: 'dashbridge', renderer: user % 2 ? 'uplot' : 'flot', state: 'enabled' }, 1, version);
                add(user, age, 'dashbridge.report_generated', 'used', {}, 1, version);
                add(user, age, 'dashbridge.report_generated', 'outcome', { outcome: user % 7 === 0 ? 'partial' : 'success', countBucket: '2_5' }, 1, version);
            }
        }
    }
    if (scenario === 'catalog') {
        featureIds.forEach((featureId, index) => {
            const available = signalsFor(featureId);
            const signal = available.includes('used') ? 'used' : available[0];
            const candidates = signal === 'outcome' ? [{ outcome: 'success' }, {}]
                : signal === 'changed' ? [{ state: 'enabled' }, { theme: 'dark' }, {}]
                    : signal === 'configured' ? [{ state: 'enabled' }, {}] : [{}];
            const dimensions = candidates.find(value => validateBatch({ schemaVersion: 1, installationId: idFor('1', 500 + index), droppedAggregates: 0,
                events: [{ eventId: idFor('2', sequence + 1), periodStart: new Date(base).toISOString(), featureId, signal, dimensions: value, count: 1, extensionVersion: '2.4.3' }] }));
            add(500 + index, 0, featureId, signal, dimensions);
        });
    }
    if (['outcomes', 'delivery', 'catalog'].includes(scenario)) {
        const outcomes = ['success', 'partial', 'cancelled', 'invalid_input', 'unsupported_page', 'permission_denied', 'auth_required', 'timeout', 'no_data', 'busy', 'error'];
        outcomes.forEach((outcome, index) => {
            add(300 + index, 0, 'dashbridge.report_generated', 'used');
            add(300 + index, 0, 'dashbridge.report_generated', 'outcome', { outcome });
        });
        ['runtime_dependency_missing', 'visual_verification_failed', 'legend_apply_failed', 'timeout', 'unexpected_exception'].forEach((failure, index) => {
            add(400 + index, 0, 'internal.panel_tools_apply', 'outcome', { surface: 'dashbridge', outcome: 'error', failure });
        });
    }
    const metrics = { fixture_version: FIXTURE_VERSION, fixture_scenario: scenario, fixture_created_at: new Date(base).toISOString(),
        accepted_batches: Math.ceil(sequence / 100), accepted_aggregates: sequence, rejected_batches: scenario === 'delivery' ? 17 : 0,
        client_dropped_aggregates: scenario === 'delivery' ? 23 : 0, storage_rejections: scenario === 'delivery' ? 2 : 0,
        rate_limit_rejections: scenario === 'delivery' ? 11 : 0 };
    if (sequence) metrics.last_successful_ingest = new Date(base).toISOString();
    Object.entries(metrics).forEach(([name, value]) => writeMetric.run(name, String(value)));
    db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
console.log(`Created ${sequence} validated synthetic aggregates: ${scenario}, UTC ${day}, fixtures ${FIXTURE_VERSION}`);
