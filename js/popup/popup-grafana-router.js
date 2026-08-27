// === Grafana Shared & Initialization Module ===

document.addEventListener("DOMContentLoaded", () => {
    const btnBatchCapture = document.getElementById("openBatchCaptureBtn");
    if (btnBatchCapture) {
        btnBatchCapture.onclick = () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("batch.html") });
        };
    }

    const btnDashBridge = document.getElementById("openDashBridgeBtn");
    if (btnDashBridge) {
        btnDashBridge.onclick = () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("dashbridge.html") });
        };
    }

    // Sub-Tab Switching Logic for Grafana
    const subBtns = document.querySelectorAll(".grafana-sub-btn");
    const subContents = document.querySelectorAll(".grafana-sub-content");

    const defaultGrafanaModules = {
        module_grafana_links: true,
        module_grafana_batch: true,
        module_grafana_debug: true
    };

    chrome.storage.sync.get(defaultGrafanaModules, (modules) => {
        const subMapping = {
            "grafana-links": modules.module_grafana_links,
            "grafana-batch": modules.module_grafana_batch,
            "grafana-debug": modules.module_grafana_debug
        };

        let visibleSubCount = 0;
        let firstVisibleSub = null;

        // Показываем/скрываем кнопки подвкладок
        for (const [subId, isVisible] of Object.entries(subMapping)) {
            const subBtn = document.querySelector(`.grafana-sub-btn[data-sub="${subId}"]`);
            if (subBtn) {
                if (isVisible) {
                    subBtn.style.display = "";
                    visibleSubCount++;
                    if (!firstVisibleSub) firstVisibleSub = subId;
                } else {
                    subBtn.style.display = "none";
                }
            }
        }

        const subnav = document.querySelector(".grafana-subnav");
        const fallbackSub = document.getElementById("grafana-no-subtabs");

        if (visibleSubCount === 0) {
            if (subnav) subnav.style.display = "none";
            subContents.forEach(c => c.style.display = "none");
            if (fallbackSub) fallbackSub.style.display = "block";
        } else {
            if (subnav) subnav.style.display = "block";
            if (fallbackSub) fallbackSub.style.display = "none";

            // Скрываем строки поднавигации, если в них нет видимых кнопок
            const rows = document.querySelectorAll(".grafana-subnav .subnav-row");
            rows.forEach(row => {
                const hasVisible = Array.from(row.querySelectorAll(".grafana-sub-btn")).some(btn => btn.style.display !== "none");
                row.style.display = hasVisible ? "flex" : "none";
            });
        }

        const activateSubTab = (target, persist = true) => {
            if (subMapping[target] === false) return;
            const btn = document.querySelector(`.grafana-sub-btn[data-sub="${target}"]`);
            if (!btn) return;
            subBtns.forEach(item => item.classList.remove('active'));
            subContents.forEach(content => { content.style.display = "none"; });
            btn.classList.add('active');
            const targetContent = document.getElementById(target);
            if (targetContent) targetContent.style.display = "block";
            if (persist) {
                chrome.storage.sync.get(["rememberLastSubTab"], (settings) => {
                    if (settings.rememberLastSubTab !== false) {
                        chrome.storage.sync.set({ lastActiveGrafanaSubTab: target });
                    }
                });
            }
        };

        // Переключение подвкладок Grafana
        subBtns.forEach(btn => {
            btn.addEventListener("click", () => activateSubTab(btn.dataset.sub));
        });

        // Восстановление активной подвкладки
        chrome.storage.sync.get(["lastActiveGrafanaSubTab", "rememberLastSubTab"], (data) => {
            const shouldRemSub = data.rememberLastSubTab !== false;
            const requestedSub = new URLSearchParams(location.search).get('guiSub');
            let targetSub = null;

            if (requestedSub && subMapping[requestedSub]) {
                targetSub = requestedSub;
            } else if (shouldRemSub && data.lastActiveGrafanaSubTab && subMapping[data.lastActiveGrafanaSubTab]) {
                targetSub = data.lastActiveGrafanaSubTab;
            } else if (visibleSubCount > 0) {
                targetSub = firstVisibleSub;
            }

            if (targetSub) {
                activateSubTab(targetSub, false);
            }
            if (new URLSearchParams(location.search).has('guiCapture')) {
                setTimeout(() => {
                    const root = document.documentElement;
                    chrome.runtime.sendMessage({
                        type: 'dashbridge-popup-capture-size',
                        width: Math.ceil(Math.max(document.body.scrollWidth, root.scrollWidth) + 16),
                        height: Math.ceil(Math.max(document.body.scrollHeight, root.scrollHeight) + 16)
                    });
                }, 350);
            }
        });
    });
});
