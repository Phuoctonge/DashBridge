// Opens the local Easter egg outside the constrained extension popup.
document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('debugFreshCodeEasterEgg');
    const notice = document.getElementById('freshCodeNotice');
    if (!trigger || !notice) return;

    const updateNoticeMode = () => {
        const grafanaTabActive = document.querySelector('.tab-btn[data-tab="tab-grafana"]')?.classList.contains('active');
        const debugTabActive = document.querySelector('.grafana-sub-btn[data-sub="grafana-debug"]')?.classList.contains('active');
        notice.classList.toggle('is-debug', Boolean(grafanaTabActive && debugTabActive));
    };

    document.addEventListener('click', (event) => {
        if (event.target.closest('.tab-btn, .grafana-sub-btn')) {
            setTimeout(updateNoticeMode, 0);
        }
    });
    updateNoticeMode();

    trigger.addEventListener('click', () => {
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const interfaceScale = Math.min(1.5, Math.max(0.9, rootFontSize / 16));
        const uiScale = document.documentElement.dataset.uiScale || 'auto';
        chrome.windows.create({
            url: `${chrome.runtime.getURL('assets/ui/debug-easter-egg.html')}?uiScale=${encodeURIComponent(uiScale)}`,
            type: 'popup',
            width: Math.round(420 * interfaceScale),
            height: Math.round(190 * interfaceScale),
        });
    });
});
