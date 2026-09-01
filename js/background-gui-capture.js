(function initBackgroundGuiCapture(root) {
    'use strict';

    const CAPTURE_INTERVAL_MS = 750;
    const SOURCE_BUDGET_BYTES = 128 * 1024 * 1024;
    const ARCHIVE_BUDGET_BYTES = 64 * 1024 * 1024;

    function reserveBytes(usedBytes, nextBytes, maxBytes = SOURCE_BUDGET_BYTES) {
        const total = Math.max(0, Number(usedBytes) || 0) + Math.max(0, Number(nextBytes) || 0);
        if (total > maxBytes) {
            throw new RangeError(`Снимки GUI превышают безопасный лимит ${Math.round(maxBytes / 1024 / 1024)} МиБ.`);
        }
        return total;
    }

    function assertArchiveSize(blob, maxBytes = ARCHIVE_BUDGET_BYTES) {
        if (!blob || !Number.isFinite(blob.size) || blob.size > maxBytes) {
            throw new RangeError(`ZIP GUI превышает безопасный лимит ${Math.round(maxBytes / 1024 / 1024)} МиБ.`);
        }
        return blob;
    }

    function create({ chromeRef = chrome, zipConstructor = root.JSZip,
        fetchRef = root.fetch, btoaRef = root.btoa,
        setTimer = root.setTimeout, clearTimer = root.clearTimeout,
        now = () => Date.now() } = {}) {
        if (!chromeRef?.tabs || !chromeRef?.windows || !chromeRef?.storage?.local
            || !chromeRef?.downloads || typeof fetchRef !== 'function'
            || typeof btoaRef !== 'function' || typeof setTimer !== 'function'
            || typeof clearTimer !== 'function') {
            throw new TypeError('Background GUI capture dependencies are incomplete');
        }
        const readyWaiters = new Map();
        let captureInProgress = false;
        let lastPanelVisibleCaptureAt = 0;
        const wait = ms => new Promise(resolve => setTimer(resolve, ms));

        const waitForReady = (tabId, timeoutMs = 15_000) => new Promise(resolve => {
            const previous = readyWaiters.get(tabId);
            if (previous) previous(false);
            const finish = ready => {
                clearTimer(timeout);
                if (readyWaiters.get(tabId) === finish) readyWaiters.delete(tabId);
                resolve(ready);
            };
            const timeout = setTimer(() => finish(false), timeoutMs);
            readyWaiters.set(tabId, finish);
        });

        const markReady = tabId => {
            const finish = readyWaiters.get(tabId);
            if (!finish) return false;
            finish(true);
            return true;
        };

        const blobToDataUrl = async blob => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const chunkSize = 0x8000;
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
            }
            return `data:application/zip;base64,${btoaRef(binary)}`;
        };

        const waitForTab = tabId => new Promise(resolve => {
            const timeout = setTimer(() => {
                chromeRef.tabs.onUpdated.removeListener(onUpdated);
                resolve();
            }, 6000);
            const onUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    clearTimer(timeout);
                    chromeRef.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                }
            };
            chromeRef.tabs.onUpdated.addListener(onUpdated);
        });

        const collectInternal = async () => {
            await chromeRef.storage.local.set({
                guiCaptureStatus: { state: 'running', message: 'Сбор скриншотов запущен', updatedAt: now() },
            });
            if (typeof zipConstructor !== 'function') throw new Error('Модуль упаковки ZIP не загружен');
            const popupUrl = chromeRef.runtime.getURL('pages/popup/popup.html');
            const pages = [
                { name: '01_popup_grafana_dashboards.png', popup: ['tab-grafana', 'grafana-links'] },
                { name: '04_popup_grafana_links.png', popup: ['tab-grafana', 'grafana-links'] },
                { name: '05_popup_grafana_batch.png', popup: ['tab-grafana', 'grafana-batch'] },
                { name: '06_popup_grafana_debug.png', popup: ['tab-grafana', 'grafana-debug'] },
                { name: '07_popup_jira.png', popup: ['tab-jira'] },
                { name: '09_popup_tdm.png', popup: ['tab-tdm'] },
                { name: '10_options.png', url: chromeRef.runtime.getURL('pages/options/options.html') },
                { name: '11_dashbridge.png', url: chromeRef.runtime.getURL('pages/dashbridge/dashbridge.html') },
                { name: '12_batch.png', url: chromeRef.runtime.getURL('pages/batch/batch.html') },
                { name: '13_worklog.png', url: chromeRef.runtime.getURL('pages/worklog/worklog.html') },
            ];
            const captureWindow = await chromeRef.windows.create({
                url: popupUrl, type: 'popup', focused: true, width: 366, height: 760,
            });
            const tabId = captureWindow.tabs?.[0]?.id;
            if (!captureWindow.id || !tabId) throw new Error('Не удалось открыть окно для снимков');
            try {
                const zip = new zipConstructor();
                let capturedSourceBytes = 0;
                for (let index = 0; index < pages.length; index += 1) {
                    const page = pages[index];
                    const dashbridgeReady = page.name === '11_dashbridge.png' ? waitForReady(tabId) : null;
                    if (page.url) {
                        await chromeRef.windows.update(captureWindow.id, { state: 'maximized' });
                        const loaded = waitForTab(tabId);
                        await chromeRef.tabs.update(tabId, { url: page.url });
                        await loaded;
                    } else {
                        await chromeRef.windows.update(captureWindow.id, { state: 'normal' });
                        await chromeRef.windows.update(captureWindow.id, { width: 366, height: 760 });
                        const [mainTab, subTab] = page.popup;
                        const captureUrl = new URL(popupUrl);
                        captureUrl.searchParams.set('guiCapture', String(index));
                        captureUrl.searchParams.set('guiTab', mainTab);
                        if (subTab) captureUrl.searchParams.set('guiSub', subTab);
                        const loaded = waitForTab(tabId);
                        await chromeRef.tabs.update(tabId, { url: captureUrl.toString() });
                        await loaded;
                    }
                    if (dashbridgeReady) await dashbridgeReady;
                    else await wait(CAPTURE_INTERVAL_MS);
                    const dataUrl = await chromeRef.tabs.captureVisibleTab(captureWindow.id, { format: 'png' });
                    const image = await fetchRef(dataUrl).then(response => response.blob());
                    if (!image) throw new Error(`Не удалось создать ${page.name}`);
                    capturedSourceBytes = reserveBytes(capturedSourceBytes, image.size);
                    zip.file(page.name, image);
                }
                const archive = assertArchiveSize(await zip.generateAsync({
                    type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
                }));
                const archiveUrl = await blobToDataUrl(archive);
                const date = new Date().toISOString().replace(/[:.]/g, '-');
                await chromeRef.downloads.download({
                    url: archiveUrl, filename: `dashbridge_gui_${date}.zip`, saveAs: true,
                });
                await chromeRef.storage.local.set({
                    guiCaptureStatus: {
                        state: 'complete',
                        message: `Готово: ${pages.length} снимков переданы в загрузки. Окно можно закрыть после сохранения ZIP.`,
                        updatedAt: now(),
                    },
                });
                const resultUrl = new URL(popupUrl);
                resultUrl.searchParams.set('guiTab', 'tab-grafana');
                resultUrl.searchParams.set('guiSub', 'grafana-debug');
                await chromeRef.tabs.update(tabId, { url: resultUrl.toString() });
                return pages.length;
            } catch (error) {
                await chromeRef.windows.remove(captureWindow.id).catch(() => undefined);
                throw error;
            }
        };

        const collect = async () => {
            if (captureInProgress) throw new Error('GUI capture is already running');
            captureInProgress = true;
            try { return await collectInternal(); }
            finally { captureInProgress = false; }
        };

        const captureVisiblePanel = async sender => {
            const waitMs = Math.max(0, 600 - (now() - lastPanelVisibleCaptureAt));
            if (waitMs) await wait(waitMs);
            lastPanelVisibleCaptureAt = now();
            return chromeRef.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
        };

        return Object.freeze({ collect, captureVisiblePanel, waitForReady, markReady });
    }

    root.DashBridgeBackgroundGuiCapture = Object.freeze({ create, reserveBytes, assertArchiveSize });
})(globalThis);
