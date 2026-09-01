'use strict';

// Builds an exhaustive, machine-readable explanation of what changed between
// two observations. Full snapshots are retained separately; image payloads are
// represented here by hashes so the diff does not duplicate base64 data.
function buildRuntimeDiagnosticDiff(before, after) {
    const changes = [];
    const countsByRoot = {};
    let truncated = false;
    const maxChanges = 25_000;
    const hashText = text => {
        let value = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            value = Math.imul(value ^ text.charCodeAt(index), 16777619);
        }
        return `fnv1a-${(value >>> 0).toString(16)}`;
    };
    const imageDescriptor = value => value && typeof value === 'object' ? {
        hash: value.hash || null,
        width: value.width || null,
        height: value.height || null,
        bytes: value.imageBytes || value.bytes || value.dataUrl?.length || null,
        error: value.error || null,
        capturedAt: value.capturedAt || null,
        pixelStats: value.pixelStats || null,
    } : null;
    const safeValue = (value, depth = 0) => {
        if (typeof value === 'string' && value.startsWith('data:image/')) {
            return { imagePayload: true, characters: value.length, hash: hashText(value) };
        }
        if (typeof value === 'string' && value.length > 8192) {
            return {
                largeCanonicalValue: true,
                characters: value.length,
                hash: hashText(value),
                first4096: value.slice(0, 4096),
                last4096: value.slice(-4096),
            };
        }
        if (value === null || value === undefined || typeof value !== 'object') return value;
        if (depth > 14) return '[diff-depth-limit]';
        if (Array.isArray(value)) return value.map(item => safeValue(item, depth + 1));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            key === 'dataUrl' ? safeValue(item, depth + 1) : safeValue(item, depth + 1),
        ]));
    };
    const push = (path, beforeValue, afterValue, kind) => {
        if (changes.length >= maxChanges) { truncated = true; return; }
        const root = path.split(/[.[]/, 1)[0] || '(root)';
        countsByRoot[root] = (countsByRoot[root] || 0) + 1;
        changes.push({
            index: changes.length + 1,
            path,
            kind,
            before: safeValue(beforeValue),
            after: safeValue(afterValue),
        });
    };
    const walk = (left, right, path = '', depth = 0) => {
        if (changes.length >= maxChanges) { truncated = true; return; }
        if (Object.is(left, right)) return;
        if (path.endsWith('.dataUrl') || path === 'dataUrl') {
            push(path, imageDescriptor({ dataUrl: left }), imageDescriptor({ dataUrl: right }), 'image-payload-changed');
            return;
        }
        const leftObject = left !== null && typeof left === 'object';
        const rightObject = right !== null && typeof right === 'object';
        if (!leftObject || !rightObject || depth >= 16) {
            push(path || '(root)', left, right, left === undefined ? 'added' : (right === undefined ? 'removed' : 'changed'));
            return;
        }
        if (Array.isArray(left) !== Array.isArray(right)) {
            push(path || '(root)', left, right, 'type-changed');
            return;
        }
        const keys = Array.isArray(left)
            ? Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index)
            : [...new Set([...Object.keys(left), ...Object.keys(right)])];
        keys.forEach(key => walk(left[key], right[key], Array.isArray(left)
            ? `${path}[${key}]`
            : (path ? `${path}.${key}` : key), depth + 1));
    };
    walk(before || null, after || null);

    const eventDelta = (left, right) => {
        const leftEvents = Array.isArray(left?.events) ? left.events : [];
        const rightEvents = Array.isArray(right?.events) ? right.events : [];
        const lastId = leftEvents.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);
        return rightEvents.filter(event => (Number(event?.id) || 0) > lastId);
    };
    const keyedDelta = (left = [], right = [], keyOf) => {
        const leftMap = new Map(left.map(item => [keyOf(item), item]));
        const rightMap = new Map(right.map(item => [keyOf(item), item]));
        const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
        return keys.flatMap(key => {
            const a = leftMap.get(key);
            const b = rightMap.get(key);
            return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ key, before: a || null, after: b || null }];
        });
    };
    const beforeCanvas = before?.canvas || [];
    const afterCanvas = after?.canvas || [];
    return {
        schema: 'dashbridge-e2e-runtime-diff/v1',
        beforeAt: before?.at || null,
        afterAt: after?.at || null,
        elapsedMs: before?.at && after?.at ? Math.max(0, after.at - before.at) : null,
        changed: changes.length > 0,
        changeCount: changes.length,
        truncated,
        maxChanges,
        countsByRoot,
        changes,
        images: {
            panel: { before: imageDescriptor(before?.panelImage), after: imageDescriptor(after?.panelImage) },
            viewport: { before: imageDescriptor(before?.viewportImage), after: imageDescriptor(after?.viewportImage) },
            canvas: Array.from({ length: Math.max(beforeCanvas.length, afterCanvas.length) }, (_, index) => ({
                index,
                before: imageDescriptor(beforeCanvas[index]),
                after: imageDescriptor(afterCanvas[index]),
            })),
        },
        tools: { before: before?.tools || null, after: after?.tools || null },
        markers: { before: before?.markers || null, after: after?.markers || null },
        visibilityChanges: keyedDelta(
            before?.markers?.visibilityEntries,
            after?.markers?.visibilityEntries,
            item => item?.key || ''
        ),
        seriesChanges: keyedDelta(before?.series, after?.series, item => `${item?.index}\u0000${item?.label || ''}`),
        network: {
            before: before?.interceptor || null,
            after: after?.interceptor || null,
            addedEvents: eventDelta(before?.interceptor, after?.interceptor),
        },
        visualReapply: {
            before: before?.visualReapplyDiagnostic || null,
            after: after?.visualReapplyDiagnostic || null,
            addedEvents: eventDelta(before?.visualReapplyDiagnostic, after?.visualReapplyDiagnostic),
        },
        consoleAndDebugLogs: {
            before: before?.logs || [],
            after: after?.logs || [],
        },
        dom: {
            beforeHash: before?.domSnapshot?.root?.outerHTMLHash || null,
            afterHash: after?.domSnapshot?.root?.outerHTMLHash || null,
            beforeBytes: before?.domSnapshot?.root?.outerHTMLBytes || null,
            afterBytes: after?.domSnapshot?.root?.outerHTMLBytes || null,
            changed: before?.domSnapshot?.root?.outerHTMLHash !== after?.domSnapshot?.root?.outerHTMLHash,
        },
    };
}
