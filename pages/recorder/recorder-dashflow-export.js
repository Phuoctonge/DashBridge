(function initDashBridgeDashflowExport(global) {
    'use strict';

    const create = ({
        schema,
        requestDuration,
        stepLabel,
        TextEncoderRef = TextEncoder,
        URLRef = URL,
        DateRef = Date
    } = {}) => {
        if (!schema || typeof requestDuration !== 'function' || typeof stepLabel !== 'function') {
            throw new TypeError('DashFlow export requires schema, duration and step-label adapters');
        }

        const headersToHar = headers => {
            if (Array.isArray(headers)) {
                return headers.map(header => ({ name: String(header.name), value: String(header.value) }));
            }
            return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
        };
        const headerValue = (headers, wantedName) => {
            const match = headersToHar(headers)
                .find(header => header.name.toLowerCase() === wantedName.toLowerCase());
            return match?.value || '';
        };
        const requestCookies = headers => headerValue(headers, 'cookie')
            .split(';')
            .map(value => value.trim())
            .filter(Boolean)
            .map(pair => {
                const separator = pair.indexOf('=');
                return {
                    name: separator < 0 ? pair : pair.slice(0, separator),
                    value: separator < 0 ? '' : pair.slice(separator + 1)
                };
            });
        const responseCookies = headers => headersToHar(headers)
            .filter(header => header.name.toLowerCase() === 'set-cookie')
            .flatMap(header => String(header.value).split(/\r?\n(?=[^;=\s]+=[^;]*)/))
            .map(value => {
                const [pair, ...attributes] = value.split(';');
                const separator = pair.indexOf('=');
                const cookie = {
                    name: separator < 0 ? pair.trim() : pair.slice(0, separator).trim(),
                    value: separator < 0 ? '' : pair.slice(separator + 1).trim()
                };
                for (const attribute of attributes) {
                    const [rawName, ...rawValue] = attribute.trim().split('=');
                    const name = rawName.toLowerCase();
                    const attributeValue = rawValue.join('=');
                    if (name === 'path') cookie.path = attributeValue;
                    else if (name === 'domain') cookie.domain = attributeValue;
                    else if (name === 'expires') cookie.expires = attributeValue;
                    else if (name === 'httponly') cookie.httpOnly = true;
                    else if (name === 'secure') cookie.secure = true;
                    else if (name === 'samesite') cookie.sameSite = attributeValue;
                }
                return cookie;
            });

        const buildNetwork = ({ requests = [], createdAt = null, finishedAt = null, pageEvents = [] } = {}) => ({
            version: 2,
            source: 'Chrome DevTools Protocol',
            createdAt,
            finishedAt,
            pageEvents,
            requests: Array.from(requests).filter(request => request.url && request.method).map(request => {
                const { responseBody, bodyCaptured, ...record } = request;
                return {
                    ...record,
                    requestHeaders: headersToHar(request.requestHeaders),
                    responseHeaders: headersToHar(request.responseHeaders)
                };
            })
        });

        const buildHar = ({
            requests = [],
            steps = [],
            createdAt = null,
            extensionVersion = ''
        } = {}) => {
            const encoder = new TextEncoderRef();
            const entries = Array.from(requests).filter(request => request.url && request.method).map(request => {
                const duration = requestDuration(request) || 0;
                const content = {
                    size: request.bodyBytes ?? (request.decodedDataLength || request.encodedDataLength || 0),
                    mimeType: request.mimeType || ''
                };
                if (request.bodyPath) content._dashbridgeBodyPath = request.bodyPath;
                if (request.bodySha256) content._dashbridgeSha256 = request.bodySha256;
                content._dashbridgeBodyCapture = request.responseBodyCapture
                    || { status: 'unavailable', reason: 'unknown' };
                let queryString = [];
                try {
                    queryString = [...new URLRef(request.url).searchParams]
                        .map(([name, value]) => ({ name, value }));
                } catch (_) { /* invalid CDP URL */ }
                const stepId = Number(request.stepId) || null;
                const durationValue = requestDuration(request);
                const responseHeadersSize = request.responseHeadersText
                    ? encoder.encode(request.responseHeadersText).byteLength : -1;
                const responseBodySize = request.dataEncodedLength > 0 ? request.dataEncodedLength
                    : Number.isFinite(request.encodedDataLength)
                        ? Math.max(0, request.encodedDataLength - Math.max(0, responseHeadersSize)) : -1;
                const entry = {
                    startedDateTime: Number.isFinite(request.wallTime)
                        ? new DateRef(request.wallTime * 1000).toISOString() : createdAt,
                    time: duration,
                    ...(stepId ? { pageref: `step-${stepId}` } : {}),
                    request: {
                        method: request.method,
                        url: request.url,
                        httpVersion: request.protocol || '',
                        headers: headersToHar(request.requestHeaders),
                        queryString,
                        cookies: requestCookies(request.requestHeaders),
                        headersSize: request.requestHeadersText
                            ? encoder.encode(request.requestHeadersText).byteLength : -1,
                        bodySize: request.postData !== undefined
                            ? encoder.encode(request.postData).byteLength : -1
                    },
                    response: {
                        status: Number(request.status) || 0,
                        statusText: request.statusText || '',
                        httpVersion: request.protocol || '',
                        headers: headersToHar(request.responseHeaders),
                        cookies: responseCookies(request.responseHeaders),
                        content,
                        redirectURL: request.redirectURL || '',
                        headersSize: responseHeadersSize,
                        bodySize: responseBodySize
                    },
                    cache: {},
                    timings: schema.buildHarTimings(request, durationValue || 0),
                    serverIPAddress: request.remoteIPAddress || undefined,
                    connection: request.connectionId !== undefined ? String(request.connectionId) : undefined,
                    _resourceType: request.resourceType || '',
                    _dashbridgeStep: stepId,
                    _dashbridgeFromDiskCache: request.fromDiskCache === true,
                    _dashbridgeFromServiceWorker: request.fromServiceWorker === true,
                    _dashbridgeRequestBodyCapture: request.requestBodyCapture || { status: 'none' },
                    _dashbridgeInitiator: request.initiator || null,
                    _dashbridgeSecurity: {
                        state: request.securityState || null,
                        details: request.securityDetails || null
                    },
                    _dashbridgeCdpTiming: request.responseTiming || null,
                    _dashbridgeTransferSize: Number(request.encodedDataLength) || 0
                };
                if (request.postData !== undefined) {
                    entry.request.postData = {
                        mimeType: String(request.requestHeaders?.['Content-Type']
                            || request.requestHeaders?.['content-type'] || ''),
                        text: request.postData
                    };
                }
                if (request.failed) entry._dashbridgeError = request.errorText || 'Loading failed';
                return entry;
            });
            const pages = Array.from(steps).map((step, index) => ({
                id: `step-${index + 1}`,
                startedDateTime: new DateRef(Number(step._dashbridge?.at) || DateRef.parse(createdAt)).toISOString(),
                title: `${index + 1}. ${step.type} ${stepLabel(step)}`.trim(),
                pageTimings: {},
                _dashbridgeStep: step
            }));
            return {
                log: {
                    version: '1.2',
                    creator: { name: 'DashBridge Traffic Recorder', version: extensionVersion },
                    pages,
                    entries
                }
            };
        };

        return Object.freeze({ buildNetwork, buildHar });
    };

    global.DashBridgeDashflowExport = Object.freeze({ create });
})(globalThis);
