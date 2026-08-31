(function initDashBridgeRecorderReplay(root) {
    'use strict';

    function normalizeReplaySteps(steps) {
        return steps.filter((step, index) => {
            if (step.type !== 'change' || steps[index - 1]?.type !== 'click') return true;
            const css = step._dashbridge?.locator?.css;
            const duplicate = steps.slice(Math.max(0, index - 3), index - 1).reverse().find(candidate =>
                candidate.type === 'change' && candidate._dashbridge?.locator?.css === css
                && candidate.value === step.value
                && Number(step._dashbridge?.at || 0) - Number(candidate._dashbridge?.at || 0) < 2_000);
            return !duplicate;
        });
    }

    function performDomAction(step) {
        const locator = step?._dashbridge?.locator || {};
        const expectedFrameUrl = step?._dashbridge?.frameUrl;
        if (expectedFrameUrl && location.href !== expectedFrameUrl) return { ok: false, url: location.href, error: 'Другой frame URL' };
        const normalizedText = value => String(value || '').replace(/\s+/g, ' ').trim();
        const roleOf = element => {
            const explicit = element.getAttribute('role');
            if (explicit) return explicit;
            if (element.localName === 'button') return 'button';
            if (element.localName === 'a' && element.hasAttribute('href')) return 'link';
            if (element.localName === 'textarea') return 'textbox';
            if (element.localName === 'select') return 'combobox';
            if (element.localName !== 'input') return null;
            const type = String(element.type || 'text').toLowerCase();
            if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'range') return 'slider';
            return type === 'hidden' ? null : 'textbox';
        };
        const accessibleNameOf = element => {
            const ariaLabel = normalizedText(element.getAttribute('aria-label'));
            if (ariaLabel) return ariaLabel;
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
                const text = normalizedText(labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '));
                if (text) return text;
            }
            if ('labels' in element && element.labels?.length) {
                const text = normalizedText(Array.from(element.labels).map(label => label.textContent || '').join(' '));
                if (text) return text;
            }
            return normalizedText(element.innerText || element.textContent);
        };
        const isUsable = element => element instanceof Element && element.isConnected
            && element.getClientRects().length > 0 && !element.hasAttribute('disabled');
        const matchesType = element => (!locator.tag || element.localName === locator.tag)
            && (!locator.inputType || String(element.getAttribute('type') || '').toLowerCase() === String(locator.inputType).toLowerCase());
        const testAttribute = ['data-testid', 'data-test-id', 'data-qa', 'data-cy'].includes(locator.testAttribute)
            ? locator.testAttribute : 'data-testid';
        const matchesFingerprint = element => {
            if (!matchesType(element)) return false;
            if (locator.id && element.id === locator.id) return true;
            if (locator.testId && element.getAttribute(testAttribute) === locator.testId) return true;
            if (locator.name && element.getAttribute('name') === locator.name) return true;
            if (locator.ariaLabel && normalizedText(element.getAttribute('aria-label')) === normalizedText(locator.ariaLabel)) return true;
            if (locator.href && element.localName === 'a' && element.href === locator.href) return true;
            if (locator.action && element.localName === 'form' && element.action === locator.action) return true;
            const expectedName = normalizedText(locator.accessibleName || locator.labelText || locator.text);
            if (locator.role && expectedName && roleOf(element) === locator.role && accessibleNameOf(element) === expectedName) return true;
            return Boolean(locator.text && normalizedText(element.innerText || element.textContent) === normalizedText(locator.text));
        };
        const byAttribute = (attribute, value) => !value ? [] : Array.from(document.querySelectorAll(`[${attribute}]`))
            .filter(candidate => candidate.getAttribute(attribute) === value);
        let ambiguity = '';
        const unique = (candidates, description, strictFingerprint = false) => {
            const matches = Array.from(candidates || []).filter(element => isUsable(element)
                && matchesType(element) && (!strictFingerprint || matchesFingerprint(element)));
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) ambiguity = `Неоднозначный локатор (${description}): найдено ${matches.length} элементов`;
            return null;
        };
        let element = locator.id ? unique([document.getElementById(locator.id)].filter(Boolean), `id=${locator.id}`) : null;
        if (!element && locator.testId) element = unique(byAttribute(testAttribute, locator.testId), `${testAttribute}=${locator.testId}`);
        if (!element && locator.name) element = unique(document.getElementsByName(locator.name), `name=${locator.name}`);
        if (!element && locator.ariaLabel) element = unique(byAttribute('aria-label', locator.ariaLabel), `aria-label=${locator.ariaLabel}`);
        if (!element && locator.href) element = unique(Array.from(document.links).filter(link => link.href === locator.href), `href=${locator.href}`);
        if (!element && locator.action) element = unique(Array.from(document.forms).filter(form => form.action === locator.action), `action=${locator.action}`);
        const expectedName = normalizedText(locator.accessibleName || locator.labelText || locator.text);
        if (!element && locator.role && expectedName) {
            element = unique(Array.from(document.querySelectorAll('button,a,input,textarea,select,[role],[tabindex],[contenteditable="true"]'))
                .filter(candidate => roleOf(candidate) === locator.role && accessibleNameOf(candidate) === expectedName),
            `role=${locator.role}, name=${expectedName}`);
        }
        if (!element && locator.text && locator.tag && /^[a-z][a-z0-9-]*$/i.test(locator.tag)) {
            element = unique(Array.from(document.getElementsByTagName(locator.tag))
                .filter(candidate => normalizedText(candidate.innerText || candidate.textContent) === normalizedText(locator.text)),
            `${locator.tag}, text=${locator.text}`);
        }
        if (!element && locator.css && locator.stable !== false) {
            try { element = unique(document.querySelectorAll(locator.css), `css=${locator.css}`, true); }
            catch { /* invalid selector */ }
        }
        if (!element) {
            const description = locator.accessibleName || locator.ariaLabel || locator.name || locator.testId || locator.href || locator.css || 'locator';
            return { ok: false, url: location.href, error: ambiguity || `Надёжный элемент не найден: ${description}` };
        }
        element.scrollIntoView({ block: 'center', inline: 'center' });
        if (step.type === 'click') { element.click(); return { ok: true, url: location.href }; }
        if (step.type === 'change') {
            if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
                if (element.checked !== Boolean(step.value)) element.click();
            } else {
                const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                if (setter) setter.call(element, step.value == null ? '' : String(step.value));
                else element.value = step.value == null ? '' : String(step.value);
                element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
            return { ok: true, url: location.href };
        }
        if (step.type === 'keyDown') {
            element.focus();
            element.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true, composed: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: step.key, bubbles: true, composed: true }));
            return { ok: true, url: location.href };
        }
        if (step.type === 'submit') {
            if (!(element instanceof HTMLFormElement)) return { ok: false, url: location.href, error: 'Submit locator не указывает на form' };
            if (typeof element.requestSubmit === 'function') element.requestSubmit(); else element.submit();
            return { ok: true, url: location.href };
        }
        return { ok: false, url: location.href, error: `Тип ${step.type} не поддерживается` };
    }

    function create(deps) {
        const { state, ui, delay, networkIdleMs, networkIdleTimeoutMs, ensureDebuggerPermission,
            stopActiveSession, resetSession, buildRecorderWindowLayout, createControlledTab, attachNetwork,
            buildComparison, scheduleRender, setStatus, updateControls, stepLabel, getOperationProgressController } = deps;
        const waitForTabComplete = async (tabId, timeoutMs = 20_000) => {
            if (state.stopRequested) throw new Error('Операция остановлена пользователем');
            const existing = await chrome.tabs.get(tabId).catch(() => null);
            if (existing?.status === 'complete') return;
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => finish(new Error('Превышено время загрузки страницы')), timeoutMs);
                const cancellation = setInterval(() => { if (state.stopRequested) finish(new Error('Операция остановлена пользователем')); }, 100);
                const listener = (updatedId, changeInfo) => { if (updatedId === tabId && changeInfo.status === 'complete') finish(); };
                const finish = error => { clearTimeout(timeout); clearInterval(cancellation); chrome.tabs.onUpdated.removeListener(listener); error ? reject(error) : resolve(); };
                chrome.tabs.onUpdated.addListener(listener);
            });
        };
        const waitForNetworkIdle = async () => {
            const deadline = Date.now() + networkIdleTimeoutMs;
            while (Date.now() < deadline) {
                if (state.stopRequested) throw new Error('Операция остановлена пользователем');
                if (!state.inFlight.size && Date.now() - state.lastNetworkAt >= networkIdleMs) return;
                await delay(100);
            }
        };
        const performDomActionWithWait = async (step, timeoutMs = 15_000) => {
            const deadline = Date.now() + timeoutMs; let lastError = 'Элемент не найден';
            while (Date.now() < deadline) {
                if (state.stopRequested) throw new Error('Операция остановлена пользователем');
                const results = await chrome.scripting.executeScript({
                    target: { tabId: state.tabId, allFrames: true }, func: performDomAction, args: [step]
                }).catch(error => { lastError = error?.message || String(error); return []; });
                const success = results.find(item => item.result?.ok);
                if (success) return success;
                lastError = results.map(item => item.result?.error).filter(error => error && error !== 'Другой frame URL')[0] || lastError;
                await delay(200);
            }
            throw new Error(lastError);
        };
        const waitForExpectedNavigation = async (expectedUrl, timeoutMs = 20_000) => {
            if (!expectedUrl) return;
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (state.stopRequested) throw new Error('Операция остановлена пользователем');
                const tab = await chrome.tabs.get(state.tabId).catch(() => null);
                if (tab?.url === expectedUrl) { await waitForTabComplete(state.tabId, timeoutMs); return; }
                await delay(100);
            }
            throw new Error(`Не выполнен переход на ${expectedUrl}`);
        };
        const executeStep = async (step, index) => {
            if (state.stopRequested) throw new Error('Операция остановлена пользователем');
            state.activeStepId = index + 1;
            setStatus(`Replay: шаг ${index + 1}/${state.steps.length} — ${step.type}`);
            const progress = getOperationProgressController();
            progress?.update({ phase: `Replay: шаг ${index + 1} из ${state.steps.length}`, done: index,
                total: state.steps.length, success: index, failed: 0, message: `${step.type} ${stepLabel(step)}` });
            if (step.type === 'navigate') {
                await chrome.tabs.update(state.tabId, { url: step.url });
                await waitForTabComplete(state.tabId); await waitForNetworkIdle();
            } else {
                await performDomActionWithWait(step); await waitForExpectedNavigation(step._dashbridge?.navigationUrl);
                await delay(100); await waitForNetworkIdle();
            }
            progress?.update({ phase: `Replay: выполнен шаг ${index + 1} из ${state.steps.length}`, done: index + 1,
                total: state.steps.length, success: index + 1, failed: 0, message: `${step.type} ${stepLabel(step)}` });
        };
        const start = async () => {
            if (!state.steps.length) return;
            const progress = getOperationProgressController();
            try {
                await progress?.openPictureInPicture({ title: 'Traffic Recorder · Replay', phase: 'Подготовка replay', width: 390, height: 300 });
                await ensureDebuggerPermission();
                const replaySteps = normalizeReplaySteps(state.steps.map(step => structuredClone(step)));
                await stopActiveSession(false); resetSession({ keepSteps: true, keepBaseline: true }); state.steps = replaySteps;
                state.sessionOptions = { disableCache: ui.disableCache.checked, disableCookies: ui.disableCookies.checked };
                state.mode = 'replaying'; state.createdAt = new Date().toISOString(); state.sessionStartedAt = Date.now(); updateControls();
                const tabId = await createControlledTab(buildRecorderWindowLayout()); await attachNetwork(tabId);
                for (let index = 0; index < replaySteps.length; index += 1) await executeStep(replaySteps[index], index);
                await stopActiveSession(false); buildComparison();
                progress?.finish({ status: 'complete', message: `Replay завершён: ${replaySteps.length} шагов` });
                setStatus(`Replay завершен: ${replaySteps.length} шагов, собрано ${state.requests.size} запросов. Сравнение готово.`);
            } catch (error) {
                await stopActiveSession(false);
                if (state.baselineRequests.size && state.requests.size) buildComparison();
                if (state.stopRequested) setStatus('Replay остановлен пользователем.');
                else {
                    progress?.finish({ status: 'error', message: `Replay остановлен: ${error?.message || error}` });
                    setStatus(`Replay остановлен: ${error?.message || error}`, true);
                }
            }
            scheduleRender();
        };
        return Object.freeze({ start, waitForTabComplete, waitForNetworkIdle, executeStep });
    }

    root.DashBridgeRecorderReplay = Object.freeze({ create, normalizeReplaySteps, performDomAction });
})(globalThis);
