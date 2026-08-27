(function (root) {
    'use strict';

    function matchKey(request) {
        const stepId = Number(request?.stepId) || 0;
        return `${stepId}\u0000${String(request?.method || 'GET').toUpperCase()}\u0000${String(request?.url || '')}`;
    }

    function bucketsOf(requests) {
        const buckets = new Map();
        for (const request of requests || []) {
            if (!request?.url) continue;
            const key = matchKey(request);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(request);
        }
        return buckets;
    }

    function differences(oldRequest, newRequest) {
        const result = [];
        if (Number(oldRequest.status || 0) !== Number(newRequest.status || 0)) result.push('status');
        if (String(oldRequest.mimeType || '') !== String(newRequest.mimeType || '')) result.push('mime');
        const oldHash = oldRequest.bodySha256 || '';
        const newHash = newRequest.bodySha256 || '';
        if (oldHash && newHash) {
            if (oldHash !== newHash) result.push('body hash');
        } else {
            const bodyState = request => {
                if (request.bodySha256) return 'hashed';
                const status = request.responseBodyCapture?.status;
                return ['captured', 'empty'].includes(status) ? status : status ? 'unavailable' : 'unknown';
            };
            if (oldHash || newHash || bodyState(oldRequest) !== bodyState(newRequest)) result.push('body capture');
        }
        return result;
    }

    function build(baselineRequests, currentRequests) {
        const baseline = bucketsOf(baselineRequests); const current = bucketsOf(currentRequests);
        const keys = new Set([...baseline.keys(), ...current.keys()]); const result = [];
        for (const key of keys) {
            const oldItems = baseline.get(key) || []; const newItems = current.get(key) || [];
            for (let index = 0; index < Math.max(oldItems.length, newItems.length); index += 1) {
                const oldRequest = oldItems[index] || null; const newRequest = newItems[index] || null;
                const source = oldRequest || newRequest; let status; let changed = [];
                if (!oldRequest) status = 'added';
                else if (!newRequest) status = 'removed';
                else { changed = differences(oldRequest, newRequest); status = changed.length ? 'changed' : 'unchanged'; }
                result.push({
                    status, differences: changed, baseline: oldRequest, current: newRequest,
                    stepId: Number(source.stepId) || null, method: source.method || '', url: source.url || ''
                });
            }
        }
        const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
        return result.sort((left, right) => order[left.status] - order[right.status] || left.url.localeCompare(right.url));
    }

    root.DashBridgeFlowCompare = Object.freeze({ build, matchKey });
})(globalThis);
