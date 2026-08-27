// Portable DashBridge recording bundle. The container is ZIP; flow and HAR
// remain readable standard JSON files so the filename can change independently.
(function (root) {
    'use strict';

    const FORMAT = 'dashbridge-flow';
    const VERSION = 2;
    const MAX_FLOW_STEPS = 20_000;
    const MAX_NETWORK_REQUESTS = 50_000;
    const MAX_STREAM_EVENTS = 50_000;
    const MAX_PAGE_EVENTS = 20_000;
    const MAX_ACTION_VALUE = 1024 * 1024;
    const MAX_LOCATOR_TEXT = 16 * 1024;
    const SUPPORTED_STEP_TYPES = new Set(['navigate', 'click', 'change', 'keyDown', 'submit']);

    function normalizeHttpUrl(value) {
        const source = String(value || '').trim();
        if (!source) return null;
        const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(source);
        const looksLikeHostPort = /^(?:localhost|[a-z\d.-]+):\d+(?:[/?#]|$)/i.test(source);
        const hasUnsafeScheme = /^[a-z][a-z\d+.-]*:/i.test(source) && !looksLikeHostPort;
        if (!hasExplicitScheme && hasUnsafeScheme) return null;
        try {
            const parsed = new URL(hasExplicitScheme ? source : `https://${source}`);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
            return parsed.toString();
        } catch (_) {
            return null;
        }
    }

    function safeFilename(value, fallback = 'recording') {
        const normalized = String(value || '').trim()
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 100);
        return normalized || fallback;
    }

    function base64DecodedByteLength(value) {
        const source = String(value || '').replace(/\s/g, '');
        if (!source) return 0;
        const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor(source.length * 3 / 4) - padding);
    }

    function classifyResponseBodyCapture(request, limits = {}) {
        if (request?.failed) return { status: 'unavailable', reason: 'loading-failed' };
        if (request?.resourceType === 'Preflight') return { status: 'empty', reason: 'no-body-expected' };

        const encodedBytes = Math.max(0, Number(request?.encodedDataLength) || 0);
        const decodedBytes = Math.max(0, Number(request?.decodedDataLength) || 0);
        const maxBodyBytes = Math.max(0, Number(limits.maxBodyBytes) || 0);
        if (maxBodyBytes && Math.max(encodedBytes, decodedBytes) > maxBodyBytes) {
            return { status: 'skipped', reason: 'too-large' };
        }

        const totalBodyBytes = Math.max(0, Number(limits.totalBodyBytes) || 0);
        const maxTotalBodyBytes = Math.max(0, Number(limits.maxTotalBodyBytes) || 0);
        if (maxTotalBodyBytes && totalBodyBytes >= maxTotalBodyBytes) {
            return { status: 'skipped', reason: 'total-limit' };
        }
        return null;
    }

    function buildHarTimings(request, duration) {
        const timing = request?.responseTiming;
        const totalDuration = Math.max(0, Number(duration) || 0);
        if (!timing) return { blocked: -1, dns: -1, connect: -1, send: 0, wait: totalDuration, receive: 0, ssl: -1 };
        const phase = (start, end) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start ? end - start : -1;
        const starts = [timing.proxyStart, timing.dnsStart, timing.connectStart, timing.sendStart]
            .filter(value => Number.isFinite(value) && value >= 0);
        const requestOffset = Number.isFinite(timing.requestTime) && Number.isFinite(request?.startedMonotonic)
            ? Math.max(0, Math.round((timing.requestTime - request.startedMonotonic) * 1_000_000_000) / 1_000_000)
            : 0;
        const raw = {
            blocked: requestOffset + (starts.length ? Math.min(...starts) : 0),
            dns: phase(timing.dnsStart, timing.dnsEnd),
            connect: phase(timing.connectStart, timing.connectEnd),
            send: phase(timing.sendStart, timing.sendEnd),
            wait: phase(timing.sendEnd, timing.receiveHeadersEnd),
        };
        // CDP requestTime/requestWillBeSent/loadingFinished clocks can differ by
        // a few milliseconds. HAR requires its non-SSL phases not to exceed
        // entry.time, so consume the duration budget in wire order and put any
        // residual interval into receive.
        let remaining = totalDuration;
        const bounded = {};
        for (const name of ['blocked', 'dns', 'connect', 'send', 'wait']) {
            const value = raw[name];
            if (!Number.isFinite(value) || value < 0) { bounded[name] = -1; continue; }
            bounded[name] = Math.min(value, remaining); remaining -= bounded[name];
        }
        return { ...bounded, receive: remaining, ssl: phase(timing.sslStart, timing.sslEnd) };
    }

    function createManifest({ title, startUrl, createdAt, finishedAt, requestCount, stepCount, containsSecrets,
        networkMode, environment, captureLimits, completeness }) {
        return {
            format: FORMAT,
            version: VERSION,
            title: String(title || 'DashBridge recording').slice(0, 200),
            createdAt: createdAt || new Date().toISOString(),
            startUrl: normalizeHttpUrl(startUrl),
            flow: 'flow.json',
            network: 'network.json',
            baseline: 'traffic.har',
            streams: 'streams.json',
            requestCount: Math.max(0, Number(requestCount) || 0),
            stepCount: Math.max(0, Number(stepCount) || 0),
            containsSecrets: containsSecrets === true,
            networkMode: {
                cacheDisabled: networkMode?.cacheDisabled !== false,
                bypassServiceWorker: networkMode?.cacheDisabled !== false,
                ephemeralCookies: networkMode?.ephemeralCookies === true,
            },
            environment: environment && typeof environment === 'object' ? environment : {},
            capture: {
                startedAt: createdAt || new Date().toISOString(),
                finishedAt: finishedAt || null,
                limits: captureLimits && typeof captureLimits === 'object' ? captureLimits : {},
                completeness: completeness && typeof completeness === 'object' ? completeness : {},
            },
        };
    }

    function validateManifest(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Некорректный manifest.json');
        if (value.format !== FORMAT) throw new TypeError('Файл не является DashBridge Flow');
        if (!Number.isInteger(value.version) || value.version !== VERSION) {
            throw new RangeError(`Версия DashBridge Flow ${value.version} не поддерживается`);
        }
        if (value.flow !== 'flow.json' || value.network !== 'network.json'
            || value.baseline !== 'traffic.har' || value.streams !== 'streams.json') {
            throw new TypeError('Некорректная структура DashBridge Flow');
        }
        return value;
    }

    function validateFlow(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.steps)) {
            throw new TypeError('Некорректный flow.json');
        }
        if (value.steps.length > MAX_FLOW_STEPS) throw new RangeError('Сценарий содержит слишком много шагов');
        for (const step of value.steps) {
            if (!step || typeof step !== 'object' || typeof step.type !== 'string') throw new TypeError('Некорректный шаг сценария');
            if (!SUPPORTED_STEP_TYPES.has(step.type)) throw new TypeError(`Тип шага ${step.type} не поддерживается`);
            if (step.type === 'navigate' && !normalizeHttpUrl(step.url)) throw new TypeError('Некорректный URL шага navigate');
            if (step.type === 'navigate') continue;
            const locator = step._dashbridge?.locator;
            if (!locator || typeof locator !== 'object' || typeof locator.css !== 'string' || !locator.css
                || locator.css.length > MAX_LOCATOR_TEXT) throw new TypeError('Некорректный локатор шага');
            if (typeof step._dashbridge?.frameUrl === 'string' && step._dashbridge.frameUrl.length > 4096) {
                throw new RangeError('URL frame шага слишком длинный');
            }
            if (step._dashbridge?.navigationUrl && !normalizeHttpUrl(step._dashbridge.navigationUrl)) {
                throw new TypeError('Некорректный navigation URL шага');
            }
            if (step.type === 'change') {
                const supportedValue = step.value == null || ['string', 'number', 'boolean'].includes(typeof step.value);
                if (!supportedValue || (typeof step.value === 'string' && step.value.length > MAX_ACTION_VALUE)) {
                    throw new RangeError('Некорректное значение шага change');
                }
            }
            if (step.type === 'keyDown' && !['Enter', 'Escape', 'Tab'].includes(step.key)) {
                throw new TypeError('Некорректная клавиша шага keyDown');
            }
        }
        return value;
    }

    function validateNetwork(value) {
        if (!value || typeof value !== 'object' || value.version !== VERSION || !Array.isArray(value.requests)) {
            throw new TypeError('Некорректный network.json');
        }
        if (value.requests.length > MAX_NETWORK_REQUESTS) throw new RangeError('Запись содержит слишком много сетевых запросов');
        if (value.pageEvents !== undefined && (!Array.isArray(value.pageEvents) || value.pageEvents.length > MAX_PAGE_EVENTS)) {
            throw new RangeError('Запись содержит слишком много событий страницы');
        }
        for (const request of value.requests) {
            if (!request || typeof request !== 'object' || typeof request.url !== 'string' || typeof request.method !== 'string') {
                throw new TypeError('Некорректная запись сетевого запроса');
            }
        }
        return value;
    }

    function validateStreams(value) {
        if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.events)) {
            throw new TypeError('Некорректный streams.json');
        }
        if (value.events.length > MAX_STREAM_EVENTS) throw new RangeError('Запись содержит слишком много потоковых событий');
        return value;
    }

    root.DashBridgeFlowSchema = Object.freeze({
        FORMAT, VERSION, MAX_FLOW_STEPS, MAX_NETWORK_REQUESTS, MAX_STREAM_EVENTS, MAX_PAGE_EVENTS, normalizeHttpUrl, safeFilename,
        base64DecodedByteLength, classifyResponseBodyCapture, buildHarTimings,
        createManifest, validateManifest, validateFlow, validateNetwork, validateStreams,
    });
})(globalThis);
