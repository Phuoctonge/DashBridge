(function initDashBridgeReportTransport(global) {
    'use strict';

    const create = ({
        forceLoadPanel,
        getEffectivePanelSla,
        postToDashboardFrame,
        frameTimeoutMs = 90_000,
        totalTimeoutMs = 125_000,
        now = () => Date.now(),
        random = () => Math.random(),
        createObserver = callback => new MutationObserver(callback),
        setTimer = (callback, timeoutMs) => setTimeout(callback, timeoutMs),
        clearTimer = timer => clearTimeout(timer),
        documentRef = global.document
    } = {}) => {
        if (typeof forceLoadPanel !== 'function'
            || typeof getEffectivePanelSla !== 'function'
            || typeof postToDashboardFrame !== 'function') {
            throw new TypeError('DashBridge report transport requires panel, SLA and frame adapters');
        }

        const waiters = new Map();
        const abortError = () => new DOMException('Формирование сообщения отменено', 'AbortError');
        const throwIfAborted = signal => {
            if (signal?.aborted) throw abortError();
        };
        const observationScope = iframe => (
            iframe.closest?.('.panel-card')?.parentElement
            || iframe.parentElement
            || documentRef?.body
        );
        const observeFrame = (iframe, inspect) => {
            const observer = createObserver(inspect);
            observer.observe(observationScope(iframe), {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['data-dashbridge-loaded']
            });
            return observer;
        };

        const waitForIframeReady = (iframe, timeoutMs = frameTimeoutMs, signal = null) => {
            throwIfAborted(signal);
            if (!iframe?.isConnected) return Promise.reject(new Error('Iframe панели удалён'));
            if (iframe.dataset.dashbridgeLoaded === 'true') return Promise.resolve(iframe);
            return new Promise((resolve, reject) => {
                let settled = false;
                let frameObserver = null;
                let timeout = null;
                const finish = error => {
                    if (settled) return;
                    settled = true;
                    frameObserver?.disconnect();
                    clearTimer(timeout);
                    signal?.removeEventListener('abort', abort);
                    error ? reject(error) : resolve(iframe);
                };
                const abort = () => finish(abortError());
                const inspect = () => {
                    if (!iframe.isConnected) return finish(new Error('Iframe панели удалён во время загрузки'));
                    if (iframe.dataset.dashbridgeLoaded === 'true') finish();
                };
                frameObserver = observeFrame(iframe, inspect);
                timeout = setTimer(
                    () => finish(new Error('Панель не загрузилась за 90 секунд')),
                    timeoutMs
                );
                signal?.addEventListener('abort', abort, { once: true });
                inspect();
            });
        };

        const requestPanelSnapshot = async (panel, signal = null) => {
            throwIfAborted(signal);
            const deadline = now() + totalTimeoutMs;
            if (panel.paused) return {
                state: 'unavailable',
                dataStatus: 'paused',
                dataStatusText: 'Панель находится на паузе',
                error: 'Панель находится на паузе',
                series: []
            };
            const sla = getEffectivePanelSla(panel);
            if (sla.error) return {
                state: 'configuration_error',
                dataStatus: 'configuration_error',
                dataStatusText: sla.error,
                error: sla.error,
                series: []
            };
            const iframe = forceLoadPanel(panel.id);
            if (!iframe) return {
                state: 'unavailable',
                dataStatus: 'iframe_unavailable',
                dataStatusText: 'Iframe панели отсутствует',
                error: 'Iframe панели отсутствует',
                series: []
            };
            try {
                await waitForIframeReady(iframe, Math.min(
                    frameTimeoutMs,
                    Math.max(1, deadline - now())
                ), signal);
            } catch (error) {
                if (signal?.aborted || error?.name === 'AbortError') throw error;
                return {
                    state: 'unavailable',
                    dataStatus: 'iframe_unavailable',
                    dataStatusText: error.message || 'Iframe панели недоступен',
                    error: error.message || 'Iframe панели недоступен',
                    series: []
                };
            }

            const requestId = `panel-report-${panel.id}-${now()}-${random().toString(36).slice(2)}`;
            throwIfAborted(signal);
            return new Promise((resolve, reject) => {
                let settled = false;
                let frameObserver = null;
                let timeout = null;
                const finish = snapshot => {
                    if (settled) return;
                    settled = true;
                    frameObserver?.disconnect();
                    clearTimer(timeout);
                    signal?.removeEventListener('abort', abort);
                    waiters.delete(requestId);
                    resolve(snapshot);
                };
                const abort = () => {
                    if (settled) return;
                    settled = true;
                    frameObserver?.disconnect();
                    clearTimer(timeout);
                    signal?.removeEventListener('abort', abort);
                    waiters.delete(requestId);
                    postToDashboardFrame(iframe, { action: 'cancelPanelReportSnapshot', requestId });
                    reject(abortError());
                };
                const inspect = () => {
                    if (!iframe.isConnected || iframe.dataset.dashbridgeLoaded !== 'true') {
                        finish({
                            state: 'unavailable',
                            dataStatus: 'iframe_unavailable',
                            dataStatusText: 'Iframe панели был закрыт или перезагружен во время получения данных',
                            error: 'Iframe панели был закрыт или перезагружен во время получения данных',
                            series: []
                        });
                    }
                };
                frameObserver = observeFrame(iframe, inspect);
                const responseTimeoutMs = Math.max(1, deadline - now());
                timeout = setTimer(() => finish({
                    state: 'timeout',
                    dataStatus: 'timeout',
                    dataStatusText: 'Панель не ответила за общий лимит 125 секунд',
                    error: 'Панель не ответила за общий лимит 125 секунд',
                    series: []
                }), responseTimeoutMs);
                waiters.set(requestId, { iframe, resolve: finish });
                signal?.addEventListener('abort', abort, { once: true });
                if (!postToDashboardFrame(iframe, {
                    action: 'collectPanelReportSnapshot',
                    requestId,
                    sla,
                    timeoutMs: responseTimeoutMs
                })) {
                    finish({
                        state: 'unavailable',
                        dataStatus: 'request_error',
                        dataStatusText: 'Не удалось отправить запрос в iframe',
                        error: 'Не удалось отправить запрос в iframe',
                        series: []
                    });
                }
            });
        };

        const acceptSnapshot = (requestId, sourceIframe, snapshot) => {
            const waiter = waiters.get(requestId);
            if (!waiter || waiter.iframe !== sourceIframe) return false;
            waiter.resolve(snapshot && typeof snapshot === 'object'
                ? snapshot
                : { state: 'error', error: 'Некорректный ответ панели.', series: [] });
            return true;
        };

        return Object.freeze({
            abortError,
            throwIfAborted,
            waitForIframeReady,
            requestPanelSnapshot,
            acceptSnapshot,
            pendingCount: () => waiters.size
        });
    };

    global.DashBridgeReportTransport = Object.freeze({ create });
})(globalThis);
