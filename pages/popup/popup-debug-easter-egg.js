// Opens the local Easter egg outside the constrained extension popup.
document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('debugFreshCodeEasterEgg');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const interfaceScale = Math.min(1.5, Math.max(0.9, rootFontSize / 16));
        const uiScale = document.documentElement.dataset.uiScale || 'auto';
        chrome.windows.create({
            url: `${chrome.runtime.getURL('pages/debug-easter-egg/debug-easter-egg.html')}?uiScale=${encodeURIComponent(uiScale)}`,
            type: 'popup',
            width: Math.round(420 * interfaceScale),
            height: Math.round(190 * interfaceScale),
        });
    });
});
