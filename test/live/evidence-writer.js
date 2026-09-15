'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 16 * 1024;
const SECRET_KEYS = new Set(['authorization', 'cookie', 'password', 'token', 'secret', 'body', 'url', 'profile', 'profileName']);
function sanitize(value, depth = 0) {
    if (depth > 6) return '[depth-limit]';
    if (typeof value === 'string') return value.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 512);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(item, depth + 1)]));
}
function writeEvidence(root, value, { filename = 'report.json' } = {}) {
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, filename.replace(/[^a-z0-9_.-]/gi, '_'));
    const base = sanitize(value);
    let serialized = `${JSON.stringify(base, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
        serialized = `${JSON.stringify({ status: base?.status || 'unknown', truncated: true, evidenceTruncated: true })}\n`;
    }
    fs.writeFileSync(target, serialized, 'utf8');
    return { path: target, bytes: Buffer.byteLength(serialized, 'utf8'), truncated: serialized.includes('evidenceTruncated') };
}
module.exports = { writeEvidence, MAX_BYTES };
