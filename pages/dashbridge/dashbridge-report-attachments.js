(function initReportAttachments(root) {
    'use strict';

    // One preview owns selection, captured blobs, cancellation, DOM listeners and URLs.
    function create({ host, overlay, getPanels, getContext, captureSelection, collage,
        copyImage, requestReport = null, preferences = {}, onPreferencesChange = async () => {},
        documentRef = document, urlApi = URL, download = options => chrome.downloads.download(options) }) {
        if (!host || !collage?.compose || typeof captureSelection !== 'function') throw new TypeError('Attachments dependencies are incomplete');
        host.innerHTML = `<section class="report-attachments">
            <div class="report-attachment-workspace"><div class="report-attachment-settings">
            <div class="report-attachment-heading"><h4>Панели</h4><span class="attachment-count" role="status">Выбрано 0 из 8</span></div>
            <label class="attachment-sla-option"><span class="switch"><input type="checkbox" class="attachment-sla" role="switch" checked><span class="slider" aria-hidden="true"></span></span><span>Только панели с нарушением SLA</span></label>
            <p class="report-attachment-note">Фильтр учитывает уровни SLA последнего сообщения. «Всегда добавлять скриншот» добавляет панель независимо от SLA и включения в текст, кроме панелей на паузе.</p>
            <div class="report-attachment-actions"><button type="button" class="btn btn-outline attachment-all">Выбрать доступные</button>
                <button type="button" class="btn btn-outline attachment-none">Снять обычный выбор</button></div>
            <fieldset class="report-attachment-panels"><legend>Панели для снимка</legend></fieldset>
            <p class="report-attachment-note">Порядок скриншотов: перетащите панели за значок ⠿.</p>
            <div class="report-attachment-options"><label>Раскладка <select class="attachment-layout">
                <option value="auto">Авто</option><option value="column">▤ В столбик</option><option value="grid">▦ Две колонки</option></select></label></div>
            <p class="attachment-layout-hint"></p>
            <p class="report-attachment-note">Общий отчёт фиксирует период и временно отключает автообновление. Повторная съёмка обновляет также текст. Ваши ручные правки сохраняются отдельно.</p>
            </div><div class="report-attachment-preview">
            <div class="attachment-empty"><strong>Здесь появится коллаж</strong><p>Выберите панели и нажмите «Сформировать коллаж».</p></div>
            <div class="attachment-result" hidden>
                <div class="attachment-image-scroll"><img class="attachment-image" alt="Коллаж выбранных панелей"></div>
                <button type="button" class="btn btn-outline attachment-original">Увеличить</button>
            </div></div></div>
            <div class="report-attachment-feedback"><p class="attachment-status" role="status"></p><p class="attachment-errors" role="alert" hidden></p></div>
            <div class="report-preview-footer"><button type="button" class="btn btn-outline attachment-capture">Сформировать коллаж</button>
                <button type="button" class="btn btn-outline attachment-retry" hidden>Повторить неудачные</button>
                <button type="button" class="btn btn-outline attachment-accept" hidden>Использовать успешные</button>
                <button type="button" class="btn btn-outline attachment-save" disabled>Сохранить PNG</button>
                <button type="button" class="btn btn-primary attachment-copy" disabled>Копировать изображение</button></div>
            <dialog class="attachment-zoom" aria-label="Коллаж в оригинальном размере"><div class="attachment-zoom-header"><strong>Коллаж · оригинальный размер</strong><button type="button" class="btn btn-outline attachment-zoom-close">Закрыть просмотр</button></div><div class="attachment-zoom-scroll"><img alt="Коллаж в оригинальном размере"></div></dialog>
            </section>`;
        const find = name => host.querySelector(`.attachment-${name}`);
        const list = host.querySelector('.report-attachment-panels');
        const status = find('status');
        find('sla').checked = preferences.slaOnly !== false;
        find('layout').value = ['auto', 'column', 'grid'].includes(preferences.layout) ? preferences.layout : 'auto';
        const listeners = new AbortController();
        let panels = getPanels();
        const savedRanks = new Map((preferences.panelOrder || []).map((id, index) => [id, index]));
        panels = [...panels].sort((a, b) => (savedRanks.get(a.id) ?? Infinity) - (savedRanks.get(b.id) ?? Infinity));
        let images = [];
        let failures = [];
        let result = null;
        let resultUrl = null;
        let sourceContext = null;
        let activeRun = null;
        let stopped = false;
        let userSelected = Array.isArray(preferences.selectedIds);
        let intendedIds = new Set(preferences.selectedIds || []);
        const forcedIds = new Set((preferences.forcedIds || []).filter(id => panels.some(panel => panel.id === id)).slice(0, 8));
        let collectingText = true;
        let allowedPartial = false;
        let saving = false;
        let reportStates = new Map();
        let draggedId = null;
        const signature = () => JSON.stringify(getContext());
        let observedContext = signature();
        const on = (target, event, callback) => target.addEventListener(event, callback, { signal: listeners.signal });
        const eligible = panel => !panel.paused && (forcedIds.has(panel.id) || !find('sla').checked
            || ['warning', 'critical', 'breached'].includes(reportStates.get(panel.id)));
        const selectedIds = () => new Set([...list.querySelectorAll('.attachment-select:checked')].map(input => input.dataset.panelId));
        const selected = () => { const ids = selectedIds(); return panels.filter(panel => eligible(panel) && ids.has(panel.id)); };
        const choose = (ids = null) => {
            const chosen = new Set(panels.filter(panel => !panel.paused && forcedIds.has(panel.id)).map(panel => panel.id));
            for (const panel of panels) {
                if (chosen.size >= 8) break;
                if (eligible(panel) && (!ids || ids.has(panel.id))) chosen.add(panel.id);
            }
            return chosen;
        };
        const reason = panel => {
            if (panel.paused) return 'На паузе';
            const state = reportStates.get(panel.id);
            if (['critical', 'breached'].includes(state)) return 'Критический уровень';
            if (state === 'warning') return 'Предупредительный уровень';
            if (state === 'ok') return 'В пределах SLA';
            if (state === 'no_threshold') return 'Без SLA';
            if (collectingText) return 'Ожидаем результаты сообщения';
            return 'Нет подтверждённого результата SLA';
        };
        const setStatus = text => { if (!stopped) status.textContent = text; };
        const persist = () => {
            const value = { slaOnly: find('sla').checked, heading: false,
                layout: find('layout').value, panelOrder: panels.map(panel => panel.id),
                forcedIds: [...forcedIds],
                selectedIds: userSelected ? [...intendedIds].slice(0, 8) : null };
            void Promise.resolve().then(() => onPreferencesChange(value)).catch(error => {
                setStatus('Настройки скриншотов не сохранены: ' + (error.message || String(error)));
            });
        };
        const releaseResult = () => {
            find('zoom').close();
            find('zoom').querySelector('img').removeAttribute('src');
            find('image').removeAttribute('src');
            if (resultUrl) urlApi.revokeObjectURL(resultUrl);
            resultUrl = null; result = null;
            find('result').hidden = true;
            find('empty').hidden = false;
        };
        const sync = () => {
            const busy = !!activeRun;
            const count = selected().length;
            find('count').textContent = `Выбрано ${count} из 8`;
            const columns = count ? collage.geometry(count, find('layout').value).columns : 1;
            find('layout-hint').textContent = count ? `Раскладка: ${columns} ${columns === 1 ? 'колонка' : 'колонки'} × ${Math.ceil(count / columns)} стр.` : 'Можно выбрать до 8 панелей.';
            host.querySelectorAll('button, select, input').forEach(control => { control.disabled = busy; });
            list.querySelectorAll('.attachment-select').forEach(input => {
                input.disabled = busy || forcedIds.has(input.dataset.panelId) || !eligible(panels.find(panel => panel.id === input.dataset.panelId))
                    || (!input.checked && count >= 8);
            });
            list.querySelectorAll('.attachment-always').forEach(input => {
                input.disabled = busy || (!input.checked && forcedIds.size >= 8);
            });
            list.querySelectorAll('.attachment-panel-row').forEach(row => {
                row.querySelector('.attachment-drag').draggable = !busy;
            });
            find('capture').disabled = busy || collectingText || !selected().length || selected().length > 8;
            find('all').disabled = busy || !panels.some(eligible);
            find('all').title = 'Сначала панели «Всегда добавлять скриншот», затем подходящие по фильтру, до 8 снимков.';
            find('empty').querySelector('p').textContent = find('sla').checked && !count
                ? (collectingText ? 'Ожидаем результаты сообщения.' : 'Нет выбранных панелей с подтверждённым нарушением SLA. Можно отключить фильтр и выбрать графики вручную.')
                : 'Выберите панели и нажмите «Сформировать коллаж».';
            find('retry').hidden = !failures.length;
            find('accept').hidden = !failures.length || !images.length || allowedPartial;
            find('save').disabled = busy || saving || !result;
            find('copy').disabled = busy || !result;
            find('capture').textContent = result ? 'Переснять' : 'Сформировать коллаж';
        };
        const renderPanels = ids => {
            list.querySelectorAll('.attachment-panel-row').forEach(node => node.remove());
            for (const panel of panels) {
                const row = documentRef.createElement('div');
                row.className = 'attachment-panel-row'; row.dataset.panelId = panel.id;
                const drag = documentRef.createElement('span');
                drag.className = 'attachment-drag'; drag.textContent = '⠿'; drag.draggable = true;
                drag.title = 'Перетащить скриншот';
                const label = documentRef.createElement('label');
                const body = documentRef.createElement('div'); body.className = 'attachment-panel-body';
                const input = documentRef.createElement('input');
                input.type = 'checkbox'; input.className = 'attachment-select'; input.dataset.panelId = panel.id;
                input.checked = !panel.paused && ids.has(panel.id);
                const text = documentRef.createElement('span');
                text.textContent = panel.title || 'Панель';
                const note = documentRef.createElement('small');
                note.textContent = reason(panel); text.appendChild(note);
                const always = documentRef.createElement('label'); always.className = 'attachment-always-option';
                always.innerHTML = '<span class="switch"><input type="checkbox" class="attachment-always" role="switch"><span class="slider" aria-hidden="true"></span></span><span>Всегда добавлять скриншот</span>';
                const toggle = always.querySelector('input'); toggle.dataset.panelId = panel.id;
                toggle.checked = forcedIds.has(panel.id);
                toggle.setAttribute('aria-label', `Всегда добавлять скриншот: ${panel.title || 'Панель'}`);
                label.append(input, text); body.append(label, always); row.append(drag, body);
                list.appendChild(row);
            }
            sync();
        };
        const reset = () => {
            activeRun?.abort(); images = []; failures = []; sourceContext = null; allowedPartial = false;
            releaseResult(); find('errors').hidden = true; sync();
        };
        const assertCurrent = controller => {
            if (stopped || controller.signal.aborted) throw new DOMException('Подготовка отменена', 'AbortError');
            if (signature() !== sourceContext) throw new Error('Профиль или параметры панелей изменились. Сформируйте коллаж заново.');
        };
        const build = async controller => {
            assertCurrent(controller);
            if (!images.length) throw new Error('Нет готовых снимков.');
            const composed = await collage.compose(images, {
                layout: find('layout').value,
                heading: '',
                signal: controller.signal
            });
            assertCurrent(controller);
            releaseResult(); result = composed;
            resultUrl = urlApi.createObjectURL(result.blob);
            find('image').src = resultUrl; find('result').hidden = false;
            find('empty').hidden = true;
            find('result').scrollIntoView?.({ block: 'nearest' });
            setStatus(`${failures.length ? 'Неполный коллаж. ' : ''}Панелей: ${images.length}. ${result.width}×${result.height}, ${(result.blob.size / 1024 / 1024).toFixed(1)} МиБ.`);
        };
        const rebuild = async () => {
            if (activeRun || !images.length || (failures.length && !allowedPartial)) return;
            const controller = new AbortController(); activeRun = controller;
            releaseResult(); sync();
            try { await build(controller); }
            catch (error) { setStatus(error.message); }
            finally { activeRun = null; if (!stopped) sync(); }
        };
        const movePanel = (id, targetIndex) => {
            if (activeRun) return;
            const index = panels.findIndex(panel => panel.id === id);
            if (index < 0 || targetIndex < 0 || targetIndex >= panels.length || index === targetIndex) return;
            const ids = selectedIds();
            panels = [...panels];
            const [panel] = panels.splice(index, 1); panels.splice(targetIndex, 0, panel);
            const byId = new Map(images.map(image => [image.panelId, image]));
            images = panels.map(item => byId.get(item.id)).filter(Boolean);
            renderPanels(ids);
            persist();
            setStatus('Порядок скриншотов изменён.');
            void rebuild();
        };
        on(list, 'dragstart', event => {
            if (activeRun || !event.target.closest('.attachment-drag')) { event.preventDefault(); return; }
            draggedId = event.target.closest('.attachment-panel-row').dataset.panelId;
            event.dataTransfer.setData('text/plain', draggedId); event.dataTransfer.effectAllowed = 'move';
        });
        on(list, 'dragover', event => {
            if (draggedId && !activeRun && event.target.closest('.attachment-panel-row')) event.preventDefault();
        });
        on(list, 'drop', event => {
            const row = event.target.closest('.attachment-panel-row');
            if (!draggedId || !row) return;
            event.preventDefault(); movePanel(draggedId, panels.findIndex(panel => panel.id === row.dataset.panelId)); draggedId = null;
        });
        on(list, 'dragend', () => { draggedId = null; });
        const capture = async (retry, signal = null) => {
            if (activeRun || collectingText) return;
            const chosen = selected();
            if (!chosen.length || chosen.length > 8) { setStatus('Выберите от 1 до 8 панелей.'); return; }
            const controller = new AbortController(); activeRun = controller;
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            if (!retry) { images = []; failures = []; }
            sourceContext = signature(); allowedPartial = false; releaseResult(); sync();
            const wanted = retry ? chosen.filter(panel => failures.some(failure => failure.panelId === panel.id)) : chosen;
            const progress = documentRef.createElement('div');
            progress.className = 'report-collage-progress';
            progress.innerHTML = '<span role="status"></span><button type="button" class="btn btn-outline">Отменить (Esc)</button>';
            documentRef.body.appendChild(progress);
            const cancel = () => controller.abort();
            const cancelButton = progress.querySelector('button');
            cancelButton.addEventListener('click', cancel);
            const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } };
            documentRef.addEventListener('keydown', escape, true);
            const inert = new Map([...documentRef.body.children].filter(node => node !== progress && node !== overlay
                && !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)).map(node => [node, node.inert]));
            const oldVisibility = overlay.style.visibility;
            const oldDisplay = overlay.style.display;
            const oldInert = overlay.inert;
            let contextObserver;
            try {
                inert.forEach((_value, node) => { node.inert = true; });
                overlay.style.visibility = 'hidden'; overlay.style.display = 'none'; overlay.inert = true;
                cancelButton.focus();
                contextObserver = new MutationObserver(() => {
                    if (signature() !== sourceContext) controller.abort();
                });
                contextObserver.observe(documentRef.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
                const captured = await captureSelection(wanted, {
                    signal: controller.signal, assertCurrent: () => assertCurrent(controller),
                    onCaptureVisibility: hidden => { progress.style.visibility = hidden ? 'hidden' : ''; },
                    allowUnrendered: true,
                    onProgress: (index, count, title) => {
                        progress.querySelector('span').textContent = `Снимок ${index + 1} из ${count}: ${title || 'Панель'}`;
                    }
                });
                assertCurrent(controller);
                const byId = new Map([...images, ...captured.images].map(image => [image.panelId, image]));
                images = chosen.map(panel => byId.get(panel.id)).filter(Boolean);
                failures = captured.errors;
                find('errors').textContent = failures.map(item => `${item.title || 'Панель'}: ${item.error}`).join('\n');
                find('errors').hidden = !failures.length;
                if (failures.length) setStatus(`Получено ${images.length} из ${chosen.length} снимков. Повторите неудачные или используйте успешные.`);
                else await build(controller);
            } catch (error) {
                images = []; failures = []; releaseResult();
                setStatus(error.name === 'AbortError' ? 'Подготовка отменена. Можно запустить снова.' : error.message);
                return { error };
            } finally {
                signal?.removeEventListener('abort', abort);
                contextObserver?.disconnect();
                cancelButton.removeEventListener('click', cancel);
                documentRef.removeEventListener('keydown', escape, true);
                inert.forEach((value, node) => { node.inert = value; });
                overlay.style.visibility = oldVisibility; overlay.style.display = oldDisplay; overlay.inert = oldInert;
                progress.remove(); activeRun = null;
                if (!stopped) {
                    sync(); find('capture').focus({ preventScroll: true });
                    if (result) find('result').scrollIntoView?.({ block: 'nearest' });
                }
            }
        };
        on(list, 'change', event => {
            if (activeRun) return;
            const input = event.target;
            if (input.classList.contains('attachment-always')) {
                if (input.checked && forcedIds.size < 8) forcedIds.add(input.dataset.panelId);
                else forcedIds.delete(input.dataset.panelId);
            } else {
                if (!userSelected) intendedIds = new Set([...selectedIds()].filter(id => !forcedIds.has(id)));
                userSelected = true;
                if (input.checked) intendedIds.add(input.dataset.panelId);
                else intendedIds.delete(input.dataset.panelId);
                if (intendedIds.size > 8) {
                    const visibleIds = selectedIds();
                    const hiddenIds = [...intendedIds].filter(id => !visibleIds.has(id));
                    intendedIds.delete(hiddenIds.find(id => !forcedIds.has(id)) || hiddenIds[0]);
                }
            }
            reset();
            const ids = choose(userSelected ? intendedIds : null);
            list.querySelectorAll('.attachment-select').forEach(control => { control.checked = ids.has(control.dataset.panelId); });
            sync(); persist();
            setStatus(`Выбрано панелей: ${selected().length} из 8.`);
        });
        on(find('all'), 'click', () => {
            userSelected = true; reset(); intendedIds = choose();
            renderPanels(intendedIds); persist();
        });
        on(find('sla'), 'change', () => {
            userSelected = false; reset();
            renderPanels(choose());
            persist();
            setStatus(find('sla').checked ? 'Выбраны обязательные панели и панели с нарушением SLA.' : 'Фильтр SLA выключен. Можно выбрать любые доступные панели.');
        });
        on(find('none'), 'click', () => { userSelected = true; intendedIds.clear(); reset(); renderPanels(choose(intendedIds)); persist(); });
        on(find('capture'), 'click', () => { void (requestReport ? requestReport() : capture(false)); });
        on(find('retry'), 'click', () => { void (requestReport ? requestReport() : capture(true)); });
        on(find('accept'), 'click', () => { allowedPartial = true; void rebuild(); });
        on(find('layout'), 'change', () => { persist(); sync(); void rebuild(); });
        on(find('original'), 'click', () => {
            if (!resultUrl) return;
            find('zoom').querySelector('img').src = resultUrl;
            find('zoom').showModal();
        });
        on(find('zoom-close'), 'click', () => find('zoom').close());
        on(find('copy'), 'click', async () => {
            if (!result || activeRun) return;
            try { await copyImage(result.blob); setStatus('Изображение скопировано. Вставьте его в Telegram; текст скопируйте отдельно.'); }
            catch { setStatus('Не удалось скопировать изображение. Сохраните PNG и прикрепите его в Telegram.'); }
        });
        on(find('save'), 'click', async () => {
            if (!result || activeRun || saving) return;
            saving = true; sync();
            const downloadUrl = urlApi.createObjectURL(result.blob);
            try {
                await download({ url: downloadUrl, filename: `dashbridge_collage_${new Date().toISOString().replace(/[:.]/g, '-')}.png`, saveAs: true });
                setStatus('PNG передан в загрузки.');
            } catch { setStatus('Не удалось сохранить PNG. Попробуйте ещё раз.'); }
            finally { urlApi.revokeObjectURL(downloadUrl); saving = false; if (!stopped) sync(); }
        });
        const inspectContext = () => {
            if (stopped) return;
            const next = signature();
            if (next === observedContext) return;
            observedContext = next;
            const ids = new Set(selected().map(panel => panel.id));
            reset();
            const latest = getPanels(); const ranks = new Map(panels.map((panel, index) => [panel.id, index]));
            panels = [...latest].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
            for (const id of forcedIds) if (!panels.some(panel => panel.id === id)) forcedIds.delete(id);
            reportStates.clear(); renderPanels(choose(ids));
            setStatus('Параметры панелей изменились. Обновите данные на вкладке «Текст» перед применением фильтра SLA.');
        };
        const observer = new MutationObserver(inspectContext);
        observer.observe(documentRef.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
        on(documentRef, 'change', inspectContext);
        renderPanels(choose(intendedIds));
        const stop = () => {
            stopped = true; activeRun?.abort(); observer.disconnect(); listeners.abort();
            images = []; failures = []; releaseResult();
        };
        on(window, 'pagehide', stop);
        return Object.freeze({
            stop,
            captureReport: signal => selected().length ? capture(false, signal)
                : setStatus('Текст сформирован. Подходящих выбранных панелей нет - коллаж не требуется.'),
            setCollecting(value) {
                collectingText = value;
                if (value) { reportStates.clear(); reset(); }
                renderPanels(selectedIds());
            },
            setReport(collected) {
                if (stopped) return;
                inspectContext();
                reset();
                reportStates = new Map(collected.panelResults.map(item => [item.panel.id, item.snapshot?.state || item.state]));
                const ids = choose(userSelected ? intendedIds : null);
                renderPanels(ids);
            }
        });
    }
    root.DashBridgeReportAttachments = Object.freeze({ create });
})(globalThis);
