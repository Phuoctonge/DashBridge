(function initBatchDiagnosticJournal(root) {
    'use strict';

    const SECRET_KEY = /(cookie|authorization|token|password|secret|credential|api[-_]?key|request[-_]?body|response[-_]?body)/i;
    const REDACTED = '[REDACTED]';
    const isObject = value => value && typeof value === 'object';

    function sanitize(value, seen = new WeakSet()) {
        if (!isObject(value)) return value;
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);
        if (Array.isArray(value)) return value.map(item => sanitize(item, seen));
        const result = {};
        Object.entries(value).forEach(([key, item]) => {
            result[key] = SECRET_KEY.test(key) ? REDACTED : sanitize(item, seen);
        });
        return result;
    }

    function create({ enabled = true, runId = '', now = () => Date.now() } = {}) {
        const active = enabled === true;
        const startedAt = Number(now()) || Date.now();
        let sequence = 0;
        const events = [];
        const record = input => {
            if (!active || !isObject(input)) return null;
            const atMs = Number(now()) || Date.now();
            const event = {
                seq: ++sequence,
                at: new Date(atMs).toISOString(),
                elapsedMs: Math.max(0, atMs - startedAt),
                runId: String(input.runId ?? runId),
                jobId: input.jobId == null ? null : String(input.jobId),
                panelId: input.panelId == null ? null : String(input.panelId),
                panelTitle: input.panelTitle == null ? null : String(input.panelTitle),
                stage: String(input.stage || 'unknown'),
                event: String(input.event || 'unknown'),
                requestedUrl: input.requestedUrl == null ? null : String(input.requestedUrl),
                actualUrl: input.actualUrl == null ? null : String(input.actualUrl),
                details: sanitize(input.details || {})
            };
            events.push(event);
            return event;
        };
        const snapshot = () => events.map(event => sanitize(event));
        const toJsonl = () => events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
        const clear = () => { events.length = 0; sequence = 0; };
        return Object.freeze({ enabled: active, record, snapshot, toJsonl, clear });
    }

    root.BatchDiagnosticJournal = Object.freeze({ create });
})(globalThis);
