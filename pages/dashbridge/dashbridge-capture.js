'use strict';

// Owns DashBridge card capture and the restoration boundary.
// The page controller supplies live profile/panel state without sharing capture flags.
globalThis.DashBridgeCapture = (() => {
    function create({
        getPanels,
        getDefaultCapturePrepared,
        setDefaultCapturePrepared,
        getCompactCaptureDimensions,
        forceLoadPanel,
        postToDashboardFrame,
        inspectCompactCapture = null,
        waitForCaptureLayout = null,
        showAlert,
        storage = chrome.storage.sync,
        documentRef = document,
    }) {
        if (typeof getDefaultCapturePrepared !== 'function'
            || typeof setDefaultCapturePrepared !== 'function'
            || typeof getCompactCaptureDimensions !== 'function'
            || typeof postToDashboardFrame !== 'function'
            || typeof storage?.set !== 'function') {
            throw new TypeError('DashBridge capture dependencies are incomplete');
        }
        let panelCaptureInProgress = false;
        let selectionOwner = null;
        let lastPanelCaptureAt = 0;
        const waitForLayout = () => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const syncToggles = enabled => {
            const dimensions = getCompactCaptureDimensions();
            documentRef.querySelectorAll('.btn-capture-toggle').forEach(button => {
                button.classList.toggle('capture-toggle-active', enabled);
                button.setAttribute('aria-pressed', String(enabled));
                button.title = enabled
                    ? `Компактный снимок ${dimensions.width}×${dimensions.height}: включён`
                    : `Компактный снимок ${dimensions.width}×${dimensions.height}: выключен`;
                button.setAttribute('aria-label', button.title);
            });
        };

        const broadcastPrepared = enabled => {
            const dimensions = getCompactCaptureDimensions();
            documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
                postToDashboardFrame(iframe, {
                    action: 'dashbridgeCapturePreparedDefaultChanged',
                    enabled,
                    outputWidth: dimensions.width,
                    outputHeight: dimensions.height,
                });
            });
        };

        const setPrepared = (enabled, { persist = true } = {}) => {
            const prepared = !!enabled;
            setDefaultCapturePrepared(prepared);
            syncToggles(prepared);
            broadcastPrepared(prepared);
            if (persist) void storage.set({ grafanaCompactScreenshot: prepared });
            if (persist) globalThis.DashBridgeAnalytics?.changed('dashbridge.capture_prepared_changed', prepared);
            return prepared;
        };

        const frameRequest = (iframe, requestId, layout = false, signal = null) => new Promise((resolve, reject) => {
            const origin = new URL(iframe.src).origin;
            const sourceUrl = iframe.src;
            const sourceWindow = iframe.contentWindow;
            const finish = (error, reason) => {
                clearTimeout(timer); window.removeEventListener('message', receive);
                signal?.removeEventListener('abort', abort);
                error ? reject(error) : resolve(reason);
            };
            const abort = () => finish(new Error('Подготовка отменена'));
            const receive = event => {
                if (event.source !== sourceWindow || event.origin !== origin
                    || event.data?.requestId !== requestId) return;
                if ((layout && event.data.action === 'dashbridgeCaptureLayoutReady')
                    || (!layout && event.data.action === 'dashbridgeCompactCaptureSupport')) {
                    if (!iframe.isConnected || iframe.src !== sourceUrl) return finish(new Error('Панель перезагружена.'));
                    finish(null, typeof event.data.error === 'string' ? event.data.error.slice(0, 500) : 'Не удалось проверить тип панели.');
                }
            };
            const timer = setTimeout(() => finish(new Error(layout
                ? 'График не подтвердил новый размер. Повторите снимок.'
                : 'Панель не ответила на проверку компактного снимка. Повторите снимок.')), layout ? 8000 : 5000);
            window.addEventListener('message', receive);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) return abort();
            try {
                const sent = layout
                    ? postToDashboardFrame(iframe, { action: 'dashbridgeCaptureLayoutCheck', requestId })
                    : postToDashboardFrame(iframe, { action: 'dashbridgeCompactCaptureCheck', requestId });
                if (!sent) {
                    finish(new Error('Панель ещё не загрузилась. Повторите снимок.'));
                }
            } catch (error) { finish(error); }
        });
        const checkCompactCapture = inspectCompactCapture || frameRequest;
        const checkCaptureLayout = waitForCaptureLayout || ((iframe, requestId, signal) => frameRequest(iframe, requestId, true, signal));
        const capturePanel = async (sourceIframe, panel, request, owner = null) => {
            if (panelCaptureInProgress || (selectionOwner && owner !== selectionOwner)) {
                const busyResult = {
                    action: 'dashbridgePanelCaptureResult', requestId: request.requestId,
                    ok: false, error: 'capture-in-progress'
                };
                postToDashboardFrame(sourceIframe, busyResult);
                return busyResult;
            }
            panelCaptureInProgress = true;
            const card = sourceIframe.closest('.panel-card');
            const prepared = !!request.prepared;
            const scroll = { x: window.scrollX, y: window.scrollY };
            const captureProps = [
                'position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height',
                'min-width', 'min-height', 'max-width', 'max-height', 'transform', 'z-index',
                'margin', 'box-sizing', 'border'
            ];
            const captureSnapshot = card && new Map(captureProps.map(prop => [prop, {
                value: card.style.getPropertyValue(prop), priority: card.style.getPropertyPriority(prop)
            }]));
            let result = {
                action: 'dashbridgePanelCaptureResult', requestId: request.requestId,
                ok: false, error: 'capture-failed'
            };
            const inspectPrepared = async () => {
                const sourceUrl = sourceIframe.src;
                const reason = await checkCompactCapture(sourceIframe, request.requestId);
                request.assertCurrent?.();
                if (!sourceIframe.isConnected || sourceIframe.src !== sourceUrl) throw new Error('Панель перезагружена.');
                if (reason) throw Object.assign(new Error(reason), { code: 'compact-unsupported' });
            };
            try {
                request.assertCurrent?.();
                if (!card) throw new Error('capture-card-not-found');
                if (prepared) {
                    // Reports load offscreen Grafana after moving the card into view.
                    // Their inspection must wait for that runtime; toolbar capture is already loaded.
                    if (!request.waitForData) await inspectPrepared();
                    const fitted = window.DashBridgeGrafanaCaptureOutput.fitPreparedSize({
                        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                        outputWidth: Number(request.outputWidth) || 1000,
                        outputHeight: Number(request.outputHeight) || 520
                    });
                    card.style.setProperty('position', 'fixed', 'important');
                    card.style.setProperty('inset', 'auto', 'important');
                    card.style.setProperty('left', `${fitted.left}px`, 'important');
                    card.style.setProperty('top', `${fitted.top}px`, 'important');
                    card.style.setProperty('width', `${fitted.width}px`, 'important');
                    card.style.setProperty('height', `${fitted.height}px`, 'important');
                    card.style.setProperty('min-width', '0', 'important');
                    card.style.setProperty('min-height', '0', 'important');
                    card.style.setProperty('max-width', 'none', 'important');
                    card.style.setProperty('max-height', 'none', 'important');
                    card.style.setProperty('transform', 'none', 'important');
                    card.style.setProperty('z-index', '2147483645', 'important');
                    card.style.setProperty('margin', '0', 'important');
                    card.style.setProperty('box-sizing', 'border-box', 'important');
                    // Cropping targets the iframe. Removing the card border keeps
                    // the configured prepared output aspect ratio exact.
                    card.style.setProperty('border', 'none', 'important');
                } else card.scrollIntoView({ block: 'center', inline: 'center' });
                card.classList.add('dashbridge-panel-capture-active');
                postToDashboardFrame(sourceIframe, { action: 'dashbridgeCaptureLayoutChanged' });
                await request.waitForData?.();
                request.assertCurrent?.();
                if (prepared && request.waitForData) await inspectPrepared();
                await waitForLayout();
                await window.DashBridgeGrafanaCaptureOutput?.waitForStableLayout?.(card || sourceIframe);
                if (prepared) {
                    try {
                        const reason = await checkCaptureLayout(sourceIframe, request.requestId, request.signal);
                        request.assertCurrent?.();
                        if (reason) throw new Error(reason);
                    } catch (error) {
                        error.code = 'capture-layout-unready';
                        throw error;
                    }
                }
                const rect = sourceIframe.getBoundingClientRect();
                if (rect.width <= 1 || rect.height <= 1) throw new Error('capture-panel-empty');
                const tab = await chrome.tabs.getCurrent();
                if (!tab?.windowId) throw new Error('capture-tab-unavailable');
                const throttleWait = Math.max(0, 600 - (Date.now() - lastPanelCaptureAt));
                if (throttleWait) await new Promise(resolve => setTimeout(resolve, throttleWait));
                lastPanelCaptureAt = Date.now();
                request.assertCurrent?.();
                const captured = await chrome.runtime.sendMessage({ type: 'dashbridge-capture-visible-tab' });
                request.assertCurrent?.();
                if (!captured?.ok) throw new Error(captured?.error || 'capture-visible-tab-failed');
                const source = captured.dataUrl;
                if (!source) throw new Error('capture-visible-tab-failed');
                const outputSize = prepared ? {
                    width: Number(request.outputWidth) || 1000,
                    height: Number(request.outputHeight) || 520
                } : null;
                const image = await window.DashBridgeGrafanaCaptureOutput.crop(source, {
                    x: rect.left, y: rect.top, width: rect.width, height: rect.height,
                    dpr: window.devicePixelRatio || 1
                }, outputSize);
                request.assertCurrent?.();
                if (request.outputAction === 'copy') {
                    try {
                        await window.DashBridgeGrafanaCaptureOutput.copy(image.blob);
                    } catch (clipboardError) {
                        await chrome.downloads.download({
                            url: image.dataUrl,
                            filename: window.DashBridgeGrafanaCaptureOutput.filename(request.title || panel?.title),
                            saveAs: false
                        });
                        result = {
                            action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true,
                            fallback: 'download', clipboardError: clipboardError?.message || String(clipboardError),
                            insecureContext: window.isSecureContext !== true
                        };
                    }
                } else if (request.outputAction === 'archive' || request.outputAction === 'image') {
                    result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true, image };
                } else {
                    await chrome.downloads.download({
                        url: image.dataUrl,
                        filename: window.DashBridgeGrafanaCaptureOutput.filename(request.title || panel?.title),
                        saveAs: false
                    });
                }
                if (request.outputAction !== 'archive' && !result.ok) {
                    result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true };
                }
            } catch (error) {
                result = {
                    action: 'dashbridgePanelCaptureResult', requestId: request.requestId,
                    ok: false, error: error?.message || String(error), errorCode: error?.code || null
                };
            } finally {
                try {
                    if (card) {
                        card.classList.remove('dashbridge-panel-capture-active');
                        captureSnapshot?.forEach((state, prop) => state.value
                            ? card.style.setProperty(prop, state.value, state.priority || '')
                            : card.style.removeProperty(prop));
                    }
                    window.scrollTo(scroll.x, scroll.y);
                    postToDashboardFrame(sourceIframe, { action: 'dashbridgeCaptureLayoutChanged' });
                    await waitForLayout();
                    postToDashboardFrame(sourceIframe, {
                        action: result.action, requestId: result.requestId,
                        ok: result.ok, error: result.error
                    });
                } finally { panelCaptureInProgress = false; }
            }
            return result;
        };

        // The lease stays in this controller; iframe messages cannot acquire it.
        const captureSelection = async (selected, { signal, assertCurrent = () => {}, onProgress = () => {},
            onCaptureVisibility = () => {}, allowUnrendered = false, waitForData = null } = {}) => {
            if (panelCaptureInProgress || selectionOwner) throw new Error('Уже выполняется захват снимков.');
            if (!Array.isArray(selected) || selected.length < 1 || selected.length > 8
                || new Set(selected.map(panel => panel.id)).size !== selected.length) throw new Error('Выберите от 1 до 8 разных панелей.');
            const owner = {};
            selectionOwner = owner;
            const images = [];
            const errors = [];
            let bytes = 0;
            const check = () => {
                if (signal?.aborted) throw new DOMException('Подготовка отменена', 'AbortError');
                assertCurrent();
            };
            const waitRendered = async iframe => {
                check();
                if (allowUnrendered || iframe.dataset.dashbridgeRendered === 'true') return;
                await new Promise((resolve, reject) => {
                    let observer;
                    let timer;
                    const finish = error => {
                        observer?.disconnect(); clearTimeout(timer);
                        signal?.removeEventListener('abort', abort);
                        error ? reject(error) : resolve();
                    };
                    const abort = () => finish(new DOMException('Подготовка отменена', 'AbortError'));
                    const inspect = () => {
                        try {
                            check();
                            if (!iframe.isConnected) throw new Error('Панель удалена.');
                            if (iframe.dataset.dashbridgeRendered === 'true') finish();
                        } catch (error) { finish(error); }
                    };
                    observer = new MutationObserver(inspect);
                    observer.observe(documentRef.body, { subtree: true, childList: true, attributes: true,
                        attributeFilter: ['data-dashbridge-rendered', 'src'] });
                    timer = setTimeout(() => finish(new Error('Панель не загрузилась за 20 секунд.')), 20_000);
                    signal?.addEventListener('abort', abort, { once: true });
                    inspect();
                });
            };
            try {
                for (let index = 0; index < selected.length; index += 1) {
                    check();
                    const panel = selected[index];
                    onProgress(index, selected.length, panel.title);
                    try {
                        if (!getPanels().some(current => current.id === panel.id && !current.paused)) throw new Error('Панель недоступна или на паузе.');
                        const iframe = forceLoadPanel(panel.id);
                        if (!iframe) throw new Error('Iframe панели отсутствует.');
                        const src = iframe.src;
                        const assertFrame = () => {
                            check();
                            if (!iframe.isConnected || iframe.src !== src
                                || (!allowUnrendered && iframe.dataset.dashbridgeRendered !== 'true')) throw new Error('Панель перезагружена.');
                        };
                        await waitRendered(iframe);
                        let result;
                        try {
                            onCaptureVisibility(true);
                            result = await capturePanel(iframe, panel, {
                                requestId: `report_image_${Date.now()}_${index}`, outputAction: 'image',
                                prepared: true, outputWidth: 1000, allowUnrendered, signal,
                                waitForData: waitForData ? async () => { check(); await waitForData(panel, signal); check(); } : null,
                                assertCurrent: assertFrame
                            }, owner);
                        } finally { onCaptureVisibility(false); }
                        check();
                        if (!result.ok || !result.image?.blob) throw new Error(result.error || 'Не удалось снять панель.');
                        bytes += result.image.blob.size;
                        if (bytes > 64 * 1024 * 1024) throw new Error('Превышен лимит снимков 64 МиБ.');
                        const { blob, width, height } = result.image;
                        images.push({ panelId: panel.id, title: panel.title, blob, width, height, capturedAt: Date.now() });
                    } catch (error) {
                        check();
                        errors.push({ panelId: panel.id, title: panel.title, error: error.message || String(error) });
                    }
                }
                check();
                return { images, errors };
            } finally { selectionOwner = null; }
        };

        const captureFromToolbar = async (panel, iframe, outputAction, button) => {
            if (!iframe || !button) return;
            const originalTitle = button.title;
            button.disabled = true;
            button.title = outputAction === 'copy' ? 'Копирование снимка…' : 'Сохранение снимка…';
            button.setAttribute('aria-label', button.title);
            try {
                const dimensions = getCompactCaptureDimensions();
                const result = await capturePanel(iframe, panel, {
                    requestId: `dashboard_capture_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    outputAction,
                    prepared: getDefaultCapturePrepared(),
                    outputWidth: dimensions.width,
                    outputHeight: dimensions.height,
                    title: panel?.title
                });
                if (!result?.ok) {
                    if (['compact-unsupported', 'capture-layout-unready'].includes(result?.errorCode)) await showAlert?.(result.error);
                    throw new Error(result?.error || 'capture-failed');
                }
                globalThis.DashBridgeAnalytics?.outcome(outputAction === 'copy'
                    ? 'dashbridge.capture_panel_copy' : 'dashbridge.capture_panel_download', 'success', {
                    prepared: getDefaultCapturePrepared(), format: 'png'
                });
                button.classList.add('capture-action-success');
                setTimeout(() => button.classList.remove('capture-action-success'), 1600);
            } catch (error) {
                globalThis.DashBridgeAnalytics?.outcome(outputAction === 'copy'
                    ? 'dashbridge.capture_panel_copy' : 'dashbridge.capture_panel_download', 'error', {
                    prepared: getDefaultCapturePrepared(), format: 'png'
                });
                console.error('DashBridge panel capture failed:', error);
                button.classList.add('capture-action-error');
                setTimeout(() => button.classList.remove('capture-action-error'), 2000);
            } finally {
                button.disabled = false;
                button.title = originalTitle;
                button.setAttribute('aria-label', originalTitle);
            }
        };

        return Object.freeze({
            captureFromToolbar,
            capturePanel,
            captureSelection,
            syncToggles,
            broadcastPrepared,
            setPrepared,
        });
    }

    return Object.freeze({ create });
})();
