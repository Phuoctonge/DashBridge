(function initDashBridgeGrafanaTimePickerClipboard(root) {
    'use strict';

    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;
    const ABSOLUTE_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
    const EPOCH_MILLISECONDS_RE = /^\d{13}$/;
    const pad = value => String(value).padStart(2, '0');
    const formatLocalDateTime = milliseconds => {
        const date = new Date(milliseconds);
        if (!Number.isFinite(date.getTime())) return null;
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
            + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };
    const normalizeEndpoint = value => {
        const text = normalizeText(value);
        if (!text) return '';
        const local = LOCAL_DATE_TIME_RE.exec(text);
        if (local) return `${local[1]} ${local[2]}`;
        if (ABSOLUTE_WITH_ZONE_RE.test(text) || EPOCH_MILLISECONDS_RE.test(text)) {
            return formatLocalDateTime(EPOCH_MILLISECONDS_RE.test(text) ? Number(text) : Date.parse(text)) || text;
        }
        return text;
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
                return { root: candidate, inputs: inputs.slice(0, 2) };
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
    const flash = (button, message, failed = false) => {
        const original = button.title;
        button.title = message;
        button.classList.toggle('dashbridge-time-picker-failed', failed);
        button.classList.toggle('dashbridge-time-picker-success', !failed);
        setTimeout(() => {
            if (!button.isConnected) return;
            button.title = original;
            button.classList.remove('dashbridge-time-picker-failed', 'dashbridge-time-picker-success');
        }, 1400);
    };
    const copyPickerRange = async (button, picker) => {
        const range = normalizeRange({ from: picker.inputs[0].value, to: picker.inputs[1].value });
        if (!range) throw new Error('empty-range');
        await navigator.clipboard.writeText(serializeRange(range));
        flash(button, 'Диапазон скопирован');
    };
    const pastePickerRange = async (button, picker) => {
        const range = parseRange(await navigator.clipboard.readText());
        if (!range) throw new Error('invalid-range');
        setInputValue(picker.inputs[0], range.from);
        setInputValue(picker.inputs[1], range.to);
        flash(button, 'Диапазон вставлен');
    };
    const createButton = (kind, picker) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `dashbridge-time-picker-clipboard dashbridge-time-picker-${kind}`;
        button.title = kind === 'copy' ? 'Копировать диапазон времени' : 'Вставить диапазон времени';
        button.setAttribute('aria-label', button.title);
        button.append(icon(kind));
        button.addEventListener('click', async event => {
            event.preventDefault(); event.stopPropagation();
            try {
                if (kind === 'copy') {
                    await copyPickerRange(button, picker);
                } else {
                    await pastePickerRange(button, picker);
                }
            } catch {
                flash(button, kind === 'copy' ? 'Не удалось скопировать' : 'В буфере нет диапазона', true);
            }
        });
        return button;
    };
    const bindNativeButton = (button, kind, picker) => {
        if (button.dataset.dashbridgeTimeClipboardBound) return;
        button.dataset.dashbridgeTimeClipboardBound = kind;
        button.title = kind === 'copy'
            ? 'Копировать совместимый диапазон времени'
            : 'Вставить диапазон времени';
        button.addEventListener('click', event => {
            // Grafana 12 serializes absolute state as UTC ISO. Replace only the
            // two native picker actions with the visible local values understood
            // by both Grafana 10 and 12; Apply remains entirely native.
            event.preventDefault();
            event.stopImmediatePropagation();
            void (kind === 'copy' ? copyPickerRange(button, picker) : pastePickerRange(button, picker))
                .catch(() => flash(button, kind === 'copy' ? 'Не удалось скопировать' : 'В буфере нет диапазона', true));
        }, true);
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
        if (document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true') return;
        [...document.querySelectorAll(buttonSelector)].filter(isApplyButton).forEach(applyButton => {
            const actions = applyButton.parentElement;
            if (!actions || actions.querySelector('.dashbridge-time-picker-clipboard')) return;
            const picker = findPicker(applyButton);
            if (!picker) return;
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
        const allowed = document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true';
        if (allowed && !observer) {
            observer = new MutationObserver(schedule);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            schedule();
        } else if (!allowed && observer) {
            observer.disconnect(); observer = null;
            document.querySelectorAll('.dashbridge-time-picker-clipboard').forEach(button => button.remove());
        }
    };
    document.addEventListener('dashbridgeGrafanaMenuScopeChanged', syncScope);
    syncScope();
})(globalThis);
