(function initRecorderSessionController(root) {
    'use strict';

    function create({ state, ui, schema, transport, networkCapture, delay,
        resetSession, addNavigateStep, saveSettings, setStatus, updateControls,
        updateRecordingProgress, scheduleRender, getProgressController,
        chromeRef = chrome }) {
        if (!state || !ui?.startUrl || !ui?.disableCache || !ui?.disableCookies
            || typeof schema?.normalizeHttpUrl !== 'function'
            || typeof transport?.ensureDebuggerPermission !== 'function'
            || typeof transport?.buildWindowLayout !== 'function'
            || typeof transport?.createControlledTab !== 'function'
            || typeof transport?.attachNetwork !== 'function'
            || typeof transport?.detachNetwork !== 'function'
            || typeof transport?.postLifecycle !== 'function'
            || typeof networkCapture?.setResponseBodyStatus !== 'function'
            || typeof delay !== 'function' || typeof resetSession !== 'function'
            || typeof addNavigateStep !== 'function' || typeof saveSettings !== 'function'
            || typeof setStatus !== 'function' || typeof updateControls !== 'function'
            || typeof updateRecordingProgress !== 'function'
            || typeof scheduleRender !== 'function'
            || typeof getProgressController !== 'function'
            || typeof chromeRef?.tabs?.update !== 'function'
            || typeof chromeRef?.windows?.remove !== 'function') {
            throw new TypeError('Recorder session controller dependencies are incomplete');
        }

        const stop = async (showStatus = true) => {
            if (!['recording', 'replaying'].includes(state.mode) && !state.attached) return;
            const stoppedMode = state.mode;
            if (showStatus) state.stopRequested = true;
            await delay(250);
            const pendingCaptures = () => [
                ...state.pendingBodyCaptures,
                ...state.pendingRequestBodyCaptures,
            ];
            if (pendingCaptures().length) {
                await Promise.race([
                    Promise.allSettled(pendingCaptures()),
                    delay(3_000),
                ]);
            }
            state.completeness.pendingCapturesAtStop = pendingCaptures().length;
            for (const request of state.requests.values()) {
                if (request.responseBodyCapture?.status === 'pending') {
                    networkCapture.setResponseBodyStatus(request, 'unavailable', 'capture-stopped');
                }
                if (request.requestBodyCapture?.status === 'pending') {
                    request.requestBodyCapture = { status: 'failed', reason: 'capture-stopped' };
                    state.completeness.requestBodiesFailed += 1;
                }
            }
            await transport.detachNetwork();
            state.captureFinishedAt = new Date().toISOString();
            const ephemeralWindowId = state.sessionOptions.disableCookies ? state.windowId : null;
            state.mode = 'idle';
            state.sessionStartedAt = null;
            state.tabId = null;
            state.windowId = null;
            if (Number.isInteger(ephemeralWindowId)) {
                await chromeRef.windows.remove(ephemeralWindowId).catch(() => undefined);
            }
            if (showStatus) {
                getProgressController()?.cancel();
                setStatus(`Сессия остановлена: ${state.steps.length} шагов, ${state.requests.size} запросов.`);
                if (stoppedMode === 'recording') root.DashBridgeAnalytics?.outcome('recorder.record_stopped', 'success');
            }
            scheduleRender();
        };

        const finalizeUnexpected = async (message, { debuggerDetached = false } = {}) => {
            if (!['recording', 'replaying'].includes(state.mode)) return;
            const detachedMode = state.mode;
            const ephemeralWindowId = state.sessionOptions.disableCookies ? state.windowId : null;
            state.attached = false;
            state.detachedUnexpectedly = true;
            state.captureFinishedAt = new Date().toISOString();
            state.completeness.pendingCapturesAtStop = state.pendingBodyCaptures.size
                + state.pendingRequestBodyCaptures.size;
            if (debuggerDetached) state.completeness.unexpectedDebuggerDetach = true;
            for (const request of state.requests.values()) {
                if (request.responseBodyCapture?.status === 'pending') {
                    networkCapture.setResponseBodyStatus(
                        request,
                        'unavailable',
                        debuggerDetached ? 'debugger-detached' : 'controlled-tab-closed',
                    );
                }
                if (request.requestBodyCapture?.status === 'pending') {
                    request.requestBodyCapture = {
                        status: 'failed',
                        reason: debuggerDetached ? 'debugger-detached' : 'controlled-tab-closed',
                    };
                    state.completeness.requestBodiesFailed += 1;
                }
            }
            state.inFlight.clear();
            state.mode = 'idle';
            state.sessionStartedAt = null;
            state.tabId = null;
            state.windowId = null;
            transport.postLifecycle({ type: 'unbind' });
            getProgressController()?.finish({ status: 'error', message });
            setStatus(message, true);
            scheduleRender();
            root.DashBridgeAnalytics?.outcome(detachedMode === 'replaying'
                ? 'recorder.replay_finished' : 'recorder.unexpected_detach', 'error');
            if (Number.isInteger(ephemeralWindowId)) {
                await chromeRef.windows.remove(ephemeralWindowId).catch(() => undefined);
            }
        };

        const start = async () => {
            const startUrl = schema.normalizeHttpUrl(ui.startUrl.value);
            if (!startUrl) {
                setStatus('Введите корректный адрес сайта, например site.ru', true);
                return;
            }
            ui.startUrl.value = startUrl;
            try {
                await getProgressController()?.openPictureInPicture({
                    title: 'Traffic Recorder', phase: 'Запись трафика', width: 390, height: 300,
                });
                void saveSettings().catch(() => undefined);
                await transport.ensureDebuggerPermission();
                await stop(false);
                resetSession();
                state.sessionOptions = {
                    disableCache: ui.disableCache.checked,
                    disableCookies: ui.disableCookies.checked,
                };
                state.mode = 'recording';
                state.startUrl = startUrl;
                state.createdAt = new Date().toISOString();
                state.sessionStartedAt = Date.now();
                state.title = new URL(startUrl).hostname;
                updateControls();
                const layout = transport.buildWindowLayout();
                const tabId = await transport.createControlledTab(layout);
                await transport.attachNetwork(tabId);
                addNavigateStep(startUrl);
                setStatus('Запись активна. Выполняйте сценарий в открывшейся вкладке.');
                await chromeRef.tabs.update(tabId, { url: startUrl });
                updateRecordingProgress();
                root.DashBridgeAnalytics?.outcome('recorder.record_started', 'success');
            } catch (error) {
                await stop(false);
                getProgressController()?.finish({
                    status: 'error', message: `Не удалось начать запись: ${error?.message || error}`,
                });
                setStatus(`Не удалось начать запись: ${error?.message || error}`, true);
                root.DashBridgeAnalytics?.outcome('recorder.record_started', 'error');
            }
        };

        return Object.freeze({ start, stop, finalizeUnexpected });
    }

    root.DashBridgeRecorderSessionController = Object.freeze({ create });
})(globalThis);
