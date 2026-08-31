'use strict';

(() => {
    const INVALID_PANELS_CODE = 'DASHBRIDGE_INVALID_PANELS_ARRAY';
    const PANEL_WIDTHS = new Set(['33%', '50%', '100%']);

    function createPanelExportPayload({ profile, panels, exportedAt = new Date().toISOString() }) {
        return {
            version: 3,
            profileName: profile ? profile.name : 'Default',
            timeState: DashBridgeTimeState.normalize(profile?.timeState),
            report: DashBridgeReport.normalizeProfile(profile?.report),
            exportedAt,
            // JSON serialization owns the actual snapshot; retain the complete
            // forward-compatible panel objects until that serialization step.
            panels,
        };
    }

    function buildPanelExportFileName(profileName, exportedAt = new Date().toISOString()) {
        const safeName = String(profileName || 'panels')
            .replace(/[^a-zа-яё0-9]/giu, '_').toLowerCase();
        return `dashbridge_${safeName}_${String(exportedAt).slice(0, 10)}.json`;
    }

    function invalidPanelsError() {
        const error = new Error('Неверный формат файла: ожидается поле panels[]');
        error.code = INVALID_PANELS_CODE;
        return error;
    }

    function parsePanelImportText(text, {
        fallbackProfileName = '',
        randomUUID = () => crypto.randomUUID(),
    } = {}) {
        const data = JSON.parse(text);
        if (!Array.isArray(data?.panels)) throw invalidPanelsError();

        const profileName = String(data.profileName || String(fallbackProfileName).replace('.json', ''))
            .trim().slice(0, 120) || 'Imported';
        const timeState = DashBridgeTimeState.normalize(data.timeState);
        const report = DashBridgeReport.normalizeProfile(data.report);
        const panels = [];
        const warnings = [];
        const identities = new Set();
        let invalidEntries = 0;
        let duplicatesDropped = 0;

        for (const source of data.panels) {
            if (!source || typeof source !== 'object' || typeof source.src !== 'string'
                || !window.DashBridgePanelUrl.isSupportedPanelUrl(source.src)) {
                invalidEntries += 1;
                continue;
            }

            const height = Number.parseInt(source.height, 10);
            const candidate = {
                ...source,
                id: randomUUID(),
                width: PANEL_WIDTHS.has(source.width) ? source.width : '50%',
                height: Number.isFinite(height) ? `${Math.min(3000, Math.max(180, height))}px` : '350px',
            };
            try {
                const normalized = DashBridgeLocalStateSchema.normalizeProfiles([{
                    id: randomUUID(), name: profileName, panels: [candidate],
                }]).items[0]?.panels[0];
                if (!normalized) {
                    invalidEntries += 1;
                    continue;
                }
                const identity = window.DashBridgePanelUrl.getProfilePanelIdentity(normalized.src);
                if (identity && identities.has(identity)) {
                    duplicatesDropped += 1;
                    continue;
                }
                if (identity) identities.add(identity);
                panels.push(normalized);
            } catch (error) {
                invalidEntries += 1;
                warnings.push(error);
            }
        }

        return {
            version: data.version,
            profileName,
            timeState,
            report,
            panels,
            hasTimeState: !!data.timeState && typeof data.timeState === 'object',
            hasReport: !!data.report && typeof data.report === 'object',
            invalidEntries,
            duplicatesDropped,
            warnings,
        };
    }

    window.DashBridgePanelTransfer = Object.freeze({
        INVALID_PANELS_CODE,
        createPanelExportPayload,
        buildPanelExportFileName,
        parsePanelImportText,
    });
})();
