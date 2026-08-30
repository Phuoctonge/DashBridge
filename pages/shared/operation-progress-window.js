// Always-on-top progress controller based on Document Picture-in-Picture.
window.DashBridgeOperationProgress = (() => {
    const create = ({ onCancel, closeDelayMs = 1800 } = {}) => {
        let snapshot = null;
        let closeTimer = null;
        let pictureInPictureWindow = null;
        let pictureInPictureElements = null;

        const statusLabels = {
            running: 'Выполняется', cancelling: 'Остановка', complete: 'Готово',
            partial: 'Есть ошибки', error: 'Ошибка', cancelled: 'Остановлено'
        };

        const render = () => {
            if (!snapshot || !pictureInPictureElements || pictureInPictureWindow?.closed) return;
            const elements = pictureInPictureElements;
            const done = Math.max(0, Number(snapshot.done) || 0);
            const total = Math.max(0, Number(snapshot.total) || 0);
            const status = statusLabels[snapshot.status] ? snapshot.status : 'running';
            elements.title.textContent = snapshot.title || 'DashBridge';
            elements.phase.textContent = snapshot.phase || 'Подготовка…';
            elements.status.textContent = statusLabels[status];
            elements.status.dataset.status = status;
            if (total > 0) {
                elements.bar.max = total;
                elements.bar.value = Math.min(done, total);
            } else {
                elements.bar.removeAttribute('value');
            }
            const percent = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
            elements.count.textContent = total > 0 ? `${done} / ${total}` : `${done} ${snapshot.unit || ''}`.trim();
            elements.percent.textContent = total > 0 ? `${percent}%` : 'Выполняется';
            elements.success.textContent = String(Math.max(0, Number(snapshot.success) || 0));
            elements.failed.textContent = String(Math.max(0, Number(snapshot.failed) || 0));
            elements.message.textContent = snapshot.message || 'Операция выполняется в контролируемом окне.';
            elements.cancel.disabled = status !== 'running';
            elements.cancel.hidden = ['complete', 'partial', 'error', 'cancelled'].includes(status);
        };

        const requestCancel = async () => {
            if (!snapshot || snapshot.status !== 'running') return false;
            snapshot = { ...snapshot, status: 'cancelling', message: 'Останавливаем операцию…' };
            render();
            await Promise.resolve(onCancel?.()).catch(() => undefined);
            return true;
        };

        const bindDocument = pipWindow => {
            const pipDocument = pipWindow.document;
            pipDocument.documentElement.lang = 'ru';
            pipDocument.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
            pipDocument.documentElement.dataset.uiScale = document.documentElement.dataset.uiScale || 'auto';
            const sourceFontSize = globalThis.getComputedStyle?.(document.documentElement)?.fontSize;
            if (sourceFontSize && pipDocument.documentElement.style) {
                pipDocument.documentElement.style.fontSize = sourceFontSize;
            }
            pipDocument.title = 'Прогресс DashBridge';
            for (const stylesheet of ['pages/shared/theme.css', 'pages/shared/operation-progress.css']) {
                const link = pipDocument.createElement('link');
                link.rel = 'stylesheet';
                link.href = chrome.runtime.getURL(stylesheet);
                pipDocument.head.appendChild(link);
            }
            pipDocument.body.innerHTML = `
                <main class="operation-progress-card">
                    <header>
                        <span class="operation-progress-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
                        </span>
                        <div><h1 id="operationTitle">DashBridge</h1><p id="operationPhase">Подготовка…</p></div>
                        <span id="operationStatus" class="operation-status">Выполняется</span>
                    </header>
                    <progress id="operationBar" max="1"></progress>
                    <div class="operation-progress-numbers"><strong id="operationCount">0 / 0</strong><span id="operationPercent">0%</span></div>
                    <div class="operation-progress-stats"><span>Успешно: <strong id="operationSuccess">0</strong></span><span>Ошибки: <strong id="operationFailed">0</strong></span></div>
                    <p id="operationMessage" class="operation-message">Операция выполняется в контролируемом окне.</p>
                    <button id="operationCancel" type="button" class="btn btn-danger">Принудительно остановить</button>
                </main>`;
            pictureInPictureElements = {
                title: pipDocument.getElementById('operationTitle'), phase: pipDocument.getElementById('operationPhase'),
                status: pipDocument.getElementById('operationStatus'), bar: pipDocument.getElementById('operationBar'),
                count: pipDocument.getElementById('operationCount'), percent: pipDocument.getElementById('operationPercent'),
                success: pipDocument.getElementById('operationSuccess'), failed: pipDocument.getElementById('operationFailed'),
                message: pipDocument.getElementById('operationMessage'), cancel: pipDocument.getElementById('operationCancel')
            };
            pictureInPictureElements.cancel.addEventListener('click', () => { void requestCancel(); });
            render();
        };

        const release = async () => {
            clearTimeout(closeTimer);
            closeTimer = null;
            const pipWindow = pictureInPictureWindow;
            pictureInPictureWindow = null;
            pictureInPictureElements = null;
            snapshot = null;
            if (pipWindow && !pipWindow.closed) pipWindow.close();
        };

        return {
            async openPictureInPicture({ title, phase = 'Подготовка', width = 390, height = 300 }) {
                if (typeof globalThis.documentPictureInPicture?.requestWindow !== 'function') return false;
                clearTimeout(closeTimer);
                closeTimer = null;
                if (pictureInPictureWindow && !pictureInPictureWindow.closed) pictureInPictureWindow.close();
                pictureInPictureWindow = null;
                pictureInPictureElements = null;
                snapshot = { title, phase, done: 0, total: 0, success: 0, failed: 0, status: 'running', message: '' };
                try {
                    const rootFontSize = Number.parseFloat(globalThis.getComputedStyle?.(document.documentElement)?.fontSize) || 16;
                    const interfaceScale = Math.min(1.5, Math.max(0.9, rootFontSize / 16));
                    // Invoke before the first await to preserve activation from the start button.
                    const pendingWindow = globalThis.documentPictureInPicture.requestWindow({
                        width: Math.max(Math.round(340 * interfaceScale), Math.round((Number(width) || 390) * interfaceScale)),
                        height: Math.max(Math.round(260 * interfaceScale), Math.round((Number(height) || 300) * interfaceScale))
                    });
                    const pipWindow = await pendingWindow;
                    pictureInPictureWindow = pipWindow;
                    bindDocument(pipWindow);
                    pipWindow.addEventListener('pagehide', () => {
                        if (pictureInPictureWindow !== pipWindow) return;
                        pictureInPictureWindow = null;
                        pictureInPictureElements = null;
                    }, { once: true });
                    return true;
                } catch {
                    pictureInPictureWindow = null;
                    pictureInPictureElements = null;
                    snapshot = null;
                    return false;
                }
            },
            update(progress) {
                if (!pictureInPictureWindow || !snapshot || snapshot.status !== 'running') return;
                snapshot = { ...snapshot, ...progress, status: 'running' };
                render();
            },
            finish({ status = null, message = '' } = {}) {
                if (!pictureInPictureWindow || !snapshot) return;
                const inferredStatus = snapshot.success > 0
                    ? (snapshot.failed > 0 ? 'partial' : 'complete')
                    : 'error';
                snapshot = {
                    ...snapshot,
                    status: status || inferredStatus,
                    message: message || (inferredStatus === 'complete' ? 'Операция завершена' : inferredStatus === 'partial' ? 'Операция завершена с ошибками' : 'Не удалось получить результат')
                };
                render();
                clearTimeout(closeTimer);
                closeTimer = setTimeout(() => { void release(); }, closeDelayMs);
            },
            cancel() {
                this.finish({ status: 'cancelled', message: 'Операция остановлена' });
            },
            release,
            get mode() { return pictureInPictureWindow ? 'picture-in-picture' : null; }
        };
    };

    return { create };
})();
