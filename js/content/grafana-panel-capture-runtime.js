(() => {
    'use strict';

    const create = context => {
        const {
            isDashboardIframe, extensionOrigin, tools, panelVisualState,
            getPanelStateKey, registerRuntimeCleanup, syncThresholdHighlightState
        } = context;

        let panelCaptureInProgress = false;
        let captureNoticeTimer = null;
        const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const removeCaptureNotice = () => {
            if (captureNoticeTimer) clearTimeout(captureNoticeTimer);
            captureNoticeTimer = null;
            document.getElementById('dashbridge-panel-capture-notice')?.remove();
        };
        const showCaptureNotice = message => {
            removeCaptureNotice();
            if (!document.getElementById('dashbridge-panel-capture-notice-style')) {
                const style = document.createElement('style');
                style.id = 'dashbridge-panel-capture-notice-style';
                style.textContent = `
                    #dashbridge-panel-capture-notice{position:fixed;left:50%;bottom:24px;z-index:2147483647;width:min(480px,calc(100vw - 32px));display:flex;align-items:center;gap:10px;box-sizing:border-box;transform:translateX(-50%);padding:12px 42px 12px 14px;border:1px solid #4b5563;border-radius:10px;background:#1f2937;color:#f9fafb;box-shadow:0 12px 32px rgba(0,0,0,.32);font:500 14px/1.4 system-ui,sans-serif;animation:dashbridge-capture-notice-in .16s ease-out}
                    #dashbridge-panel-capture-notice .dashbridge-panel-capture-notice-icon{color:#34d399;font-size:18px;font-weight:800}
                    #dashbridge-panel-capture-notice .dashbridge-panel-capture-notice-close{position:absolute;top:5px;right:7px;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:#d1d5db;cursor:pointer;font:22px/1 system-ui,sans-serif}
                    #dashbridge-panel-capture-notice .dashbridge-panel-capture-notice-close:hover{background:rgba(255,255,255,.12);color:#fff}
                    #dashbridge-panel-capture-notice .dashbridge-panel-capture-notice-close:focus-visible{outline:2px solid #93c5fd;outline-offset:1px}
                    @keyframes dashbridge-capture-notice-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
                    @media(prefers-reduced-motion:reduce){#dashbridge-panel-capture-notice{animation:none}}
                `;
                document.documentElement.appendChild(style);
            }
            const notice = document.createElement('div');
            notice.id = 'dashbridge-panel-capture-notice';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-atomic', 'true');
            const icon = document.createElement('span');
            icon.className = 'dashbridge-panel-capture-notice-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '✓';
            const text = document.createElement('span');
            text.textContent = String(message || 'Файл сохранён.');
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'dashbridge-panel-capture-notice-close';
            close.setAttribute('aria-label', 'Закрыть уведомление');
            close.textContent = '×';
            close.addEventListener('click', removeCaptureNotice, { once: true });
            notice.append(icon, text, close);
            document.body.appendChild(notice);
            captureNoticeTimer = setTimeout(removeCaptureNotice, 5000);
        };
        registerRuntimeCleanup(() => {
            removeCaptureNotice();
            document.getElementById('dashbridge-panel-capture-notice-style')?.remove();
        });
        const fitPanelCaptureSize = options => {
            const sharedFit = window.DashBridgeGrafanaCaptureOutput?.fitPreparedSize;
            if (typeof sharedFit === 'function') return sharedFit(options);
            const margin = Number(options?.margin) || 12;
            const outputWidth = Math.max(1, Number(options?.outputWidth) || 1000);
            const outputHeight = Math.max(1, Number(options?.outputHeight) || 520);
            const viewportWidth = Math.max(1, Number(options?.viewportWidth) || window.innerWidth);
            const viewportHeight = Math.max(1, Number(options?.viewportHeight) || window.innerHeight);
            const availableWidth = Math.max(1, viewportWidth - margin * 2);
            const availableHeight = Math.max(1, viewportHeight - margin * 2);
            const scale = Math.min(1, availableWidth / outputWidth, availableHeight / outputHeight);
            const width = outputWidth * scale;
            const height = outputHeight * scale;
            return {
                width: Math.max(1, Math.round(width)),
                height: Math.max(1, Math.round(height)),
                left: Math.max(margin, Math.round((viewportWidth - width) / 2)),
                top: Math.max(margin, Math.round((viewportHeight - height) / 2))
            };
        };
        const defaultPanelCapturePrepared = () => {
            const datasetValue = document.documentElement.dataset.dashbridgeCapturePrepared;
            if (datasetValue === 'true' || datasetValue === 'false') return datasetValue === 'true';
            return isDashboardIframe && typeof tools.capturePrepared === 'boolean' ? tools.capturePrepared : false;
        };
        const panelCaptureDimensions = () => ({
            width: Math.max(100, Number(document.documentElement.dataset.dashbridgeCaptureWidth) || 1000),
            height: Math.max(100, Number(document.documentElement.dataset.dashbridgeCaptureHeight) || 520)
        });
        const readPanelCaptureState = panel => {
            // Batch applies transform settings through the MAIN command bridge
            // and keeps them in the document-level tools state. Direct Grafana
            // capture does not always populate panelVisualState, so falling
            // back to an empty object would disable response-filter highlights
            // while the panel is being moved into the temporary capture frame.
            const state = panelVisualState?.get(panel) || panel.__dashbridgeVisualState || tools || {};
            return { ...state, capturePrepared: defaultPanelCapturePrepared() };
        };
        const syncPanelCaptureToggle = (button, enabled) => {
            if (!button) return;
            button.classList.toggle('dashbridge-panel-capture-toggle-active', enabled);
            button.setAttribute('aria-pressed', String(enabled));
            const dimensions = panelCaptureDimensions();
            button.title = enabled
                ? `Компактный снимок ${dimensions.width}×${dimensions.height}: включён`
                : `Компактный снимок ${dimensions.width}×${dimensions.height}: выключен`;
            button.setAttribute('aria-label', button.title);
        };
        const syncAllPanelCaptureToggles = enabled => document
            .querySelectorAll('.dashbridge-panel-capture-toggle')
            .forEach(button => syncPanelCaptureToggle(button, enabled));
        const setPanelCapturePrepared = (panel, enabled) => {
            const value = !!enabled;
            const nextState = { ...readPanelCaptureState(panel), capturePrepared: value };
            panel.__dashbridgeVisualState = nextState;
            panelVisualState?.set(panel, nextState);
            tools.capturePrepared = value;
            document.documentElement.dataset.dashbridgeCapturePrepared = String(value);
            syncAllPanelCaptureToggles(value);
            if (isDashboardIframe) {
                window.parent.postMessage({
                    action: 'dashbridgeCapturePreparedChanged',
                    panelId: getPanelStateKey(panel),
                    enabled: value
                }, extensionOrigin);
            } else {
                document.dispatchEvent(new CustomEvent('dashbridgeCapturePreparedSettingChanged', {
                    detail: { enabled: value }
                }));
            }
            return value;
        };
        const onCaptureDefaultChanged = event => {
            if (typeof event.detail?.enabled !== 'boolean') return;
            tools.capturePrepared = event.detail.enabled;
            syncAllPanelCaptureToggles(event.detail.enabled);
        };
        document.addEventListener('dashbridgeGrafanaCaptureDefaultChanged', onCaptureDefaultChanged);
        registerRuntimeCleanup(() => document.removeEventListener('dashbridgeGrafanaCaptureDefaultChanged', onCaptureDefaultChanged));
        const panelCaptureTitleSelector = '[data-testid="panel title"], .panel-title-text, .panel-title, h6[title], h2';
        const getPanelCaptureTitle = panel => panel.querySelector(panelCaptureTitleSelector)?.textContent?.trim() || 'Panel';
        const createCompactCaptureLegendBackgroundController = root => {
            const getRows = () => {
                const candidates = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(root) || []);
                if (!candidates.length) candidates.push(...Array.from(root?.querySelectorAll?.(
                    '.graph-legend-series, .u-legend tbody tr, tbody tr[class*="LegendRow"]'
                ) || []));
                const rows = candidates.map(candidate => candidate.closest?.(
                    '.graph-legend-series, tr, [class*="LegendRow"]'
                ) || candidate);
                return [...new Set(rows)];
            };
            const isOpaque = value => value && value !== 'transparent'
                && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(value);
            const parseRgb = value => {
                const match = String(value || '').match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
                return match ? match.slice(1, 4).map(Number) : null;
            };
            const isNeutralBackground = value => {
                const rgb = parseRgb(value);
                return isOpaque(value) && rgb && Math.max(...rgb) - Math.min(...rgb) <= 14;
            };
            const readBackground = row => {
                // Some Grafana themes paint the stripe on a nested legend cell,
                // not on the row itself. Series swatches are nested there too, so
                // accept only neutral UI backgrounds; otherwise a green/red/cyan
                // series marker would incorrectly colour the complete legend row.
                const elements = [row, ...row.querySelectorAll('*')];
                return elements.map(element => getComputedStyle(element).backgroundColor)
                    .find(isNeutralBackground) || null;
            };
            const nativeBackgrounds = getRows().map(readBackground);
            const backgroundAncestors = [];
            for (let element = root; element; element = element.parentElement) {
                backgroundAncestors.push(element);
                if (element === document.body) break;
            }
            backgroundAncestors.push(document.documentElement);
            const rootBackground = backgroundAncestors
                .map(element => getComputedStyle(element).backgroundColor)
                .find(isNeutralBackground);
            const primaryBackground = nativeBackgrounds.find(Boolean) || rootBackground
                || (document.documentElement.classList.contains('theme-light') ? 'rgb(255, 255, 255)' : 'rgb(17, 18, 23)');
            const capturedBackgrounds = nativeBackgrounds.map(background => background || rootBackground || primaryBackground);
            const distinctBackgrounds = [...new Set(capturedBackgrounds.filter(Boolean))];
            const primaryRgb = parseRgb(primaryBackground) || [255, 255, 255];
            const luminance = primaryRgb.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            const stripeDelta = luminance > 128 ? -12 : 12;
            const fallbackStripeBackground = `rgb(${primaryRgb
                .map(channel => Math.max(0, Math.min(255, Math.round(channel + stripeDelta))))
                .join(', ')})`;
            const touched = new Map();
            const rememberStyle = (element, property) => {
                let properties = touched.get(element);
                if (!properties) {
                    properties = new Map();
                    touched.set(element, properties);
                }
                if (!properties.has(property)) properties.set(property, {
                    value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property)
                });
            };
            const setTemporaryStyle = (element, property, value) => {
                rememberStyle(element, property);
                element.style.setProperty(property, value, 'important');
            };
            const getLayoutRows = () => {
                const bottomRows = Array.from(root?.querySelectorAll?.('.dashbridge-legend-bottom tr') || []);
                return bottomRows.length ? bottomRows : getRows();
            };
            const apply = () => {
                getRows().forEach((row, index) => {
                    const background = distinctBackgrounds.length > 1
                        ? (capturedBackgrounds[index] || capturedBackgrounds[index % capturedBackgrounds.length])
                        : (index % 2 === 1 ? fallbackStripeBackground : primaryBackground);
                    for (const element of [row, ...row.children]) {
                        setTemporaryStyle(element, 'background-color', background);
                    }
                });
                // In compact bottom legends the name takes the remaining space;
                // numeric columns must share stable widths, but a hard-coded
                // 48px overflows themes that add left padding to value cells.
                const layoutRows = getLayoutRows();
                const columnWidths = [];
                layoutRows.forEach(row => {
                    Array.from(row.children).slice(1).forEach((cell, columnIndex) => {
                        setTemporaryStyle(cell, 'box-sizing', 'border-box');
                        setTemporaryStyle(cell, 'width', 'auto');
                        setTemporaryStyle(cell, 'min-width', '0');
                        setTemporaryStyle(cell, 'max-width', 'none');
                        setTemporaryStyle(cell, 'flex', '0 1 auto');
                        setTemporaryStyle(cell, 'white-space', 'nowrap');
                        const naturalWidth = Math.ceil(Math.max(
                            cell.scrollWidth || 0, cell.getBoundingClientRect().width || 0
                        ));
                        // Keep short vCPU/count columns compact; percentage
                        // cells still grow to their measured content width.
                        columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] || 32, naturalWidth);
                    });
                });
                layoutRows.forEach(row => {
                    Array.from(row.children).slice(1).forEach((cell, columnIndex) => {
                        const width = columnWidths[columnIndex] || 32;
                        setTemporaryStyle(cell, 'width', `${width}px`);
                        setTemporaryStyle(cell, 'min-width', `${width}px`);
                        setTemporaryStyle(cell, 'max-width', `${width}px`);
                        setTemporaryStyle(cell, 'flex', `0 0 ${width}px`);
                        setTemporaryStyle(cell, 'text-align', 'right');
                    });
                });
            };
            const observer = typeof MutationObserver === 'function'
                ? new MutationObserver(apply)
                : null;
            return {
                start() {
                    apply();
                    observer?.observe(root, { childList: true, subtree: true });
                },
                apply,
                restore() {
                    observer?.disconnect();
                    touched.forEach((properties, element) => {
                        properties.forEach(({ value, priority }, property) => {
                            if (value) element.style.setProperty(property, value, priority);
                            else element.style.removeProperty(property);
                        });
                    });
                    touched.clear();
                }
            };
        };
        const waitForPanelCaptureResult = (requestId, iframe) => new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(null, new Error('capture-timeout')), 15000);
            const finish = (result, error = null) => {
                clearTimeout(timeout);
                if (iframe) window.removeEventListener('message', onMessage);
                else document.removeEventListener('dashbridgePanelCaptureResult', onEvent);
                error ? reject(error) : resolve(result);
            };
            const onEvent = event => {
                if (event.detail?.requestId === requestId) finish(event.detail);
            };
            const onMessage = event => {
                if (event.source !== window.parent || event.origin !== extensionOrigin
                    || event.data?.action !== 'dashbridgePanelCaptureResult'
                    || event.data.requestId !== requestId) return;
                finish(event.data);
            };
            if (iframe) window.addEventListener('message', onMessage);
            else document.addEventListener('dashbridgePanelCaptureResult', onEvent);
        });
        const prepareNativePanelCapture = async (panel, prepared, dimensions = panelCaptureDimensions()) => {
            const outer = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
            const captureVisualState = readPanelCaptureState(panel);
            // Grafana 10 can still render legacy Graph/Flot panels. Their plot and
            // right-side legend are sized by .graph-panel, independently from the
            // surrounding React grid item. Resizing only `outer` leaves the legacy
            // content at its old dimensions, so the compact crop contains a large
            // blank area and can clip the legend completely.
            const legacyGraphPanel = prepared ? outer.querySelector('.graph-panel') : null;
            const layoutTarget = legacyGraphPanel || outer;
            const captureNode = legacyGraphPanel || outer;
            const legacyTitleSource = legacyGraphPanel ? outer.querySelector(panelCaptureTitleSelector) : null;
            const legacyTitleText = legacyTitleSource?.textContent?.trim() || '';
            const legacyTitleOutsideGraph = !!legacyTitleText && !legacyGraphPanel?.contains(legacyTitleSource);
            const legacyTitleHeight = legacyTitleOutsideGraph ? 32 : 0;
            const legacyPanelContent = legacyGraphPanel?.closest('.css-kvzgb9-panel-content, [class*="panel-content"]');
            const legacyPanelContentStyle = legacyPanelContent ? getComputedStyle(legacyPanelContent) : null;
            const legacyFramePadding = side => legacyPanelContentStyle
                ? Number.parseFloat(legacyPanelContentStyle.getPropertyValue(`padding-${side}`)) || 0
                : 0;
            const scroll = { x: window.scrollX, y: window.scrollY };
            outer.scrollIntoView({ block: 'center', inline: 'center' });
            await nextPaint();
            const layout = window.DashBridgeGrafanaCompactLayout;
            const props = ['position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'transform', 'z-index', 'margin', 'box-sizing', 'transition'];
            const snapshot = new Map(props.map(prop => [prop, {
                value: outer.style.getPropertyValue(prop), priority: outer.style.getPropertyPriority(prop)
            }]));
            const legacyProps = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'flex-basis', 'padding', 'box-sizing', 'transition'];
            const legacySnapshot = legacyGraphPanel && new Map(legacyProps.map(prop => [prop, {
                value: legacyGraphPanel.style.getPropertyValue(prop), priority: legacyGraphPanel.style.getPropertyPriority(prop)
            }]));
            const originalParent = captureNode.parentNode;
            const originalNextSibling = captureNode.nextSibling;
            let captureFrame = null;
            let captureAnchor = null;
            let captureLegendBackgroundController = null;
            let captureInnerSizeController = null;
            const restore = async () => {
                if (captureFrame) {
                    if (captureAnchor?.parentNode) captureAnchor.replaceWith(captureNode);
                    else if (originalParent?.isConnected) {
                        const before = originalNextSibling?.parentNode === originalParent ? originalNextSibling : null;
                        originalParent.insertBefore(captureNode, before);
                    }
                    captureAnchor?.remove?.();
                    captureFrame.remove();
                    captureFrame = null;
                    captureAnchor = null;
                }
                captureLegendBackgroundController?.restore();
                captureLegendBackgroundController = null;
                captureInnerSizeController?.restore();
                captureInnerSizeController = null;
                snapshot.forEach((state, prop) => state.value
                    ? outer.style.setProperty(prop, state.value, state.priority || '')
                    : outer.style.removeProperty(prop));
                legacySnapshot?.forEach((state, prop) => state.value
                    ? legacyGraphPanel.style.setProperty(prop, state.value, state.priority || '')
                    : legacyGraphPanel.style.removeProperty(prop));
                window.dispatchEvent(new Event('resize'));
                if (prepared) {
                    layout?.restoreFlot([outer]);
                    layout?.restoreUPlot([outer]);
                }
                if (legacyGraphPanel) {
                    syncThresholdHighlightState(outer, captureVisualState);
                }
                window.scrollTo(scroll.x, scroll.y);
                await nextPaint();
            };
            try {
                if (prepared) {
                    layout?.rememberUPlotSize(outer, layoutTarget);
                    const fitted = fitPanelCaptureSize({
                        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                        outputWidth: dimensions.width, outputHeight: dimensions.height
                    });
                    if (!originalParent || !document.body) throw new Error('capture-panel-detached');
                    const isOpaqueBackground = value => value && value !== 'transparent'
                        && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(value);
                    const bodyBackground = getComputedStyle(document.body).backgroundColor;
                    const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
                    // Flot canvases are transparent. Prefer the nearest
                    // dashboard/panel ancestor's computed background; the
                    // page background may be Grafana's neutral grey.
                    const panelBackgrounds = [];
                    for (let node = captureNode; node && node !== document.body; node = node.parentElement) {
                        panelBackgrounds.push(getComputedStyle(node).backgroundColor);
                    }
                    const captureBackground = [...panelBackgrounds, bodyBackground, rootBackground].find(isOpaqueBackground)
                        || (document.documentElement.classList.contains('theme-light') ? '#ffffff' : '#111217');
                    captureFrame = document.createElement('div');
                    captureFrame.className = 'dashbridge-panel-capture-frame';
                    Object.assign(captureFrame.style, {
                        position: 'fixed', left: `${fitted.left}px`, top: `${fitted.top}px`,
                        width: `${fitted.width}px`, height: `${fitted.height}px`,
                        zIndex: '2147483645', overflow: 'hidden', pointerEvents: 'none',
                        background: captureBackground, isolation: 'isolate'
                    });
                    if (legacyGraphPanel) {
                        captureFrame.style.setProperty('padding', `${legacyFramePadding('top')}px ${legacyFramePadding('right')}px ${legacyFramePadding('bottom')}px ${legacyFramePadding('left')}px`);
                        captureFrame.style.setProperty('box-sizing', 'border-box');
                    }
                    captureAnchor = document.createComment('dashbridge-panel-capture-anchor');
                    // Grafana's zebra striping is scoped through dashboard ancestors.
                    // Compact capture moves the real panel under document.body, so
                    // remember the already computed row backgrounds before that move.
                    captureLegendBackgroundController = createCompactCaptureLegendBackgroundController(captureNode);
                    originalParent.insertBefore(captureAnchor, captureNode);
                    document.body.appendChild(captureFrame);
                    if (legacyTitleOutsideGraph) {
                        const sourceStyle = getComputedStyle(legacyTitleSource);
                        const captureTitle = document.createElement('div');
                        captureTitle.className = 'dashbridge-panel-capture-legacy-title';
                        captureTitle.textContent = legacyTitleText;
                        Object.assign(captureTitle.style, {
                            height: `${legacyTitleHeight}px`, padding: '6px 8px 0', boxSizing: 'border-box',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: sourceStyle.color, fontFamily: sourceStyle.fontFamily,
                            fontSize: sourceStyle.fontSize, fontWeight: sourceStyle.fontWeight,
                            lineHeight: sourceStyle.lineHeight === 'normal' ? '20px' : sourceStyle.lineHeight
                        });
                        captureFrame.appendChild(captureTitle);
                    }
                    captureFrame.appendChild(captureNode);
                    captureLegendBackgroundController.start();
                    if (legacyGraphPanel) {
                        const legacyWidth = Math.max(1, fitted.width - legacyFramePadding('left') - legacyFramePadding('right'));
                        const legacyHeight = Math.max(1, fitted.height - legacyFramePadding('top') - legacyFramePadding('bottom') - legacyTitleHeight);
                        legacyGraphPanel.style.setProperty('width', `${legacyWidth}px`, 'important');
                        legacyGraphPanel.style.setProperty('height', `${legacyHeight}px`, 'important');
                        legacyGraphPanel.style.setProperty('min-width', `${legacyWidth}px`, 'important');
                        legacyGraphPanel.style.setProperty('min-height', `${legacyHeight}px`, 'important');
                        legacyGraphPanel.style.setProperty('max-width', `${legacyWidth}px`, 'important');
                        legacyGraphPanel.style.setProperty('max-height', `${legacyHeight}px`, 'important');
                        legacyGraphPanel.style.setProperty('flex-basis', `${legacyWidth}px`, 'important');
                        legacyGraphPanel.style.setProperty('box-sizing', 'border-box', 'important');
                        legacyGraphPanel.style.setProperty('padding', '0 12px 12px', 'important');
                        legacyGraphPanel.style.setProperty('transition', 'none', 'important');
                    } else {
                        outer.style.setProperty('position', 'relative', 'important');
                        outer.style.setProperty('inset', '0', 'important');
                        outer.style.setProperty('left', '0', 'important');
                        outer.style.setProperty('top', '0', 'important');
                        outer.style.setProperty('right', 'auto', 'important');
                        outer.style.setProperty('bottom', 'auto', 'important');
                        outer.style.setProperty('width', '100%', 'important');
                        outer.style.setProperty('height', '100%', 'important');
                        outer.style.setProperty('min-width', '0', 'important');
                        outer.style.setProperty('min-height', '0', 'important');
                        outer.style.setProperty('max-width', 'none', 'important');
                        outer.style.setProperty('max-height', 'none', 'important');
                        outer.style.setProperty('transform', 'none', 'important');
                        outer.style.setProperty('z-index', '2147483645', 'important');
                        outer.style.setProperty('margin', '0', 'important');
                        outer.style.setProperty('box-sizing', 'border-box', 'important');
                        outer.style.setProperty('transition', 'none', 'important');
                    }
                    window.dispatchEvent(new Event('resize'));
                    await new Promise(resolve => setTimeout(resolve, 250));
                    layout?.redrawFlot(layoutTarget, true);
                    window.DashBridgeGrafanaVisualEngine?.reflowChart?.({ root: layoutTarget });
                    // Grafana's ResizeObserver may rewrite measured inline sizes
                    // while the panel is moved under the capture frame. Release
                    // those stale constraints after that pass, immediately before
                    // sizing the native renderer.
                    captureInnerSizeController = layout?.relaxInlineSizeConstraints(layoutTarget);
                    layout?.resizeUPlot(layoutTarget, layoutTarget);
                    captureLegendBackgroundController.apply();
                    if (legacyGraphPanel) {
                        // Prepared legacy capture moves .graph-panel outside its
                        // saved outer root. Bind the overlay to the temporary
                        // frame so the Flot plot remains discoverable and painted.
                        syncThresholdHighlightState(captureFrame, captureVisualState);
                    }
                    await nextPaint();
                }
                const rect = (captureFrame || outer).getBoundingClientRect();
                const captureRect = {
                    x: Math.max(0, rect.left), y: Math.max(0, rect.top),
                    width: Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left),
                    height: Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top),
                    dpr: window.devicePixelRatio || 1
                };
                return { rect: captureRect, restore };
            } catch (error) {
                try { await restore(); } catch (_) { }
                throw error;
            }
        };
        let activeBatchCaptureSession = null;
        const batchCaptureApi = Object.freeze({
            async prepare({ panelId, sessionId, outputWidth, outputHeight }) {
                if (activeBatchCaptureSession) {
                    try { await activeBatchCaptureSession.session.restore(); } catch (_) { }
                    activeBatchCaptureSession = null;
                    document.documentElement.classList.remove('dashbridge-panel-capture-mode');
                }
                const panel = window.DashBridgeGrafanaDom?.findPanelById(panelId) || null;
                if (!panel || !sessionId) return { ok: false, reason: 'panel-not-found' };
                const dimensions = {
                    width: Math.min(4096, Math.max(100, Math.round(Number(outputWidth) || 1000))),
                    height: Math.min(4096, Math.max(100, Math.round(Number(outputHeight) || 520)))
                };
                document.documentElement.classList.add('dashbridge-panel-capture-mode');
                try {
                    const session = await prepareNativePanelCapture(panel, true, dimensions);
                    activeBatchCaptureSession = { id: String(sessionId), session };
                    return { ok: true, rect: session.rect };
                } catch (error) {
                    document.documentElement.classList.remove('dashbridge-panel-capture-mode');
                    return { ok: false, reason: error?.message || String(error) };
                }
            },
            async restore(sessionId) {
                if (!activeBatchCaptureSession || activeBatchCaptureSession.id !== String(sessionId)) return false;
                const current = activeBatchCaptureSession;
                activeBatchCaptureSession = null;
                try { await current.session.restore(); } finally {
                    document.documentElement.classList.remove('dashbridge-panel-capture-mode');
                }
                return true;
            }
        });
        window.DashBridgeGrafanaBatchCapture = batchCaptureApi;
        registerRuntimeCleanup(() => {
            const current = activeBatchCaptureSession;
            activeBatchCaptureSession = null;
            document.documentElement.classList.remove('dashbridge-panel-capture-mode');
            if (current) void current.session.restore().catch(() => undefined);
            if (window.DashBridgeGrafanaBatchCapture === batchCaptureApi) {
                delete window.DashBridgeGrafanaBatchCapture;
            }
        });
        const runPanelCapture = async (panel, action, button, host) => {
            if (panelCaptureInProgress) return;
            panelCaptureInProgress = true;
            const requestId = `panel_capture_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const state = readPanelCaptureState(panel);
            const prepared = !!state.capturePrepared;
            const dimensions = panelCaptureDimensions();
            const startedAt = Date.now();
            const diagnostic = {
                schema: 'dashbridge-panel-capture-diagnostic/v1', requestId, action, prepared,
                panelKey: getPanelStateKey(panel), startedAt: new Date(startedAt).toISOString(),
                userActivationAtClick: navigator.userActivation?.isActive === true,
                phase: 'started'
            };
            const publishDiagnostic = patch => {
                Object.assign(diagnostic, patch, {
                    elapsedMs: Date.now() - startedAt,
                    updatedAt: new Date().toISOString()
                });
                window.__dashbridgeLastPanelCaptureDiagnostic = { ...diagnostic };
            };
            publishDiagnostic({});
            const originalTitle = button.title;
            button.disabled = true;
            button.title = action === 'copy' ? 'Копирование снимка…' : 'Сохранение снимка…';
            let session = null;
            try {
                publishDiagnostic({ phase: 'preparing' });
                document.documentElement.classList.add('dashbridge-panel-capture-mode');
                host.classList.add('dashbridge-panel-capture-hidden');
                await nextPaint();
                let resultPromise;
                if (isDashboardIframe) {
                    resultPromise = waitForPanelCaptureResult(requestId, true);
                    window.parent.postMessage({
                        action: 'dashbridgePanelCaptureRequest', requestId, outputAction: action,
                        prepared, outputWidth: dimensions.width, outputHeight: dimensions.height,
                        panelId: getPanelStateKey(panel), title: getPanelCaptureTitle(panel)
                    }, extensionOrigin);
                } else {
                    session = await prepareNativePanelCapture(panel, prepared, dimensions);
                    publishDiagnostic({ phase: 'prepared', rect: { ...session.rect } });
                    resultPromise = waitForPanelCaptureResult(requestId, false);
                    document.dispatchEvent(new CustomEvent('dashbridgePanelCaptureRequest', { detail: {
                        requestId, action, prepared, outputWidth: dimensions.width, outputHeight: dimensions.height,
                        rect: session.rect, title: getPanelCaptureTitle(panel)
                    } }));
                }
                publishDiagnostic({ phase: 'waiting-for-result' });
                const result = await resultPromise;
                if (!result?.ok) {
                    const failure = new Error(result?.error || 'capture-failed');
                    failure.stage = result?.stage || null;
                    throw failure;
                }
                if (result.fallback === 'download') {
                    showCaptureNotice(result.insecureContext
                        ? 'Буфер изображений недоступен на HTTP - файл сохранён.'
                        : 'Не удалось скопировать изображение - файл сохранён.');
                }
                publishDiagnostic({
                    phase: 'complete', resultStage: result.stage || 'complete', ok: true,
                    fallback: result.fallback || null
                });
                button.classList.add('dashbridge-panel-capture-success');
                setTimeout(() => button.classList.remove('dashbridge-panel-capture-success'), 1600);
            } catch (error) {
                publishDiagnostic({
                    phase: 'failed', ok: false, resultStage: error?.stage || null,
                    error: String(error?.message || error).slice(0, 500)
                });
                console.error('DashBridge panel capture failed:', error);
                button.classList.add('dashbridge-panel-capture-error');
                setTimeout(() => button.classList.remove('dashbridge-panel-capture-error'), 2000);
            } finally {
                try { await session?.restore?.(); } catch (error) { console.error('DashBridge panel capture restore failed:', error); }
                document.documentElement.classList.remove('dashbridge-panel-capture-mode');
                host.classList.remove('dashbridge-panel-capture-hidden');
                button.disabled = false;
                button.title = originalTitle;
                panelCaptureInProgress = false;
                publishDiagnostic({ restored: true });
            }
        };
    

        return Object.freeze({
            readPanelCaptureState, syncPanelCaptureToggle,
            setPanelCapturePrepared, getPanelCaptureTitle, runPanelCapture
        });
    };

    window.DashBridgeGrafanaPanelCaptureRuntime = Object.freeze({ create });
})();

