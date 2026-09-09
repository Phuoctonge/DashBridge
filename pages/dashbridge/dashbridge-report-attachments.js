(function initReportAttachments(root) {
    'use strict';

    // One preview owns selection, captured blobs, cancellation, DOM listeners and URLs.
    function create({ host, overlay, getPanels, getContext, captureSelection, collage,
        copyImage, documentRef = document, urlApi = URL, download = options => chrome.downloads.download(options) }) {
        if (!host || !collage?.compose || typeof captureSelection !== 'function') throw new TypeError('Attachments dependencies are incomplete');
        host.innerHTML = `<section class="report-attachments">
            <div class="report-attachment-workspace"><div class="report-attachment-settings">
            <div class="report-attachment-heading"><h4>Панели</h4><span class="attachment-count" role="status">Выбрано 0 из 8</span></div>
            <div class="report-attachment-actions"><button type="button" class="btn btn-outline attachment-all">Выбрать доступные</button>
                <button type="button" class="btn btn-outline attachment-none">Снять выбор</button></div>
            <fieldset class="report-attachment-panels"><legend>Панели для снимка</legend></fieldset>
            <div class="report-attachment-options"><label>Раскладка <select class="attachment-layout">
                <option value="auto">Авто</option><option value="column">▤ В столбик</option><option value="grid">▦ Две колонки</option></select></label>
                <label><input type="checkbox" class="attachment-heading" checked> Название профиля и период</label></div>
            <p class="attachment-layout-hint"></p>
            <p class="report-attachment-note">Снимки делаются последовательно. При автообновлении данные панелей могут различаться по времени.</p>
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
        const listeners = new AbortController();
        let panels = getPanels();
        let images = [];
        let failures = [];
        let result = null;
        let resultUrl = null;
        let sourceContext = null;
        let activeRun = null;
        let stopped = false;
        let userSelected = false;
        let collectingText = true;
        let allowedPartial = false;
        let saving = false;
        const signature = () => JSON.stringify(getContext());
        let observedContext = signature();
        const on = (target, event, callback) => target.addEventListener(event, callback, { signal: listeners.signal });
        const selected = () => panels.filter(panel => list.querySelector(`input[data-panel-id="${CSS.escape(panel.id)}"]`)?.checked);
        const setStatus = text => { if (!stopped) status.textContent = text; };
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
            const columns = find('layout').value === 'column' || (find('layout').value === 'auto' && count <= 2) || count === 1 ? 1 : 2;
            find('layout-hint').textContent = count ? `Раскладка: ${columns} ${columns === 1 ? 'колонка' : 'колонки'} × ${Math.ceil(count / columns)} стр.` : 'Можно выбрать до 8 панелей.';
            host.querySelectorAll('button, select, input').forEach(control => { control.disabled = busy; });
            list.querySelectorAll('input').forEach(input => {
                input.disabled = busy || !!panels.find(panel => panel.id === input.dataset.panelId)?.paused;
            });
            find('capture').disabled = busy || collectingText || !selected().length || selected().length > 8;
            find('all').disabled = busy || panels.filter(panel => !panel.paused).length > 8;
            find('all').title = panels.filter(panel => !panel.paused).length > 8 ? 'Доступно больше 8 панелей — выберите вручную.' : '';
            find('retry').hidden = !failures.length;
            find('accept').hidden = !failures.length || !images.length || allowedPartial;
            find('save').disabled = busy || saving || !result;
            find('copy').disabled = busy || !result;
            find('capture').textContent = result ? 'Переснять' : 'Сформировать коллаж';
        };
        const renderPanels = ids => {
            list.querySelectorAll('label').forEach(node => node.remove());
            for (const panel of panels) {
                const label = documentRef.createElement('label');
                const input = documentRef.createElement('input');
                input.type = 'checkbox'; input.dataset.panelId = panel.id;
                input.checked = !panel.paused && ids.has(panel.id);
                const text = documentRef.createElement('span');
                text.textContent = `${panel.title || 'Панель'}${panel.paused ? ' — на паузе' : ''}`;
                label.append(input, text); list.appendChild(label);
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
            const context = getContext();
            const composed = await collage.compose(images, {
                layout: find('layout').value,
                heading: find('heading').checked ? `${context.name || 'DashBridge'}\n${context.period || ''}` : '',
                signal: controller.signal
            });
            assertCurrent(controller);
            releaseResult(); result = composed;
            resultUrl = urlApi.createObjectURL(result.blob);
            find('image').src = resultUrl; find('result').hidden = false;
            find('empty').hidden = true;
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
        const capture = async retry => {
            if (activeRun || collectingText) return;
            const chosen = selected();
            if (!chosen.length || chosen.length > 8) { setStatus('Выберите от 1 до 8 панелей.'); return; }
            const controller = new AbortController(); activeRun = controller;
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
            const oldInert = overlay.inert;
            let contextObserver;
            try {
                inert.forEach((_value, node) => { node.inert = true; });
                overlay.style.visibility = 'hidden'; overlay.inert = true;
                cancelButton.focus();
                contextObserver = new MutationObserver(() => {
                    if (signature() !== sourceContext) controller.abort();
                });
                contextObserver.observe(documentRef.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
                const captured = await captureSelection(wanted, {
                    signal: controller.signal, assertCurrent: () => assertCurrent(controller),
                    onCaptureVisibility: hidden => { progress.style.visibility = hidden ? 'hidden' : ''; },
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
            } finally {
                contextObserver?.disconnect();
                cancelButton.removeEventListener('click', cancel);
                documentRef.removeEventListener('keydown', escape, true);
                inert.forEach((value, node) => { node.inert = value; });
                overlay.style.visibility = oldVisibility; overlay.inert = oldInert;
                progress.remove(); activeRun = null;
                if (!stopped) { sync(); find('capture').focus(); }
            }
        };
        on(list, 'change', () => { userSelected = true; reset(); setStatus(`Выбрано панелей: ${selected().length} из 8.`); });
        on(find('all'), 'click', () => { userSelected = true; reset(); renderPanels(new Set(panels.filter(panel => !panel.paused).map(panel => panel.id))); });
        on(find('none'), 'click', () => { userSelected = true; reset(); renderPanels(new Set()); });
        on(find('capture'), 'click', () => { void capture(false); });
        on(find('retry'), 'click', () => { void capture(true); });
        on(find('accept'), 'click', () => { allowedPartial = true; void rebuild(); });
        on(find('layout'), 'change', () => { sync(); void rebuild(); });
        on(find('heading'), 'change', () => { void rebuild(); });
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
            reset(); panels = getPanels(); renderPanels(ids);
            setStatus('Параметры панелей изменились. Сформируйте коллаж заново.');
        };
        const observer = new MutationObserver(inspectContext);
        observer.observe(documentRef.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
        on(documentRef, 'change', inspectContext);
        renderPanels(new Set());
        const stop = () => {
            stopped = true; activeRun?.abort(); observer.disconnect(); listeners.abort();
            images = []; failures = []; releaseResult();
        };
        on(window, 'pagehide', stop);
        return Object.freeze({
            stop,
            setCollecting(value) { collectingText = value; sync(); },
            setReport(collected) {
                if (stopped) return;
                inspectContext();
                if (!userSelected) renderPanels(new Set(collected.panelResults.filter(item => item.included && !item.panel.paused).slice(0, 8).map(item => item.panel.id)));
            }
        });
    }
    root.DashBridgeReportAttachments = Object.freeze({ create });
})(globalThis);
