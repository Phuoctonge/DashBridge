(function() {
    let IFRAME_IDS = ["wysiwygTextarea_ifr", "mce_0_ifr"];
    window.__confluenceFixActive = false;
    let confluenceObserver = null;
    const _origFocus = HTMLElement.prototype.focus;

    // Keep the proven cross-Wiki focus interception, but never mutate an
    // options object owned and potentially reused by Confluence.
    if (!HTMLElement.prototype.__fixApplied) {
        HTMLElement.prototype.focus = function(options) {
            const nextOptions = window.__confluenceFixActive
                ? { ...(options && typeof options === "object" ? options : {}), preventScroll: true }
                : options;
            return _origFocus.call(this, nextOptions);
        };
        HTMLElement.prototype.__fixApplied = true;
    }

    const applyToIframe = (ifr) => {
        try {
            const doc = ifr.contentDocument;
            const win = ifr.contentWindow;
            if (!doc || !win) return;

            // Preserve the legacy iframe patch used by all supported Wikis.
            if (!win.__confluenceFocusFixed) {
                win.HTMLElement.prototype.focus = function(options) {
                    const nextOptions = window.__confluenceFixActive
                        ? { ...(options && typeof options === "object" ? options : {}), preventScroll: true }
                        : options;
                    return _origFocus.call(this, nextOptions);
                };
                win.__confluenceFocusFixed = true;
            }

            let style = doc.getElementById("scroll-fix-style");
            if (window.__confluenceFixActive) {
                if (!style) {
                    style = doc.createElement("style");
                    style.id = "scroll-fix-style";
                    style.textContent = "body#tinymce { overflow-anchor: none !important; scroll-behavior: auto !important; height: auto !important; }";
                    doc.head.appendChild(style);
                }
            } else if (style) {
                style.remove();
            }
        } catch (error) {
            // Ignore inaccessible or detached editor iframes.
        }
    };

    const updateAll = () => {
        IFRAME_IDS.forEach((id) => {
            const ifr = document.getElementById(id);
            if (ifr) applyToIframe(ifr);
        });
    };

    const stopObserver = () => {
        if (confluenceObserver) {
            confluenceObserver.disconnect();
            confluenceObserver = null;
        }
    };

    const startObserver = () => {
        if (confluenceObserver) return;
        confluenceObserver = new MutationObserver(() => {
            if (window.__confluenceFixActive) updateAll();
        });
        confluenceObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window) return;
        if (event.data && event.data.type === "SET_CONFLUENCE_FIX") {
            window.__confluenceFixActive = !!event.data.value;
            if (Array.isArray(event.data.iframeIds)) {
                IFRAME_IDS = event.data.iframeIds;
            }
            if (window.__confluenceFixActive) startObserver();
            else stopObserver();
            updateAll();
        }
    });

    window.postMessage({ type: "INJECT_READY" }, window.location.origin);
})();
