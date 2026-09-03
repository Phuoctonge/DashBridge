(function initDashBridgePanelTransferController(root) {
    'use strict';

    function create({ transfer, showAlert, showConfirm, getPanels, setPanels, getProfiles,
        getActiveProfile, setTabActiveProfileId, savePanels, saveProfiles,
        loadActiveProfileTimeState, syncTimeControlsFromState, renderProfileSwitcher,
        renderDashboard, documentRef = document, fileReaderFactory = () => new FileReader(),
        blobFactory = (parts, options) => new Blob(parts, options), urlApi = URL,
        randomUUID = () => crypto.randomUUID(), now = () => new Date() }) {
        if (!transfer?.createPanelExportPayload || !transfer?.buildPanelExportFileName
            || !transfer?.parsePanelImportText || typeof showAlert !== 'function'
            || typeof showConfirm !== 'function' || typeof getPanels !== 'function'
            || typeof setPanels !== 'function' || typeof getProfiles !== 'function'
            || typeof getActiveProfile !== 'function' || typeof setTabActiveProfileId !== 'function'
            || typeof savePanels !== 'function' || typeof saveProfiles !== 'function'
            || typeof loadActiveProfileTimeState !== 'function'
            || typeof syncTimeControlsFromState !== 'function'
            || typeof renderProfileSwitcher !== 'function' || typeof renderDashboard !== 'function') {
            throw new TypeError('DashBridge panel transfer controller dependencies are incomplete');
        }

        const exportPanels = async () => {
            const panels = getPanels();
            if (panels.length === 0) {
                await showAlert('Нет панелей для экспорта.');
                root.DashBridgeAnalytics?.outcome('dashbridge.profile_exported', 'no_data');
                return;
            }
            const profile = getActiveProfile();
            const exportedAt = now().toISOString();
            const data = transfer.createPanelExportPayload({ profile, panels, exportedAt });
            const blob = blobFactory([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = urlApi.createObjectURL(blob);
            const anchor = documentRef.createElement('a');
            anchor.href = url;
            anchor.download = transfer.buildPanelExportFileName(profile?.name, exportedAt);
            documentRef.body.appendChild(anchor);
            anchor.click();
            documentRef.body.removeChild(anchor);
            urlApi.revokeObjectURL(url);
            root.DashBridgeAnalytics?.outcome('dashbridge.profile_exported', 'success', {
                countBucket: root.DashBridgeAnalytics.bucket(panels.length)
            });
        };

        const importPanels = async file => {
            const reader = fileReaderFactory();
            reader.onload = async event => {
                try {
                    const imported = transfer.parsePanelImportText(event.target.result, {
                        fallbackProfileName: file.name,
                        randomUUID,
                    });
                    imported.warnings.forEach(error => {
                        console.warn('Пропущена некорректная импортируемая панель:', error);
                    });
                    const {
                        profileName,
                        timeState: importedTimeState,
                        report: importedReport,
                        panels: importedPanels,
                    } = imported;
                    if (importedPanels.length === 0) {
                        await showAlert('В файле нет панелей с корректными настройками и URL.');
                        root.DashBridgeAnalytics?.outcome('dashbridge.profile_imported', 'no_data');
                        return;
                    }
                    const choice = await showConfirm(
                        `Файл содержит ${importedPanels.length} панел(и).\n\n`
                        + '[OK] — Заменить панели текущего профиля\n'
                        + `[Отмена] — Создать новый профиль «${profileName}»`
                    );
                    if (choice) {
                        setPanels(importedPanels);
                        const activeProfile = getActiveProfile();
                        if (activeProfile && imported.hasTimeState) {
                            activeProfile.timeState = importedTimeState;
                            loadActiveProfileTimeState();
                            syncTimeControlsFromState();
                        }
                        if (activeProfile && imported.hasReport) activeProfile.report = importedReport;
                        savePanels();
                        renderDashboard();
                    } else {
                        const newProfile = {
                            id: randomUUID(), name: profileName, panels: importedPanels,
                            timeState: importedTimeState, report: importedReport
                        };
                        const currentProfile = getActiveProfile();
                        if (currentProfile) currentProfile.panels = getPanels();
                        getProfiles().push(newProfile);
                        setTabActiveProfileId(newProfile.id);
                        setPanels(importedPanels);
                        loadActiveProfileTimeState();
                        await saveProfiles();
                        renderProfileSwitcher();
                        syncTimeControlsFromState();
                        renderDashboard();
                    }
                    root.DashBridgeAnalytics?.outcome('dashbridge.profile_imported', 'success', {
                        countBucket: root.DashBridgeAnalytics.bucket(importedPanels.length)
                    });
                } catch (error) {
                    if (error?.code === transfer.INVALID_PANELS_CODE) {
                        await showAlert(error.message);
                        root.DashBridgeAnalytics?.outcome('dashbridge.profile_imported', 'invalid_input');
                        return;
                    }
                    await showAlert('Ошибка чтения файла: ' + error.message);
                    root.DashBridgeAnalytics?.outcome('dashbridge.profile_imported', 'error');
                }
            };
            reader.readAsText(file);
        };

        const setup = () => {
            documentRef.getElementById('exportPanelsBtn').addEventListener('click', exportPanels);
            const importInput = documentRef.getElementById('importPanelsInput');
            documentRef.getElementById('importPanelsBtn').addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', event => {
                const file = event.target.files[0];
                if (file) importPanels(file);
                importInput.value = '';
            });
        };

        return Object.freeze({ exportPanels, importPanels, setup });
    }

    root.DashBridgePanelTransferController = Object.freeze({ create });
})(globalThis);
