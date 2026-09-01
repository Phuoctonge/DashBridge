(() => {
    'use strict';

    const create = context => {
        const {
            tools, isDashboardIframe, visualMetadata, legendSelection, getTargetPanel,
            pushBoundedDiagnosticEvent, capDiagnosticJournal, setRecentDiagnosticRecord,
            setPanelDataStatus, syncPanelDataStatusPresentation, responseSeriesFilterIsEnabled,
            syncResponseFilterPresentation, hasPersistentVisualWork,
            reapplyVisualStylesAfterDataTransform, consumeVisualStylesAfterQuery,
            registerRuntimeCleanup, isThresholdRestorePending
        } = context;

        const transforms = window.DashBridgeGrafanaPanelDataTransforms?.create(context);
        if (!transforms) throw new Error('DashBridge Grafana panel data transforms are unavailable');
        const {
            trimResponseDomainLabels, transformCpuData, transformMemData, restoreMemByteUnit,
            collectResponseTableRecords, filterSeriesByThreshold, getFieldLegendNames,
            collectResponseSeriesNames, collectResponseFilterVisibleNames,
            collectThresholdHighlightRules, collectCpuCapacityEntries, filterLegendData,
            hasSourceSeriesFilterScope, hasDataTransform
        } = transforms;
        const isQueryUrl = url => /api\/(ds|tsdb)\/query|api\/datasources\/proxy/.test(url || '');
        const getRequestQueries = requestBody => {
            try {
                const payload = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
                return Array.isArray(payload?.queries) ? payload.queries : [];
            } catch {
                return [];
            }
        };
        const isTargetPanelView = () => {
            const viewPanel = new URL(location.href).searchParams.get('viewPanel');
            if (!viewPanel) return false;
            // On a hard navigation Grafana can issue the View panel's first query
            // before DashBridge receives a command carrying targetPanelId. The
            // route itself still has an unambiguous single-panel scope.
            if (!tools.targetPanelId) return true;
            return `panel-${String(viewPanel).replace(/^panel-/, '')}`
                === `panel-${String(tools.targetPanelId).replace(/^panel-/, '')}`;
        };
        const getTargetQueryRefIds = requestBody => {
            if (isDashboardIframe) return null;
            const signatures = new Set(tools.targetQuerySignatures || []);
            const queries = getRequestQueries(requestBody);
            // Grafana's View route renders only the requested panel. It may start
            // the first datasource request before the dashboard definition has
            // been read, so the route's panel id is the strongest available scope.
            if (isTargetPanelView()) {
                return new Set(queries.map(query => String(query.refId || '')).filter(Boolean));
            }
            if (!signatures.size) return new Set();
            const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
            const scopeSignatures = new Set([...signatures].map(signature => {
                try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
            }).filter(Boolean));
            const configuredQueries = [...signatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                const candidates = queries.map(query => ({
                    raw: query,
                    refId: String(query.refId || ''),
                    alias: query.alias || '',
                    signature: window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '',
                    scopeSignature: getQueryScopeSignature?.(query) || '',
                }));
                const matched = candidates.filter(query => signatures.has(query.signature)
                    || scopeSignatures.has(query.scopeSignature)
                    || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                        ?.queryMatchesConfiguredTarget?.(configured, query.raw)));
                return new Set(matched.map(query => query.refId).filter(Boolean));
            } catch {
                return new Set();
            }
        };
        const getAnalysisQueryRefIds = (requestBody, signatures) => {
            if (isDashboardIframe) return null;
            const queries = getRequestQueries(requestBody);
            const configuredSignatures = new Set(signatures || []);
            if (!configuredSignatures.size) return new Set();
            const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
            const scopeSignatures = new Set([...configuredSignatures].map(signature => {
                try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
            }).filter(Boolean));
            const configuredQueries = [...configuredSignatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                return new Set(queries.filter(query => {
                    const signature = window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '';
                    const scopeSignature = getQueryScopeSignature?.(query) || '';
                    return configuredSignatures.has(signature) || scopeSignatures.has(scopeSignature)
                        || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                            ?.queryMatchesConfiguredTarget?.(configured, query));
                }).map(query => String(query.refId || '')).filter(Boolean));
            } catch {
                return new Set();
            }
        };
        const observePanelAnalysisResponse = (session, data, requestBody, requestStartedAt) => {
            try {
                if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
                    || requestStartedAt < session.acceptAfter) return;
                const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
                if (targetRefIds !== null && !targetRefIds.size) return;
                const snapshot = window.DashBridgeGrafanaPanelAnalysis?.analyzeResponse?.({
                    type: session.type,
                    data,
                    targetRefIds,
                    settings: session.settings
                });
                if (snapshot?.ok) session.onSnapshot?.(snapshot);
            } catch {
                // Analysis is observational: malformed datasource frames must never
                // prevent the established CPU/RAM transform from consuming a response.
            }
        };
        const panelAnalysisRequestMatches = (session, requestBody, requestStartedAt) => {
            if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
                || requestStartedAt < session.acceptAfter) return false;
            const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
            return targetRefIds === null || targetRefIds.size > 0;
        };
        const createResponseFilterWorkspace = (data, targetRefIds, helperRefIds = new Set()) => {
            const privateHelperRefIds = new Set(helperRefIds || []);
            if (targetRefIds === null) {
                return { data, isolated: false, helperRefIds: privateHelperRefIds };
            }
            const includedRefIds = new Set([...targetRefIds, ...privateHelperRefIds]);
            return {
                data: {
                    ...data,
                    results: Object.fromEntries(Object.entries(data?.results || {})
                        .filter(([refId]) => includedRefIds.has(String(refId))))
                },
                isolated: true,
                helperRefIds: privateHelperRefIds
            };
        };
        const commitResponseFilterWorkspace = (target, workspace) => {
            if (!workspace?.isolated) return target;
            workspace.helperRefIds.forEach(refId => delete target.results?.[refId]);
            Object.assign(target.results, workspace.data.results);
            return target;
        };
    
        const prepareCpuCapacityRequestBody = requestBody => {
            const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
            if (!capacityFilter || !tools.cpuCapacityFilterEnabled) return { body: requestBody, changed: false };
            const allowedRefIds = isDashboardIframe ? null : getTargetQueryRefIds(requestBody);
            if (!isDashboardIframe && !allowedRefIds.size) return { body: requestBody, changed: false };
            return capacityFilter.prepareRequestBody(requestBody, { enabled: true, allowedRefIds });
        };
    
        const replaceFetchBody = (args, body) => {
            const [input, init] = args;
            if (typeof Request !== 'undefined' && input instanceof Request) {
                return [new Request(input, { ...(init || {}), body })];
            }
            return [input, { ...(init || {}), body }];
        };
    
        const getTargetLegendRefIds = data => {
            const targetNames = new Set((tools.targetLegendSeries || []).map(name => String(name).trim()).filter(Boolean));
            if (!targetNames.size) return new Set();
            const results = Object.entries(data?.results || {}).map(([refId, result]) => ({
                refId: String(refId),
                fields: (result.frames || []).flatMap(frame => (frame.schema?.fields || []).map(field => ({
                    fieldNames: getFieldLegendNames(field)
                })))
            }));
            const matched = results.filter(result => result.fields.some(field =>
                field.fieldNames.some(name => targetNames.has(name))
            ));
            return new Set(matched.map(result => result.refId));
        };
    
        const calculatedTitleOriginalText = new WeakMap();
        const markCalculatedTitle = () => {
            const suffix = ' calculated';
            const root = getTargetPanel();
            const title = root.querySelector('[class*="panel-title" i], .panel-title-text, [data-testid*="header" i] h2, [data-testid*="header" i] h6, .panel-header h2, .panel-header h6');
            if (!title) return;
            const text = (title.textContent || '').trim();
            if (tools.invertIdle || tools.convertMemToUsed || tools.cpuCapacityFilterEnabled) {
                if (!calculatedTitleOriginalText.has(title)) {
                    calculatedTitleOriginalText.set(title, text.endsWith(suffix) ? text.slice(0, -suffix.length) : text);
                }
                const originalText = calculatedTitleOriginalText.get(title);
                if (originalText && text !== `${originalText}${suffix}`) title.textContent = `${originalText}${suffix}`;
                return;
            }
            const originalText = calculatedTitleOriginalText.get(title);
            if (originalText !== undefined) {
                title.textContent = originalText;
                calculatedTitleOriginalText.delete(title);
            } else if (text.endsWith(suffix)) {
                title.textContent = text.slice(0, -suffix.length);
            }
        };
    
        let calculatedTitleFrame = 0;
        const scheduleCalculatedTitleSync = () => {
            if (calculatedTitleFrame) return;
            calculatedTitleFrame = requestAnimationFrame(() => {
                calculatedTitleFrame = 0;
                markCalculatedTitle();
                syncPanelDataStatusPresentation();
            });
        };
        const observeCalculatedTitle = () => {
            const observerRequired = !!tools.invertIdle || !!tools.convertMemToUsed
                || !!tools.cpuCapacityFilterEnabled || !!tools.seriesQueryFilterEnabled;
            // BUG-B fix: проверяем не только наличие флага, но и активность observer'а.
            // После suspend/resume браузер может разорвать соединение — тогда observer надо пересоздать.
            const existing = window.__dashbridgeCalculatedTitleObserver;
            if (!observerRequired) {
                existing?.disconnect();
                window.__dashbridgeCalculatedTitleObserver = null;
                if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
                calculatedTitleFrame = 0;
                return;
            }
            if (existing && existing._dashbridgeActive) return;
            existing?.disconnect();
            const obs = new MutationObserver(scheduleCalculatedTitleSync);
            obs._dashbridgeActive = true;
            obs.observe(document.documentElement, { subtree: true, childList: true });
            window.__dashbridgeCalculatedTitleObserver = obs;
        };
        registerRuntimeCleanup(() => {
            if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
            calculatedTitleFrame = 0;
        });
    
        // Monkey-patching (перехват сети): мы подменяем оригинальные window.fetch и XMLHttpRequest.
        // Это позволяет нам "на лету" перехватывать JSON-ответы от сервера Grafana (/api/ds/query) 
        // и изменять сырые метрики (например, инвертировать CPU idle в CPU used или считать RAM) 
        // до того, как они попадут во внутренний стейт дашборда.
        const installDataInterceptor = () => {
            if (window.__dashbridgeCardDataInterceptor) return;
            window.__dashbridgeCardDataInterceptor = true;
            const diagnostics = window.__dashbridgeDataInterceptorDiagnostic = window.__dashbridgeDataInterceptorDiagnostic || {
                queryResponses: 0, transformed: 0, exactMatches: 0, legendFallbackMatches: 0,
                unmatched: 0, sourceFilterRuns: 0, last: null,
                nextEventId: 0, activeRequests: 0, events: []
            };
            // Keep this journal compact and JSON-serializable: E2E needs causal
            // request evidence, not request/response payloads or DOM references.
            diagnostics.nextEventId = Number(diagnostics.nextEventId) || 0;
            diagnostics.activeRequests = Number(diagnostics.activeRequests) || 0;
            diagnostics.events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
            capDiagnosticJournal(diagnostics, 500);
            const payloadArchive = window.__dashbridgeDataInterceptorArchive
                || (window.__dashbridgeDataInterceptorArchive = {
                    schema: 'dashbridge-e2e-network-payload-archive/v1',
                    startedAt: Date.now(),
                    requests: {},
                    responses: {},
                    limits: { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 },
                    stats: { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 },
                });
            payloadArchive.requests ||= {};
            payloadArchive.responses ||= {};
            payloadArchive.limits ||= { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 };
            payloadArchive.stats ||= { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 };
            const archiveEnabled = () => window.__dashbridgeE2EDiagnostics?.installed === true;
            const fullPayloadEvidenceEnabled = () => window.__dashbridgeE2EDiagnostics?.fullPayloadEvidence === true;
            const hashPayload = text => {
                let value = 2166136261;
                for (let index = 0; index < text.length; index += 1) {
                    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
                }
                return `fnv1a-${(value >>> 0).toString(16)}`;
            };
            const serializePayload = value => {
                try {
                    const text = typeof value === 'string' ? value : JSON.stringify(value);
                    const maxCharacters = Number(payloadArchive.limits.payloadCharacters) || 8192;
                    const remainingBudget = Math.max(0, (Number(payloadArchive.limits.fullPayloadBudget) || 0)
                        - (Number(payloadArchive.stats.storedFullPayloadCharacters) || 0));
                    const retainFull = fullPayloadEvidenceEnabled() && text.length <= remainingBudget;
                    let parsed = null;
                    if (retainFull) {
                        parsed = value;
                        if (typeof value === 'string') {
                            try { parsed = JSON.parse(value); } catch (_) { parsed = value; }
                        }
                        payloadArchive.stats.storedFullPayloadCharacters += text.length;
                    } else if (text.length) {
                        payloadArchive.stats.truncatedPayloads += 1;
                    }
                    return {
                        value: parsed,
                        textBytes: text.length,
                        hash: hashPayload(text),
                        truncated: !retainFull,
                        sample: retainFull ? null : {
                            first: text.slice(0, Math.floor(maxCharacters / 2)),
                            last: text.slice(-Math.ceil(maxCharacters / 2)),
                        },
                    };
                } catch (error) {
                    return { value: null, textBytes: null, hash: null, error: error?.message || String(error) };
                }
            };
            const archiveRequest = (requestId, transport, url, body) => {
                if (!archiveEnabled()) return;
                const before = Object.keys(payloadArchive.requests).length;
                setRecentDiagnosticRecord(payloadArchive.requests, requestId, {
                    at: Date.now(), requestId, transport, url: String(url || ''),
                    body: serializePayload(body ?? null),
                }, Number(payloadArchive.limits.requests) || 100);
                if (before >= (Number(payloadArchive.limits.requests) || 100)) payloadArchive.stats.droppedRequests += 1;
            };
            const archiveResponse = (requestId, stage, data, details = {}) => {
                if (!archiveEnabled()) return;
                const record = payloadArchive.responses[requestId]
                    || setRecentDiagnosticRecord(payloadArchive.responses, requestId, { requestId, observations: [] }, Number(payloadArchive.limits.requests) || 100);
                record.observations.push({ at: Date.now(), stage, payload: serializePayload(data), ...details });
                const observationLimit = Number(payloadArchive.limits.observationsPerResponse) || 8;
                if (record.observations.length > observationLimit) {
                    const removed = record.observations.length - observationLimit;
                    record.observations.splice(0, removed);
                    payloadArchive.stats.droppedObservations += removed;
                }
            };
            const pushEvent = (stage, details = {}) => {
                const event = { id: ++diagnostics.nextEventId, at: Date.now(), stage, ...details };
                pushBoundedDiagnosticEvent(diagnostics, event, 500);
                return event;
            };
            const reportCycle = { active: new Set(), failures: [] };
            const beginRequest = (transport, url) => {
                const requestId = `query_${Date.now()}_${diagnostics.nextEventId + 1}`;
                if (!reportCycle.active.size) {
                    reportCycle.failures = [];
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    if (isDashboardIframe) setPanelDataStatus('loading');
                }
                reportCycle.active.add(requestId);
                diagnostics.activeRequests = reportCycle.active.size;
                pushEvent('request-start', { requestId, transport, url: String(url || ''), activeRequests: diagnostics.activeRequests });
                return requestId;
            };
            const completeRequest = (requestId, transport, outcome, details = {}) => {
                if (!reportCycle.active.has(requestId)) return;
                reportCycle.active.delete(requestId);
                diagnostics.activeRequests = reportCycle.active.size;
                if (['http-error', 'network-error', 'decode-error'].includes(outcome)) {
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    reportCycle.failures.push({ outcome, ...details });
                }
                pushEvent('request-complete', { requestId, transport, outcome, activeRequests: diagnostics.activeRequests });
                if (reportCycle.active.size) return;
                const failure = reportCycle.failures[0] || null;
                if (failure?.outcome === 'http-error') setPanelDataStatus('http_error', { httpStatus: failure.httpStatus });
                else if (failure?.outcome === 'network-error') setPanelDataStatus('network_error');
                else if (failure?.outcome === 'decode-error') setPanelDataStatus('decode_error');
                else if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
                // A transform determines data/empty from its scoped response. Do
                // not overwrite that result after the final parallel request.
                else if (outcome === 'transformed') { /* status already set by transform */ }
                else if (outcome === 'aborted') setPanelDataStatus('aborted');
                else setPanelDataStatus('unknown');
                window.dispatchEvent(new Event('dashbridgePanelDataSettled'));
            };
            const decodeNativeFetchResponse = response => response.clone().json();
            const transform = (data, requestBody, request) => {
                archiveResponse(request.requestId, 'decoded-before-transform', data, { transport: request.transport });
                if (!data?.results) {
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    setPanelDataStatus('decode_error');
                    pushEvent('decode-error', { ...request, reason: 'response has no results' });
                    archiveResponse(request.requestId, 'returned-without-results', data, { reason: 'response has no results' });
                    return data;
                }
                diagnostics.queryResponses += 1;
                const exactTargetRefIds = getTargetQueryRefIds(requestBody);
                let targetRefIds = exactTargetRefIds;
                let scope = exactTargetRefIds === null ? 'iframe' : exactTargetRefIds.size ? 'query-signature' : 'none';
                if (!isDashboardIframe && !targetRefIds.size) {
                    targetRefIds = getTargetLegendRefIds(data);
                    if (targetRefIds.size) scope = 'legend-fallback';
                }
                const resultRefIds = Object.keys(data.results || {});
                // A normal Grafana dashboard has many panels sharing the same
                // datasource endpoint. Never alter a response until it matches
                // the selected panel's saved query signature.
                if (!isDashboardIframe && !targetRefIds.size) {
                    diagnostics.unmatched += 1;
                    diagnostics.last = { at: Date.now(), scope, resultRefIds, targetRefIds: [] };
                    pushEvent('scope-mismatch', { ...request, scope, resultRefIds, targetRefIds: [] });
                    archiveResponse(request.requestId, 'returned-scope-mismatch', data, { scope, resultRefIds });
                    return data;
                }
                if (scope === 'query-signature') diagnostics.exactMatches += 1;
                if (scope === 'legend-fallback') diagnostics.legendFallbackMatches += 1;
                const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
                const cpuContext = capacityFilter?.readContext?.(requestBody) || {
                    helperRefIds: new Set(), loadRefIds: new Set()
                };
                // Only copy the selected panel and its private vCPU helper into the
                // transformation workspace. Neither response filter is allowed to
                // mutate frames belonging to another dashboard panel.
                const workspace = createResponseFilterWorkspace(data, targetRefIds, cpuContext.helperRefIds);
                const scopedData = workspace.data;
                const countSeries = source => Object.values(source?.results || {}).reduce((total, result) => total
                    + (result.frames || []).reduce((frameTotal, frame) => frameTotal
                        + Math.max(0, (frame.schema?.fields || []).filter(field => field.type !== 'time' && field.name !== 'Time').length), 0), 0);
                const beforeSeries = countSeries(scopedData);
                trimResponseDomainLabels(scopedData);
                if (tools.invertIdle) transformCpuData(scopedData);
                const memoryTransform = tools.convertMemToUsed ? transformMemData(scopedData) : null;
                visualMetadata.memoryConversionApplied = tools.convertMemToUsed ? memoryTransform.applied : null;
                const memoryConversionFailed = !!tools.convertMemToUsed && !memoryTransform.applied;
                if (!tools.convertMemToUsed && tools.forceMemByteUnit) restoreMemByteUnit(scopedData);
                // Dynamic vCPU filtering owns only Load Average frames and runs
                // before the generic fixed-threshold series filter. The latter can
                // then safely evaluate the already-scoped result without changing
                // how vCPU capacity is calculated.
                const cpuCapacityFilter = tools.cpuCapacityFilterEnabled
                    ? capacityFilter?.filterResponse?.(scopedData, requestBody, {
                        enabled: true,
                        coefficient: tools.cpuCapacityFilterCoefficient,
                        mode: tools.cpuCapacityFilterMode,
                        trimDomainEnabled: tools.trimDomainEnabled === true,
                        trimDomain: tools.trimDomain,
                        selectedTypes: [
                            tools.cpuCapacityFilterLoad1 !== false ? '1m' : null,
                            tools.cpuCapacityFilterLoad5 === true ? '5m' : null,
                            tools.cpuCapacityFilterLoad15 === true ? '15m' : null
                        ].filter(Boolean)
                    })?.metrics || null
                    : null;
                // The query signature is preferred, but Grafana may rewrite a
                // request before it reaches fetch/XHR. A matching legend refId is
                // still a panel-scoped response and must receive the source filter.
                let sourceFilter = null;
                if (memoryConversionFailed && tools.seriesQueryFilterEnabled) {
                    sourceFilter = { enabled: true, skipped: 'memory-conversion-not-applied' };
                } else if (hasSourceSeriesFilterScope(targetRefIds)) {
                    diagnostics.sourceFilterRuns += 1;
                    sourceFilter = filterSeriesByThreshold(scopedData).metrics;
                }
                if (!memoryConversionFailed) filterLegendData(scopedData);
                visualMetadata.seriesThresholdHighlightRules = collectThresholdHighlightRules(scopedData);
                visualMetadata.seriesCpuCapacityEntries = collectCpuCapacityEntries(scopedData);
                // Lightweight metadata is enough for chart/table fallbacks. Do not
                // walk every value of every series during normal Grafana loading;
                // full report evaluation belongs to an explicit report request.
                visualMetadata.responseTableRecords = collectResponseTableRecords(scopedData);
                visualMetadata.responseSeriesNames = collectResponseSeriesNames(scopedData);
                if (responseSeriesFilterIsEnabled()) {
                    visualMetadata.responseFilterVisibleNames = collectResponseFilterVisibleNames(scopedData);
                    visualMetadata.responseFilterReady = true;
                } else {
                    visualMetadata.responseFilterVisibleNames = [];
                    visualMetadata.responseFilterReady = false;
                }
                // Bind the freshly computed metadata before Grafana consumes the
                // transformed response. For Flot this wraps the current setData;
                // its native data commit then schedules the correctly sized
                // overlay. No delayed redraw or forced plot resize is needed.
                const visualRoot = window.DashBridgeGrafanaDom?.outerPanel(getTargetPanel()) || getTargetPanel() || document;
                syncResponseFilterPresentation(visualRoot);
                diagnostics.transformed += 1;
                const afterSeries = countSeries(scopedData);
                const sourceFilterRemovedEverything = !!sourceFilter?.enabled
                    && sourceFilter.beforeSeries > 0
                    && sourceFilter.thresholdMatchedSeries === 0
                    && sourceFilter.afterSeries === 0;
                const cpuFilterRemovedEverything = !!cpuCapacityFilter?.enabled
                    && cpuCapacityFilter.beforeSeries > 0
                    && cpuCapacityFilter.afterSeries === 0;
                visualMetadata.responseFilterEmptyIsNormal = afterSeries === 0
                    && (sourceFilterRemovedEverything || cpuFilterRemovedEverything);
                if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
                else if (beforeSeries === 0 && afterSeries === 0) setPanelDataStatus('empty_source');
                else setPanelDataStatus('data');
                diagnostics.last = {
                    at: Date.now(), scope, targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                    resultRefIds, beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                    memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                    sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                    cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
                };
                pushEvent('transform', {
                    ...request, scope, resultRefIds,
                    targetRefIds: targetRefIds === null ? null : [...targetRefIds], beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                    memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                    invertIdle: !!tools.invertIdle, convertMemToUsed: !!tools.convertMemToUsed,
                    forceMemByteUnit: !!tools.forceMemByteUnit,
                    sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                    cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
                });
                // Helper results are deliberately removed by filterResponse;
                // commit also expresses that deletion on the original response.
                commitResponseFilterWorkspace(data, workspace);
                archiveResponse(request.requestId, 'after-transform', data, {
                    scope,
                    resultRefIds,
                    targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                    beforeSeries,
                    afterSeries,
                });
                reapplyVisualStylesAfterDataTransform();
                return data;
            };
            const originalFetch = window.fetch;
            window.fetch = async (...args) => {
                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                if (!isQueryUrl(url)) return originalFetch(...args);
                const transformActive = hasDataTransform();
                const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
                const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
                const requestStartedAt = performance.now();
                // The production fast path must stay idle while every feature is
                // OFF. E2E is the sole exception: a reset still has to observe the
                // selected panel's request in order to prove a safe baseline.
                const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
                const observeActive = transformActive || hasPersistentVisualWork() || isThresholdRestorePending()
                    || diagnosticObservationActive || analysisCaptureActive;
                if (!observeActive) return originalFetch(...args);
                const requestId = beginRequest('fetch', url);
                let effectiveArgs = args;
                let requestBody = null;
                if (transformActive || diagnosticObservationActive || analysisCaptureActive) {
                    requestBody = await window.DashBridgeGrafanaNetwork.readFetchBody(args[0], args[1]).catch(() => null);
                }
                if (tools.cpuCapacityFilterEnabled && requestBody !== null) {
                    const prepared = prepareCpuCapacityRequestBody(requestBody);
                    if (prepared.changed) {
                        requestBody = prepared.body;
                        effectiveArgs = replaceFetchBody(args, prepared.body);
                    }
                }
                const requestBodyPromise = Promise.resolve(requestBody);
                try {
                    const response = await originalFetch(...effectiveArgs);
                    pushEvent('response', { requestId, transport: 'fetch', status: response.status, ok: response.ok });
                    archiveResponse(requestId, 'http-response-metadata', null, {
                        transport: 'fetch',
                        status: response.status,
                        ok: response.ok,
                        redirected: response.redirected,
                        responseType: response.type,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                    });
                    if (!response.ok) {
                        pushEvent('query-error', { requestId, transport: 'fetch', status: response.status });
                        completeRequest(requestId, 'fetch', 'http-error', { httpStatus: response.status });
                        return response;
                    }
                    if (!transformActive) {
                        const requestBody = await requestBodyPromise;
                        if (!isDashboardIframe && analysisCaptureActive
                            && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                            try {
                                const decoded = await decodeNativeFetchResponse(response);
                                observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                            } catch { /* DOM fallback remains available when a datasource response is not JSON. */ }
                        }
                        const targetRefIds = getTargetQueryRefIds(requestBody);
                        const scope = targetRefIds === null
                            ? 'iframe'
                            : (targetRefIds.size ? 'query-signature' : 'none');
                        consumeVisualStylesAfterQuery();
                        pushEvent('transform-skipped', {
                            requestId,
                            transport: 'fetch',
                            reason: 'visual-only-observed',
                            scope,
                            targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                        });
                        completeRequest(requestId, 'fetch', 'completed');
                        return response;
                    }
                    let originalResponseText = null;
                    try {
                        const requestBody = await requestBodyPromise;
                        archiveRequest(requestId, 'fetch', url, requestBody);
                        // The transformed response replaces the native one, so consume the
                        // native body directly. Cloning here tees the stream and leaves the
                        // original branch unread; repeated Grafana refreshes can then retain
                        // buffered response bodies until GC and steadily grow tab memory.
                        originalResponseText = await response.text();
                        const decoded = JSON.parse(originalResponseText);
                        if (analysisCaptureActive && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                            observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                        }
                        const data = transform(decoded, requestBody, { requestId, transport: 'fetch' });
                        consumeVisualStylesAfterQuery();
                        completeRequest(requestId, 'fetch', data?.results ? 'transformed' : 'decode-error');
                        return window.DashBridgeGrafanaNetwork.createJsonResponse(data, response);
                    } catch (error) {
                        pushEvent('decode-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                        completeRequest(requestId, 'fetch', 'decode-error');
                        return originalResponseText === null
                            ? response
                            : window.DashBridgeGrafanaNetwork.createBodyResponse(originalResponseText, response);
                    }
                } catch (error) {
                    pushEvent('query-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                    completeRequest(requestId, 'fetch', error?.name === 'AbortError' ? 'aborted' : 'network-error');
                    throw error;
                }
            };
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__dashbridgeRequestUrl = url;
                return originalOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
                if (isQueryUrl(this.__dashbridgeRequestUrl)) {
                    const transformActive = hasDataTransform();
                    const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
                    const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
                    const requestStartedAt = performance.now();
                    const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
                    const observeActive = transformActive || hasPersistentVisualWork() || isThresholdRestorePending()
                        || diagnosticObservationActive || analysisCaptureActive;
                    if (!observeActive) return originalSend.call(this, body);
                    if (tools.cpuCapacityFilterEnabled) {
                        const prepared = prepareCpuCapacityRequestBody(body);
                        if (prepared.changed) body = prepared.body;
                    }
                    const requestId = beginRequest('xhr', this.__dashbridgeRequestUrl);
                    if (transformActive) archiveRequest(requestId, 'xhr', this.__dashbridgeRequestUrl, body ?? null);
                    this.addEventListener('abort', () => { this.__dashbridgeRequestAborted = true; }, { once: true });
                    this.addEventListener('readystatechange', () => {
                        if (this.readyState !== 4 || this.__dashbridgeRequestFinished) return;
                        this.__dashbridgeRequestFinished = true;
                        const request = { requestId, transport: 'xhr' };
                        pushEvent('response', { ...request, status: this.status, ok: this.status >= 200 && this.status < 300 });
                        archiveResponse(requestId, 'http-response-metadata', null, {
                            transport: 'xhr',
                            status: this.status,
                            ok: this.status >= 200 && this.status < 300,
                            responseURL: this.responseURL,
                            responseType: this.responseType,
                            headers: this.getAllResponseHeaders?.() || '',
                        });
                        if (this.status < 200 || this.status >= 300) {
                            pushEvent('query-error', { ...request, status: this.status });
                            const outcome = this.status === 0
                                ? (this.__dashbridgeRequestAborted ? 'aborted' : 'network-error')
                                : 'http-error';
                            completeRequest(requestId, 'xhr', outcome, { httpStatus: this.status });
                            return;
                        }
                        const captureRequestMatches = analysisCaptureActive
                            && panelAnalysisRequestMatches(analysisCapture, body, requestStartedAt);
                        if (!transformActive && !captureRequestMatches) {
                            const targetRefIds = getTargetQueryRefIds(body);
                            const scope = targetRefIds === null
                                ? 'iframe'
                                : (targetRefIds.size ? 'query-signature' : 'none');
                            consumeVisualStylesAfterQuery();
                            pushEvent('transform-skipped', {
                                ...request,
                                reason: 'visual-only-observed',
                                scope,
                                targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                            });
                            completeRequest(requestId, 'xhr', 'completed');
                            return;
                        }
                        try {
                            const decoded = window.DashBridgeGrafanaNetwork.readXhrJson(this);
                            if (!decoded.supported) throw new Error(`Unsupported XHR responseType: ${decoded.type}`);
                            if (decoded.error) throw decoded.error;
                            if (captureRequestMatches) {
                                observePanelAnalysisResponse(analysisCapture, decoded.data, body, requestStartedAt);
                            }
                            if (!transformActive) {
                                consumeVisualStylesAfterQuery();
                                completeRequest(requestId, 'xhr', 'completed');
                                return;
                            }
                            const json = transform(decoded.data, body, request);
                            consumeVisualStylesAfterQuery();
                            const serialized = JSON.stringify(json);
                            if (decoded.type === 'text') {
                                Object.defineProperty(this, 'responseText', { configurable: true, value: serialized });
                                Object.defineProperty(this, 'response', { configurable: true, value: serialized });
                            }
                            completeRequest(requestId, 'xhr', json?.results ? 'transformed' : 'decode-error');
                        } catch (error) {
                            pushEvent('decode-error', { ...request, reason: error.message || String(error) });
                            completeRequest(requestId, 'xhr', 'decode-error');
                        }
                    });
                }
                return originalSend.call(this, body);
            };
        };
    
    

        return Object.freeze({
            hasDataTransform, markCalculatedTitle, observeCalculatedTitle, installDataInterceptor
        });
    };

    window.DashBridgeGrafanaPanelDataRuntime = Object.freeze({ create });
})();
