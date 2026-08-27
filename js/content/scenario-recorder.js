// Injected only into the tab explicitly created by Traffic Recorder.
(function () {
    'use strict';
    if (window.__dashbridgeScenarioRecorderInstalled) return;
    window.__dashbridgeScenarioRecorderInstalled = true;

    if (window === window.top) {
        chrome.runtime.sendMessage({
            type: 'dashbridge-recorder-environment',
            environment: {
                userAgent: navigator.userAgent,
                platform: navigator.userAgentData?.platform || navigator.platform || '',
                language: navigator.language,
                languages: Array.from(navigator.languages || []),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                viewport: { width: innerWidth, height: innerHeight },
                devicePixelRatio: window.devicePixelRatio || 1,
            },
        }).catch(() => undefined);
    }

    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const shortText = value => {
        const normalized = normalizeText(value);
        return normalized && normalized.length <= 160 ? normalized : null;
    };

    function implicitRole(element) {
        const tag = element?.localName;
        if (tag === 'button') return 'button';
        if (tag === 'a' && element.hasAttribute('href')) return 'link';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return 'combobox';
        if (tag !== 'input') return null;
        const type = String(element.type || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        return ['hidden'].includes(type) ? null : 'textbox';
    }

    function labelledText(element) {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
            if (shortText(text)) return shortText(text);
        }
        if ('labels' in element && element.labels?.length) {
            const text = Array.from(element.labels).map(label => label.textContent || '').join(' ');
            if (shortText(text)) return shortText(text);
        }
        return null;
    }

    function stableTestAttribute(element) {
        for (const name of ['data-testid', 'data-test-id', 'data-qa', 'data-cy']) {
            const value = element.getAttribute(name);
            if (value) return { name, value };
        }
        return { name: null, value: null };
    }

    function cssPath(element) {
        if (!(element instanceof Element)) return null;
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testAttribute = stableTestAttribute(element);
        if (testAttribute.value) return `[${testAttribute.name}="${CSS.escape(testAttribute.value)}"]`;
        const name = element.getAttribute('name');
        if (name) return `${element.localName}[name="${CSS.escape(name)}"]`;
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 7) {
            let part = current.localName;
            const parent = current.parentElement;
            if (!parent) { parts.unshift(part); break; }
            const siblings = Array.from(parent.children).filter(child => child.localName === current.localName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            current = parent;
        }
        return parts.join(' > ');
    }

    function locatorFor(element) {
        const target = element instanceof Element ? element.closest('button,a,input,textarea,select,[role],[contenteditable="true"]') || element : null;
        if (!target) return null;
        const testAttribute = stableTestAttribute(target);
        const ariaLabel = shortText(target.getAttribute('aria-label'));
        const text = shortText(target.innerText || target.textContent);
        const labelText = labelledText(target);
        const role = target.getAttribute('role') || implicitRole(target);
        const accessibleName = ariaLabel || labelText || text;
        const href = target.localName === 'a' && target.hasAttribute('href') ? target.href : null;
        const action = target.localName === 'form' && target.hasAttribute('action') ? target.action : null;
        return {
            css: cssPath(target),
            id: target.id || null,
            name: target.getAttribute('name'),
            testAttribute: testAttribute.name,
            testId: testAttribute.value,
            role,
            ariaLabel,
            accessibleName,
            labelText,
            text,
            href,
            action,
            tag: target.localName,
            inputType: target.getAttribute('type'),
            stable: Boolean(target.id || testAttribute.value || target.getAttribute('name') || ariaLabel
                || labelText || href || action || (role && accessibleName) || text),
        };
    }

    function emit(type, element, extra = {}) {
        const locator = locatorFor(element);
        if (!locator?.css) return;
        chrome.runtime.sendMessage({
            type: 'dashbridge-recorder-action',
            action: {
                type, locator, url: location.href, frameUrl: location.href,
                at: Date.now(), ...extra,
            }
        }).catch(() => undefined);
    }

    document.addEventListener('click', event => {
        if (!event.isTrusted) return;
        if (event.button !== 0) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        const clickable = path.find(node => node instanceof Element && (
            ['button', 'a', 'input', 'summary'].includes(node.localName)
            || node.hasAttribute('role') || node.hasAttribute('tabindex') || node.hasAttribute('onclick')
            || getComputedStyle(node).cursor === 'pointer'
        )) || event.target;
        emit('click', clickable, { button: 'primary', pointerType: event.pointerType || 'mouse' });
    }, true);

    const pendingInputs = new WeakMap();
    document.addEventListener('change', event => {
        if (!event.isTrusted) return;
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
        clearTimeout(pendingInputs.get(target)); pendingInputs.delete(target);
        emit('change', target, {
            value: target.type === 'checkbox' || target.type === 'radio' ? target.checked : target.value,
            secret: target instanceof HTMLInputElement && target.type === 'password',
        });
    }, true);

    document.addEventListener('input', event => {
        if (!event.isTrusted) return;
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
        clearTimeout(pendingInputs.get(target));
        pendingInputs.set(target, setTimeout(() => {
            pendingInputs.delete(target);
            emit('change', target, { value: target.value, secret: target instanceof HTMLInputElement && target.type === 'password' });
        }, 400));
    }, true);

    document.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (!['Enter', 'Escape', 'Tab'].includes(event.key)) return;
        emit('keyDown', event.target, { key: event.key });
    }, true);

    document.addEventListener('submit', event => {
        if (!event.isTrusted) return;
        emit('submit', event.target);
    }, true);
})();
