(() => {
    'use strict';
    const create = owner => {
        // Wrappers belong to the document; their UI callbacks belong to the latest
        // panel-tools generation, including completion of requests already in flight.
        const context = { ...owner };
        let disposed = false;
        for (const name of ['getTargetPanel', 'setPanelDataStatus', 'syncPanelDataStatusPresentation',
            'responseSeriesFilterIsEnabled', 'syncResponseFilterPresentation', 'hasPersistentVisualWork',
            'reapplyVisualStylesAfterDataTransform', 'consumeVisualStylesAfterQuery', 'isThresholdRestorePending']) {
            context[name] = (...args) => window.__dashbridgePanelDataOwner?.[name]?.(...args);
        }
        owner.registerRuntimeCleanup(() => {
            disposed = true;
            if (window.__dashbridgePanelDataOwner === owner) window.__dashbridgePanelDataOwner = null;
        });
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
            collectResponseTableRecords, filterSeriesByThreshold, getFieldLegendNames, getFrameLegendNames,
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
        const isDashboardVariableQuery = requestBody => {
            const queries = isDashboardIframe ? getRequestQueries(requestBody) : [];
            return queries.length > 0 && queries.every(query => String(query.refId || '') === 'metricFindQuery');
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
            const queries = getRequestQueries(requestBody);
            if (isDashboardIframe) {
                // d-solo variable queries must never overwrite the panel status.
                if (!queries.length) return null;
                return new Set(queries
                    .filter(query => String(query.refId || '') !== 'metricFindQuery')
                    .map(query => String(query.refId || '')).filter(Boolean));
            }
            const signatures = new Set(tools.targetQuerySignatures || []);
            // Grafana's View route renders only the requested panel. It may start
            // the first datasource request before the dashboard definition has
            // been read, so the route's panel id is the strongest available scope.
            if (isTargetPanelView()) {
                return new Set(queries.map(query => String(query.refId || '')).filter(Boolean));
            }
            if (!signatures.size) return new Set();
            const configuredQueries = [...signatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                const candidates = queries.map(query => ({
                    raw: query,
                    refId: String(query.refId || ''),
                    alias: query.alias || '',
                    signature: window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '',
                }));
                const matched = candidates.filter(query => signatures.has(query.signature)
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
            const configuredQueries = [...configuredSignatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                return new Set(queries.filter(query => {
                    const signature = window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '';
                    return configuredSignatures.has(signature)
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
        const createResponseFilterWorkspace = (...args) => globalThis.DashBridgeGrafanaPanelDataTransformsRuntime.createWorkspace(...args);
        const commitResponseFilterWorkspace = (...args) => globalThis.DashBridgeGrafanaPanelDataTransformsRuntime.commitWorkspace(...args);
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
        const captureRawLegendSeries = (data, targetRefIds) => {
            // A direct Grafana panel can briefly have no resolved query signature
            // while its first refresh is settling. Do not replace a valid cache
            // with an empty snapshot in that interval.
            if (targetRefIds instanceof Set && targetRefIds.size === 0 && !isTargetPanelView()) return;
            if (targetRefIds instanceof Set && targetRefIds.size === 0) targetRefIds = null;
            const allowed = targetRefIds === null ? null : new Set(targetRefIds || []);
            const series = [];
            Object.entries(data?.results || {}).forEach(([refId, result]) => {
                if (allowed && !allowed.has(String(refId))) return;
                (result.frames || []).forEach(frame => {
                    const fields = frame.schema?.fields || [];
                    fields.forEach((field, index) => {
                        if (field?.type === 'time' || field?.name === 'Time') return;
                        const candidates = getFrameLegendNames(frame, field);
                        const label = candidates.find(value => !/^(?:value|series|metric|значение|серия|метрика)$/iu.test(value))
                            || candidates[0] || '';
                        const values = frame.data?.values?.[index];
                        if (!label || !values || typeof values[Symbol.iterator] !== 'function') return;
                        const rawValues = Array.from(values);
                        let last = null;
                        for (let valueIndex = rawValues.length - 1; valueIndex >= 0; valueIndex -= 1) {
                            const numeric = Number(rawValues[valueIndex]);
                            if (Number.isFinite(numeric)) { last = numeric; break; }
                        }
                        const latest = last === null ? [] : [last];
                        series.push({ label: String(label), values: latest, data: latest });
                    });
                });
            });
            window.__dashbridgeRawLegendSeries = series.slice(0, 20_000);
            window.__dashbridgeRawLegendSeriesOwner = owner;
        };
        registerRuntimeCleanup(() => {
            if (window.__dashbridgeRawLegendSeriesOwner !== owner) return;
            delete window.__dashbridgeRawLegendSeries;
            delete window.__dashbridgeRawLegendSeriesOwner;
        });
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
        const installDataInterceptor = () => {
            if (disposed) return;
            window.__dashbridgePanelDataOwner = owner;
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
                if (!isDashboardIframe && !targetRefIds.size
                    && (!getRequestQueries(requestBody).length || !tools.targetQuerySignatures?.length)) {
                    targetRefIds = getTargetLegendRefIds(data);
                    if (targetRefIds.size) scope = 'legend-fallback';
                }
                const resultRefIds = Object.keys(data.results || {});
                // Never transform a known query belonging to a different panel.
                if (targetRefIds !== null && !targetRefIds.size) {
                    // A target switch cannot transfer private helper results to Grafana.
                    window.DashBridgeGrafanaCpuCapacityFilter?.filterResponse?.(data, requestBody);
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
                visualMetadata.responseUnitCodes = window.DashBridgeGrafanaUnit
                    ?.collectDataFrameUnitCodes?.(scopedData) || [];
                const countSeries = source => Object.values(source?.results || {}).reduce((total, result) => total
                    + (result.frames || []).reduce((frameTotal, frame) => frameTotal
                        + Math.max(0, (frame.schema?.fields || []).filter(field => field.type !== 'time' && field.name !== 'Time').length), 0), 0);
                const beforeSeries = countSeries(scopedData);
                // Load/helper identity must reach the collision-aware capacity
                // trimmer intact; general domain removal can merge endpoints.
                const capacityTrimRefs = tools.cpuCapacityFilterEnabled || cpuContext.helperRefIds.size
                    ? new Set([...cpuContext.loadRefIds, ...cpuContext.helperRefIds]) : new Set();
                trimResponseDomainLabels(scopedData, capacityTrimRefs);
                if (tools.invertIdle) transformCpuData(scopedData);
                const memoryTransform = tools.convertMemToUsed ? transformMemData(scopedData) : null;
                visualMetadata.memoryConversionApplied = tools.convertMemToUsed ? memoryTransform.applied : null;
                const memoryConversionFailed = !!tools.convertMemToUsed && !memoryTransform.applied;
                if (!tools.convertMemToUsed && tools.forceMemByteUnit) restoreMemByteUnit(scopedData);
                // Request-owned helper cleanup survives disabling the filter in flight.
                const cpuCapacityFilter = tools.cpuCapacityFilterEnabled || cpuContext.helperRefIds.size
                    ? capacityFilter?.filterResponse?.(scopedData, requestBody, {
                        enabled: !!tools.cpuCapacityFilterEnabled,
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
                let effectiveArgs = args;
                let requestBody = null;
                if (isDashboardIframe || transformActive || diagnosticObservationActive || analysisCaptureActive) {
                    requestBody = await window.DashBridgeGrafanaNetwork.readFetchBody(args[0], args[1]).catch(() => null);
                }
                if (isDashboardVariableQuery(requestBody)) {
                    diagnostics.unmatched += 1;
                    pushEvent('request-skipped', { transport: 'fetch', url: String(url || ''), reason: 'dashboard-variable-query' });
                    return originalFetch(...args);
                }
                const requestId = beginRequest('fetch', url);
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
                        if (hasPersistentVisualWork()) {
                            try {
                                const decoded = await decodeNativeFetchResponse(response.clone());
                                captureRawLegendSeries(decoded, targetRefIds);
                            } catch { /* Last remains fail-open when the response is not a data frame. */ }
                        }
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
                        // Consume directly: cloning would leave an unread tee buffering the body.
                        originalResponseText = await response.text();
                        const decoded = JSON.parse(originalResponseText);
                        if (hasPersistentVisualWork()) captureRawLegendSeries(decoded, getTargetQueryRefIds(requestBody));
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
                this.__dashbridgeRequestCleanup?.();
                this.__dashbridgeRequestFinished = false;
                this.__dashbridgeRequestAborted = false;
                if (this.__dashbridgeResponseOverridden) {
                    delete this.responseText;
                    delete this.response;
                    this.__dashbridgeResponseOverridden = false;
                }
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
                    if (isDashboardVariableQuery(body)) {
                        diagnostics.unmatched += 1;
                        pushEvent('request-skipped', { transport: 'xhr', url: String(this.__dashbridgeRequestUrl || ''), reason: 'dashboard-variable-query' });
                        return originalSend.call(this, body);
                    }
                    if (tools.cpuCapacityFilterEnabled) {
                        const prepared = prepareCpuCapacityRequestBody(body);
                        if (prepared.changed) body = prepared.body;
                    }
                    const requestId = beginRequest('xhr', this.__dashbridgeRequestUrl);
                    if (transformActive) archiveRequest(requestId, 'xhr', this.__dashbridgeRequestUrl, body ?? null);
                    const onAbort = () => { this.__dashbridgeRequestAborted = true; };
                    const onReady = () => {
                        if (this.readyState !== 4 || this.__dashbridgeRequestFinished) return;
                        this.__dashbridgeRequestFinished = true;
                        this.__dashbridgeRequestCleanup = null;
                        this.removeEventListener('readystatechange', onReady);
                        this.removeEventListener('abort', onAbort);
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
                            if (hasPersistentVisualWork()) captureRawLegendSeries(decoded.data, getTargetQueryRefIds(body));
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
                                this.__dashbridgeResponseOverridden = true;
                            }
                            completeRequest(requestId, 'xhr', json?.results ? 'transformed' : 'decode-error');
                        } catch (error) {
                            pushEvent('decode-error', { ...request, reason: error.message || String(error) });
                            completeRequest(requestId, 'xhr', 'decode-error');
                        }
                    };
                    this.__dashbridgeRequestCleanup = () => {
                        this.removeEventListener('readystatechange', onReady);
                        this.removeEventListener('abort', onAbort);
                        completeRequest(requestId, 'xhr', 'aborted');
                        this.__dashbridgeRequestCleanup = null;
                    };
                    this.addEventListener('abort', onAbort, { once: true });
                    this.addEventListener('readystatechange', onReady);
                }
                try { return originalSend.call(this, body); }
                catch (error) { this.__dashbridgeRequestCleanup?.(); throw error; }
            };
        };
        return Object.freeze({ hasDataTransform, markCalculatedTitle, observeCalculatedTitle, installDataInterceptor });
    };

    window.DashBridgeGrafanaPanelDataRuntime = Object.freeze({ create });
})();
