(function initDashBridgePageUiController(root) {
    'use strict';

    function create({ getCrosshairMode, setCrosshairMode, getCrosshairThickness,
        setCrosshairThickness, hideCrosshair, postToDashboardFrame, getFrames,
        getCapturePrepared, setCapturePrepared, captureAllPanels,
        renderProfileSwitcher, showPrompt, createProfile, renameActiveProfile,
        deleteProfile, getActiveProfile, getActiveProfileId, openReportSettings,
        openReportPreview, openReportTest, setupPanelAddition,
        closeDashboardPickerIfOpen, setupPanelTransfer, closePanelAnalysis,
        closePanelExtraActions, exitFullscreen, documentRef = document,
        storageRef = localStorage }) {
        const required = [
            getCrosshairMode, setCrosshairMode, getCrosshairThickness,
            setCrosshairThickness, hideCrosshair, postToDashboardFrame, getFrames,
            getCapturePrepared, setCapturePrepared, captureAllPanels,
            renderProfileSwitcher, showPrompt, createProfile, renameActiveProfile,
            deleteProfile, getActiveProfile, getActiveProfileId, openReportSettings,
            openReportPreview, openReportTest, setupPanelAddition,
            closeDashboardPickerIfOpen, setupPanelTransfer, closePanelAnalysis,
            closePanelExtraActions, exitFullscreen,
        ];
        if (required.some(value => typeof value !== 'function')) {
            throw new TypeError('DashBridge page UI controller dependencies are incomplete');
        }

        const updateCrosshairControls = () => {
            const toggle = documentRef.getElementById('crosshairToggleCheckbox');
            if (toggle) toggle.checked = getCrosshairMode() === 'line';
            const valueLabel = documentRef.getElementById('crosshairThicknessValue');
            if (valueLabel) valueLabel.textContent = getCrosshairThickness() + 'px';
        };

        const setup = () => {
            documentRef.getElementById('capturePreparedToggleBtn')?.addEventListener('click', () => {
                setCapturePrepared(!getCapturePrepared());
            });
            documentRef.getElementById('captureAllPanelsBtn')?.addEventListener('click', event => {
                void captureAllPanels(event.currentTarget);
            });

            const crosshairMenuButton = documentRef.getElementById('crosshairMenuBtn');
            const crosshairDropdown = documentRef.getElementById('crosshairDropdown');
            const crosshairToggle = documentRef.getElementById('crosshairToggleCheckbox');
            const crosshairSlider = documentRef.getElementById('crosshairThicknessSlider');
            const profileDropdown = documentRef.getElementById('profileDropdown');
            const dataDropdown = documentRef.getElementById('dataDropdown');
            const addPanelDropdown = documentRef.getElementById('addPanelDropdown');
            const reportDropdown = documentRef.getElementById('reportDropdown');

            const closeHeaderMenus = () => {
                if (dataDropdown) dataDropdown.style.display = 'none';
                if (addPanelDropdown) addPanelDropdown.style.display = 'none';
                if (reportDropdown) reportDropdown.style.display = 'none';
                if (crosshairDropdown) crosshairDropdown.style.display = 'none';
                documentRef.getElementById('dataMenuBtn')?.setAttribute('aria-expanded', 'false');
                documentRef.getElementById('addPanelMenuBtn')?.setAttribute('aria-expanded', 'false');
                documentRef.getElementById('reportMenuBtn')?.setAttribute('aria-expanded', 'false');
                crosshairMenuButton?.setAttribute('aria-expanded', 'false');
            };

            crosshairMenuButton?.addEventListener('click', event => {
                event.stopPropagation();
                const isShowing = crosshairDropdown.style.display === 'flex';
                closeHeaderMenus();
                crosshairDropdown.style.display = isShowing ? 'none' : 'flex';
                crosshairMenuButton.setAttribute('aria-expanded', !isShowing);
            });
            crosshairDropdown?.addEventListener('click', event => event.stopPropagation());
            crosshairToggle?.addEventListener('change', event => {
                const mode = event.target.checked ? 'line' : 'off';
                setCrosshairMode(mode);
                try { storageRef.setItem('dashbridge_crosshairMode', mode); } catch { /* optional storage */ }
                if (mode === 'off') hideCrosshair();
                getFrames().forEach(iframe => {
                    postToDashboardFrame(iframe, {
                        action: 'setCrosshairMode',
                        mode,
                        thickness: getCrosshairThickness(),
                    });
                });
            });
            crosshairSlider?.addEventListener('input', event => {
                const thickness = parseInt(event.target.value, 10) || 1;
                setCrosshairThickness(thickness);
                const label = documentRef.getElementById('crosshairThicknessValue');
                if (label) label.textContent = thickness + 'px';
                try { storageRef.setItem('dashbridge_crosshairThickness', thickness); } catch { /* optional storage */ }
                getFrames().forEach(iframe => {
                    postToDashboardFrame(iframe, { action: 'setCrosshairThickness', thickness });
                });
            });

            documentRef.getElementById('profilePickerBtn').addEventListener('click', event => {
                event.stopPropagation();
                const isShowing = profileDropdown.style.display === 'flex';
                profileDropdown.style.display = isShowing ? 'none' : 'flex';
                documentRef.getElementById('timePopover').style.display = 'none';
                documentRef.getElementById('refreshPopover').style.display = 'none';
                closeHeaderMenus();
                if (!isShowing) renderProfileSwitcher();
            });
            profileDropdown.addEventListener('click', event => event.stopPropagation());

            const toggleHeaderMenu = (button, dropdown) => {
                const isShowing = dropdown.style.display === 'block';
                closeHeaderMenus();
                profileDropdown.style.display = 'none';
                documentRef.getElementById('timePopover').style.display = 'none';
                documentRef.getElementById('refreshPopover').style.display = 'none';
                if (!isShowing) {
                    dropdown.style.display = 'block';
                    button.setAttribute('aria-expanded', 'true');
                }
            };
            documentRef.getElementById('dataMenuBtn').addEventListener('click', event => {
                event.stopPropagation();
                toggleHeaderMenu(event.currentTarget, dataDropdown);
            });
            documentRef.getElementById('addPanelMenuBtn').addEventListener('click', event => {
                event.stopPropagation();
                toggleHeaderMenu(event.currentTarget, addPanelDropdown);
            });
            documentRef.getElementById('reportMenuBtn').addEventListener('click', event => {
                event.stopPropagation();
                toggleHeaderMenu(event.currentTarget, reportDropdown);
            });
            dataDropdown.addEventListener('click', event => event.stopPropagation());
            addPanelDropdown.addEventListener('click', event => event.stopPropagation());
            reportDropdown.addEventListener('click', event => event.stopPropagation());
            documentRef.getElementById('configureReportBtn').addEventListener('click', () => {
                closeHeaderMenus();
                openReportSettings();
            });
            documentRef.getElementById('generateReportBtn').addEventListener('click', () => {
                closeHeaderMenus();
                openReportPreview();
            });
            documentRef.getElementById('testReportBtn').addEventListener('click', () => {
                closeHeaderMenus();
                openReportTest();
            });

            documentRef.getElementById('newProfileBtn').addEventListener('click', async () => {
                const name = await showPrompt('Название нового профиля:');
                if (name?.trim()) createProfile(name.trim());
            });
            documentRef.getElementById('renameProfileBtn').addEventListener('click', async () => {
                const profile = getActiveProfile();
                if (!profile) return;
                const name = await showPrompt('Переименовать профиль:', profile.name);
                if (name?.trim() && name.trim() !== profile.name) renameActiveProfile(name.trim());
            });
            documentRef.getElementById('deleteProfileBtn').addEventListener('click', () => {
                deleteProfile(getActiveProfileId());
            });

            setupPanelAddition();
            setupPanelTransfer();

            documentRef.addEventListener('keydown', event => {
                if (event.key !== 'Escape') return;
                closeDashboardPickerIfOpen();
                closePanelAnalysis();
                closePanelExtraActions();
                exitFullscreen();
            });
            documentRef.addEventListener('click', () => {
                profileDropdown.style.display = 'none';
                closeHeaderMenus();
                const timePopover = documentRef.getElementById('timePopover');
                const refreshPopover = documentRef.getElementById('refreshPopover');
                if (timePopover) timePopover.style.display = 'none';
                if (refreshPopover) refreshPopover.style.display = 'none';
                closePanelExtraActions();
            });
        };

        return Object.freeze({ setup, updateCrosshairControls });
    }

    root.DashBridgePageUiController = Object.freeze({ create });
})(globalThis);
