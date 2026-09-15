'use strict';

const MAX_STRING = 512;
const MAX_JSON_BYTES = 4096;
const MAX_STEPS = 32;
const RENDERERS = new Set(['uplot', 'flot', 'mixed', 'unknown']);

function fail(message) { throw new TypeError(message); }
function text(value, label, max = MAX_STRING) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be a bounded string`);
    return value.trim();
}
function jsonSize(value) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch { fail('value is not serializable'); }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) fail('value exceeds size limit');
}
function httpUrl(value, label) {
    let url;
    try { url = new URL(text(value, label)); } catch { fail(`${label} must be an HTTP(S) URL without credentials`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(`${label} must be an HTTP(S) URL without credentials`);
    return url.href;
}
function validateEnvironment(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('environment must be an object');
    const renderers = Array.isArray(value.renderers) && value.renderers.length ? value.renderers : ['unknown'];
    if (renderers.some(renderer => !RENDERERS.has(renderer))) fail('environment has an unknown renderer');
    const dashboardUrls = Array.isArray(value.dashboardUrls) ? value.dashboardUrls.map((url, index) => httpUrl(url, `dashboardUrls[${index}]`)) : [];
    if (!dashboardUrls.length) fail('environment requires dashboardUrls');
    return Object.freeze({ name: text(value.name, 'name', 96), baseUrl: httpUrl(value.baseUrl, 'baseUrl'), dashboardUrls, renderers: [...renderers] });
}
function validateCommand(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('command must be an object');
    const args = value.args === undefined ? {} : value.args;
    jsonSize(args);
    return Object.freeze({ commandId: value.commandId ? text(value.commandId, 'commandId', 128) : null, capability: text(value.capability, 'capability', 128), operation: text(value.operation, 'operation', 32), panel: value.panel || null, args });
}
function validateScenario(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('scenario must be an object');
    if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > MAX_STEPS) fail('scenario steps must be bounded');
    const timeoutMs = Number(value.timeoutMs || 30_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) fail('scenario timeout is out of range');
    const steps = value.steps.map(step => validateCommand({ ...step, capability: step.capability || value.capability }));
    return Object.freeze({ name: text(value.name, 'name', 128), capability: text(value.capability, 'capability', 128), timeoutMs, steps });
}
function redactEvidence(value) {
    jsonSize(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(redactEvidence);
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, MAX_STRING) : value;
    const hidden = new Set(['cookie', 'authorization', 'password', 'token', 'body', 'url']);
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, hidden.has(key.toLowerCase()) ? '[redacted]' : redactEvidence(item)]));
}
module.exports = { validateEnvironment, validateCommand, validateScenario, redactEvidence };
