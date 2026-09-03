/* global DashBridgeAnalytics */
// === Grafana Links / Dashboards Module ===

document.addEventListener("DOMContentLoaded", () => {
    if (typeof renderButtons === 'function') renderButtons();
    setupGrafanaTimestampTool();
    const modal = document.getElementById("modalOverlay");
    const openModalBtn = document.getElementById("openAddModal");
    const closeModalBtn = document.getElementById("closeModal");
    const saveBtn = document.getElementById("saveBtn");

    openModalBtn.onclick = () => {
        resetForm();
        modal.style.display = "flex";
    };
    closeModalBtn.onclick = () => modal.style.display = "none";
    window.addEventListener("click", (event) => {
        if (event.target == modal) modal.style.display = "none";
    });

    saveBtn.onclick = () => {
        const name = document.getElementById("newBtnName").value.trim();
        const url = document.getElementById("newBtnUrl").value.trim();
        const editId = document.getElementById("editBtnId").value;
        if (!name || !url) {
            alert("Пожалуйста, заполните все поля");
            return;
        }
        chrome.storage.sync.get(["customButtons"], (data) => {
            let buttons = normalizedCustomButtons(data.customButtons);
            if (editId) {
                buttons = buttons.map(b => b.id == editId ? { ...b, name, url } : b);
            } else {
                buttons.push({ id: Date.now(), name, url });
            }
            try { buttons = DashBridgeLocalStateSchema.normalizeCustomButtons(buttons).items; }
            catch (error) { alert(error.message); return; }
            chrome.storage.sync.set({ customButtons: buttons }, () => {
                if (chrome.runtime.lastError) { alert(`Не удалось сохранить ссылку: ${chrome.runtime.lastError.message}`); return; }
                DashBridgeAnalytics?.outcome(editId ? 'popup.grafana_link_edited' : 'popup.grafana_link_created', 'success');
                modal.style.display = "none";
                renderButtons();
            });
        });
    };
});

function setupGrafanaTimestampTool() {
    const storageKey = 'grafanaTimestampRange';
    const storageTtlMs = 3 * 60 * 1000;
    const timestampStorage = chrome.storage.session || chrome.storage.local;
    const readButton = document.getElementById('grafanaTimestampReadBtn');
    const result = document.getElementById('grafanaTimestampResult');
    const fromOutput = document.getElementById('grafanaTimestampFrom');
    const toOutput = document.getElementById('grafanaTimestampTo');
    const status = document.getElementById('grafanaTimestampStatus');
    if (!readButton || !result || !fromOutput || !toOutput || !status) return;
    let rangeRevision = 0;

    const showStatus = (message, isError = false) => {
        status.textContent = message;
        status.classList.toggle('error', isError);
    };
    const showRange = (range, message) => {
        fromOutput.textContent = String(range.from);
        toOutput.textContent = String(range.to);
        result.hidden = false;
        showStatus(message);
    };
    const restoreRevision = rangeRevision;
    timestampStorage.get([storageKey], data => {
        if (rangeRevision !== restoreRevision) return;
        const saved = data?.[storageKey];
        const from = Number(saved?.from);
        const to = Number(saved?.to);
        const savedAt = Number(saved?.savedAt);
        const age = Date.now() - savedAt;
        const isFresh = Number.isFinite(savedAt) && age >= 0 && age <= storageTtlMs;
        if (Number.isFinite(from) && Number.isFinite(to) && to >= from && isFresh) {
            showRange({ from, to }, 'Восстановлен последний диапазон этой сессии.');
        } else if (saved) {
            timestampStorage.remove(storageKey);
        }
    });
    readButton.addEventListener('click', async () => {
        rangeRevision += 1;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const range = parseGrafanaUrlTimeRange(tab?.url || '');
        if (!range) {
            const retained = !!fromOutput.textContent && !!toOutput.textContent;
            result.hidden = !retained;
            showStatus(`В URL нет фиксированного диапазона from/to.${retained ? ' Последние значения сохранены.' : ' Выберите в Grafana абсолютное время.'}`, true);
            return;
        }
        timestampStorage.set({ [storageKey]: { ...range, savedAt: Date.now() } });
        DashBridgeAnalytics?.outcome('popup.grafana_time_read', 'success');
        showRange(range, 'Готово. Нажмите на нужное значение, чтобы скопировать.');
    });
    result.addEventListener('click', async event => {
        const button = event.target.closest('[data-timestamp-copy]');
        if (!button) return;
        const output = button.dataset.timestampCopy === 'from' ? fromOutput : toOutput;
        if (!output.textContent) return;
        try {
            await navigator.clipboard.writeText(output.textContent);
            DashBridgeAnalytics?.outcome('popup.grafana_time_copied', 'success');
            showStatus(`${button.dataset.timestampCopy === 'from' ? 'Начало' : 'Конец'} скопировано.`);
        } catch {
            showStatus('Не удалось скопировать значение.', true);
        }
    });
}

// Статические SVG-иконки (без пользовательских данных, безопасны для innerHTML)
const EDIT_ICON_SVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const DELETE_ICON_SVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ef4444;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

function normalizedCustomButtons(value) {
    if (value === undefined) return getDefaultButtons();
    return DashBridgeLocalStateSchema.normalizeCustomButtons(value, { mode: 'load' }).items;
}

function renderButtons() {
    const container = document.getElementById("customButtonsContainer");
    chrome.storage.sync.get(["customButtons"], (data) => {
        const buttons = normalizedCustomButtons(data.customButtons);
        container.innerHTML = "";

        buttons.forEach(btn => {
            const div = document.createElement("div");
            div.className = "button-row";

            // Кнопка-ссылка: используем textContent и dataset (защита от XSS)
            const linkBtn = document.createElement("button");
            linkBtn.className = "grafana-link-btn";
            linkBtn.dataset.url = btn.url;
            linkBtn.textContent = btn.name;
            linkBtn.addEventListener("click", () => openGrafana(btn.url));

            // Кнопка редактирования: статическая SVG-иконка безопасна
            const editBtn = document.createElement("button");
            editBtn.className = "btn-icon btn-edit";
            editBtn.dataset.id = btn.id;
            editBtn.title = "Редактировать";
            editBtn.innerHTML = EDIT_ICON_SVG;
            editBtn.addEventListener("click", () => editButton(btn.id));

            // Кнопка удаления: статическая SVG-иконка безопасна
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "btn-icon btn-delete";
            deleteBtn.dataset.id = btn.id;
            deleteBtn.title = "Удалить";
            deleteBtn.innerHTML = DELETE_ICON_SVG;
            deleteBtn.addEventListener("click", () => deleteButton(btn.id));

            div.appendChild(linkBtn);
            div.appendChild(editBtn);
            div.appendChild(deleteBtn);
            container.appendChild(div);
        });
    });
}

function openGrafana(baseUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) return;
        const currentTab = tabs[0];
        if (!currentTab || !currentTab.url) return;

        chrome.storage.sync.get(["grafanaKeepParams"], (data) => {
            const keepStr = data.grafanaKeepParams || "from, to, var-project";
            const keepList = keepStr.split(",").map(p => p.trim()).filter(p => p);

            try {
                const url = new URL(baseUrl);
                if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                    throw new Error('Unsupported URL protocol');
                }
                const current = new URL(currentTab.url);

                keepList.forEach(p => {
                    const val = current.searchParams.get(p);
                    if (val) url.searchParams.set(p, val);
                });

                chrome.tabs.update(currentTab.id, { url: url.toString() });
                DashBridgeAnalytics?.opened('popup.grafana_link_opened');
                window.close();
            } catch (e) {
                console.error('Invalid Grafana URL', e);
            }
        });
    });
}

function getDefaultButtons() {
    return [
        { id: 1, name: "Основной", url: "https://grafanakns.mos.ru/d/d78c98f6dd89/monitoring-jmeter-mirsky?orgId=1&refresh=10s&var-station=All" },
        { id: 2, name: "Заказчик", url: "https://grafanakns.mos.ru/d/CQ866X77kN/monitoring-jmeter?orgId=11&refresh=10s&var-station=All" }
    ];
}

function editButton(id) {
    chrome.storage.sync.get(["customButtons"], (data) => {
        const buttons = normalizedCustomButtons(data.customButtons);
        const btn = buttons.find(b => b.id == id);
        if (btn) {
            document.getElementById("newBtnName").value = btn.name;
            document.getElementById("newBtnUrl").value = btn.url;
            document.getElementById("editBtnId").value = btn.id;
            document.getElementById("modalTitle").textContent = "Редактировать";
            document.getElementById("modalOverlay").style.display = "flex";
        }
    });
}

function deleteButton(id) {
    if (!confirm("Удалить эту ссылку?")) return;
    chrome.storage.sync.get(["customButtons"], (data) => {
        let buttons = normalizedCustomButtons(data.customButtons);
        buttons = buttons.filter(b => b.id != id);
        chrome.storage.sync.set({ customButtons: buttons }, renderButtons);
        DashBridgeAnalytics?.opened('popup.grafana_link_deleted');
    });
}

function resetForm() {
    document.getElementById("newBtnName").value = "";
    document.getElementById("newBtnUrl").value = "";
    document.getElementById("editBtnId").value = "";
    document.getElementById("modalTitle").textContent = "Новый дашборд";
}
