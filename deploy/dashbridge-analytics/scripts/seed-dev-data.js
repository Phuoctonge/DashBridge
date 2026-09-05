'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '.dev-data');
const databasePath = path.join(dataDir, 'analytics.sqlite');
const reset = process.argv.includes('--reset');

fs.mkdirSync(dataDir, { recursive: true });
if (reset) {
    for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(databasePath + suffix); } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
}
if (fs.existsSync(databasePath)) {
    console.log(`Development database already exists: ${databasePath}`);
    process.exit(0);
}

const db = new DatabaseSync(databasePath);
db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        signal TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        extension_version TEXT NOT NULL
    ) STRICT;
    CREATE INDEX events_period ON events(period_start);
    CREATE INDEX events_feature_period ON events(feature_id, period_start);
    CREATE INDEX events_installation_period ON events(installation_id, period_start);
    CREATE INDEX events_version_period ON events(extension_version, period_start);
    CREATE TABLE service_metrics (metric TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
`);
const insert = db.prepare(`INSERT INTO events
    (event_id, installation_id, period_start, feature_id, signal, dimensions_json, event_count, extension_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const samples = [
    ['popup.opened', 'used', {}],
    ['dashbridge.opened', 'used', {}],
    ['grafana.panel.fill_removed', 'effective', { surface: 'dashbridge', state: 'enabled', renderer: 'uplot' }],
    ['grafana.panel.threshold', 'configured', { surface: 'direct_grafana', state: 'enabled' }],
    ['dashbridge.capture_all_zip', 'outcome', { outcome: 'success', format: 'zip', countBucket: '6_10' }],
    ['dashbridge.capture_all_zip', 'outcome', { outcome: 'partial', format: 'zip', countBucket: '11_plus' }],
    ['dashbridge.analysis_result', 'outcome', { outcome: 'no_data', mode: 'period', source: 'graph' }],
    ['batch.main_run', 'outcome', { outcome: 'success', workflow: 'main', countBucket: '2_5' }],
    ['batch.series_run', 'outcome', { outcome: 'timeout', workflow: 'series', countBucket: '11_plus' }],
    ['jira.batch_send', 'outcome', { outcome: 'success', countBucket: '2_5' }],
    ['recorder.replay_finished', 'outcome', { outcome: 'error' }],
    ['options.module_availability', 'configured', { module: 'grafana', state: 'enabled' }],
];
const versions = ['2.4.1', '2.4.2', '2.4.3'];
const hour = 3_600_000;
let sequence = 1;

db.exec('BEGIN');
try {
    for (let user = 1; user <= 24; user += 1) {
        const installationId = `10000000-0000-4000-8000-${String(user).padStart(12, '0')}`;
        for (let day = 0; day < 90; day += 1) {
            const activity = samples[(user * 7 + day * 5) % samples.length];
            const timestamp = Date.now() - day * 24 * hour - ((user + day) % 18) * hour;
            const periodStart = new Date(Math.floor(timestamp / hour) * hour).toISOString();
            const eventId = `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
            insert.run(eventId, installationId, periodStart, activity[0], activity[1],
                JSON.stringify(activity[2]), 1 + ((user + day) % 7), versions[(user + day) % versions.length]);
            sequence += 1;
        }
    }
    const metrics = {
        accepted_batches: 1842, rejected_batches: 17, accepted_aggregates: sequence - 1,
        client_dropped_aggregates: 3, storage_rejections: 0, rate_limit_rejections: 11,
        last_successful_ingest: new Date().toISOString(),
    };
    const writeMetric = db.prepare('INSERT INTO service_metrics (metric, value) VALUES (?, ?)');
    Object.entries(metrics).forEach(([name, value]) => writeMetric.run(name, String(value)));
    db.exec('COMMIT');
} catch (error) {
    db.exec('ROLLBACK');
    throw error;
} finally {
    db.close();
}
console.log(`Created ${sequence - 1} synthetic aggregates in ${databasePath}`);
