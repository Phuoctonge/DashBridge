'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { featureIds } = require('../analytics-contract');

test('synthetic scenarios cover the catalog and preserve existing databases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-seed-'));
    const run = (scenario, extra = []) => spawnSync(process.execPath,
        [require.resolve('../scripts/seed-dev-data'), `--scenario=${scenario}`, '--date=2026-09-07', ...extra],
        { env: { ...process.env, DATA_DIR: path.join(root, scenario) }, encoding: 'utf8' });
    try {
        for (const scenario of ['normal', 'empty', 'sparse', 'large', 'upgrade', 'catalog', 'outcomes', 'delivery']) {
            const result = run(scenario);
            assert.equal(result.status, 0, result.stderr);
            const db = new DatabaseSync(path.join(root, scenario, 'analytics.sqlite'));
            const scalar = sql => Object.values(db.prepare(sql).get())[0];
            assert.equal(scalar("SELECT COUNT(*) FROM events WHERE signal='effective' AND event_count<>1"), 0);
            assert.equal(scalar("SELECT COUNT(*) FROM (SELECT 1 FROM events WHERE signal='effective' GROUP BY installation_id,substr(period_start,1,10),feature_id,dimensions_json HAVING COUNT(*)>1)"), 0);
            if (scenario === 'empty') assert.equal(scalar('SELECT COUNT(*) FROM events'), 0);
            if (scenario === 'large') assert.equal(scalar('SELECT COUNT(*) FROM events'), 64800);
            if (scenario === 'sparse') assert.equal(scalar('SELECT COUNT(DISTINCT substr(period_start,1,10)) FROM events'), 3);
            if (scenario === 'catalog') assert.equal(scalar('SELECT COUNT(DISTINCT feature_id) FROM events'), featureIds.length);
            if (['catalog', 'outcomes', 'delivery'].includes(scenario)) {
                assert.equal(scalar("SELECT COUNT(DISTINCT json_extract(dimensions_json,'$.failure')) FROM events"), 5);
                assert.equal(scalar("SELECT COUNT(DISTINCT json_extract(dimensions_json,'$.outcome')) FROM events"), 11);
            }
            if (scenario === 'upgrade') {
                const versions = db.prepare('SELECT extension_version FROM events GROUP BY period_start ORDER BY period_start').all().map(row => row.extension_version);
                assert.deepEqual([...versions].sort(), versions);
                assert.equal(new Set(versions).size, 3);
            }
            const count = scalar('SELECT COUNT(*) FROM events');
            db.close();
            assert.equal(run(scenario).status, 0);
            const unchanged = new DatabaseSync(path.join(root, scenario, 'analytics.sqlite'));
            assert.equal(unchanged.prepare('SELECT COUNT(*) AS n FROM events').get().n, count);
            unchanged.close();
        }
        assert.equal(run('empty', ['--reset']).status, 0);
        assert(fs.readdirSync(path.join(root, 'empty')).some(name => name.startsWith('analytics.sqlite.backup-')));
        const unmarked = new DatabaseSync(path.join(root, 'normal', 'analytics.sqlite'));
        unmarked.exec("DELETE FROM service_metrics WHERE metric='fixture_version'"); unmarked.close();
        assert.notEqual(run('normal', ['--reset']).status, 0);
        assert(!fs.readdirSync(path.join(root, 'normal')).some(name => name.includes('.backup-')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
