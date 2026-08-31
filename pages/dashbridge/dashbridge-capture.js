'use strict';

// Owns DashBridge card capture, archive sequencing and the restoration boundary.
// The page controller supplies live profile/panel state without sharing capture flags.
globalThis.DashBridgeCapture = (() => {
    function create({
        getPanels,
        getActiveProfile,
        getDefaultCapturePrepared,
        getCompactCaptureDimensions,
        forceLoadPanel,
        syncDashboardCaptureToggles,
        postToDashboardFrame,
        showAlert,
    }) {
        let panelCaptureInProgress = false;
        let archiveCaptureInProgress = false;
        let lastPanelCaptureAt = 0;
        const waitForLayout = () => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const safeArchiveName = (value, fallback = 'panel') => {
            const cleaned = String(value || fallback)
                .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 100);
            return cleaned || fallback;
        };

        const waitForPanelRendered = (iframe, timeoutMs = 20_000) => {
            if (iframe?.dataset.dashbridgeRendered === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                const finish = error => {
                    clearTimeout(timeout);
                    observer.disconnect();
                    error ? reject(error) : resolve();
                };
                const observer = new MutationObserver(() => {
                    if (iframe.dataset.dashbridgeRendered === 'true') finish();
                });
                const timeout = setTimeout(() => finish(new Error('panel-render-timeout')), timeoutMs);
                observer.observe(iframe, { attributes: true, attributeFilter: ['data-dashbridge-rendered'] });
            });
        };

        const capturePanel = async (sourceIframe, panel, request) => {
            if (panelCaptureInProgress) {
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
            try {
                if (!card) throw new Error('capture-card-not-found');
                if (prepared) {
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
                await new Promise(resolve => setTimeout(resolve, prepared ? 260 : 80));
                await waitForLayout();
                const rect = sourceIframe.getBoundingClientRect();
                if (rect.width <= 1 || rect.height <= 1) throw new Error('capture-panel-empty');
                const tab = await chrome.tabs.getCurrent();
                if (!tab?.windowId) throw new Error('capture-tab-unavailable');
                const throttleWait = Math.max(0, 600 - (Date.now() - lastPanelCaptureAt));
                if (throttleWait) await new Promise(resolve => setTimeout(resolve, throttleWait));
                lastPanelCaptureAt = Date.now();
                const source = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                if (!source) throw new Error('capture-visible-tab-failed');
                const outputSize = prepared ? {
                    width: Number(request.outputWidth) || 1000,
                    height: Number(request.outputHeight) || 520
                } : null;
                const image = await window.DashBridgeGrafanaCaptureOutput.crop(source, {
                    x: rect.left, y: rect.top, width: rect.width, height: rect.height,
                    dpr: window.devicePixelRatio || 1
                }, outputSize);
                if (request.outputAction === 'copy') {
                    await window.DashBridgeGrafanaCaptureOutput.copy(image.blob);
                } else if (request.outputAction === 'archive') {
                    result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true, image };
                } else {
                    await chrome.downloads.download({
                        url: image.dataUrl,
                        filename: window.DashBridgeGrafanaCaptureOutput.filename(request.title || panel?.title),
                        saveAs: false
                    });
                }
                if (request.outputAction !== 'archive') {
                    result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true };
                }
            } catch (error) {
                result = {
                    action: 'dashbridgePanelCaptureResult', requestId: request.requestId,
                    ok: false, error: error?.message || String(error)
                };
            } finally {
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
                panelCaptureInProgress = false;
            }
            return result;
        };

        const captureAll = async button => {
            if (!button || archiveCaptureInProgress || panelCaptureInProgress) return;
            const panels = getPanels();
            const activePanels = panels.filter(panel => !panel.paused);
            const pausedCount = panels.length - activePanels.length;
            if (!activePanels.length) {
                await showAlert(pausedCount
                    ? 'Все графики текущего профиля поставлены на паузу.'
                    : 'В текущем профиле нет графиков.');
                return;
            }

            archiveCaptureInProgress = true;
            const originalHtml = button.innerHTML;
            const originalTitle = button.title;
            const originalScroll = { x: window.scrollX, y: window.scrollY };
            const errors = [];
            const zip = new JSZip();
            const budget = DashBridgeArchiveBudget.create(64 * 1024 * 1024);
            const lockedControls = new Map(
                [...document.querySelectorAll('header button, header input, header select, .panel-actions button')]
                    .map(control => [control, control.disabled])
            );
            lockedControls.forEach((_wasDisabled, control) => { control.disabled = true; });

            try {
                for (let index = 0; index < activePanels.length; index += 1) {
                    const panel = activePanels[index];
                    button.querySelector('span').textContent = `Снимки ${index + 1}/${activePanels.length}`;
                    const iframe = forceLoadPanel(panel.id);
                    try {
                        if (!iframe) throw new Error('panel-iframe-not-found');
                        await waitForPanelRendered(iframe);
                        const dimensions = getCompactCaptureDimensions();
                        const result = await capturePanel(iframe, panel, {
                            requestId: `dashboard_archive_${Date.now()}_${index}`,
                            outputAction: 'archive',
                            prepared: getDefaultCapturePrepared(),
                            outputWidth: dimensions.width,
                            outputHeight: dimensions.height,
                            title: panel.title
                        });
                        if (!result?.ok || !result.image?.blob) throw new Error(result?.error || 'capture-failed');
                        budget.reserve(result.image.blob.size, panel.title || panel.id);
                        const name = `${String(index + 1).padStart(2, '0')}_${safeArchiveName(panel.title, `panel_${panel.id}`)}.png`;
                        zip.file(name, result.image.blob);
                    } catch (error) {
                        errors.push(`${index + 1}. ${panel.title || panel.id}: ${error?.message || String(error)}`);
                    }
                }

                if (pausedCount) errors.push(`Пропущено панелей на паузе: ${pausedCount}.`);
                if (errors.length) zip.file('errors.txt', `DashBridge — отчёт создания снимков\n\n${errors.join('\n')}\n`);
                if (Object.keys(zip.files).every(name => name === 'errors.txt')) {
                    throw new Error('Не удалось создать ни одного снимка. Проверьте загрузку панелей Grafana.');
                }

                button.querySelector('span').textContent = 'Упаковка ZIP…';
                const profileName = safeArchiveName(getActiveProfile()?.name, 'profile');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                await downloadZipArchive(zip, `dashbridge_${profileName}_${timestamp}.zip`);
                button.classList.add('active');
                setTimeout(() => button.classList.remove('active'), 1600);
                if (errors.length) {
                    await showAlert(`ZIP создан. Успешно: ${activePanels.length - (errors.length - (pausedCount ? 1 : 0))} из ${activePanels.length}. Подробности добавлены в errors.txt.`);
                }
            } catch (error) {
                console.error('DashBridge archive capture failed:', error);
                await showAlert('Не удалось сохранить снимки: ' + (error?.message || String(error)));
            } finally {
                window.scrollTo(originalScroll.x, originalScroll.y);
                button.innerHTML = originalHtml;
                button.title = originalTitle;
                lockedControls.forEach((wasDisabled, control) => { control.disabled = wasDisabled; });
                syncDashboardCaptureToggles(getDefaultCapturePrepared());
                archiveCaptureInProgress = false;
            }
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
                if (!result?.ok) throw new Error(result?.error || 'capture-failed');
                button.classList.add('capture-action-success');
                setTimeout(() => button.classList.remove('capture-action-success'), 1600);
            } catch (error) {
                console.error('DashBridge panel capture failed:', error);
                button.classList.add('capture-action-error');
                setTimeout(() => button.classList.remove('capture-action-error'), 2000);
            } finally {
                button.disabled = false;
                button.title = originalTitle;
                button.setAttribute('aria-label', originalTitle);
            }
        };

        return Object.freeze({ captureAll, captureFromToolbar, capturePanel });
    }

    return Object.freeze({ create });
})();
