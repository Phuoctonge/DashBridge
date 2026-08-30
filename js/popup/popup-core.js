document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelectorAll(".tab-btn");
    const contents = document.querySelectorAll(".tab-content");
    const reportGuiCaptureSize = () => {
        if (!new URLSearchParams(location.search).has('guiCapture')) return;
        setTimeout(() => {
            const root = document.documentElement;
            chrome.runtime.sendMessage({
                type: 'dashbridge-popup-capture-size',
                width: Math.ceil(Math.max(document.body.scrollWidth, root.scrollWidth) + 16),
                height: Math.ceil(Math.max(document.body.scrollHeight, root.scrollHeight) + 16)
            });
        }, 250);
    };

    // Загружаем состояния модулей
    const defaultModules = {
        module_grafana: true,
        module_recorder: true,
        module_jira: true,
        module_tdm: true
    };

    chrome.storage.sync.get(defaultModules, (modules) => {
        const mapping = {
            "tab-grafana": modules.module_grafana,
            "tab-recorder": modules.module_recorder,
            "tab-jira": modules.module_jira,
            "tab-tdm": modules.module_tdm
        };

        let visibleCount = 0;
        let firstVisibleTab = null;

        // Показываем/скрываем кнопки вкладок
        for (const [tabId, isVisible] of Object.entries(mapping)) {
            const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabBtn) {
                if (isVisible) {
                    tabBtn.style.display = "";
                    visibleCount++;
                    if (!firstVisibleTab) firstVisibleTab = tabId;
                } else {
                    tabBtn.style.display = "none";
                }
            }
        }

        const tabsNav = document.querySelector(".tabs-nav");
        const fallbackTab = document.getElementById("tab-no-modules");

        if (visibleCount === 0) {
            if (tabsNav) tabsNav.style.display = "none";
            contents.forEach(c => c.classList.remove("active"));
            if (fallbackTab) fallbackTab.classList.add("active");
        } else {
            if (tabsNav) tabsNav.style.display = "flex";
            if (fallbackTab) fallbackTab.classList.remove("active");
        }

        const activateTab = (target, persist = true) => {
            if (mapping[target] === false) return;
            const tab = document.querySelector(`.tab-btn[data-tab="${target}"]`);
            if (!tab) return;
            tabs.forEach(item => item.classList.remove("active"));
            contents.forEach(content => content.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(target)?.classList.add("active");
            if (persist) {
                document.querySelectorAll('[id$="Status"], [role="status"]').forEach(el => {
                    el.style.display = "none";
                    el.textContent = "";
                });
                chrome.storage.sync.get(["rememberLastTab"], (settings) => {
                    if (settings.rememberLastTab !== false) {
                        chrome.storage.sync.set({ lastActiveTab: target });
                    }
                });
            }
        };

        // Переключение вкладок по клику
        tabs.forEach(tab => {
            tab.addEventListener("click", () => activateTab(tab.dataset.tab));
        });

        // Восстановление активной вкладки
        chrome.storage.sync.get(["lastActiveTab", "rememberLastTab"], (data) => {
            const shouldRemTab = data.rememberLastTab !== false;
            const requestedTab = new URLSearchParams(location.search).get('guiTab');
            let targetTab = null;

            if (requestedTab && mapping[requestedTab]) {
                targetTab = requestedTab;
            } else if (shouldRemTab && data.lastActiveTab && mapping[data.lastActiveTab]) {
                targetTab = data.lastActiveTab;
            } else if (visibleCount > 0) {
                targetTab = firstVisibleTab;
            }

            if (targetTab) {
                activateTab(targetTab, false);
            }
            reportGuiCaptureSize();
        });
    });

    const openSettingsBtn = document.getElementById("openSettingsBtn");
    if (openSettingsBtn) {
        openSettingsBtn.onclick = openOptions;
    }

    const openSettingsFallbackBtn = document.getElementById("openSettingsFallbackBtn");
    if (openSettingsFallbackBtn) {
        openSettingsFallbackBtn.onclick = openOptions;
    }

    const recorderButton = document.getElementById("openTrafficRecorderBtn");
    if (recorderButton) {
        recorderButton.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("html/recorder.html") });
    }

    function openOptions() {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('pages/options/options.html'));
        }
    }
});
