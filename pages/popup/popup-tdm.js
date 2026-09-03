/* global DashBridgeAnalytics */
function formatTdmExportProgress(message) {
    const current = Number.isFinite(Number(message.current)) ? Number(message.current) : 0;
    const hasKnownTotal = message.total !== undefined && message.total !== null
        && Number.isFinite(Number(message.total));
    const label = message.text || 'Сбор данных: обработано блоков';
    return hasKnownTotal
        ? label + ' ' + current + ' из ' + Number(message.total) + '...'
        : label + ' ' + current + '...';
}
document.addEventListener("DOMContentLoaded", () => {
    const photosCheck = document.getElementById("tdmExportPhotos");
    const excludeCheck = document.getElementById("tdmExcludeUserCheckbox");
    const excludeText = document.getElementById("tdmExcludeUserText");
    const startInput = document.getElementById("tdmExportStart");
    const endInput = document.getElementById("tdmExportEnd");
    const filterContainer = document.getElementById("tdmFilterUserContainer");

    if (photosCheck && excludeCheck && excludeText && filterContainer) {
        photosCheck.addEventListener("change", () => {
            chrome.storage.sync.set({ tdmSavePhotosDefault: photosCheck.checked });
        });

        excludeCheck.addEventListener("change", () => {
            excludeText.style.display = excludeCheck.checked ? "block" : "none";
            chrome.storage.sync.set({
                tdmExcludeUserDefault: excludeCheck.checked
            });
        });

        DashBridgeSyncInputWriter.bind({
            element: excludeText,
            key: 'tdmExcludeUserTextDefault',
            onError(error) {
                const status = document.getElementById('tdmExportStatus');
                if (status) {
                    status.style.display = 'block';
                    status.textContent = `Не удалось сохранить фильтр: ${error.message}`;
                }
            }
        });
    }

    if (startInput && endInput) {
        const saveDates = () => {
            chrome.storage.sync.get(["tdmRememberDate"], (data) => {
                if (data.tdmRememberDate !== false) {
                    chrome.storage.sync.set({
                        tdmLastStart: startInput.value,
                        tdmLastEnd: endInput.value
                    });
                }
            });
        };
        startInput.addEventListener("change", saveDates);
        endInput.addEventListener("change", saveDates);
    }

    const tdmExportBtn = document.getElementById("tdmExportBtn");
    if (tdmExportBtn) tdmExportBtn.onclick = tdmExport;

    chrome.storage.sync.get({
        tdmExcludeUserDefault: false,
        tdmExcludeUserTextDefault: "",
        tdmRememberDate: false,
        tdmLastStart: "",
        tdmLastEnd: "",
        tdmSavePhotosDefault: true
    }, (data) => {
        const photosCheck = document.getElementById("tdmExportPhotos");
        const excludeCheck = document.getElementById("tdmExcludeUserCheckbox");
        const excludeText = document.getElementById("tdmExcludeUserText");
        const startInput = document.getElementById("tdmExportStart");
        const endInput = document.getElementById("tdmExportEnd");

        // Загружаем настройки из глобальных дефолтов или последнего состояния
        if (photosCheck) photosCheck.checked = data.tdmSavePhotosDefault !== false;
        if (excludeCheck) {
            excludeCheck.checked = data.tdmExcludeUserDefault === true;
        }
        if (excludeText) {
            excludeText.style.display = excludeCheck && excludeCheck.checked ? "block" : "none";
            excludeText.value = data.tdmExcludeUserTextDefault || "";
        }

        if (data.tdmRememberDate !== false) {
            if (startInput && data.tdmLastStart) startInput.value = data.tdmLastStart;
            if (endInput && data.tdmLastEnd) endInput.value = data.tdmLastEnd;
        }
    });
});

/**
 * Экспорт сообщений из TDM Chat (Улучшенная версия из popup_old.js)
 */
async function tdmExport() {
    const statusEl = document.getElementById("tdmExportStatus");
    const btn = document.getElementById("tdmExportBtn");
    const photosCheck = document.getElementById("tdmExportPhotos");
    const excludeCheck = document.getElementById("tdmExcludeUserCheckbox");
    const excludeText = document.getElementById("tdmExcludeUserText");
    const startInput = document.getElementById("tdmExportStart");
    const endInput = document.getElementById("tdmExportEnd");
    const formatSelect = document.getElementById("tdmExportFormat");

    statusEl.style.display = "block";
    statusEl.textContent = "Начинаю экспорт...";

    let startVal = startInput.value;
    let endVal = endInput.value;

    if (startVal && endVal && new Date(startVal) > new Date(endVal)) {
        startInput.value = endVal;
        endInput.value = startVal;
        const temp = startVal;
        startVal = endVal;
        endVal = temp;
    }

    let excludeName = "";
    if (photosCheck.checked && excludeCheck.checked) {
        excludeName = excludeText.value.trim().toLowerCase();
    }

    const options = {
        startStr: startVal,
        endStr: endVal,
        format: formatSelect.value,
        savePhotos: photosCheck.checked,
        excludePhotoUser: excludeName,
        isExcludeAll: photosCheck.checked && excludeCheck.checked && excludeName === "",
        photoExportId: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
    };
    const analyticsDimensions = { format: ['html', 'json', 'both'].includes(options.format) ? options.format : 'html' };
    DashBridgeAnalytics?.track('tdm.export_started', 'used', analyticsDimensions);
    const finishAnalytics = outcome => DashBridgeAnalytics?.outcome('tdm.export_finished', outcome, analyticsDimensions);

    const photoArchive = options.savePhotos && typeof JSZip !== 'undefined'
        ? createRollingZipArchive({
            filename: `TDM_Photos_${options.photoExportId}.zip`,
            maxBytes: 50 * 1024 * 1024
        })
        : null;
    let activeTdmTabId = null;
    let photoQueue = Promise.resolve();
    const progressListener = (msg, sender, sendResponse) => {
        if (msg.action === "tdmExportProgress") {
            statusEl.textContent = formatTdmExportProgress(msg);
        }
        if (msg.action === 'tdmExportPhoto' && msg.exportId === options.photoExportId
            && sender.tab?.id === activeTdmTabId && photoArchive) {
            photoQueue = photoQueue.then(() => photoArchive.add(
                msg.filename, msg.b64, msg.bytes, { base64: true }
            ));
            photoQueue.then(
                () => sendResponse({ ok: true }),
                error => sendResponse({ ok: false, error: error?.message || String(error) })
            );
            return true;
        }
        return undefined;
    };
    chrome.runtime.onMessage.addListener(progressListener);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
            statusEl.textContent = "Ошибка доступа к вкладке.";
            chrome.runtime.onMessage.removeListener(progressListener);
            finishAnalytics('error');
            return;
        }
        if (tabs[0]) {
            activeTdmTabId = tabs[0].id;
            chrome.storage.sync.get({ tdmDomain: 'web.tdm.mos.ru' }, (settings) => {
                let activeUrl;
                let tdmUrl;
                try {
                    activeUrl = new URL(tabs[0].url);
                    const configuredDomain = String(settings.tdmDomain || '').trim();
                    tdmUrl = new URL(
                        configuredDomain.includes('://')
                            ? configuredDomain
                            : `https://${configuredDomain}`
                    );
                } catch (error) {
                    statusEl.textContent = "Некорректный адрес TDM в настройках.";
                    chrome.runtime.onMessage.removeListener(progressListener);
                    finishAnalytics('invalid_input');
                    return;
                }

                if (activeUrl.hostname.toLowerCase() !== tdmUrl.hostname.toLowerCase()) {
                    statusEl.textContent = `Откройте страницу TDM Chat (${settings.tdmDomain})`;
                    chrome.runtime.onMessage.removeListener(progressListener);
                    finishAnalytics('unsupported_page');
                    return;
                }
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: _tdmExportScriptInternal,
                    args: [options]
                }, async (results) => {
                    if (chrome.runtime.lastError) {
                        statusEl.textContent = "Ошибка расширения: " + chrome.runtime.lastError.message;
                        finishAnalytics('error');
                    } else if (!results || !results[0]) {
                        statusEl.textContent = "Ошибка: не удалось связаться со страницей.";
                        finishAnalytics('error');
                    } else if (results[0].result === null) {
                        statusEl.textContent = "Ошибка парсинга. Обновите чат.";
                        finishAnalytics('error');
                    } else if (results[0].result && results[0].result.error) {
                        statusEl.textContent = "Ошибка: " + results[0].result.error;
                        finishAnalytics(/нет сообщений/i.test(results[0].result.error) ? 'no_data'
                            : (/10 минут/i.test(results[0].result.error) ? 'timeout' : 'error'));
                    } else {
                        const payload = results[0].result;
                        if (options.format === 'html' || options.format === 'both') {
                            const htmlUrl = URL.createObjectURL(new Blob([payload.html], { type: 'text/html' }));
                            chrome.downloads.download({ url: htmlUrl, filename: `TDM_Chat_${payload.datePrefix}.html`, saveAs: false }, () => URL.revokeObjectURL(htmlUrl));
                        }
                        if (options.format === 'json' || options.format === 'both') {
                            const jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(payload.messages, null, 2)], { type: 'application/json' }));
                            chrome.downloads.download({ url: jsonUrl, filename: `TDM_Chat_${payload.datePrefix}.json`, saveAs: false }, () => URL.revokeObjectURL(jsonUrl));
                        }

                        if (options.savePhotos && payload.photoCount > 0 && photoArchive) {
                            statusEl.style.display = "block";
                            statusEl.textContent = "Формирование ZIP архива...";
                            photoQueue.then(() => photoArchive.finalize()).then(() => {
                                statusEl.textContent = "Экспорт полностью завершен!";
                                setTimeout(() => { statusEl.style.display = "none"; }, 5000);
                                finishAnalytics('success');
                            }).catch(e => {
                                statusEl.textContent = "Ошибка ZIP: " + e.message;
                                finishAnalytics('partial');
                            });
                        } else {
                            statusEl.textContent = "Экспорт успешно завершен!";
                            setTimeout(() => { statusEl.style.display = "none"; }, 5000);
                            finishAnalytics('success');
                        }
                    }
                    chrome.runtime.onMessage.removeListener(progressListener);
                });
            });
        }
    });
}
