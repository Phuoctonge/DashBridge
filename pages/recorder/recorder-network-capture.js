(function initRecorderNetworkCapture(root) {
    'use strict';

    function create({ state, schema, sendCdp, sha256, bodyBytes, addNavigateStep,
        injectActionRecorder, scheduleRender, setStatus, limits,
        setTimeoutRef = setTimeout }) {
        const {
            maxBodyBytes, maxRequestBodyBytes, maxTotalRequestBodyBytes,
            maxTotalBodyBytes, maxRequests, maxStreamEvents,
            maxStreamPayloadBytes, maxPageEvents,
        } = limits || {};
        if (!state || !schema || typeof sendCdp !== 'function'
            || typeof sha256 !== 'function' || typeof bodyBytes !== 'function'
            || typeof addNavigateStep !== 'function'
            || typeof injectActionRecorder !== 'function'
            || typeof scheduleRender !== 'function' || typeof setStatus !== 'function'
            || typeof setTimeoutRef !== 'function'
            || ![maxBodyBytes, maxRequestBodyBytes, maxTotalRequestBodyBytes,
                maxTotalBodyBytes, maxRequests, maxStreamEvents,
                maxStreamPayloadBytes, maxPageEvents].every(Number.isFinite)) {
            throw new TypeError('Recorder network capture dependencies are incomplete');
        }

        const ensureRequest = requestId => {
            const activeKey = state.activeRequests.get(requestId) || requestId;
            let request = state.requests.get(activeKey);
            if (!request) {
                request = {
                    requestId: activeKey, cdpRequestId: requestId, stepId: state.activeStepId,
                    requestBodyCapture: { status: 'none' },
                    responseBodyCapture: { status: 'pending' },
                    decodedDataLength: 0, dataEncodedLength: 0,
                };
                state.requests.set(activeKey, request);
                state.activeRequests.set(requestId, activeKey);
                const chain = state.requestChains.get(requestId) || [];
                if (!chain.includes(activeKey)) chain.push(activeKey);
                state.requestChains.set(requestId, chain);
            }
            return request;
        };

        const setResponseBodyStatus = (request, status, reason = null) => {
            if (!request || request.responseBodyCapture?.status !== 'pending') return;
            request.responseBodyCapture = { status, ...(reason ? { reason } : {}) };
            const counter = status === 'captured' ? 'responseBodiesCaptured'
                : status === 'empty' ? 'responseBodiesEmpty'
                    : status === 'skipped' ? 'responseBodiesSkipped'
                        : status === 'unavailable' ? 'responseBodiesUnavailable'
                            : 'responseBodiesFailed';
            state.completeness[counter] += 1;
        };

        const beginRequest = params => {
            const cdpId = params.requestId;
            const previous = state.activeRequests.has(cdpId) ? ensureRequest(cdpId) : null;
            if (previous && params.redirectResponse) {
                Object.assign(previous, {
                    status: params.redirectResponse.status,
                    statusText: params.redirectResponse.statusText,
                    responseHeaders: params.redirectResponse.headers || {},
                    mimeType: params.redirectResponse.mimeType,
                    protocol: params.redirectResponse.protocol,
                    finishedMonotonic: params.timestamp,
                    encodedDataLength: params.redirectResponse.encodedDataLength || 0,
                    redirectURL: params.request?.url || '',
                });
                setResponseBodyStatus(previous, 'unavailable', 'redirect');
            }
            const redirectIndex = state.redirectCounts.get(cdpId) || 0;
            const candidateKey = redirectIndex ? `${cdpId}:redirect-${redirectIndex}` : cdpId;
            const earlyPlaceholder = state.requests.get(candidateKey);
            const reusePlaceholder = Boolean(earlyPlaceholder && !earlyPlaceholder.url);
            const key = reusePlaceholder ? earlyPlaceholder.requestId : candidateKey;
            state.redirectCounts.set(cdpId, Math.max(redirectIndex + 1, 1));
            if (!previous && state.requests.size >= maxRequests) {
                setStatus(`Достигнут лимит ${maxRequests} запросов; новые записи пропускаются`, true);
                state.completeness.droppedRequests += 1;
                state.ignoredRequests.add(cdpId);
                return { requestId: key, cdpRequestId: cdpId, dropped: true };
            }
            const request = reusePlaceholder ? earlyPlaceholder : {
                requestId: key, cdpRequestId: cdpId, stepId: state.activeStepId,
                requestBodyCapture: { status: 'none' },
                responseBodyCapture: { status: 'pending' },
                decodedDataLength: 0, dataEncodedLength: 0,
            };
            state.requests.set(key, request);
            state.activeRequests.set(cdpId, key);
            const chain = state.requestChains.get(cdpId) || [];
            if (!chain.includes(key)) chain.push(key);
            state.requestChains.set(cdpId, chain);
            return request;
        };

        const requestForExtraInfo = (requestId, indexMap) => {
            const chain = state.requestChains.get(requestId) || [];
            const index = indexMap.get(requestId) || 0;
            if (!chain[index]) {
                const key = index ? `${requestId}:redirect-${index}` : requestId;
                if (!state.requests.has(key)) {
                    state.requests.set(key, {
                        requestId: key, cdpRequestId: requestId, stepId: state.activeStepId,
                        requestBodyCapture: { status: 'none' },
                        responseBodyCapture: { status: 'pending' },
                        decodedDataLength: 0, dataEncodedLength: 0,
                    });
                }
                chain[index] = key;
                state.requestChains.set(requestId, chain);
            }
            const key = chain[index];
            indexMap.set(requestId, index + 1);
            return state.requests.get(key);
        };

        const captureRequestBody = async request => {
            if (!request || request.postData !== undefined
                || request.requestBodyCapture?.status !== 'pending') return;
            try {
                const result = await sendCdp('Network.getRequestPostData', {
                    requestId: request.cdpRequestId,
                });
                if (request.requestBodyCapture?.status !== 'pending') return;
                const postData = String(result.postData || '');
                const postDataBytes = new TextEncoder().encode(postData).byteLength;
                if (postDataBytes > maxRequestBodyBytes) {
                    request.requestBodyCapture = { status: 'skipped', reason: 'too-large' };
                    state.completeness.requestBodiesSkipped += 1;
                    return;
                }
                if (state.totalRequestBodyBytes + postDataBytes > maxTotalRequestBodyBytes) {
                    request.requestBodyCapture = { status: 'skipped', reason: 'total-limit' };
                    state.completeness.requestBodiesSkipped += 1;
                    return;
                }
                request.postData = postData;
                state.totalRequestBodyBytes += postDataBytes;
                request.requestBodyCapture = {
                    status: request.postData ? 'captured' : 'empty', source: 'cdp',
                };
                markMultipartRequestBody(request);
            } catch (error) {
                if (request.requestBodyCapture?.status !== 'pending') return;
                request.requestBodyCapture = {
                    status: 'failed', reason: 'cdp-error',
                    error: error?.message || String(error),
                };
                state.completeness.requestBodiesFailed += 1;
            }
        };

        const headerValue = (headers, wantedName) => {
            const entries = Array.isArray(headers)
                ? headers.map(header => ({ name: String(header.name), value: String(header.value) }))
                : Object.entries(headers || {}).map(([name, value]) => ({
                    name, value: String(value),
                }));
            const match = entries.find(header => (
                header.name.toLowerCase() === wantedName.toLowerCase()
            ));
            return match?.value || '';
        };

        const markMultipartRequestBody = request => {
            if (!request || request.requestBodyCapture?.status !== 'captured') return;
            if (!/^multipart\/form-data\b/i.test(headerValue(
                request.requestHeaders, 'content-type',
            ))) return;
            request.requestBodyCapture = {
                ...request.requestBodyCapture,
                status: 'partial',
                reason: 'multipart-file-bytes-may-be-omitted',
            };
            state.completeness.requestBodiesPartial += 1;
        };

        const queueRequestBodyCapture = request => {
            const pending = captureRequestBody(request).finally(() => {
                state.pendingRequestBodyCaptures.delete(pending);
            });
            state.pendingRequestBodyCaptures.add(pending);
        };

        const captureResponseBody = async request => {
            if (!request || request.bodyCaptured
                || request.responseBodyCapture?.status !== 'pending') return;
            const decision = schema.classifyResponseBodyCapture(request, {
                maxBodyBytes,
                totalBodyBytes: state.totalBodyBytes,
                maxTotalBodyBytes,
            });
            if (decision) {
                setResponseBodyStatus(request, decision.status, decision.reason);
                return;
            }
            request.bodyCaptured = true;
            try {
                const result = await sendCdp('Network.getResponseBody', {
                    requestId: request.cdpRequestId || request.requestId,
                });
                if (request.responseBodyCapture?.status !== 'pending') return;
                const bodyLength = result.base64Encoded
                    ? schema.base64DecodedByteLength(result.body)
                    : new TextEncoder().encode(String(result.body || '')).byteLength;
                if (bodyLength > maxBodyBytes) {
                    setResponseBodyStatus(request, 'skipped', 'too-large');
                    return;
                }
                if (state.totalBodyBytes + bodyLength > maxTotalBodyBytes) {
                    setResponseBodyStatus(request, 'skipped', 'total-limit');
                    return;
                }
                request.responseBody = String(result.body || '');
                request.bodyBase64 = result.base64Encoded === true;
                request.bodyBytes = bodyLength;
                request.bodySha256 = await sha256(bodyBytes(request));
                state.totalBodyBytes += bodyLength;
                setResponseBodyStatus(request, bodyLength ? 'captured' : 'empty');
            } catch (error) {
                request.bodyError = error?.message || String(error);
                setResponseBodyStatus(request, 'failed', 'cdp-error');
            }
            scheduleRender();
        };

        const queueResponseBodyCapture = request => {
            const pending = captureResponseBody(request).finally(() => {
                state.pendingBodyCaptures.delete(pending);
            });
            state.pendingBodyCaptures.add(pending);
        };

        const appendStreamEvent = (type, params) => {
            const payload = params.response?.payloadData ?? params.data ?? '';
            const bytes = new TextEncoder().encode(String(payload)).byteLength;
            if (state.streams.length >= maxStreamEvents
                || state.streamPayloadBytes + bytes > maxStreamPayloadBytes) {
                state.completeness.streamEventsDropped += 1;
                state.completeness.streamPayloadBytesDropped += bytes;
                return;
            }
            state.streamPayloadBytes += bytes;
            const requestKey = params.requestId
                ? state.activeRequests.get(params.requestId)
                : null;
            const request = requestKey ? state.requests.get(requestKey) : null;
            state.streams.push({
                type,
                stepId: request?.stepId ?? state.activeStepId,
                at: new Date().toISOString(),
                monotonicTime: params.timestamp ?? null,
                ...params,
            });
        };

        const appendPageEvent = event => {
            if (state.pageEvents.length >= maxPageEvents) {
                state.completeness.pageEventsDropped += 1;
                return;
            }
            state.pageEvents.push(event);
        };

        const handleEvent = (source, method, params) => {
            if (source.tabId !== state.tabId) return;
            state.lastNetworkAt = Date.now();
            if (method !== 'Network.requestWillBeSent'
                && state.ignoredRequests.has(params.requestId)) {
                if (method === 'Network.loadingFinished'
                    || method === 'Network.loadingFailed') {
                    state.ignoredRequests.delete(params.requestId);
                }
                return;
            }
            if (method === 'Network.requestWillBeSent') {
                const request = beginRequest(params);
                if (request.dropped) return;
                Object.assign(request, {
                    url: params.request?.url,
                    method: params.request?.method,
                    requestHeaders: request.associatedCookies !== undefined
                        ? request.requestHeaders
                        : params.request?.headers || {},
                    postData: params.request?.postData,
                    hasPostData: params.request?.hasPostData === true,
                    startedMonotonic: params.timestamp,
                    wallTime: params.wallTime,
                    resourceType: params.type,
                    documentUrl: params.documentURL,
                    initiator: params.initiator,
                    redirectResponse: params.redirectResponse || null,
                });
                const inlinePostBytes = request.postData === undefined
                    ? 0
                    : new TextEncoder().encode(String(request.postData)).byteLength;
                const exceedsInlineLimit = inlinePostBytes > maxRequestBodyBytes
                    || state.totalRequestBodyBytes + inlinePostBytes > maxTotalRequestBodyBytes;
                if (exceedsInlineLimit) {
                    request.postData = undefined;
                    state.completeness.requestBodiesSkipped += 1;
                } else if (request.postData !== undefined) {
                    state.totalRequestBodyBytes += inlinePostBytes;
                }
                request.requestBodyCapture = exceedsInlineLimit
                    ? {
                        status: 'skipped',
                        reason: inlinePostBytes > maxRequestBodyBytes
                            ? 'too-large'
                            : 'total-limit',
                    }
                    : request.postData !== undefined
                        ? {
                            status: request.postData ? 'captured' : 'empty',
                            source: 'inline',
                        }
                        : request.hasPostData ? { status: 'pending' } : { status: 'none' };
                markMultipartRequestBody(request);
                if (request.requestBodyCapture.status === 'pending') {
                    queueRequestBodyCapture(request);
                }
                state.inFlight.add(params.requestId);
            } else if (method === 'Network.requestWillBeSentExtraInfo') {
                const request = requestForExtraInfo(
                    params.requestId, state.requestExtraInfoIndexes,
                );
                request.requestHeaders = params.headers || request.requestHeaders || {};
                request.associatedCookies = params.associatedCookies || [];
                request.requestHeadersText = params.headersText || null;
                request.connectTiming = params.connectTiming || null;
                request.clientSecurityState = params.clientSecurityState || null;
                markMultipartRequestBody(request);
            } else if (method === 'Network.responseReceived') {
                const request = ensureRequest(params.requestId);
                Object.assign(request, {
                    status: params.response?.status,
                    statusText: params.response?.statusText,
                    responseHeaders: request.blockedCookies !== undefined
                        ? request.responseHeaders
                        : params.response?.headers || {},
                    mimeType: params.response?.mimeType,
                    protocol: params.response?.protocol,
                    fromDiskCache: params.response?.fromDiskCache === true,
                    fromServiceWorker: params.response?.fromServiceWorker === true,
                    remoteIPAddress: params.response?.remoteIPAddress,
                    remotePort: params.response?.remotePort,
                    connectionId: params.response?.connectionId,
                    connectionReused: params.response?.connectionReused === true,
                    securityState: params.response?.securityState,
                    securityDetails: params.response?.securityDetails || null,
                    fromPrefetchCache: params.response?.fromPrefetchCache === true,
                    responseTiming: params.response?.timing || null,
                    resourceType: params.type || request.resourceType,
                });
            } else if (method === 'Network.responseReceivedExtraInfo') {
                const request = requestForExtraInfo(
                    params.requestId, state.responseExtraInfoIndexes,
                );
                request.responseHeaders = params.headers || request.responseHeaders || {};
                request.responseHeadersText = params.headersText || null;
                request.blockedCookies = params.blockedCookies || [];
                request.exemptedCookies = params.exemptedCookies || [];
                request.resourceIPAddressSpace = params.resourceIPAddressSpace || null;
                if (Number.isFinite(params.statusCode)) request.status = params.statusCode;
            } else if (method === 'Network.dataReceived') {
                const request = ensureRequest(params.requestId);
                request.decodedDataLength += Number(params.dataLength) || 0;
                request.dataEncodedLength += Number(params.encodedDataLength) || 0;
            } else if (method === 'Network.requestServedFromCache') {
                ensureRequest(params.requestId).servedFromCache = true;
            } else if (method === 'Network.resourceChangedPriority') {
                const request = ensureRequest(params.requestId);
                (request.priorityChanges ||= []).push({
                    priority: params.newPriority, timestamp: params.timestamp,
                });
            } else if (method === 'Network.loadingFinished') {
                const request = ensureRequest(params.requestId);
                request.finishedMonotonic = params.timestamp;
                request.encodedDataLength = params.encodedDataLength;
                state.inFlight.delete(params.requestId);
                queueResponseBodyCapture(request);
            } else if (method === 'Network.loadingFailed') {
                const request = ensureRequest(params.requestId);
                request.finishedMonotonic = params.timestamp;
                request.failed = true;
                request.errorText = params.errorText;
                request.canceled = params.canceled === true;
                request.blockedReason = params.blockedReason || null;
                request.corsErrorStatus = params.corsErrorStatus || null;
                setResponseBodyStatus(request, 'unavailable', 'loading-failed');
                state.inFlight.delete(params.requestId);
            } else if (/^Network\.(?:webSocket|eventSourceMessageReceived|webTransport)/.test(method)) {
                appendStreamEvent(method.slice('Network.'.length), params);
            } else if (method === 'Page.frameNavigated'
                && !params.frame?.parentId && state.mode === 'recording') {
                addNavigateStep(params.frame.url, Date.now());
                setTimeoutRef(injectActionRecorder, 150);
            } else if (method === 'Page.navigatedWithinDocument'
                && state.mode === 'recording') {
                appendPageEvent({
                    type: 'sameDocumentNavigation', frameId: params.frameId,
                    url: params.url, timestamp: Date.now(),
                });
                addNavigateStep(params.url, Date.now());
            } else if (method === 'Page.lifecycleEvent') {
                appendPageEvent({
                    type: params.name, frameId: params.frameId,
                    loaderId: params.loaderId, monotonicTime: params.timestamp,
                });
            }
            scheduleRender();
        };

        return Object.freeze({ handleEvent, setResponseBodyStatus });
    }

    root.DashBridgeRecorderNetworkCapture = Object.freeze({ create });
})(globalThis);
