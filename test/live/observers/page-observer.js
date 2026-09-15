'use strict';

function attachPageObserver(page, { maxEntries = 100, maxText = 512 } = {}) {
    const limit = Math.max(1, Math.min(1000, Number(maxEntries) || 100));
    const consoleEntries = [];
    const pageErrors = [];
    const boundedText = value => String(value || '').replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, maxText);
    const push = (target, value) => { target.push(value); if (target.length > limit) target.splice(0, target.length - limit); };
    const onConsole = message => push(consoleEntries, { at: Date.now(), type: boundedText(message.type()), text: boundedText(message.text()) });
    const onPageError = error => push(pageErrors, { at: Date.now(), message: boundedText(error.message) });
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    let detached = false;
    const snapshot = () => ({ console: consoleEntries.map(item => ({ ...item })), pageErrors: pageErrors.map(item => ({ ...item })) });
    return {
        snapshot,
        drain() { const result = snapshot(); consoleEntries.length = 0; pageErrors.length = 0; return result; },
        detach() { if (detached) return; detached = true; page.off('console', onConsole); page.off('pageerror', onPageError); },
    };
}

module.exports = { attachPageObserver };
