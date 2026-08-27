"""Static contracts for saving a native Grafana panel into a DashBridge profile."""
from support.smoke import read, run_checks


if __name__ == "__main__":
    tools = read("js/content/grafana-panel-tools.js")
    content = read("js/content/content.js")
    background = read("js/background.js")
    identity = read("js/shared/grafana-panel-identity.js")
    checks = {
        "native Grafana exposes the save action":
            "dashbridge-panel-save-action" in tools
            and "Сохранить в DashBridge" in tools
            and "dashbridgeSavePanelRequest" in tools,
        "embedded DashBridge panels do not offer recursive saving":
            "if (!isDashboardIframe) host.append(saveToDashBridge)" in tools,
        "profile picker supports existing and new profiles":
            "dashbridge-profile-save-select" in content
            and "＋ Добавить профиль" in content
            and "selectedProfileId === '__new__'" in content
            and "dashbridge-save-grafana-panel" in content,
        "profile names are rendered as text":
            "option.textContent = alreadySaved" in content
            and "dashbridge-profile-save-overlay" in content,
        "background serializes profile mutations":
            "function queueGrafanaPanelSave" in background
            and "storageCommitQueue = storageCommitQueue.catch" in background,
        "background validates the Grafana sender and panel id":
            "sender.frameId !== 0" in background
            and "allowedHosts.some" in background
            and "!/^\\d+$/.test" in background,
        "saved panels use DashBridge solo URLs":
            "normalizeSavedGrafanaPanelUrl" in background
            and "DashBridgeGrafanaPanelIdentity.normalizePanelId(panelId)" in background
            and "url.searchParams.set('dashbridge', '1')" in background,
        "duplicate panels are not appended twice":
            "grafanaPanelIdentity" in background
            and "const duplicate = profile.panels.some" in background
            and "if (!duplicate) profile.panels.push" in background,
        "profiles containing the panel are labelled and disabled":
            "grafanaPanelProfileIdentity" in content
            and "(уже есть в этом профиле)" in content
            and "option.disabled = alreadySaved" in content
            and "firstAvailableProfileId" in content,
        "native dropdown keeps compact system-compatible corners":
            "dashbridge-profile-save-select" in content
            and "border-radius:6px" in content
            and "dashbridge-profile-save-combobox" not in content,
        "empty save status does not reserve vertical space":
            ".dashbridge-profile-save-status:empty{display:none}" in content,
        "legacy dashboard and solo panel URLs share one identity":
            "url.searchParams.get('panelId') || url.searchParams.get('viewPanel')" in identity
            and "part === 'd' || part === 'd-solo'" in identity
            and "replace(/^panel-/i, '')" in identity,
        "save dialog follows the shared DashBridge theme":
            "chrome.storage.sync.get('globalTheme')" in content
            and "changes.globalTheme" in content
            and "data-dashbridge-theme=\"dark\"" in content
            and "--db-primary:#2563eb" in content
            and "border-radius:12px" in content,
        "save dialog has no independent theme toggle":
            "dashbridge-profile-save-theme-toggle" not in content,
    }
    run_checks(checks)
