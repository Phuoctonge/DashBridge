'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validateBatch } = require('./analytics-contract');

const port = Math.max(1, Math.min(65535, Number(process.env.PORT) || 8080));
const dataDir = process.env.DATA_DIR || '/data';
const databasePath = path.join(dataDir, 'analytics.sqlite');
const retentionDays = Math.max(30, Math.min(1500, Number(process.env.RETENTION_DAYS) || 400));
const maxDatabaseBytes = Math.max(64, Number(process.env.MAX_DATABASE_MIB) || 512) * 1024 * 1024;
const adminGatewayUser = process.env.ADMIN_GATEWAY_USER || 'admin';

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        signal TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        extension_version TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS events_period ON events(period_start);
    CREATE INDEX IF NOT EXISTS events_feature_period ON events(feature_id, period_start);
    CREATE INDEX IF NOT EXISTS events_installation_period ON events(installation_id, period_start);
    CREATE INDEX IF NOT EXISTS events_version_period ON events(extension_version, period_start);
    CREATE TABLE IF NOT EXISTS service_metrics (
        metric TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT;
`);
const insert = db.prepare(`INSERT OR IGNORE INTO events
    (event_id, installation_id, period_start, feature_id, signal, dimensions_json,
     event_count, extension_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const readMetric = db.prepare('SELECT value FROM service_metrics WHERE metric = ?');
const writeMetric = db.prepare(`INSERT INTO service_metrics (metric, value) VALUES (?, ?)
    ON CONFLICT(metric) DO UPDATE SET value = excluded.value`);
const metricNumber = name => Number(readMetric.get(name)?.value) || 0;
const incrementMetric = (name, amount = 1) => writeMetric.run(name, String(metricNumber(name) + amount));
const setMetric = (name, value) => writeMetric.run(name, String(value));

const publicDir = path.join(__dirname, 'public');
const publicFiles = Object.freeze({
    '/admin': ['index.html', 'text/html; charset=utf-8'],
    '/admin/': ['index.html', 'text/html; charset=utf-8'],
    '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/admin/labels.js': ['labels.js', 'text/javascript; charset=utf-8'],
    '/admin/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/admin/style-extra.css': ['style-extra.css', 'text/css; charset=utf-8'],
});
const assets = new Map(Object.entries(publicFiles).map(([route, [file, contentType]]) => [
    route, { body: fs.readFileSync(path.join(publicDir, file)), contentType },
]));

const send = (response, status, body = '', headers = {}) => {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        ...headers,
    });
    response.end(body);
};
const sendJson = (response, status, value, headers = {}) => send(response, status, JSON.stringify(value), {
    'content-type': 'application/json; charset=utf-8', ...headers,
});
const requireAdmin = (request, response) => {
    // User authentication belongs to Caddy's audited basic_auth module. Caddy
    // removes any client-supplied copy and sets this identity only after bcrypt
    // verification. The app is not published on a host port.
    if (request.headers['x-dashbridge-admin'] === adminGatewayUser) return true;
    send(response, 401, 'Authentication required');
    return false;
};
const readJson = request => new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let tooLarge = false;
    request.on('data', chunk => {
        size += chunk.length;
        if (size > 262_144) { tooLarge = true; chunks.length = 0; return; }
        if (tooLarge) return;
        chunks.push(chunk);
    });
    request.on('end', () => {
        if (tooLarge) { reject(Object.assign(new Error('body-too-large'), { status: 413 })); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Object.assign(new Error('invalid-json'), { status: 400 })); }
    });
    request.on('error', reject);
});

const databaseSize = () => ['analytics.sqlite', 'analytics.sqlite-wal', 'analytics.sqlite-shm']
    .reduce((total, file) => {
        try { return total + fs.statSync(path.join(dataDir, file)).size; } catch { return total; }
    }, 0);
const databaseUsedSize = () => {
    const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size) || 4096;
    const pageCount = Number(db.prepare('PRAGMA page_count').get()?.page_count) || 0;
    const freePages = Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count) || 0;
    let walBytes = 0;
    try { walBytes = fs.statSync(path.join(dataDir, 'analytics.sqlite-wal')).size; } catch { /* no WAL yet */ }
    return Math.max(0, pageCount - freePages) * pageSize + walBytes;
};
const canonicalDimensions = value => JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
));
const maintain = () => {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    db.prepare('DELETE FROM events WHERE period_start < ?').run(cutoff);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('PRAGMA optimize');
};
maintain();
setInterval(maintain, 24 * 60 * 60 * 1000).unref();

function buildFilter(url, omitted = new Set()) {
    const days = Math.max(1, Math.min(retentionDays, Number(url.searchParams.get('days')) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const clauses = ['period_start >= ?']; const params = [cutoff];
    const allowed = { feature: 'feature_id', signal: 'signal', version: 'extension_version', installation: 'installation_id' };
    Object.entries(allowed).forEach(([query, column]) => {
        if (omitted.has(query)) return;
        const value = (url.searchParams.get(query) || '').trim();
        if (value && value.length <= 120) { clauses.push(`${column} = ?`); params.push(value); }
    });
    return { where: clauses.join(' AND '), params, days };
}

function adminData(url) {
    const filter = buildFilter(url);
    const queryFor = (source, select, group = '', order = '', limit = '', extra = '') => db.prepare(
        `SELECT ${select} FROM events WHERE ${source.where} ${extra} ${group} ${order} ${limit}`
    ).all(...source.params);
    const query = (select, group = '', order = '', limit = '', extra = '') =>
        queryFor(filter, select, group, order, limit, extra);
    const adoptionFilter = buildFilter(url, new Set(['feature', 'signal']));
    const activeInstallations = queryFor(adoptionFilter,
        'COUNT(DISTINCT installation_id) AS count')[0].count;
    const totals = query(`COALESCE(SUM(event_count), 0) AS events,
        COUNT(DISTINCT installation_id) AS installations,
        COUNT(*) AS aggregates, MIN(period_start) AS firstPeriod, MAX(period_start) AS lastPeriod`)[0];
    return {
        generatedAt: new Date().toISOString(), days: filter.days, retentionDays,
        databaseMiB: Math.round(databaseSize() / 104857.6) / 10,
        databaseUsedMiB: Math.round(databaseUsedSize() / 104857.6) / 10,
        databaseLimitMiB: Math.round(maxDatabaseBytes / 104857.6) / 10,
        totals: { ...totals, activeInstallations },
        features: query(`feature_id AS featureId,
            COUNT(DISTINCT installation_id) AS users,
            COUNT(DISTINCT CASE WHEN signal = 'used' THEN installation_id END) AS usedUsers,
            COUNT(DISTINCT CASE WHEN signal = 'configured' THEN installation_id END) AS configuredUsers,
            COUNT(DISTINCT CASE WHEN signal = 'effective' THEN installation_id END) AS effectiveUsers,
            COUNT(DISTINCT CASE WHEN signal = 'outcome' AND json_extract(dimensions_json, '$.outcome') = 'success'
                THEN installation_id END) AS successUsers,
            COUNT(DISTINCT CASE WHEN signal = 'outcome' AND json_extract(dimensions_json, '$.outcome')
                NOT IN ('success', 'cancelled') THEN installation_id END) AS issueUsers,
            SUM(event_count) AS events`, 'GROUP BY feature_id', 'ORDER BY users DESC, events DESC', 'LIMIT 500'),
        versions: query(`extension_version AS version, SUM(event_count) AS events,
            COUNT(DISTINCT installation_id) AS users,
            SUM(CASE WHEN signal = 'outcome' THEN event_count ELSE 0 END) AS outcomes,
            SUM(CASE WHEN signal = 'outcome' AND json_extract(dimensions_json, '$.outcome')
                NOT IN ('success', 'cancelled') THEN event_count ELSE 0 END) AS issues,
            MAX(period_start) AS lastSeen`,
        'GROUP BY extension_version', 'ORDER BY lastSeen DESC', 'LIMIT 100'),
        installations: query(`installation_id AS installationId, SUM(event_count) AS events,
            COUNT(DISTINCT feature_id) AS features,
            (SELECT recent.extension_version FROM events AS recent
                WHERE recent.installation_id = events.installation_id
                ORDER BY recent.period_start DESC LIMIT 1) AS version,
            MAX(period_start) AS lastSeen`, 'GROUP BY installation_id', 'ORDER BY lastSeen DESC', 'LIMIT 500'),
        timeline: query(`substr(period_start, 1, 10) AS day, SUM(event_count) AS events,
            COUNT(DISTINCT installation_id) AS users`, 'GROUP BY day', 'ORDER BY day ASC', 'LIMIT 1500'),
        dimensions: query(`dimensions_json AS dimensions, SUM(event_count) AS events,
            COUNT(DISTINCT installation_id) AS users`, 'GROUP BY dimensions_json', 'ORDER BY events DESC', 'LIMIT 200'),
        actions: query(`period_start AS periodStart, installation_id AS installationId,
            feature_id AS featureId, signal, dimensions_json AS dimensions,
            event_count AS events, extension_version AS version`, '', 'ORDER BY period_start DESC', 'LIMIT 1000'),
        problems: query(`feature_id AS featureId, extension_version AS version,
            json_extract(dimensions_json, '$.outcome') AS outcome,
            COUNT(DISTINCT installation_id) AS users, SUM(event_count) AS events`,
        'GROUP BY feature_id, extension_version, outcome', 'ORDER BY events DESC', 'LIMIT 500',
        `AND signal = 'outcome' AND json_extract(dimensions_json, '$.outcome') NOT IN ('success', 'cancelled')`),
        operations: {
            acceptedBatches: metricNumber('accepted_batches'),
            rejectedBatches: metricNumber('rejected_batches'),
            acceptedAggregates: metricNumber('accepted_aggregates'),
            clientDroppedAggregates: metricNumber('client_dropped_aggregates'),
            storageRejections: metricNumber('storage_rejections'),
            rateLimitRejections: metricNumber('rate_limit_rejections'),
            lastSuccessfulIngest: readMetric.get('last_successful_ingest')?.value || null,
        },
        filterOptions: (() => {
            const broad = buildFilter(url, new Set(['feature', 'signal', 'version', 'installation']));
            return {
                versions: queryFor(broad, 'DISTINCT extension_version AS value', '', 'ORDER BY value'),
                features: queryFor(broad, 'DISTINCT feature_id AS value', '', 'ORDER BY value'),
                installations: queryFor(broad, 'DISTINCT installation_id AS value', '', 'ORDER BY value'),
            };
        })(),
    };
}

// A process-wide token bucket limits anonymous write amplification without
// retaining IP addresses. Normal clients send at most one batch per hour.
const ingestLimiter = { tokens: 60, updatedAt: Date.now() };
const takeIngestToken = () => {
    const current = Date.now();
    ingestLimiter.tokens = Math.min(60, ingestLimiter.tokens + (current - ingestLimiter.updatedAt) / 30_000);
    ingestLimiter.updatedAt = current;
    if (ingestLimiter.tokens < 1) return false;
    ingestLimiter.tokens -= 1;
    return true;
};

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true }); return;
    }
    if (url.pathname === '/v1/events/batch' && request.method === 'OPTIONS') {
        send(response, 204, '', { 'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type',
            'access-control-max-age': '86400' });
        return;
    }
    if (url.pathname === '/v1/events/batch' && request.method === 'POST') {
        if (!takeIngestToken()) {
            incrementMetric('rejected_batches'); incrementMetric('rate_limit_rejections');
            sendJson(response, 429, { ok: false, error: 'rate-limit' }, {
                'access-control-allow-origin': '*', 'retry-after': '60'
            }); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
            incrementMetric('rejected_batches');
            sendJson(response, 415, { ok: false, error: 'content-type' }, { 'access-control-allow-origin': '*' }); return;
        }
        if (databaseUsedSize() >= maxDatabaseBytes) {
            incrementMetric('rejected_batches'); incrementMetric('storage_rejections');
            sendJson(response, 507, { ok: false, error: 'storage-limit' }, { 'access-control-allow-origin': '*' }); return;
        }
        try {
            const payload = await readJson(request);
            if (!validateBatch(payload)) {
                incrementMetric('rejected_batches');
                sendJson(response, 400, { ok: false, error: 'invalid-payload' }, { 'access-control-allow-origin': '*' }); return;
            }
            db.exec('BEGIN IMMEDIATE');
            let accepted = 0;
            try {
                payload.events.forEach(event => {
                    const result = insert.run(event.eventId, payload.installationId, event.periodStart,
                        event.featureId, event.signal, canonicalDimensions(event.dimensions), event.count,
                        event.extensionVersion);
                    accepted += Number(result.changes);
                });
                db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            incrementMetric('accepted_batches');
            incrementMetric('accepted_aggregates', accepted);
            // A lost HTTP response may retry the identical event IDs. Only a
            // batch that inserted something may acknowledge its queue-loss counter.
            if (accepted > 0) incrementMetric('client_dropped_aggregates', payload.droppedAggregates);
            setMetric('last_successful_ingest', new Date().toISOString());
            sendJson(response, 202, { ok: true, accepted }, { 'access-control-allow-origin': '*' });
        } catch (error) {
            if (!response.headersSent) {
                incrementMetric('rejected_batches');
                sendJson(response, error.status || 500, { ok: false, error: 'request-failed' }, { 'access-control-allow-origin': '*' });
            }
        }
        return;
    }
    if (url.pathname.startsWith('/admin')) {
        if (!requireAdmin(request, response)) return;
        if (request.method === 'GET' && url.pathname === '/admin') {
            send(response, 308, '', { location: '/admin/' }); return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/api/data') {
            sendJson(response, 200, adminData(url)); return;
        }
        const asset = request.method === 'GET' ? assets.get(url.pathname) : null;
        if (asset) { send(response, 200, asset.body, { 'content-type': asset.contentType }); return; }
    }
    sendJson(response, 404, { ok: false, error: 'not-found' });
});

server.listen(port, '0.0.0.0', () => console.log(`DashBridge analytics listening on port ${port}`));
const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
