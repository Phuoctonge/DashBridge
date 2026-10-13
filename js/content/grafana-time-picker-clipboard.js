(function initDashBridgeGrafanaTimePickerClipboard(root) {
    'use strict';

    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;
    const ABSOLUTE_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
    const EPOCH_MILLISECONDS_RE = /^\d{13}$/;
    const DATE_TIME_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})[ Tt](\d{2}):(\d{2}):(\d{2})/;
    const pad = value => String(value).padStart(2, '0');
    const formatLocalDateTime = milliseconds => {
        const date = new Date(milliseconds);
        if (!Number.isFinite(date.getTime())) return null;
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
            + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };
    const hasValidCalendarTime = text => {
        const parts = DATE_TIME_PARTS_RE.exec(text);
        if (!parts) return false;
        const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
            && hour <= 23 && minute <= 59 && second <= 59;
    };
    const isRelativeEndpoint = text => {
        if (!text.startsWith('now')) return false;
        // Grafana 12.2 datemath.ts strips whitespace and permits chained math,
        // implicit count 1, Q/f units and only single-unit rounding.
        const math = text.slice(3).replace(/\s/g, '');
        const operation = /([+\-/])(\d*)(f?)([yMwdhmsQ])/y;
        let cursor = 0;
        while (cursor < math.length) {
            operation.lastIndex = cursor;
            const match = operation.exec(math);
            if (!match) return false;
            const count = match[2] ? Number(match[2]) : 1;
            if (match[2] && cursor + 1 + match[2].length > 10) return false;
            if (match[1] === '/' && count !== 1) return false;
            cursor = operation.lastIndex;
        }
        return true;
    };
    const normalizeEndpoint = value => {
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
        const text = normalizeText(value);
        if (!text) return '';
        const local = LOCAL_DATE_TIME_RE.exec(text);
        if (local) return hasValidCalendarTime(text) ? `${local[1]} ${local[2]}` : '';
        if (ABSOLUTE_WITH_ZONE_RE.test(text)) {
            const offset = /[+-](\d{2}):(\d{2})$/.exec(text);
            if (!hasValidCalendarTime(text) || (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))) return '';
            return formatLocalDateTime(Date.parse(text)) || '';
        }
        if (EPOCH_MILLISECONDS_RE.test(text)) return formatLocalDateTime(Number(text)) || '';
        return typeof value === 'string' && isRelativeEndpoint(text) ? text : '';
    };
    const normalizeRange = range => {
        if (!range || typeof range !== 'object' || Array.isArray(range)) return null;
        const from = normalizeEndpoint(range.from);
        const to = normalizeEndpoint(range.to);
        return from && to ? { from, to } : null;
    };
    const parseRange = value => {
        const text = String(value || '').trim();
        if (!text) return null;
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const range = normalizeRange(parsed);
                if (range) return range;
            }
        } catch { /* A copied Grafana URL is also supported below. */ }
        try {
            const url = new URL(text);
            const from = normalizeText(url.searchParams.get('from'));
            const to = normalizeText(url.searchParams.get('to'));
            return from && to ? normalizeRange({ from, to }) : null;
        } catch { return null; }
    };
    const serializeRange = range => {
        const normalized = normalizeRange(range);
        if (!normalized) throw new TypeError('Invalid Grafana time range');
        return JSON.stringify(normalized);
    };

    root.DashBridgeGrafanaTimePickerClipboard = Object.freeze({
        normalizeEndpoint, normalizeRange, parseRange, serializeRange
    });
    if (!root.document || !root.MutationObserver) return;

    const buttonSelector = 'button, input[type="button"], input[type="submit"]';
    const isApplyButton = button => /^apply time range$/i.test(normalizeText(button?.textContent || button?.value));
    const findPicker = applyButton => {
        let candidate = applyButton.parentElement;
        while (candidate && candidate !== document.body) {
            const text = normalizeText(candidate.textContent);
            const inputs = [...candidate.querySelectorAll('input')].filter(input =>
                !['button', 'submit', 'hidden', 'search'].includes(String(input.type || 'text').toLowerCase()));
            if (/absolute time range/i.test(text) && inputs.length >= 2) {
                return { root: candidate, inputs: inputs.slice(0, 2), applyButton };
            }
            candidate = candidate.parentElement;
        }
        return null;
    };
    const setInputValue = (input, value) => {
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const icon = kind => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
        const shapes = kind === 'copy'
            ? [['path', { d: 'M8 8h11v11H8z' }], ['path', { d: 'M16 8V5H5v11h3' }]]
            : [['path', { d: 'M9 5h6' }], ['path', { d: 'M9 3h6v4H9z' }], ['path', { d: 'M7 5H5v16h14V5h-2' }], ['path', { d: 'M8 13h8M12 9v8' }]];
        shapes.forEach(([tag, attributes]) => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
            svg.append(node);
        });
        return svg;
    };
    // These records own only DashBridge listeners/presentation, never Grafana's
    // native actions. A new record also invalidates continuations of an old mount.
    const bindings = new Map();
    let suspended = false;
    const scopeAllowed = () => !suspended && document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true';
    const pickerCurrent = picker => {
        if (![picker.root, picker.applyButton, ...picker.inputs].every(node =>
            node.isConnected && node.ownerDocument === document)) return false;
        const current = findPicker(picker.applyButton);
        return current?.root === picker.root && current.inputs.every((input, index) => input === picker.inputs[index]);
    };
    const bindingCurrent = record => bindings.get(record.button) === record && scopeAllowed()
        && record.button.isConnected && record.button.ownerDocument === document
        && record.picker.root.contains(record.button) && pickerCurrent(record.picker);
    const restoreFlash = record => {
        if (record.timer !== null) clearTimeout(record.timer);
        record.timer = null;
        record.button.title = record.activeTitle;
        ['dashbridge-time-picker-failed', 'dashbridge-time-picker-success'].forEach((name, index) =>
            record.button.classList.toggle(name, record.originalClasses[index]));
    };
    const releaseBinding = record => {
        if (bindings.get(record.button) !== record) return;
        bindings.delete(record.button);
        record.button.removeEventListener('click', record.handler, record.native);
        restoreFlash(record);
        if (record.native) {
            if (record.originalTitle === null) record.button.removeAttribute('title');
            else record.button.setAttribute('title', record.originalTitle);
            if (record.originalMarker === undefined) delete record.button.dataset.dashbridgeTimeClipboardBound;
            else record.button.dataset.dashbridgeTimeClipboardBound = record.originalMarker;
        } else record.button.remove();
    };
    const flash = (record, message, failed = false) => {
        if (!bindingCurrent(record)) return;
        restoreFlash(record);
        const button = record.button;
        button.title = message;
        button.classList.toggle('dashbridge-time-picker-failed', failed);
        button.classList.toggle('dashbridge-time-picker-success', !failed);
        record.timer = setTimeout(() => {
            if (!bindingCurrent(record)) return;
            restoreFlash(record);
        }, 1400);
    };
    const copyPickerRange = async record => {
        if (!bindingCurrent(record)) return;
        const picker = record.picker;
        const range = normalizeRange({ from: picker.inputs[0].value, to: picker.inputs[1].value });
        if (!range) throw new Error('empty-range');
        await navigator.clipboard.writeText(serializeRange(range));
        if (!bindingCurrent(record)) return;
        globalThis.DashBridgeAnalytics?.outcome('grafana.time_range_copied', 'success', { surface: 'direct_grafana' });
        flash(record, 'Диапазон скопирован');
    };
    const pastePickerRange = async record => {
        if (!bindingCurrent(record)) return;
        const picker = record.picker;
        const range = parseRange(await navigator.clipboard.readText());
        if (!bindingCurrent(record)) return;
        if (!range) throw new Error('invalid-range');
        setInputValue(picker.inputs[0], range.from);
        if (!bindingCurrent(record)) return;
        setInputValue(picker.inputs[1], range.to);
        if (!bindingCurrent(record)) return;
        globalThis.DashBridgeAnalytics?.outcome('grafana.time_range_pasted', 'success', { surface: 'direct_grafana' });
        flash(record, 'Диапазон вставлен');
    };
    const bindButton = (button, kind, picker, native) => {
        if (bindings.has(button)) return;
        const record = {
            button, kind, picker, native, timer: null,
            originalTitle: button.getAttribute('title'),
            originalMarker: button.dataset.dashbridgeTimeClipboardBound,
            originalClasses: ['dashbridge-time-picker-failed', 'dashbridge-time-picker-success']
                .map(name => button.classList.contains(name))
        };
        if (native) {
            button.dataset.dashbridgeTimeClipboardBound = kind;
            button.title = kind === 'copy' ? 'Копировать совместимый диапазон времени' : 'Вставить диапазон времени';
        }
        record.activeTitle = button.title;
        record.handler = event => {
            if (!bindingCurrent(record)) {
                releaseBinding(record);
                return;
            }
            // Capture only these picker actions; an inactive handler must let
            // Grafana receive the click, including its own clipboard behavior.
            event.preventDefault();
            if (native) event.stopImmediatePropagation(); else event.stopPropagation();
            void (kind === 'copy' ? copyPickerRange(record) : pastePickerRange(record)).catch(() => {
                if (!bindingCurrent(record)) return;
                globalThis.DashBridgeAnalytics?.outcome(
                    kind === 'copy' ? 'grafana.time_range_copied' : 'grafana.time_range_pasted',
                    'invalid_input', { surface: 'direct_grafana' });
                flash(record, kind === 'copy' ? 'Не удалось скопировать' : 'В буфере нет диапазона', true);
            });
        };
        bindings.set(button, record);
        button.addEventListener('click', record.handler, native);
    };
    const createButton = (kind, picker) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `dashbridge-time-picker-clipboard dashbridge-time-picker-${kind}`;
        button.title = kind === 'copy' ? 'Копировать диапазон времени' : 'Вставить диапазон времени';
        button.setAttribute('aria-label', button.title);
        button.append(icon(kind));
        bindButton(button, kind, picker, false);
        return button;
    };
    const bindNativeButton = (button, kind, picker) => {
        bindButton(button, kind, picker, true);
    };
    const enhanceNativeClipboard = (nativeButtons, applyButton, picker) => {
        const applyIndex = nativeButtons.indexOf(applyButton);
        if (applyIndex < 2) return false;
        const actions = nativeButtons.slice(applyIndex - 2, applyIndex);
        bindNativeButton(actions[0], 'copy', picker);
        bindNativeButton(actions[1], 'paste', picker);
        return true;
    };
    const ensureStyle = () => {
        if (document.getElementById('dashbridge-time-picker-clipboard-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-time-picker-clipboard-style';
        style.textContent = `
            .dashbridge-time-picker-clipboard{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;margin-right:4px;padding:0;border:1px solid #c7d0d9;border-radius:2px;background:#f7f8fa;color:#24292f;vertical-align:middle;cursor:pointer}
            .dashbridge-time-picker-clipboard:hover{border-color:#5794f2;color:#3274d9}.dashbridge-time-picker-clipboard:focus-visible{outline:2px solid #5794f2;outline-offset:1px}
            .dashbridge-time-picker-clipboard svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
            .dashbridge-time-picker-success{color:#299c46!important}.dashbridge-time-picker-failed{color:#d44a3a!important}
        `;
        document.documentElement.append(style);
    };
    const mount = () => {
        bindings.forEach(record => { if (!bindingCurrent(record)) releaseBinding(record); });
        if (!scopeAllowed()) return;
        [...document.querySelectorAll(buttonSelector)].filter(isApplyButton).forEach(applyButton => {
            const actions = applyButton.parentElement;
            if (!actions || actions.querySelector('.dashbridge-time-picker-clipboard')) return;
            const picker = findPicker(applyButton);
            if (!picker || !pickerCurrent(picker)) return;
            const nativeButtons = [...actions.children].filter(element =>
                element.matches?.(buttonSelector)
                && !element.classList?.contains('dashbridge-time-picker-clipboard'));
            // Modern Grafana already renders Copy and Paste beside Apply. Keep
            // its controls, but make their clipboard payload cross-version.
            if (nativeButtons.length > 1 && enhanceNativeClipboard(nativeButtons, applyButton, picker)) return;
            ensureStyle();
            actions.insertBefore(createButton('copy', picker), applyButton);
            actions.insertBefore(createButton('paste', picker), applyButton);
        });
    };
    let observer = null;
    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; mount(); });
    };
    const syncScope = () => {
        const allowed = scopeAllowed();
        if (allowed && !observer) {
            observer = new MutationObserver(schedule);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            schedule();
        } else if (!allowed) {
            observer?.disconnect(); observer = null;
            bindings.forEach(releaseBinding);
        }
    };
    document.addEventListener('dashbridgeGrafanaMenuScopeChanged', syncScope);
    root.addEventListener('pagehide', () => { suspended = true; syncScope(); });
    root.addEventListener('pageshow', () => { suspended = false; syncScope(); });
    syncScope();
})(globalThis);
