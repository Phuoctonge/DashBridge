(function initRecorderDashflowController(root) {
    'use strict';

    function create({ state, ui, schema, io, exporter, zipConstructor,
        sha256, bodyBytes, stopSession, resetSession, saveSettings,
        setStatus, updateControls, scheduleRender, limits,
        chromeRef = chrome, navigatorRef = navigator, urlRef = URL,
        setTimeoutRef = setTimeout }) {
        const {
            maxRequests, maxRequestBodyBytes, maxTotalRequestBodyBytes,
            maxBodyBytes, maxTotalBodyBytes, maxStreamEvents,
            maxStreamPayloadBytes, maxPageEvents, maxWorkingSetBytes,
        } = limits || {};
        if (!state || !ui?.save || !ui?.file || !schema
            || typeof io?.write !== 'function' || typeof io?.read !== 'function'
            || typeof exporter?.buildNetwork !== 'function'
            || typeof exporter?.buildHar !== 'function'
            || typeof sha256 !== 'function' || typeof bodyBytes !== 'function'
            || typeof stopSession !== 'function' || typeof resetSession !== 'function'
            || typeof saveSettings !== 'function' || typeof setStatus !== 'function'
            || typeof updateControls !== 'function' || typeof scheduleRender !== 'function'
            || typeof chromeRef?.downloads?.download !== 'function'
            || typeof chromeRef?.runtime?.getManifest !== 'function'
            || typeof urlRef?.createObjectURL !== 'function'
            || typeof urlRef?.revokeObjectURL !== 'function'
            || typeof setTimeoutRef !== 'function'
            || ![maxRequests, maxRequestBodyBytes, maxTotalRequestBodyBytes,
                maxBodyBytes, maxTotalBodyBytes, maxStreamEvents,
                maxStreamPayloadBytes, maxPageEvents,
                maxWorkingSetBytes].every(Number.isFinite)) {
            throw new TypeError('Recorder DashFlow controller dependencies are incomplete');
        }

        const estimateWorkingSet = () => (
            state.totalBodyBytes * 3
            + state.totalRequestBodyBytes * 4
            + state.streamPayloadBytes * 4
            + state.requests.size * 2048
            + state.steps.length * 2048
        );

        const save = async () => {
            try {
                if (typeof zipConstructor !== 'function') throw new Error('JSZip не загружен');
                if (estimateWorkingSet() > maxWorkingSetBytes) {
                    throw new RangeError('Запись слишком велика для безопасного сохранения одним .dashflow; уменьшите сценарий');
                }
                setStatus('Подготовка .dashflow…');
                ui.save.disabled = true;
                const bodies = [];
                let bodyIndex = 0;
                for (const request of state.requests.values()) {
                    if (request.responseBody === undefined) continue;
                    const bytes = bodyBytes(request);
                    request.bodyBytes = bytes.byteLength;
                    const safeId = String(request.requestId)
                        .replace(/[^a-zA-Z0-9_.-]/g, '_')
                        .slice(0, 96) || 'request';
                    bodyIndex += 1;
                    request.bodyPath = `bodies/${String(bodyIndex).padStart(6, '0')}_${safeId}.bin`;
                    request.bodySha256 = request.bodySha256 || await sha256(bytes);
                    bodies.push({ path: request.bodyPath, bytes });
                }
                const flow = {
                    title: state.title || 'DashBridge recording',
                    timeout: 15_000,
                    steps: state.steps,
                    _dashbridge: {
                        networkMode: {
                            cacheDisabled: state.sessionOptions.disableCache,
                            bypassServiceWorker: state.sessionOptions.disableCache,
                            ephemeralCookies: state.sessionOptions.disableCookies,
                        },
                    },
                };
                const extensionVersion = chromeRef.runtime.getManifest().version;
                const manifest = schema.createManifest({
                    title: flow.title,
                    startUrl: state.startUrl
                        || state.steps.find(step => step.type === 'navigate')?.url,
                    createdAt: state.createdAt,
                    requestCount: state.requests.size,
                    stepCount: state.steps.length,
                    containsSecrets: state.steps.some(step => step._dashbridge?.secret)
                        || state.requests.size > 0,
                    networkMode: {
                        cacheDisabled: state.sessionOptions.disableCache,
                        ephemeralCookies: state.sessionOptions.disableCookies,
                    },
                    finishedAt: state.captureFinishedAt || new Date().toISOString(),
                    environment: state.environment || {
                        userAgent: navigatorRef.userAgent,
                        language: navigatorRef.language,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                        extensionVersion,
                    },
                    captureLimits: {
                        requests: maxRequests,
                        requestBodyBytesPerRequest: maxRequestBodyBytes,
                        requestBodyBytesTotal: maxTotalRequestBodyBytes,
                        responseBodyBytesPerRequest: maxBodyBytes,
                        responseBodyBytesTotal: maxTotalBodyBytes,
                        streamEvents: maxStreamEvents,
                        streamPayloadBytesTotal: maxStreamPayloadBytes,
                        pendingCaptureWaitMs: 3_000,
                        pageEvents: maxPageEvents,
                        archiveWorkingSetBytes: maxWorkingSetBytes,
                    },
                    completeness: state.completeness,
                });
                const blob = await io.write({
                    manifest,
                    flow,
                    network: exporter.buildNetwork({
                        requests: state.requests.values(),
                        createdAt: state.createdAt,
                        finishedAt: state.captureFinishedAt,
                        pageEvents: state.pageEvents,
                    }),
                    har: exporter.buildHar({
                        requests: state.requests.values(),
                        steps: state.steps,
                        createdAt: state.createdAt,
                        extensionVersion,
                    }),
                    streams: {
                        version: 1,
                        payloadBytes: state.streamPayloadBytes,
                        events: state.streams,
                    },
                    bodies,
                    responseBodyBytes: state.totalBodyBytes,
                });
                const url = urlRef.createObjectURL(blob);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `${schema.safeFilename(flow.title)}_${timestamp}.dashflow`;
                try {
                    await chromeRef.downloads.download({ url, filename, saveAs: true });
                } finally {
                    setTimeoutRef(() => urlRef.revokeObjectURL(url), 1000);
                }
                state.loadedManifest = manifest;
                setStatus(`Файл ${filename} передан в загрузки Chrome.`);
                root.DashBridgeAnalytics?.outcome('recorder.dashflow_exported', 'success', { format: 'dashflow' });
            } catch (error) {
                setStatus(`Не удалось сохранить .dashflow: ${error?.message || error}`, true);
                root.DashBridgeAnalytics?.outcome('recorder.dashflow_exported', 'error', { format: 'dashflow' });
            } finally {
                updateControls();
            }
        };

        const load = async file => {
            if (state.importing || ['recording', 'replaying'].includes(state.mode)) return;
            state.importing = true;
            updateControls();
            try {
                setStatus('Чтение .dashflow…');
                const imported = await io.read(file);
                const { manifest, flow, network, streams } = imported;

                // Commit only after the complete archive has passed validation.
                await stopSession(false);
                resetSession();
                state.loadedManifest = manifest;
                state.steps = flow.steps;
                state.title = String(flow.title || manifest.title || 'DashBridge recording');
                state.startUrl = manifest.startUrl
                    || flow.steps.find(step => step.type === 'navigate')?.url || '';
                state.createdAt = manifest.createdAt || new Date().toISOString();
                ui.startUrl.value = state.startUrl;
                state.requests = imported.requests;
                state.totalRequestBodyBytes = imported.totalRequestBodyBytes;
                state.totalBodyBytes = imported.totalBodyBytes;
                state.pageEvents = Array.isArray(network.pageEvents) ? network.pageEvents : [];
                state.streams = streams.events;
                state.streamPayloadBytes = imported.streamPayloadBytes;
                state.environment = manifest.environment || null;
                state.captureFinishedAt = manifest.capture?.finishedAt
                    || network.finishedAt || null;
                state.completeness = manifest.capture?.completeness || state.completeness;
                state.baselineRequests = new Map(
                    [...state.requests].map(([key, request]) => [key, { ...request }]),
                );
                void saveSettings().catch(() => undefined);
                setStatus(
                    `Загружено: ${state.steps.length} шагов, baseline ${state.requests.size} запросов.`,
                );
                scheduleRender();
                root.DashBridgeAnalytics?.outcome('recorder.dashflow_imported', 'success', { format: 'dashflow' });
            } catch (error) {
                setStatus(`Не удалось открыть .dashflow: ${error?.message || error}`, true);
                root.DashBridgeAnalytics?.outcome('recorder.dashflow_imported', 'error', { format: 'dashflow' });
            } finally {
                state.importing = false;
                ui.file.value = '';
                updateControls();
            }
        };

        return Object.freeze({ save, load, estimateWorkingSet });
    }

    root.DashBridgeRecorderDashflowController = Object.freeze({ create });
})(globalThis);
