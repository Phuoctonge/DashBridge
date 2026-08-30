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
                    return;
                }

                if (activeUrl.hostname.toLowerCase() !== tdmUrl.hostname.toLowerCase()) {
                    statusEl.textContent = `Откройте страницу TDM Chat (${settings.tdmDomain})`;
                    chrome.runtime.onMessage.removeListener(progressListener);
                    return;
                }
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: _tdmExportScriptInternal,
                    args: [options]
                }, async (results) => {
                    if (chrome.runtime.lastError) {
                        statusEl.textContent = "Ошибка расширения: " + chrome.runtime.lastError.message;
                    } else if (!results || !results[0]) {
                        statusEl.textContent = "Ошибка: не удалось связаться со страницей.";
                    } else if (results[0].result === null) {
                        statusEl.textContent = "Ошибка парсинга. Обновите чат.";
                    } else if (results[0].result && results[0].result.error) {
                        statusEl.textContent = "Ошибка: " + results[0].result.error;
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
                            }).catch(e => {
                                statusEl.textContent = "Ошибка ZIP: " + e.message;
                            });
                        } else {
                            statusEl.textContent = "Экспорт успешно завершен!";
                            setTimeout(() => { statusEl.style.display = "none"; }, 5000);
                        }
                    }
                    chrome.runtime.onMessage.removeListener(progressListener);
                });
            });
        }
    });
}

async function _tdmExportScriptInternal(options) {
    const TDM_EXPORT_MAX_DURATION_MS = 10 * 60 * 1000;
    const { startStr, endStr, format, savePhotos, excludePhotoUser, isExcludeAll, photoExportId } = options;
    const startObj = startStr ? new Date(startStr) : new Date(0);
    const endObj = endStr ? new Date(endStr) : new Date(8640000000000000);

    const chatContainer = document.querySelector('[class*="ChatContainerScrollableBlock"]');
    if (!chatContainer) return { error: "Чат не найден" };

    const delay = ms => new Promise(r => setTimeout(r, ms));
    const originalDistanceFromBottom = Math.max(0, chatContainer.scrollHeight - chatContainer.scrollTop);
    const exportDeadline = Date.now() + TDM_EXPORT_MAX_DURATION_MS;

    try {

    const fetchImgAsBase64 = async (imgEl) => {
        if (!imgEl.src) return "";
        if (imgEl.src.startsWith('data:')) return imgEl.src;

        if (imgEl.src.startsWith('blob:') || imgEl.src.startsWith('http')) {
            try {
                const response = await fetch(imgEl.src);
                const blob = await response.blob();
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject();
                    reader.readAsDataURL(blob);
                });
            } catch (e) {
                // Если fetch не сработал из-за CORS, попробуем через canvas ниже
            }
        }

        // Ждем пока картинка загрузится (max 3 сек)
        let attempts = 0;
        while ((imgEl.naturalWidth === 0 || !imgEl.complete) && attempts < 15) {
            await delay(200);
            attempts++;
        }

        try {
            const canvas = document.createElement("canvas");
            canvas.width = imgEl.naturalWidth || imgEl.clientWidth || 800;
            canvas.height = imgEl.naturalHeight || imgEl.clientHeight || 600;
            if (canvas.width === 0 || canvas.height === 0) return imgEl.src;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg", 0.9);
            if (dataURL.length < 100) return imgEl.src;
            return dataURL;
        } catch (e) {
            return imgEl.src;
        }
    };

    const monthMap = {
        'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5,
        'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
        'янв': 0, 'фев': 1, 'мар': 2, 'апр': 3, 'июн': 5, 'июл': 6, 'авг': 7, 'сен': 8, 'окт': 9, 'ноя': 10, 'дек': 11
    };

    function tryParseDateStr(str) {
        const parts = str.toLowerCase().split(' ');
        if (parts.length >= 2) {
            const day = parseInt(parts[0], 10);
            const month = monthMap[parts[1]] !== undefined ? monthMap[parts[1]] : 0;
            const year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
            return new Date(year, month, day);
        }
        return new Date();
    }

    let extractedMessages = new Map();
    let currentSender = "System";
    let currentDateStr = "";
    let reachedStart = false;

    // Функция для сбора видимых сообщений
    const collectVisibleMessages = async () => {
        const elements = Array.from(document.querySelectorAll('[id^="system-message-date-"], [id^="message-"]'));

        for (const child of elements) {
            if (child.id.startsWith('system-message-date-')) {
                currentDateStr = child.id.replace('system-message-date-', '');
                if (!currentDateStr || currentDateStr.length < 5) {
                    const dateTextEl = child.querySelector('[class*="Body2-sc-"]');
                    if (dateTextEl) {
                        const parsed = tryParseDateStr(dateTextEl.textContent.trim());
                        if (!isNaN(parsed.getTime())) {
                            currentDateStr = parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, '0') + "-" + String(parsed.getDate()).padStart(2, '0');
                        }
                    }
                }
            } else if (child.id.startsWith('message-')) {
                let msgObj = extractedMessages.get(child.id);
                let isNew = !msgObj;

                if (isNew) {
                    msgObj = {
                        id: child.id,
                        date: currentDateStr,
                        time: "00:00",
                        sender: "",
                        text: "",
                        images: [],
                        isSystem: false,
                        timestamp: 0
                    };

                    const timeEl = child.querySelector('[class*="MessageTime"]');
                    if (timeEl) {
                        msgObj.time = timeEl.textContent.trim();
                    }

                    const datetimeStr = `${msgObj.date}T${msgObj.time}:00`;
                    const msgDateObj = new Date(datetimeStr);
                    if (!isNaN(msgDateObj.getTime())) {
                        msgObj.timestamp = msgDateObj.getTime();
                    } else if (currentDateStr) {
                        msgObj.timestamp = new Date(currentDateStr).getTime() || 0;
                    }

                    if (msgObj.timestamp && msgObj.timestamp < startObj.getTime()) {
                        reachedStart = true;
                        continue; // Пропускаем старые
                    }
                    if (msgObj.timestamp && msgObj.timestamp > endObj.getTime()) {
                        continue; // Пропускаем новые
                    }

                    const nicknameEl = Array.from(child.querySelectorAll('[class*="Nickname"], [class*="UserNameText"]'))
                        .find(el => !el.closest('[class*="Reply"]'));
                    const systemContent = child.querySelector('[class*="SystemMessageContent"]');
                    const hasAvatar = !!child.querySelector('[class*="UserAvatarWrapper"]');

                    if (nicknameEl) {
                        currentSender = nicknameEl.textContent.trim();
                    } else if (systemContent) {
                        currentSender = "System";
                        msgObj.isSystem = true;
                        msgObj.text = systemContent.textContent.trim();
                    } else {
                        const layout = child.querySelector('[class*="Layout-sc-1wrxz8l-3"]');
                        const isRightAligned = layout && (layout.classList.contains('aLQQy') || layout.classList.contains('fyxvBG'));
                        if (isRightAligned || !hasAvatar) {
                            currentSender = "Вы (Я)";
                        }
                    }

                    msgObj.sender = currentSender;

                    if (!msgObj.isSystem) {
                        const textEl = child.querySelector('[data-message-text="true"]');
                        if (textEl) {
                            const clone = textEl.cloneNode(true);
                            const meta = clone.querySelector('[data-message-meta="true"]');
                            if (meta) meta.remove();
                            msgObj.text = clone.textContent.trim();
                        }
                    } // End of !msgObj.isSystem block

                } // End of isNew block

                if (!msgObj.isSystem && savePhotos) {
                    let shouldSavePhotos = true;
                    if (excludePhotoUser || isExcludeAll) {
                        if (isExcludeAll) shouldSavePhotos = false;
                        else if (msgObj.sender && msgObj.sender.toLowerCase().includes(excludePhotoUser)) shouldSavePhotos = false;
                    }

                    if (shouldSavePhotos) {
                        let imgEls = Array.from(child.querySelectorAll('img')).filter(img => {
                            if (img.closest('[class*="Reply"]')) return false;
                            const cls = (img.className || "").toLowerCase();
                            if (cls.includes('avatar') || cls.includes('emoji') || cls.includes('icon') || cls.includes('reaction')) return false;
                            return true;
                        });

                        if (imgEls.length > 0 && msgObj.images.length < imgEls.length) {
                            msgObj.images = [];
                            for (const img of imgEls) {
                                try {
                                    const b64 = await fetchImgAsBase64(img);
                                    if (b64) msgObj.images.push(b64);
                                } catch (e) {
                                    if (img.src) msgObj.images.push(img.src);
                                }
                            }
                        }
                    }
                }
                extractedMessages.set(child.id, msgObj);
                try { chrome.runtime.sendMessage({ action: "tdmExportProgress", current: extractedMessages.size, text: "Сбор сообщений:" }); } catch (e) { }
            }
        }
    };

    // Скроллим вверх плавно, собирая сообщения
    try { chrome.runtime.sendMessage({ action: "tdmExportProgress", current: 0, total: 100, text: "Подготовка..." }); } catch (e) { }

    let lastHeight = chatContainer.scrollHeight;
    let noChangeCount = 0;

    // Сначала просканируем видимые, пока находимся на текущей позиции
    await collectVisibleMessages();

    // Плавно скроллим вверх
    while (!reachedStart) {
        if (Date.now() > exportDeadline) throw new Error('Экспорт TDM остановлен: превышено максимальное время 10 минут');
        if (chatContainer.scrollTop > 0) {
            // Поднимаемся на 300px
            chatContainer.scrollTop -= 300;
            // Ждем загрузки новых элементов
            await delay(150);
            await collectVisibleMessages();
        } else {
            // Достигли текущего потолка, ждем подгрузки новой порции
            let waited = 0;
            while (chatContainer.scrollHeight === lastHeight && waited < 20) {
                await delay(200);
                waited++;

                // Дергаем для срабатывания триггера
                if (waited % 5 === 0) {
                    chatContainer.scrollTop = 50;
                    await delay(50);
                    chatContainer.scrollTop = 0;
                }
            }

            if (chatContainer.scrollHeight > lastHeight) {
                // Появилась новая история, компенсируем прыжок скролла
                chatContainer.scrollTop = chatContainer.scrollHeight - lastHeight;
                lastHeight = chatContainer.scrollHeight;
                noChangeCount = 0;
            } else {
                noChangeCount++;
                if (noChangeCount > 2) {
                    break; // Больше не грузится (начало чата)
                }
            }
        }
    }

    let messages = Array.from(extractedMessages.values());

    // Сортируем по времени по возрастанию (самые старые первыми)
    messages.sort((a, b) => a.timestamp - b.timestamp);

    if (messages.length === 0) return { error: "Нет сообщений за выбранный период" };

    const dlDate = new Date();
    const datePrefix = `${dlDate.getFullYear()}${(dlDate.getMonth() + 1).toString().padStart(2, '0')}${dlDate.getDate().toString().padStart(2, '0')}_${dlDate.getHours().toString().padStart(2, '0')}${dlDate.getMinutes().toString().padStart(2, '0')}`;

    let photoCount = 0;
    if (savePhotos) {
        let downloadImgCount = 1;
        let totalImages = 0;
        messages.forEach(m => m.images.forEach(img => { if (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http')) totalImages++; }));

        try { chrome.runtime.sendMessage({ action: "tdmExportProgress", current: 0, total: totalImages, text: "Подготовка фото:" }); } catch (e) { }
        for (const m of messages) {
            for (let i = 0; i < m.images.length; i++) {
                const src = m.images[i];
                if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')) {
                    let ext = "jpg";
                    if (src.includes('image/png')) ext = "png";
                    else if (src.includes('image/gif')) ext = "gif";
                    const filename = `TDM_Photo_${datePrefix}_${downloadImgCount}.${ext}`;

                    if (src.includes(',') && src.includes('base64')) {
                        const b64 = src.split(',')[1];
                        const estimatedBytes = Math.floor(b64.length * 3 / 4);
                        const response = await chrome.runtime.sendMessage({
                            action: 'tdmExportPhoto', exportId: photoExportId,
                            filename, b64, bytes: estimatedBytes
                        });
                        if (!response?.ok) throw new Error(response?.error || 'Не удалось передать фото в архив');
                        photoCount += 1;
                        m.images[i] = filename; // Replace the base64 string with the filename in JSON
                    }

                    try { chrome.runtime.sendMessage({ action: "tdmExportProgress", current: downloadImgCount, total: totalImages, text: "Упаковка фото:" }); } catch (e) { }
                    downloadImgCount++;
                    await delay(100);
                }
            }
        }
    }

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const generateHTML = (msgs) => {
        let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TDM Chat Export</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #1c1e21; }
            .chat { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #f8f9fa; }
            .system { text-align: center; color: #65676b; font-size: 13px; margin: 16px 0; background: #e4e6eb; padding: 6px 16px; border-radius: 16px; display: inline-block; }
            .system-wrap { text-align: center; }
            .sender { font-weight: 600; color: #1877f2; margin-bottom: 4px; font-size: 14px; }
            .text { white-space: pre-wrap; line-height: 1.5; font-size: 14px; word-break: break-word; }
            .time { font-size: 12px; color: #8d949e; margin-left: 8px; font-weight: normal; }
            .img-container { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
            .img-container img { max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: contain; }
            .date-divider { text-align: center; font-weight: 600; margin: 24px 0 16px; color: #1c1e21; font-size: 15px; }
        </style>
        </head><body><div class="chat">`;
        let lastDate = "";
        let imgCount = 1;
        for (const m of msgs) {
            if (m.date !== lastDate) {
                html += `<div class="date-divider">${escapeHtml(m.date)}</div>`;
                lastDate = m.date;
            }
            if (m.isSystem) {
                html += `<div class="system-wrap"><div class="system">${escapeHtml(m.text)}</div></div>`;
            } else {
                html += `<div class="msg">
                    <div class="sender">${escapeHtml(m.sender)}<span class="time">${escapeHtml(m.time)}</span></div>
                    <div class="text">${escapeHtml(m.text)}</div>`;
                if (m.images && m.images.length > 0) {
                    html += `<div class="img-container">`;
                    m.images.forEach(img => {
                        let ext = "jpg";
                        if (img.includes('image/png')) ext = "png";
                        else if (img.includes('image/gif')) ext = "gif";
                        const filename = img.startsWith('TDM_Photo_')
                            ? img : `TDM_Photo_${datePrefix}_${imgCount}.${ext}`;
                        imgCount++;
                        html += `<img src="./${escapeHtml(filename)}" alt="${escapeHtml(filename)}">`;
                    });
                    html += `</div>`;
                }
                html += `</div>`;
            }
        }
        html += `</div></body></html>`;
        return html;
    };

    return { success: true, messages, html: generateHTML(messages), datePrefix, photoCount };
    } finally {
        chatContainer.scrollTop = Math.max(0, chatContainer.scrollHeight - originalDistanceFromBottom);
    }
}
