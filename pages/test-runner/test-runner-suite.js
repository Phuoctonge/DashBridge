// Test Runner scenario suite.
// Набор тест-сценариев A–F для E2E тестирования DashBridge в реальной Grafana.
// Каждый сценарий: { id, category, name, run(tabId, env) → Promise<{ pass, details }> }
// Все visual-тесты обратимы: read → modify → check DOM → restore.

// --- Вспомогательные функции выполнения в MAIN world ---

async function execMain(tabId, func, args = []) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func,
        args,
    });
    return results?.[0]?.result;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Возвращает panelId с приоритетом: viewPanelId (из ?viewPanel=N) > firstGraphPanelId > firstPanelId
// При viewPanel режиме в DOM только одна панель — используем её ID напрямую.
function resolvePanelId(env) {
    return env.probe?.viewPanelId || env.probe?.firstGraphPanelId || env.probe?.firstPanelId || null;
}

// Принудительный refresh данных через штатную кнопку Grafana.
// Это запускает реальный запрос данных, в отличие от одного redraw canvas.
async function triggerRefresh(tabId) {
    return execMain(tabId, () => {
        const refreshButton = document.querySelector('[data-testid="data-testid RefreshPicker run button"]');
        if (refreshButton) {
            refreshButton.click();
            return 'RefreshPicker.run-button';
        }
        // Fallback для старых/кастомных сборок Grafana без RefreshPicker.
        try {
            const appEvents = window.__grafana_app_events || window.grafanaRuntime?.appEvents;
            if (appEvents?.emit) { appEvents.emit('refresh'); return 'appEvents.emit'; }
        } catch (_) { }
        try {
            const bus = window?.grafanaRuntime?.getAppEvents?.();
            if (bus?.publish) { bus.publish({ type: 'refresh' }); return 'bus.publish'; }
        } catch (_) { }
        try {
            const plots = document.querySelectorAll('[class*="uplot"], [class*="u-wrap"]');
            plots.forEach(p => { try { (p?._uplot || p?.uplot)?.redraw?.(true, true); } catch (_) { } });
            return 'uplot.redraw';
        } catch (_) { }
        return 'no-refresh-api';
    });
}

// Отключает автообновление через штатный RefreshPicker Grafana.
// Одного удаления ?refresh= недостаточно: React scheduler уже мог быть запущен.
// Возвращает исходный интервал и признак успешного UI-переключения для восстановления.
async function disableAutoRefresh(tabId) {
    return execMain(tabId, async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const label = element => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
        let previous = null;
        let disabledByUi = false;

        try {
            const url = new URL(location.href);
            previous = url.searchParams.get('refresh');

            const intervalButton = document.querySelector('[data-testid="data-testid RefreshPicker interval button"]');
            if (intervalButton && previous) {
                intervalButton.click();
                await wait(100);

                const menu = [...document.querySelectorAll('[role="menu"]')]
                    .find(element => element.offsetParent !== null && /\bOff\b/i.test(label(element)));
                const offItem = menu && [...menu.querySelectorAll('button, [role="menuitem"], [role="option"], a, div')]
                    .find(element => label(element).toLowerCase() === 'off');

                if (offItem) {
                    offItem.click();
                    await wait(100);
                    disabledByUi = true;
                }
            }

            // Fallback для нестандартных/старых страниц и визуальное удаление параметра.
            const cleanedUrl = new URL(location.href);
            cleanedUrl.searchParams.delete('refresh');
            history.replaceState(history.state, '', cleanedUrl.toString());
            window.dispatchEvent(new PopStateEvent('popstate'));
            return { value: previous, disabledByUi };
        } catch (_) {
            return { value: previous, disabledByUi };
        }
    });
}

// Восстанавливает исходный интервал через RefreshPicker и URL как fallback.
async function restoreAutoRefresh(tabId, previousState) {
    const previous = typeof previousState === 'string' ? previousState : previousState?.value;
    if (!previous) return;
    return execMain(tabId, async (interval, restoreThroughUi) => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const label = element => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
        try {
            if (restoreThroughUi) {
                const intervalButton = document.querySelector('[data-testid="data-testid RefreshPicker interval button"]');
                if (intervalButton) {
                    intervalButton.click();
                    await wait(100);
                    const menu = [...document.querySelectorAll('[role="menu"]')]
                        .find(element => element.offsetParent !== null);
                    const intervalItem = menu && [...menu.querySelectorAll('button, [role="menuitem"], [role="option"], a, div')]
                        .find(element => label(element).toLowerCase() === interval.toLowerCase());
                    if (intervalItem) {
                        intervalItem.click();
                        return 'ui-restored';
                    }
                }
            }

            const url = new URL(location.href);
            url.searchParams.set('refresh', interval);
            history.replaceState(history.state, '', url.toString());
            window.dispatchEvent(new PopStateEvent('popstate'));
            return 'url-restored';
        } catch (_) { return 'restore-failed'; }
    }, [previous, Boolean(previousState?.disabledByUi)]);
}

// Отправляет applyPanelTools в MAIN world (имитирует popup-команду).
// transformSettings — минимальный набор необходимых ключей.
async function applyPanelTools(tabId, tools) {
    await execMain(tabId, () => {
        window.__dashbridgeDebugLogs = [];
    });
    // The page runtime expects a flat settings object. Matrix steps keep visual
    // and transform settings grouped for readability, so normalize only at the
    // command boundary rather than silently relying on nested fields.
    const command = {
        ...tools,
        ...(tools?.visualSettings || {}),
        ...(tools?.transformSettings || {}),
    };
    delete command.visualSettings;
    delete command.transformSettings;
    return execMain(tabId, (toolsArg) => new Promise(resolve => {
        // panel-tools intentionally ignores top-level tab messages until its
        // caller opts in. Popup commands do this in runGrafanaCommand(); the
        // E2E runner must do the same or every command waits for the timeout.
        window.__dashbridgePanelToolsAllowTop = true;
        const reqId = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(result);
        };
        const handler = e => {
            if (e.source === window && e.origin === location.origin && e.data?.action === 'panelToolsApplied' && e.data?.requestId === reqId) {
                finish({
                    status: e.data.commandStatus === 'error'
                        ? 'command-error'
                        : (e.data.legendVisibilityApplied === false && e.data.legendVisibilityDeferred !== true
                            ? 'native-legend-apply-failed' : 'applied'),
                    state: window.__dashbridgePanelToolsState || null,
                    acknowledgement: e.data,
                    legendVisibilityDiagnostic: window.__dashbridgeLegendVisibilityDiagnostic || null,
                    commandDiagnostic: window.__dashbridgePanelToolsCommandDiagnostic || null,
                });
            }
        };
        // This watchdog does not establish application; only the matching
        // acknowledgement below does. Keep it aligned with the production
        // command bridge because Grafana can briefly remount a panel on reset.
        const timeout = setTimeout(() => finish({
            status: 'timeout',
            state: window.__dashbridgePanelToolsState || null,
        }), 20000);
        window.addEventListener('message', handler);
        window.postMessage({
            action: 'applyPanelTools',
            requestId: reqId,
            tools: toolsArg,
            transformSettings: {
                grafanaIdleKeyword: 'idle',
                grafanaMemTotalKeyword: 'total',
                grafanaTrimDomain: false,
                grafanaTrimDomainEnabled: false,
            },
        }, location.origin);
    }), [command]);
}

// ─── Structured runtime diagnostics ─────────────────────────────────
// The runner owns this journal instead of trying to read Chrome DevTools history.
// Every result receives serializable evidence, including PASS and SKIP outcomes.
async function installRuntimeDiagnostics(tabId) {
    return execMain(tabId, () => {
        if (window.__dashbridgeE2EDiagnostics?.installed) return { installed: true, reused: true };
        const safe = (value, depth = 0, seen = new WeakSet()) => {
            if (depth > 20) return '[depth-limit-20]';
            if (value === null || value === undefined) return value;
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
            if (value instanceof Error) return { name: value.name, message: value.message, stack: String(value.stack || '') };
            if (typeof value === 'bigint') return `${value}n`;
            if (typeof value === 'object' && seen.has(value)) return '[circular]';
            if (typeof value === 'object') seen.add(value);
            if (Array.isArray(value)) return value.map(item => safe(item, depth + 1, seen));
            if (typeof value === 'object') {
                const output = {};
                Object.entries(value).forEach(([key, item]) => { output[key] = safe(item, depth + 1, seen); });
                return output;
            }
            return `[${typeof value}]`;
        };
        const journal = window.__dashbridgeE2EDiagnostics = {
            installed: true,
            startedAt: Date.now(),
            nextEventId: 0,
            events: [],
            originals: {},
        };
        const push = (level, args) => {
            journal.events.push({
                id: ++journal.nextEventId,
                at: Date.now(),
                level,
                args: args.map(arg => safe(arg, 0, new WeakSet())),
            });
        };
        ['debug', 'log', 'info', 'warn', 'error'].forEach(level => {
            journal.originals[level] = console[level];
            console[level] = function (...args) {
                push(level, args);
                return journal.originals[level].apply(this, args);
            };
        });
        journal.onError = event => push('error', [event.message, event.error]);
        journal.onRejection = event => push('unhandledrejection', [event.reason]);
        window.addEventListener('error', journal.onError);
        window.addEventListener('unhandledrejection', journal.onRejection);
        return { installed: true, reused: false };
    });
}

let lastPanelDiagnosticCaptureAt = 0;

const DIAGNOSTIC_CAPTURE_MODES = Object.freeze({
    SEMANTIC: 'semantic-only',
    CANVAS: 'canvas',
    PANEL: 'panel',
    FORENSIC: 'forensic',
});

function normalizeDiagnosticCaptureMode(mode) {
    return Object.values(DIAGNOSTIC_CAPTURE_MODES).includes(mode)
        ? mode : DIAGNOSTIC_CAPTURE_MODES.FORENSIC;
}

function diagnosticCaptureModeForTransition(settings, activeIds = [], changedIds = null) {
    const hasDeclaredFeatureSet = Array.isArray(changedIds);
    const evidenceIds = hasDeclaredFeatureSet && changedIds.length ? changedIds : (activeIds || []);
    const ids = new Set(evidenceIds);
    const visual = settings?.visualSettings || {};
    const transform = settings?.transformSettings || {};
    const affectsPanelLayout = ids.has('invertLegend')
        || ids.has('seriesVisibility')
        || ids.has('seriesQueryFilter')
        || ids.has('invertIdle')
        || ids.has('convertMemToUsed')
        || (!hasDeclaredFeatureSet && (
            Object.prototype.hasOwnProperty.call(visual, 'invertLegend')
            || Object.prototype.hasOwnProperty.call(settings || {}, 'legendVisibility')
            || Object.prototype.hasOwnProperty.call(transform, 'seriesQueryFilterEnabled')
            || Object.prototype.hasOwnProperty.call(transform, 'invertIdle')
            || Object.prototype.hasOwnProperty.call(transform, 'convertMemToUsed')
        ));
    return affectsPanelLayout ? DIAGNOSTIC_CAPTURE_MODES.PANEL : DIAGNOSTIC_CAPTURE_MODES.CANVAS;
}

async function capturePanelDiagnosticImage(tabId, panelId, { retainViewport = true } = {}) {
    // Chrome throttles captureVisibleTab to roughly two calls per second.
    // Keep every transition screenshot instead of silently losing fast calls.
    const throttleWaitMs = Math.max(0, 600 - (Date.now() - lastPanelDiagnosticCaptureAt));
    if (throttleWaitMs) await sleep(throttleWaitMs);
    lastPanelDiagnosticCaptureAt = Date.now();
    const captureStartedAt = Date.now();
    const rect = await execMain(tabId, pid => {
        const dom = window.DashBridgeGrafanaDom;
        const panel = dom?.findPanelById?.(pid);
        const root = dom?.outerPanel?.(panel) || panel;
        if (!root) return null;
        const bounds = root.getBoundingClientRect();
        if (bounds.width <= 1 || bounds.height <= 1) return null;
        return {
            x: Math.max(0, bounds.x), y: Math.max(0, bounds.y),
            width: Math.min(bounds.width, window.innerWidth - Math.max(0, bounds.x)),
            height: Math.min(bounds.height, window.innerHeight - Math.max(0, bounds.y)),
            dpr: window.devicePixelRatio || 1,
        };
    }, [panelId]);
    if (!rect || rect.width <= 1 || rect.height <= 1) {
        return { dataUrl: null, error: 'panel-not-visible-or-empty', capturedAt: Date.now(), throttleWaitMs };
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        const source = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (!source) return { dataUrl: null, error: 'captureVisibleTab-empty-result', capturedAt: Date.now(), throttleWaitMs };
        return await new Promise(resolve => {
            const image = new Image();
            image.onload = () => {
                const dpr = rect.dpr;
                const x = Math.round(rect.x * dpr);
                const y = Math.round(rect.y * dpr);
                const width = Math.min(Math.round(rect.width * dpr), image.naturalWidth - x);
                const height = Math.min(Math.round(rect.height * dpr), image.naturalHeight - y);
                if (width <= 1 || height <= 1) return resolve({
                    dataUrl: null, error: 'panel-crop-empty', capturedAt: Date.now(), throttleWaitMs,
                    crop: { ...rect, width, height },
                });
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                context.drawImage(image, x, y, width, height, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/png');
                const hashDataUrl = value => `fnv1a-${(() => {
                    let hashValue = 2166136261;
                    for (let i = 0; i < value.length; i += 1) {
                        hashValue = Math.imul(hashValue ^ value.charCodeAt(i), 16777619);
                    }
                    return (hashValue >>> 0).toString(16);
                })()}`;
                let pixelStats = null;
                try {
                    const pixels = context.getImageData(0, 0, width, height).data;
                    const stride = Math.max(1, Math.floor((width * height) / 16384));
                    const bins = Array(16).fill(0);
                    let count = 0, sum = 0, sumSq = 0, opaque = 0, min = 255, max = 0;
                    for (let pixel = 0; pixel < width * height; pixel += stride) {
                        const offset = pixel * 4;
                        const luminance = Math.round(0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]);
                        count += 1; sum += luminance; sumSq += luminance * luminance;
                        if (pixels[offset + 3] > 250) opaque += 1;
                        min = Math.min(min, luminance); max = Math.max(max, luminance);
                        bins[Math.min(15, Math.floor(luminance / 16))] += 1;
                    }
                    const mean = count ? sum / count : 0;
                    pixelStats = {
                        samples: count, luminanceMean: Number(mean.toFixed(3)),
                        luminanceStdDev: Number(Math.sqrt(Math.max(0, sumSq / Math.max(1, count) - mean * mean)).toFixed(3)),
                        luminanceMin: min, luminanceMax: max,
                        opaqueRatio: Number((opaque / Math.max(1, count)).toFixed(4)), histogram16: bins,
                    };
                } catch (error) {
                    pixelStats = { error: error?.message || String(error) };
                }
                resolve({
                    dataUrl, width, height,
                    hash: hashDataUrl(dataUrl),
                    pixelStats, capturedAt: Date.now(), captureDurationMs: Date.now() - captureStartedAt,
                    throttleWaitMs, crop: rect,
                    viewportImage: retainViewport ? {
                        dataUrl: source,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                        hash: hashDataUrl(source),
                        bytes: source.length,
                        capturedAt: Date.now(),
                    } : null,
                });
            };
            image.onerror = () => resolve({ dataUrl: null, error: 'captured-tab-image-decode-failed', capturedAt: Date.now(), throttleWaitMs });
            image.src = source;
        });
    } catch (error) {
        return {
            dataUrl: null,
            error: error?.message || String(error),
            capturedAt: Date.now(),
            captureDurationMs: Date.now() - captureStartedAt,
            throttleWaitMs,
        };
    }
}

function runtimeVisualReuseSignature(snapshot) {
    if (!snapshot?.panelFound) return null;
    return JSON.stringify({
        renderer: snapshot.renderer || null,
        dom: {
            structuralHash: snapshot.domSnapshot?.root?.outerHTMLStructuralHash
                || snapshot.domSnapshot?.root?.outerHTMLHash || null,
            rect: snapshot.domSnapshot?.root?.rect || null,
            document: snapshot.domSnapshot?.document || null,
        },
        canvas: (snapshot.canvas || []).map(item => ({
            hash: item?.hash || null, width: item?.width || null, height: item?.height || null,
            pixelStats: item?.pixelStats || null,
        })),
        legend: snapshot.legend || null,
        markers: snapshot.markers || null,
        series: snapshot.series || null,
        threshold: snapshot.thresholdDiagnostic || null,
        visualStyleState: snapshot.visualStyleState || null,
        tools: snapshot.tools || null,
    });
}

function canReuseRuntimeVisual(snapshot, source, captureMode = 'forensic') {
    if (!source?.panelFound) return false;
    const currentSignature = runtimeVisualReuseSignature(snapshot);
    if (currentSignature === null || currentSignature !== runtimeVisualReuseSignature(source)) return false;
    const mode = ['semantic-only', 'canvas', 'panel', 'forensic'].includes(captureMode)
        ? captureMode : 'forensic';
    if (mode === 'semantic-only') return true;
    if (mode === 'canvas') {
        return (source.canvas || []).some(item => typeof item?.dataUrl === 'string' && item.dataUrl);
    }
    if (!source?.panelImage?.dataUrl) return false;
    return mode !== 'forensic' || !!source?.viewportImage?.dataUrl;
}

function runtimeVisualReuseHash(snapshot) {
    const text = runtimeVisualReuseSignature(snapshot) || '';
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function captureRuntimeDiagnostic(tabId, panelId, {
    reuseVisualFrom = null,
    captureMode = DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
    captureReason = 'explicit-full-diagnostic',
} = {}) {
    const mode = normalizeDiagnosticCaptureMode(captureMode);
    // Panel/forensic captures already retain a cropped panel PNG (and the
    // forensic mode also retains the viewport). Keeping a second base64 PNG
    // for every canvas made long matrix scenarios retain equivalent images
    // until the whole test could be spooled to OPFS. Only canvas mode needs
    // the raw canvas PNG; every mode keeps a sampled pixel hash/statistics.
    const includeCanvasImages = mode === DIAGNOSTIC_CAPTURE_MODES.CANVAS;
    const retainFullDom = mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC;
    const retainFullResources = mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC;
    const diagnostic = await execMain(tabId, (pid, visualOptions) => {
        const dom = window.DashBridgeGrafanaDom;
        const visual = window.DashBridgeGrafanaVisualEngine;
        const panel = dom?.findPanelById?.(pid);
        let root = dom?.outerPanel?.(panel) || panel;
        while (root && !root.classList?.contains('react-grid-item')
            && !root.classList?.contains('panel-container') && root.parentElement) {
            root = root.parentElement;
        }
        const hash = text => {
            let value = 2166136261;
            for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
            return `fnv1a-${(value >>> 0).toString(16)}`;
        };
        const hashBytes = bytes => {
            let value = 2166136261;
            for (let i = 0; i < bytes.length; i += 1) value = Math.imul(value ^ bytes[i], 16777619);
            return `fnv1a-${(value >>> 0).toString(16)}`;
        };
        const display = value => typeof value === 'function' ? `[function ${value.name || 'anonymous'}]`
            : value === undefined ? '[undefined]' : value === null ? null
                : typeof value === 'object' ? `[${value.constructor?.name || 'object'}]` : value;
        const rootOuterHTML = (() => {
            try { return root?.outerHTML || ''; } catch (error) { return `[outerHTML-error: ${error?.message || String(error)}]`; }
        })();
        // Grafana rewrites equivalent inline pointer/legend styles every frame.
        // Preserve the lossless HTML above, but use a style-neutral structural
        // hash when deciding whether another full-page PNG adds information.
        const rootStructuralHTML = rootOuterHTML.replace(/\sstyle="[^"]*"/gi, '');
        const rootRect = (() => {
            const rect = root?.getBoundingClientRect?.();
            return rect ? {
                x: rect.x, y: rect.y, top: rect.top, right: rect.right,
                bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height,
            } : null;
        })();
        const allResourceEntries = performance.getEntriesByType?.('resource') || [];
        const retainedResourceEntries = visualOptions?.retainFullResources
            ? allResourceEntries : allResourceEntries.slice(-25);
        const environment = {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            activeElement: document.activeElement ? {
                tag: document.activeElement.tagName,
                id: document.activeElement.id || '',
                className: String(document.activeElement.className || ''),
                ariaLabel: document.activeElement.getAttribute?.('aria-label') || '',
            } : null,
            online: navigator.onLine,
            userAgent: navigator.userAgent,
            language: navigator.language,
            languages: [...(navigator.languages || [])],
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: navigator.deviceMemory || null,
            devicePixelRatio: window.devicePixelRatio || 1,
            viewport: {
                innerWidth: window.innerWidth, innerHeight: window.innerHeight,
                outerWidth: window.outerWidth, outerHeight: window.outerHeight,
                scrollX: window.scrollX, scrollY: window.scrollY,
            },
            screen: window.screen ? {
                width: screen.width, height: screen.height,
                availWidth: screen.availWidth, availHeight: screen.availHeight,
                colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
            } : null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
            colorSchemeDark: matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? null,
            navigation: performance.getEntriesByType?.('navigation')?.map(entry => ({
                type: entry.type,
                startTime: entry.startTime,
                duration: entry.duration,
                domInteractive: entry.domInteractive,
                domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
                loadEventEnd: entry.loadEventEnd,
                transferSize: entry.transferSize,
                decodedBodySize: entry.decodedBodySize,
            })) || [],
            resourceSummary: {
                observed: allResourceEntries.length,
                retained: retainedResourceEntries.length,
                transferSize: allResourceEntries.reduce((sum, entry) => sum + (Number(entry.transferSize) || 0), 0),
                decodedBodySize: allResourceEntries.reduce((sum, entry) => sum + (Number(entry.decodedBodySize) || 0), 0),
            },
            resources: retainedResourceEntries.map(entry => ({
                name: entry.name,
                entryType: entry.entryType,
                initiatorType: entry.initiatorType,
                startTime: entry.startTime,
                duration: entry.duration,
                fetchStart: entry.fetchStart,
                domainLookupStart: entry.domainLookupStart,
                domainLookupEnd: entry.domainLookupEnd,
                connectStart: entry.connectStart,
                secureConnectionStart: entry.secureConnectionStart,
                connectEnd: entry.connectEnd,
                requestStart: entry.requestStart,
                responseStart: entry.responseStart,
                responseEnd: entry.responseEnd,
                transferSize: entry.transferSize,
                encodedBodySize: entry.encodedBodySize,
                decodedBodySize: entry.decodedBodySize,
                nextHopProtocol: entry.nextHopProtocol,
                renderBlockingStatus: entry.renderBlockingStatus,
                responseStatus: entry.responseStatus,
            })),
            memory: performance.memory ? {
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                usedJSHeapSize: performance.memory.usedJSHeapSize,
            } : null,
        };
        const domSnapshot = {
            root: root ? {
                tag: root.tagName,
                id: root.id || '',
                className: String(root.className || ''),
                attributes: Object.fromEntries([...root.attributes].map(attribute => [attribute.name, attribute.value])),
                rect: rootRect,
                childElementCount: root.childElementCount,
                descendantCount: root.querySelectorAll('*').length,
                canvasCount: root.querySelectorAll('canvas').length,
                buttonCount: root.querySelectorAll('button').length,
                text: root.innerText || '',
                ...(visualOptions?.retainFullDom ? { outerHTML: rootOuterHTML } : {}),
                outerHTMLBytes: rootOuterHTML.length,
                outerHTMLHash: hash(rootOuterHTML),
                outerHTMLStructuralHash: hash(rootStructuralHTML),
            } : null,
            document: {
                htmlClassName: document.documentElement.className || '',
                htmlDataTheme: document.documentElement.getAttribute('data-theme'),
                bodyClassName: document.body?.className || '',
                bodyChildElementCount: document.body?.childElementCount || 0,
            },
        };
        const canvas = root ? [...root.querySelectorAll('canvas')].map(element => {
            let data = '';
            if (visualOptions?.includeCanvasImages) {
                try { data = element.toDataURL('image/png'); } catch (_) { }
            }
            let sampledPixels = null;
            let pixelStats = null;
            try {
                // A bounded downscaled surface avoids allocating a full RGBA
                // buffer (several MiB on a large Grafana panel) at every
                // semantic checkpoint while preserving stable visual evidence.
                const sourceWidth = Math.max(1, element.width || 1);
                const sourceHeight = Math.max(1, element.height || 1);
                const sampleWidth = Math.max(1, Math.min(160, sourceWidth));
                const sampleHeight = Math.max(1, Math.min(90,
                    Math.round(sourceHeight * sampleWidth / sourceWidth)));
                const sampleCanvas = document.createElement('canvas');
                sampleCanvas.width = sampleWidth;
                sampleCanvas.height = sampleHeight;
                const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
                context.drawImage(element, 0, 0, sampleWidth, sampleHeight);
                sampledPixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
                const stride = Math.max(1, Math.floor((sampleWidth * sampleHeight) / 16384));
                const bins = Array(16).fill(0);
                let count = 0, sum = 0, sumSq = 0, transparent = 0, min = 255, max = 0;
                for (let pixel = 0; pixel < sampleWidth * sampleHeight; pixel += stride) {
                    const offset = pixel * 4;
                    const luminance = Math.round(0.2126 * sampledPixels[offset]
                        + 0.7152 * sampledPixels[offset + 1] + 0.0722 * sampledPixels[offset + 2]);
                    count += 1; sum += luminance; sumSq += luminance * luminance;
                    if (sampledPixels[offset + 3] < 5) transparent += 1;
                    min = Math.min(min, luminance); max = Math.max(max, luminance);
                    bins[Math.min(15, Math.floor(luminance / 16))] += 1;
                }
                const mean = count ? sum / count : 0;
                pixelStats = {
                    samples: count, luminanceMean: Number(mean.toFixed(3)),
                    luminanceStdDev: Number(Math.sqrt(Math.max(0, sumSq / Math.max(1, count) - mean * mean)).toFixed(3)),
                    luminanceMin: min, luminanceMax: max,
                    transparentRatio: Number((transparent / Math.max(1, count)).toFixed(4)), histogram16: bins,
                    sampleWidth, sampleHeight,
                };
            } catch (error) {
                pixelStats = { error: error?.message || String(error) };
            }
            const dimensionBytes = new Uint8Array([
                element.width & 255, (element.width >>> 8) & 255,
                element.height & 255, (element.height >>> 8) & 255,
            ]);
            const h = hashBytes(sampledPixels || dimensionBytes);

            // The hash supports compact matrix comparisons; the image is retained
            // as visual evidence for the diagnostic viewer and exported artifact.
            return {
                width: element.width,
                height: element.height,
                hash: h,
                bytes: data.length,
                ...(visualOptions?.includeCanvasImages ? { dataUrl: data } : {}),
                pixelStats,
            };
        }) : [];
        const state = window.__dashbridgePanelToolsState || null;
        // Use the production engine's resolver so the diagnostic renderer is
        // not reported as "unknown" for a chart the threshold engine can see.
        const findUPlot = () => {
            const resolved = visual?.findUPlot?.(root);
            if (resolved?.series && typeof resolved.redraw === 'function') return resolved;
            const candidates = root ? [root, ...root.querySelectorAll('.uplot, .u-wrap, canvas')] : [];
            for (const candidate of candidates) {
                for (const key of Object.getOwnPropertyNames(candidate)) {
                    let direct;
                    try { direct = candidate[key]; } catch (_) { continue; }
                    if (direct?.series && typeof direct.redraw === 'function' && typeof direct.setData === 'function') return direct;
                }
            }
            return null;
        };
        const uplot = findUPlot();
        const axes = uplot?.axes?.map((axis, index) => ({
            index,
            scale: axis.scale || null,
            side: axis.side ?? null,
            size: display(axis._size),
            space: display(axis._space),
            found: Array.isArray(axis._found) ? axis._found.map(display) : display(axis._found),
        })) || [];
        let series = [];
        let renderer = 'unknown';
        if (uplot?.series) {
            renderer = 'uplot';
            series = uplot.series.slice(1).map((item, index) => ({
                index: index + 1,
                label: item.label || '',
                // Grafana's uPlot invokes fill as a callback, so the public
                // renderer value remains callable. The engine records the
                // semantic disabled state separately for causal verification.
                fill: item.__dashbridgeFillDisabled === true ? false : display(item.fill),
                fillDisabled: item.__dashbridgeFillDisabled === true,
                fillType: typeof item.fill,
                evaluatedFill: (() => {
                    try {
                        const value = typeof item.fill === 'function' ? item.fill(uplot, index + 1) : item.fill;
                        return display(value);
                    } catch (error) {
                        return `[error: ${error?.message || String(error)}]`;
                    }
                })(),
                originalFill: display(item.__dashbridgeOriginalAreaFill),
                evaluatedOriginalFill: (() => {
                    try {
                        const original = item.__dashbridgeOriginalAreaFill;
                        const value = typeof original === 'function' ? original(uplot, index + 1) : original;
                        return display(value);
                    } catch (error) {
                        return `[error: ${error?.message || String(error)}]`;
                    }
                })(),
                width: display(item.width),
                originalWidth: display(item.__dashbridgeOriginalLineWidth),
                show: display(item.show)
            }));
        } else {
            const flot = (() => {
                const $ = window.jQuery || window.$;
                if (!$ || !root) return null;
                try {
                    // Match the production getFlotPlot() resolver. Grafana 10
                    // stores the live plot on the chart host via jQuery data;
                    // $.plot.getPlot() is not part of this runtime and made
                    // working fill/width changes look unsupported to E2E.
                    const hosts = $(root)
                        .find('.graph-panel__chart, .flot-base, canvas')
                        .addBack('.graph-panel__chart, .flot-base, canvas')
                        .toArray();
                    const host = hosts.find(element => !!$(element).data('plot'));
                    return host ? $(host).data('plot') : null;
                } catch (_) { return null; }
            })();
            if (flot?.getData) {
                renderer = 'flot';
                series = flot.getData().map((item, index) => ({
                    index,
                    label: item.label || '',
                    fill: display(item.lines?.fill),
                    fillDisabled: item.lines?.fill === false,
                    fillType: typeof item.lines?.fill,
                    evaluatedFill: display(item.lines?.fill),
                    originalFill: display(item.__dashbridgeOriginalAreaFill),
                    evaluatedOriginalFill: display(item.__dashbridgeOriginalAreaFill),
                    width: display(item.lines?.lineWidth),
                    originalWidth: display(item.__dashbridgeOriginalLineWidth),
                    show: display(item.lines?.show),
                }));
            }
        }
        const legendEntries = root ? Array.from(dom?.legendItems?.(panel) || []) : [];
        const legendContainer = root?.querySelector('.dashbridge-legend-bottom') || null;
        const chartHost = root?.querySelector('.graph-panel__chart, .uplot, canvas') || null;
        const rectOf = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
                left: Math.round(rect.left), top: Math.round(rect.top),
                right: Math.round(rect.right), bottom: Math.round(rect.bottom),
                width: Math.round(rect.width), height: Math.round(rect.height),
            };
        };
        const legendSelectors = '.graph-legend, .legend-container, .u-legend, [class*="legend-container" i], [class*="LegendTable" i]';
        const containsAllLegendItems = candidate => candidate
            && legendEntries.length > 0
            && legendEntries.every(item => candidate.contains(item));
        // Grafana 12 can render virtualized legend buttons in a generated class
        // wrapper (for example `css-*`) without any stable legend/table selector.
        // Match the production engine: when that happens, derive the lowest
        // shared ancestor of all entries. This is the actual visual legend and
        // lets geometry distinguish bottom from right instead of accepting a
        // flex-direction-only change as evidence.
        const sharedLegendAncestor = () => {
            if (!legendEntries.length) return null;
            let candidate = legendEntries[0];
            while (candidate && candidate !== root) {
                if (containsAllLegendItems(candidate)) return candidate;
                candidate = candidate.parentElement;
            }
            return null;
        };
        const legendRow = root?.querySelector('tr[class*="LegendRow"], .u-legend tr, .u-legend-row') || null;
        const namedLegend = legendRow?.closest?.(`table, [role="table"], .u-legend, ${legendSelectors}`)
            || legendEntries[0]?.closest?.(`table, [role="table"], .u-legend, ${legendSelectors}`)
            || root?.querySelector(legendSelectors)
            || null;
        const detectedLegend = legendContainer
            || (namedLegend && (!legendEntries.length || containsAllLegendItems(namedLegend)) ? namedLegend : null)
            || sharedLegendAncestor();
        const findFlexContainer = element => {
            let candidate = element?.parentElement || null;
            while (candidate && candidate !== root) {
                const style = getComputedStyle(candidate);
                if (style.display === 'flex') return candidate;
                candidate = candidate.parentElement;
            }
            return null;
        };
        const flexContainer = findFlexContainer(chartHost);
        const chartRect = rectOf(chartHost);
        const legendRect = rectOf(detectedLegend);
        const flexStyle = flexContainer ? getComputedStyle(flexContainer) : null;
        const belowChart = !!(chartRect && legendRect && legendRect.top >= chartRect.bottom - 2);
        const rightOfChart = !!(chartRect && legendRect && legendRect.left >= chartRect.right - 2);
        const spansChartWidth = !!(chartRect && legendRect && legendRect.width >= chartRect.width * 0.8);
        const grafanaDirection = flexContainer?.classList.contains('graph-panel--legend-right')
            ? 'right'
            : (flexContainer?.classList.contains('graph-panel--legend-bottom') ? 'bottom' : null);
        // Grafana 10 keeps its native `graph-panel--legend-right` class while
        // DashBridge temporarily overrides the same container with inline
        // flex-direction:column. During an active DashBridge lifecycle the
        // saved baseline + marker/inline style is newer evidence than that
        // intentionally stale native class. Preferring the class made a
        // visibly moved Flot legend fail H3 even though production worked.
        const dashBridgeLayoutActive = !!root
            && Object.prototype.hasOwnProperty.call(root, '__dashBridgeLegendOriginalDirection')
            && [flexContainer, chartHost, detectedLegend].filter(Boolean)
                .some(element => Object.prototype.hasOwnProperty.call(element, '__dashBridgeLegendLayoutSnapshot'));
        const dashBridgeDirection = dashBridgeLayoutActive && flexStyle?.flexDirection === 'column' && legendContainer
            ? 'bottom'
            : (dashBridgeLayoutActive && flexStyle?.flexDirection === 'row' && !legendContainer ? 'right' : null);
        const direction = dashBridgeDirection || grafanaDirection
            || (rightOfChart ? 'right' : (belowChart ? 'bottom' : 'unknown'));
        const directionEvidence = dashBridgeDirection ? 'dashbridge-active-layout'
            : (grafanaDirection ? 'grafana-class'
                : (rightOfChart ? 'legend-left >= chart-right' : (belowChart ? 'legend-top >= chart-bottom' : 'no-unambiguous-geometry')));
        // The marker and containment count identify the intended legend table,
        // while geometry proves it is visibly below the chart rather than merely
        // reflowing the Name/Mean/Max cells in its original position.
        const bottomLayout = {
            chart: chartRect,
            container: rectOf(legendContainer),
            belowChart,
            spansChartWidth,
        };
        const legendPosition = {
            direction,
            directionEvidence,
            grafanaDirection,
            markerBottom: !!legendContainer,
            chart: chartRect,
            legend: legendRect,
            flex: rectOf(flexContainer),
            relations: { belowChart, rightOfChart, spansChartWidth },
            flexStyle: flexStyle ? { display: flexStyle.display, flexDirection: flexStyle.flexDirection } : null,
            flexClasses: flexContainer?.className || '',
            legendClasses: detectedLegend?.className || '',
            inlineStyles: {
                flex: flexContainer?.getAttribute('style') || null,
                chart: chartHost?.getAttribute('style') || null,
                legend: detectedLegend?.getAttribute('style') || null,
            },
            engineState: {
                originalDirection: root?.__dashBridgeLegendOriginalDirection || null,
                hasLayoutSnapshot: [flexContainer, chartHost, detectedLegend]
                    .filter(Boolean)
                    .some(element => Object.prototype.hasOwnProperty.call(element, '__dashBridgeLegendLayoutSnapshot')),
            },
        };
        // Keep the same occurrence key as the production visibility command.
        // Label text alone is ambiguous whenever Grafana renders duplicate series.
        const legendOccurrences = new Map();
        const readNativeDisabled = entry => [...entry.querySelectorAll('button')].some(button => {
            const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
            for (let fiber = fiberKey && button[fiberKey], depth = 0;
                fiber && depth < 32; depth += 1, fiber = fiber.return) {
                const item = fiber.memoizedProps?.item;
                if (item && typeof fiber.memoizedProps.onLabelClick === 'function') return item.disabled === true;
            }
            return false;
        });
        const visibilityEntries = legendEntries.map(entry => {
            const labelNode = dom?.legendLabel?.(entry) || entry;
            const label = (labelNode.textContent || '').trim();
            const occurrence = legendOccurrences.get(label) || 0;
            legendOccurrences.set(label, occurrence + 1);
            const classes = `${entry.className || ''} ${labelNode.className || ''}`.toLowerCase();
            const opacity = Number.parseFloat(getComputedStyle(entry).opacity || '1');
            return {
                key: `${label}\u0000${occurrence}`,
                label,
                occurrence,
                hidden: entry.classList.contains('dashbridge-uplot-fast-hidden'),
                dimmed: entry.classList.contains('dashbridge-uplot-fast-dimmed'),
                nativeHidden: readNativeDisabled(entry),
                visuallyHidden: classes.includes('hidden') || classes.includes('disabled') || opacity < 0.6,
            };
        }).filter(entry => entry.label);
        const markerLabels = selector => root
            ? [...root.querySelectorAll(selector)].map(item => (item.textContent || '').trim()).filter(Boolean) : [];
        const thresholdHost = root?.matches?.('[data-dashbridge-threshold-engine]')
            ? root : root?.querySelector?.('[data-dashbridge-threshold-engine]');
        const nativeHiddenLabels = visibilityEntries.filter(entry => entry.nativeHidden).map(entry => entry.label);
        const logs = window.__dashbridgeDebugLogs ? window.__dashbridgeDebugLogs.splice(0, window.__dashbridgeDebugLogs.length) : [];
        const visualReapplySnapshot = (() => {
            const source = window.__dashbridgeVisualReapplyDiagnostic;
            if (!source) return null;
            const events = source.events || [];
            const retainedEvents = events.slice(-200);
            return JSON.parse(JSON.stringify({
                ...source,
                events: retainedEvents,
                eventWindow: {
                    total: events.length,
                    retained: retainedEvents.length,
                    firstRetainedId: retainedEvents[0]?.id || null,
                    lastRetainedId: retainedEvents.at(-1)?.id || null,
                    truncated: retainedEvents.length < events.length,
                },
            }));
        })();
        const visualMetadata = window.__dashbridgePanelToolsVisualMetadata || {};
        const dataStatusKind = visualMetadata.responseDataStatus?.kind || 'unknown';
        const intentionalEmpty = visualMetadata.responseFilterEmptyIsNormal === true
            && dataStatusKind === 'filtered_empty'
            && (state?.seriesQueryFilterEnabled === true || state?.cpuCapacityFilterEnabled === true);
        return {
            at: Date.now(), panelId: pid || null, panelFound: !!root, renderer,
            environment,
            domSnapshot,
            logs,
            legendVisibilityDiagnostic: window.__dashbridgeLegendVisibilityDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgeLegendVisibilityDiagnostic)) : null,
            panelToolsCommandDiagnostic: window.__dashbridgePanelToolsCommandDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgePanelToolsCommandDiagnostic)) : null,
            panelToolsRuntime: {
                loaded: !!window.__dashbridgePanelToolsRuntimeLoaded,
                handlerInstalled: typeof window.__dashbridgePanelToolsMessageHandler === 'function',
                runtimeGeneration: window.__dashbridgePanelToolsRuntimeGeneration || null,
                allowTop: !!window.__dashbridgePanelToolsAllowTop,
            },
            visualStyleState: visual?.getLocalStyleDebug?.({
                root,
                removeFill: !!state?.removeFill,
                thickenLines: !!state?.thickenLines,
            }) || null,
            visualReapplyDiagnostic: visualReapplySnapshot,
            dataStatus: {
                kind: dataStatusKind,
                intentionalEmpty,
            },
            legacyVisualObserverDiagnostic: window.__dashbridgeLegacyVisualObserverDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgeLegacyVisualObserverDiagnostic)) : null,
            dataLayoutReflowDiagnostic: window.__dashbridgeDataLayoutReflowDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgeDataLayoutReflowDiagnostic)) : null,
            canvas, axes, legendItems: legendEntries.length,
            legend: {
                entries: legendEntries.length,
                bottomEntries: legendContainer
                    ? legendEntries.filter(item => legendContainer.contains(item)).length : 0,
                bottomContainer: legendContainer ? {
                    tag: legendContainer.tagName,
                    className: legendContainer.className,
                    text: (legendContainer.innerText || '').trim(),
                } : null,
                layout: bottomLayout,
                position: legendPosition,
            },
            chartSeriesCount: root ? (visual?.getChartSeriesCount?.(root) || 0) : 0,
            markers: root ? {
                legendBottom: !!root.querySelector('.dashbridge-legend-bottom'),
                hidden: root.querySelectorAll('.dashbridge-uplot-fast-hidden').length,
                hiddenLabels: markerLabels('.dashbridge-uplot-fast-hidden'),
                dimmed: root.querySelectorAll('.dashbridge-uplot-fast-dimmed').length,
                dimmedLabels: markerLabels('.dashbridge-uplot-fast-dimmed'),
                nativeHidden: nativeHiddenLabels.length,
                nativeHiddenLabels,
                visibilityEntries,
                threshold: root.querySelectorAll('[data-dashbridge-threshold-line]').length,
                thresholdEngine: thresholdHost?.getAttribute('data-dashbridge-threshold-engine') || '',
            } : {},
            // These are compact MAIN-world counters. They make network and
            // threshold failures actionable without retaining query payloads.
            interceptor: window.__dashbridgeDataInterceptorDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgeDataInterceptorDiagnostic)) : null,
            thresholdDiagnostic: window.__dashbridgeThresholdDiagnostic
                ? JSON.parse(JSON.stringify(window.__dashbridgeThresholdDiagnostic)) : null,
            tools: state ? JSON.parse(JSON.stringify(state)) : null,
            series,
        };
    }, [panelId, { includeCanvasImages, retainFullDom, retainFullResources }]);
    const visualStateRef = `visual-state-${runtimeVisualReuseHash(diagnostic)}`;
    if (canReuseRuntimeVisual(diagnostic, reuseVisualFrom, mode)) {
        if (mode === DIAGNOSTIC_CAPTURE_MODES.PANEL || mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC) {
            diagnostic.panelImage = reuseVisualFrom.panelImage;
        }
        if (mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC) {
            diagnostic.viewportImage = reuseVisualFrom.viewportImage;
        }
        diagnostic.visualCapture = {
            mode: 'reused-equivalent',
            requestedMode: mode,
            reason: captureReason,
            visualStateRef,
            sourceAt: reuseVisualFrom.visualCapture?.sourceAt || reuseVisualFrom.at || null,
            verifiedAt: diagnostic.at,
            signatureHash: runtimeVisualReuseHash(diagnostic),
            proof: 'renderer+dom+geometry+canvas+legend+markers+series+threshold+visual-style+tools',
        };
        return diagnostic;
    }
    if (mode === DIAGNOSTIC_CAPTURE_MODES.SEMANTIC) {
        diagnostic.visualCapture = {
            mode: 'hash-only',
            requestedMode: mode,
            reason: captureReason,
            visualStateRef,
            sourceAt: diagnostic.at,
            verifiedAt: diagnostic.at,
            signatureHash: runtimeVisualReuseHash(diagnostic),
            proof: 'fresh-renderer+dom+geometry+canvas-hash+pixels+legend+markers+series+threshold+visual-style+tools',
        };
        return diagnostic;
    }
    if (mode === DIAGNOSTIC_CAPTURE_MODES.CANVAS) {
        diagnostic.visualCapture = {
            mode: 'captured-canvas',
            requestedMode: mode,
            reason: captureReason,
            visualStateRef,
            sourceAt: diagnostic.at,
            verifiedAt: diagnostic.at,
            signatureHash: runtimeVisualReuseHash(diagnostic),
        };
        return diagnostic;
    }
    // Canvas snapshots omit Grafana's HTML legend. This crop preserves the
    // visible panel layout, including series rows below the plot.
    const imageCapture = await capturePanelDiagnosticImage(tabId, panelId, {
        retainViewport: mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
    });
    diagnostic.viewportImage = imageCapture?.viewportImage || null;
    if (imageCapture && Object.prototype.hasOwnProperty.call(imageCapture, 'viewportImage')) {
        delete imageCapture.viewportImage;
    }
    diagnostic.panelImage = imageCapture;
    diagnostic.visualCapture = {
        mode: reuseVisualFrom ? 'captured-after-reuse-mismatch' : 'captured',
        requestedMode: mode,
        reason: captureReason,
        visualStateRef,
        sourceAt: diagnostic.at,
        verifiedAt: diagnostic.at,
        signatureHash: runtimeVisualReuseHash(diagnostic),
    };
    return diagnostic;
}

async function readRuntimeDiagnosticEvents(tabId, afterEventId = 0) {
    return execMain(tabId, lastId => {
        const journal = window.__dashbridgeE2EDiagnostics;
        const events = journal?.events || [];
        const cursor = Number.isInteger(lastId) && lastId >= 0 ? lastId : 0;
        return {
            startedAt: journal?.startedAt || null,
            nextEventId: journal?.nextEventId || 0,
            events: events.filter(event => event.id > cursor),
        };
    }, [afterEventId]);
}

async function readNetworkDiagnosticArchive(tabId) {
    return execMain(tabId, () => {
        const archive = window.__dashbridgeDataInterceptorArchive;
        return archive ? JSON.parse(JSON.stringify(archive)) : {
            schema: 'dashbridge-e2e-network-payload-archive/v1',
            startedAt: null,
            requests: {},
            responses: {},
        };
    });
}

function runtimeSnapshotRef(path, snapshot) {
    return {
        ref: path,
        at: snapshot?.at || null,
        panelId: snapshot?.panelId || null,
        panelImageHash: snapshot?.panelImage?.hash || null,
        viewportImageHash: snapshot?.viewportImage?.hash || null,
        canvasHashes: (snapshot?.canvas || []).map(image => image?.hash).filter(Boolean),
        domOuterHTMLHash: snapshot?.domSnapshot?.root?.outerHTMLHash || null,
    };
}

// Builds an exhaustive, machine-readable explanation of what changed between
// two observations. Full snapshots are retained separately; image payloads are
// represented here by hashes so the diff does not duplicate base64 data.
function buildRuntimeDiagnosticDiff(before, after) {
    const changes = [];
    const countsByRoot = {};
    let truncated = false;
    const maxChanges = 25_000;
    const hashText = text => {
        let value = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            value = Math.imul(value ^ text.charCodeAt(index), 16777619);
        }
        return `fnv1a-${(value >>> 0).toString(16)}`;
    };
    const imageDescriptor = value => value && typeof value === 'object' ? {
        hash: value.hash || null,
        width: value.width || null,
        height: value.height || null,
        bytes: value.imageBytes || value.bytes || value.dataUrl?.length || null,
        error: value.error || null,
        capturedAt: value.capturedAt || null,
        pixelStats: value.pixelStats || null,
    } : null;
    const safeValue = (value, depth = 0) => {
        if (typeof value === 'string' && value.startsWith('data:image/')) {
            return { imagePayload: true, characters: value.length, hash: hashText(value) };
        }
        if (typeof value === 'string' && value.length > 8192) {
            return {
                largeCanonicalValue: true,
                characters: value.length,
                hash: hashText(value),
                first4096: value.slice(0, 4096),
                last4096: value.slice(-4096),
            };
        }
        if (value === null || value === undefined || typeof value !== 'object') return value;
        if (depth > 14) return '[diff-depth-limit]';
        if (Array.isArray(value)) return value.map(item => safeValue(item, depth + 1));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            key === 'dataUrl' ? safeValue(item, depth + 1) : safeValue(item, depth + 1),
        ]));
    };
    const push = (path, beforeValue, afterValue, kind) => {
        if (changes.length >= maxChanges) { truncated = true; return; }
        const root = path.split(/[.[]/, 1)[0] || '(root)';
        countsByRoot[root] = (countsByRoot[root] || 0) + 1;
        changes.push({
            index: changes.length + 1,
            path,
            kind,
            before: safeValue(beforeValue),
            after: safeValue(afterValue),
        });
    };
    const walk = (left, right, path = '', depth = 0) => {
        if (changes.length >= maxChanges) { truncated = true; return; }
        if (Object.is(left, right)) return;
        if (path.endsWith('.dataUrl') || path === 'dataUrl') {
            push(path, imageDescriptor({ dataUrl: left }), imageDescriptor({ dataUrl: right }), 'image-payload-changed');
            return;
        }
        const leftObject = left !== null && typeof left === 'object';
        const rightObject = right !== null && typeof right === 'object';
        if (!leftObject || !rightObject || depth >= 16) {
            push(path || '(root)', left, right, left === undefined ? 'added' : (right === undefined ? 'removed' : 'changed'));
            return;
        }
        if (Array.isArray(left) !== Array.isArray(right)) {
            push(path || '(root)', left, right, 'type-changed');
            return;
        }
        const keys = Array.isArray(left)
            ? Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index)
            : [...new Set([...Object.keys(left), ...Object.keys(right)])];
        keys.forEach(key => walk(left[key], right[key], Array.isArray(left)
            ? `${path}[${key}]`
            : (path ? `${path}.${key}` : key), depth + 1));
    };
    walk(before || null, after || null);

    const eventDelta = (left, right) => {
        const leftEvents = Array.isArray(left?.events) ? left.events : [];
        const rightEvents = Array.isArray(right?.events) ? right.events : [];
        const lastId = leftEvents.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);
        return rightEvents.filter(event => (Number(event?.id) || 0) > lastId);
    };
    const keyedDelta = (left = [], right = [], keyOf) => {
        const leftMap = new Map(left.map(item => [keyOf(item), item]));
        const rightMap = new Map(right.map(item => [keyOf(item), item]));
        const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
        return keys.flatMap(key => {
            const a = leftMap.get(key);
            const b = rightMap.get(key);
            return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ key, before: a || null, after: b || null }];
        });
    };
    const beforeCanvas = before?.canvas || [];
    const afterCanvas = after?.canvas || [];
    return {
        schema: 'dashbridge-e2e-runtime-diff/v1',
        beforeAt: before?.at || null,
        afterAt: after?.at || null,
        elapsedMs: before?.at && after?.at ? Math.max(0, after.at - before.at) : null,
        changed: changes.length > 0,
        changeCount: changes.length,
        truncated,
        maxChanges,
        countsByRoot,
        changes,
        images: {
            panel: { before: imageDescriptor(before?.panelImage), after: imageDescriptor(after?.panelImage) },
            viewport: { before: imageDescriptor(before?.viewportImage), after: imageDescriptor(after?.viewportImage) },
            canvas: Array.from({ length: Math.max(beforeCanvas.length, afterCanvas.length) }, (_, index) => ({
                index,
                before: imageDescriptor(beforeCanvas[index]),
                after: imageDescriptor(afterCanvas[index]),
            })),
        },
        tools: { before: before?.tools || null, after: after?.tools || null },
        markers: { before: before?.markers || null, after: after?.markers || null },
        visibilityChanges: keyedDelta(
            before?.markers?.visibilityEntries,
            after?.markers?.visibilityEntries,
            item => item?.key || ''
        ),
        seriesChanges: keyedDelta(before?.series, after?.series, item => `${item?.index}\u0000${item?.label || ''}`),
        network: {
            before: before?.interceptor || null,
            after: after?.interceptor || null,
            addedEvents: eventDelta(before?.interceptor, after?.interceptor),
        },
        visualReapply: {
            before: before?.visualReapplyDiagnostic || null,
            after: after?.visualReapplyDiagnostic || null,
            addedEvents: eventDelta(before?.visualReapplyDiagnostic, after?.visualReapplyDiagnostic),
        },
        consoleAndDebugLogs: {
            before: before?.logs || [],
            after: after?.logs || [],
        },
        dom: {
            beforeHash: before?.domSnapshot?.root?.outerHTMLHash || null,
            afterHash: after?.domSnapshot?.root?.outerHTMLHash || null,
            beforeBytes: before?.domSnapshot?.root?.outerHTMLBytes || null,
            afterBytes: after?.domSnapshot?.root?.outerHTMLBytes || null,
            changed: before?.domSnapshot?.root?.outerHTMLHash !== after?.domSnapshot?.root?.outerHTMLHash,
        },
    };
}

async function readQueryLifecycle(tabId, afterEventId = 0) {
    return execMain(tabId, lastId => {
        const journal = window.__dashbridgeDataInterceptorDiagnostic;
        const cursor = Number.isInteger(lastId) && lastId >= 0 ? lastId : 0;
        const events = Array.isArray(journal?.events) ? journal.events : [];
        return {
            nextEventId: Number(journal?.nextEventId) || 0,
            activeRequests: Number(journal?.activeRequests) || 0,
            events: events.filter(event => event.id > cursor),
            last: journal?.last ? JSON.parse(JSON.stringify(journal.last)) : null,
        };
    }, [afterEventId]);
}

// The deadline is strictly a watchdog. Completion is caused by a selected
// panel response reaching a terminal journal state, never by elapsed time.
async function waitForTargetQueryLifecycle(tabId, afterEventId, timeoutMs = 12000) {
    return execMain(tabId, (cursor, timeout) => new Promise(resolve => {
        const journal = window.__dashbridgeDataInterceptorDiagnostic;
        const startedAt = performance.now();
        const finish = result => resolve({
            ...result,
            cursor: Number(journal?.nextEventId) || cursor,
            activeRequests: Number(journal?.activeRequests) || 0,
            events: (journal?.events || []).filter(event => event.id > cursor),
        });
        const poll = () => {
            const events = (journal?.events || []).filter(event => event.id > cursor);
            const target = [...events].reverse().find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
            if (target) return finish({ status: 'target-complete', target });
            const targetDecodeError = [...events].reverse().find(event => event.stage === 'decode-error');
            if (targetDecodeError) return finish({ status: 'decode-error', error: targetDecodeError });
            if (performance.now() - startedAt >= timeout) {
                const started = events.some(event => event.stage === 'request-start');
                const httpError = [...events].reverse().find(event => event.stage === 'query-error');
                return finish({
                    status: httpError ? 'query-error' : (started ? 'target-not-matched' : 'request-not-started'),
                    error: httpError || null,
                });
            }
            requestAnimationFrame(poll);
        };
        poll();
    }), [afterEventId, timeoutMs]);
}

// ─── Transition matrix executor ────────────────────────────────────

/**
 * Снимает текущее визуальное состояние: canvas data URL + DOM-маркеры.
 * @param {number} tabId
 * @param {string} panelId
 * @returns {Promise<{canvas: string|null, dom: object}>}
 */
async function captureState(tabId, panelId) {
    // Keep canvas and DOM snapshots in one MAIN-world operation so both refer
    // to the same resolved panel branch.
    const [canvas, dom] = await Promise.all([
        execMain(tabId, pid => {
            const shared = window.DashBridgeGrafanaDom;
            const panel = shared?.findPanelById?.(pid);
            let root = shared?.outerPanel?.(panel) || panel;
            while (root && !root.classList?.contains('react-grid-item')
                && !root.classList?.contains('panel-container') && root.parentElement) root = root.parentElement;
            if (!root) return null;
            // Flot uses layered canvases; serialize all layers to observe redraws.
            const image = [...root.querySelectorAll('canvas')].map(cnv => {
                try { return cnv.toDataURL(); } catch (_) { return ''; }
            }).join('|');
            return image || null;
        }, [panelId]),
        execMain(tabId, pid => {
            const shared = window.DashBridgeGrafanaDom;
            const panel = shared?.findPanelById?.(pid);
            let root = shared?.outerPanel?.(panel) || panel;
            while (root && !root.classList?.contains('react-grid-item')
                && !root.classList?.contains('panel-container') && root.parentElement) root = root.parentElement;
            if (!root) return { legendBottom: false, hidden: false, dimmed: false, seriesCount: 0, thresholdApplied: false, hasCanvas: false };
            const thresholdHost = root.matches?.('[data-dashbridge-threshold-engine]')
                ? root : root.querySelector('[data-dashbridge-threshold-engine]');
            return {
                legendBottom: !!root.querySelector('.dashbridge-legend-bottom'),
                hidden: !!root.querySelector('.dashbridge-uplot-fast-hidden'),
                dimmed: !!root.querySelector('.dashbridge-uplot-fast-dimmed'),
                seriesCount: root.querySelectorAll('.dashbridge-uplot-fast-hidden').length
                    + root.querySelectorAll('.dashbridge-uplot-fast-dimmed').length,
                // The overlay line can be clipped when a threshold is outside
                // the current Y range. The engine marker proves computation and
                // application without requiring an incidental canvas repaint.
                thresholdApplied: !!thresholdHost?.getAttribute('data-dashbridge-threshold-engine'),
                thresholdEngine: thresholdHost?.getAttribute('data-dashbridge-threshold-engine') || '',
                hasCanvas: root.querySelectorAll('canvas').length > 0,
            };
        }, [panelId]),
    ]);
    return { canvas, dom };
}

/**
 * Waits until the selected panel has reached a real, observable steady state.
 * A command acknowledgement and a terminal query event are not sufficient:
 * panel-tools can still have a two-frame visual reapply queued, while React or
 * uPlot can repaint the canvas shortly afterwards. The returned frame journal
 * is retained in the JSON report so fast changes remain diagnosable.
 */
async function waitForPanelStability(tabId, panelId, {
    timeoutMs = 8000,
    quietMs = 300,
    stableFrames = 4,
    sampleCap = 64,
} = {}) {
    return execMain(tabId, (pid, options) => new Promise(resolve => {
        const dom = window.DashBridgeGrafanaDom;
        const startedAt = performance.now();
        const startedWallAt = Date.now();
        const samples = [];
        let observedFrames = 0;
        let droppedSamples = 0;
        let lastFingerprint = null;
        let stableSince = null;
        let consecutiveStableFrames = 0;
        let mutationVersion = 0;
        let lastSampleMutationVersion = 0;
        let rootGeneration = 0;
        let observedRoot = null;
        let observer = null;
        const mutationCounts = {
            childList: 0,
            attributes: 0,
            characterData: 0,
            attributesByName: {},
            targets: {},
        };

        const hashText = value => {
            const text = String(value || '');
            let hash = 2166136261;
            for (let i = 0; i < text.length; i++) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
        };
        const serialisableTools = () => {
            const state = window.__dashbridgePanelToolsState || {};
            return {
                removeFill: !!state.removeFill,
                thickenLines: !!state.thickenLines,
                thickenLinesValue: state.thickenLinesValue ?? null,
                invertLegend: !!state.invertLegend,
                legendVisibility: state.legendVisibility ?? null,
                invertIdle: !!state.invertIdle,
                convertMemToUsed: !!state.convertMemToUsed,
                seriesQueryFilterEnabled: !!state.seriesQueryFilterEnabled,
                thresholdEnabled: !!state.thresholdEnabled,
            };
        };
        const attachObserver = root => {
            if (root === observedRoot) return;
            observer?.disconnect();
            observedRoot = root;
            rootGeneration += 1;
            if (!root) return;
            observer = new MutationObserver(records => {
                mutationVersion += records.length || 1;
                records.forEach(record => {
                    mutationCounts[record.type] = (mutationCounts[record.type] || 0) + 1;
                    if (record.attributeName) {
                        mutationCounts.attributesByName[record.attributeName]
                            = (mutationCounts.attributesByName[record.attributeName] || 0) + 1;
                    }
                    const target = record.target;
                    const signature = `${target?.tagName || target?.nodeName || 'unknown'}${target?.id ? `#${target.id}` : ''}${target?.className && typeof target.className === 'string' ? `.${target.className.replace(/\s+/g, '.').slice(0, 160)}` : ''}`;
                    mutationCounts.targets[signature] = (mutationCounts.targets[signature] || 0) + 1;
                });
            });
            observer.observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
                attributeFilter: ['class', 'style', 'width', 'height', 'aria-checked', 'aria-selected'],
            });
        };
        const finish = (status, reason) => {
            observer?.disconnect();
            const topMutationTargets = Object.entries(mutationCounts.targets)
                .map(([target, count]) => ({ target, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 100);
            resolve({
                schema: 'dashbridge-e2e-panel-settlement/v1',
                status,
                reason,
                panelId: pid,
                startedAt: startedWallAt,
                finishedAt: Date.now(),
                elapsedMs: Math.round(performance.now() - startedAt),
                requiredQuietMs: options.quietMs,
                requiredStableFrames: options.stableFrames,
                observedFrames,
                retainedSamples: samples.length,
                droppedSamples,
                samplePolicy: 'first-and-newest-bounded/v1',
                observedMutations: mutationVersion,
                observedRootGenerations: rootGeneration,
                mutationSummary: {
                    childList: mutationCounts.childList,
                    attributes: mutationCounts.attributes,
                    characterData: mutationCounts.characterData,
                    attributesByName: mutationCounts.attributesByName,
                    topTargets: topMutationTargets,
                },
                samples,
            });
        };
        const geometry = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const round = value => Math.round(Number(value || 0) * 100) / 100;
            return {
                x: round(rect.x), y: round(rect.y),
                width: round(rect.width), height: round(rect.height),
                top: round(rect.top), right: round(rect.right),
                bottom: round(rect.bottom), left: round(rect.left),
            };
        };
        const sample = () => {
            const panel = dom?.findPanelById?.(pid);
            const root = dom?.outerPanel?.(panel) || panel;
            let evidenceRoot = root;
            while (evidenceRoot && !evidenceRoot.classList?.contains('react-grid-item')
                && !evidenceRoot.classList?.contains('panel-container') && evidenceRoot.parentElement) {
                evidenceRoot = evidenceRoot.parentElement;
            }
            attachObserver(evidenceRoot);
            const now = performance.now();
            const canvases = evidenceRoot ? [...evidenceRoot.querySelectorAll('canvas')] : [];
            const canvas = canvases.map((item, index) => {
                let dataUrl = '';
                try { dataUrl = item.toDataURL(); } catch (_) { dataUrl = '[unavailable]'; }
                return {
                    index,
                    width: item.width,
                    height: item.height,
                    clientWidth: item.clientWidth,
                    clientHeight: item.clientHeight,
                    hash: hashText(dataUrl),
                };
            });
            const legend = root ? (dom?.legendItems?.(panel) || []).map((item, index) => ({
                index,
                label: (dom?.legendLabel?.(item)?.textContent || item.textContent || '').replace(/\s+/g, ' ').trim(),
                className: item.className || '',
                opacity: getComputedStyle(item).opacity,
                ariaChecked: item.getAttribute('aria-checked'),
                ariaSelected: item.getAttribute('aria-selected'),
                geometry: geometry(item),
            })) : [];
            const query = window.__dashbridgeDataInterceptorDiagnostic || {};
            const threshold = window.__dashbridgeThresholdDiagnostic || null;
            const visualReapply = window.__dashbridgeVisualReapplyDiagnostic || {};
            const dataLayoutReflow = window.__dashbridgeDataLayoutReflowDiagnostic || {};
            const visualMetadata = window.__dashbridgePanelToolsVisualMetadata || {};
            const dataStatusKind = visualMetadata.responseDataStatus?.kind || 'unknown';
            const intentionalEmpty = visualMetadata.responseFilterEmptyIsNormal === true
                && dataStatusKind === 'filtered_empty'
                && (window.__dashbridgePanelToolsState?.seriesQueryFilterEnabled === true
                    || window.__dashbridgePanelToolsState?.cpuCapacityFilterEnabled === true);
            const facts = {
                rootFound: !!evidenceRoot,
                rootConnected: !!evidenceRoot?.isConnected,
                rootGeneration,
                rootGeometry: geometry(evidenceRoot),
                canvas,
                legend,
                markers: evidenceRoot ? {
                    hidden: evidenceRoot.querySelectorAll('.dashbridge-uplot-fast-hidden').length,
                    dimmed: evidenceRoot.querySelectorAll('.dashbridge-uplot-fast-dimmed').length,
                    legendBottom: evidenceRoot.querySelectorAll('.dashbridge-legend-bottom').length,
                    thresholdEngine: evidenceRoot.getAttribute('data-dashbridge-threshold-engine') || '',
                } : null,
                tools: serialisableTools(),
                dataStatus: {
                    kind: dataStatusKind,
                    intentionalEmpty,
                },
                query: {
                    activeRequests: Number(query.activeRequests) || 0,
                    nextEventId: Number(query.nextEventId) || 0,
                    lastStage: query.last?.stage || null,
                    lastScope: query.last?.scope || null,
                },
                visualReapply: {
                    pending: visualReapply.pending === true,
                    activeGeneration: Number(visualReapply.activeGeneration) || 0,
                    attemptsPlanned: Number(visualReapply.attemptsPlanned) || 0,
                    attemptsFinished: Number(visualReapply.attemptsFinished) || 0,
                    lastCompletedAt: visualReapply.lastCompletedAt || null,
                    finishedAt: visualReapply.finishedAt || null,
                    errors: Number(visualReapply.errors) || 0,
                },
                dataLayoutReflow: {
                    pending: dataLayoutReflow.pending === true,
                    activeGeneration: Number(dataLayoutReflow.activeGeneration) || 0,
                    attemptsPlanned: Number(dataLayoutReflow.attemptsPlanned) || 0,
                    attemptsFinished: Number(dataLayoutReflow.attemptsFinished) || 0,
                    lastCompletedAt: dataLayoutReflow.lastCompletedAt || null,
                    finishedAt: dataLayoutReflow.finishedAt || null,
                    errors: Number(dataLayoutReflow.errors) || 0,
                },
                threshold: threshold ? {
                    enabled: !!threshold.enabled,
                    panelFound: !!threshold.panelFound,
                    engine: threshold.status?.engine || threshold.unitEngine || '',
                    applied: threshold.status?.applied ?? null,
                    exceeded: threshold.status?.exceeded ?? null,
                } : null,
                mutationVersion,
                mutationsSincePreviousFrame: mutationVersion - lastSampleMutationVersion,
            };
            // MutationObserver is diagnostic evidence, not the definition of a
            // visible state. Grafana virtualized legends rewrite identical style
            // attributes every frame. Include resulting geometry/semantics in
            // the fingerprint, while retaining raw mutation activity separately.
            const { mutationVersion: _mutationVersion, mutationsSincePreviousFrame: _mutationDelta, ...observableFacts } = facts;
            const fingerprint = JSON.stringify(observableFacts);
            const same = fingerprint === lastFingerprint;
            if (same) consecutiveStableFrames += 1;
            else {
                lastFingerprint = fingerprint;
                consecutiveStableFrames = 1;
                stableSince = now;
            }
            observedFrames += 1;
            samples.push({
                frame: observedFrames,
                at: Date.now(),
                elapsedMs: Math.round(now - startedAt),
                sameAsPrevious: same,
                consecutiveStableFrames,
                stableForMs: Math.round(now - stableSince),
                ...facts,
            });
            if (samples.length > options.sampleCap) {
                const removeCount = samples.length - options.sampleCap;
                // Preserve the first baseline frame and the newest bounded
                // window. Every frame still participates in the live verdict;
                // only repetitive report evidence is discarded.
                samples.splice(1, removeCount);
                droppedSamples += removeCount;
            }
            lastSampleMutationVersion = mutationVersion;

            const quietLongEnough = now - stableSince >= options.quietMs;
            const queryIdle = facts.query.activeRequests === 0;
            const visualReapplyIdle = facts.visualReapply.pending === false;
            const dataLayoutReflowIdle = facts.dataLayoutReflow.pending === false;
            const renderStateReady = canvas.length > 0 || facts.dataStatus.intentionalEmpty;
            if (facts.rootFound && facts.rootConnected && renderStateReady
                && queryIdle && visualReapplyIdle && dataLayoutReflowIdle && quietLongEnough
                && consecutiveStableFrames >= options.stableFrames) {
                finish('stable', facts.dataStatus.intentionalEmpty
                    ? 'The source filter produced a confirmed intentional empty state and panel lifecycle remained unchanged for the required window'
                    : 'Observable panel geometry, legend, canvas, query activity and visual reapply lifecycle remained unchanged for the required window');
                return;
            }
            if (now - startedAt >= options.timeoutMs) {
                const blockers = [];
                if (!facts.rootFound || !facts.rootConnected) blockers.push('panel-not-connected');
                if (!renderStateReady) blockers.push('canvas-missing');
                if (!queryIdle) blockers.push('query-still-active');
                if (!visualReapplyIdle) blockers.push('visual-reapply-pending');
                if (!dataLayoutReflowIdle) blockers.push('data-layout-reflow-pending');
                if (!quietLongEnough) blockers.push('panel-still-changing');
                if (consecutiveStableFrames < options.stableFrames) blockers.push('insufficient-stable-frames');
                finish('timeout', blockers.join(', ') || 'stability-timeout');
                return;
            }
            requestAnimationFrame(sample);
        };
        sample();
    }), [panelId, { timeoutMs, quietMs, stableFrames, sampleCap }]);
}

/**
 * Получает привязку сетевого преобразования непосредственно перед командой.
 * Подписи из popup не существуют в E2E-командах, поэтому без этого шага
 * перехватчик намеренно считает все ответы чужими для выбранной панели.
 */
async function captureTargetDataScope(tabId, panelId) {
    return execMain(tabId, async pid => {
        const dom = window.DashBridgeGrafanaDom;
        const visual = window.DashBridgeGrafanaVisualEngine;
        const panel = dom?.findPanelById?.(pid);
        const root = dom?.outerPanel?.(panel) || panel;
        if (!root) return { targetQuerySignatures: [], targetLegendSeries: [] };
        const legendItems = dom?.legendItems?.(panel) || [];
        const seen = new Set();
        const targetLegendSeries = legendItems.map(item => (item.textContent || '').trim())
            .filter(name => name && !seen.has(name) && seen.add(name));
        const targetQuerySignatures = await visual?.getPanelQuerySignaturesAsync?.({ root, panelId: pid }) || [];
        return { targetQuerySignatures, targetLegendSeries };
    }, [panelId]);
}

/**
 * Применяет настройки к панели через applyPanelTools и ждёт применения.
 * @param {number} tabId
 * @param {string} panelId
 * @param {object} settings — visualSettings и/или transformSettings
 */
async function applySettingsAndWait(tabId, panelId, settings, { refresh = true, verifyPersistence = false } = {}) {
    const transform = { ...(settings?.transformSettings || {}) };
    // Реальный UI всегда хранит числовое значение порога. E2E включает флаг
    // отдельно, поэтому задаём тот же валидный нулевой порог, если значения нет.
    if (transform.thresholdEnabled && !Object.prototype.hasOwnProperty.call(transform, 'thresholdValue')) {
        transform.thresholdValue = 0;
        transform.thresholdRawValue = null;
    }
    // Target scope is captured for every lifecycle command. This lets a visual
    // setting prove persistence against the selected panel's real response too.
    const targetScope = await captureTargetDataScope(tabId, panelId);
    const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;
    // `panelId` is retained for the matrix's compact call contract; the
    // top-level command also receives targetPanelId for panel-tools routing.
    const command = { panelId, targetPanelId: panelId, ...settings, ...targetScope, transformSettings: transform };
    const result = await applyPanelTools(tabId, command);
    // A command and a graph Refresh are separate user-visible actions. Capture
    // the exact intermediate state so failures in immediate application can be
    // distinguished from failures in refresh persistence.
    const afterCommandBeforeRefresh = await captureRuntimeDiagnostic(tabId, panelId, {
        captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
        captureReason: 'after-command-before-refresh-semantic-proof',
    });
    if (result?.status !== 'applied') return {
        ...result,
        afterCommandBeforeRefresh,
        refresh: null,
        lifecycle: null,
        settlement: null,
        cursor: commandCursor,
        commandCursor,
    };
    if (!refresh) {
        const settlement = await waitForPanelStability(tabId, panelId);
        return { ...result, afterCommandBeforeRefresh, refresh: null, lifecycle: null, settlement, cursor: commandCursor, commandCursor };
    }
    // Establish the causal cursor immediately before the refresh. Events emitted
    // while the command itself was applying must not satisfy the refresh wait.
    const cursor = (await readQueryLifecycle(tabId)).nextEventId;
    const refreshResult = await triggerRefresh(tabId);
    const lifecycle = await waitForTargetQueryLifecycle(tabId, cursor);
    const settlement = lifecycle?.status === 'target-complete'
        ? await waitForPanelStability(tabId, panelId)
        : null;
    const persistence = {
        required: !!verifyPersistence,
        status: verifyPersistence ? 'not-run' : 'not-required',
        reason: verifyPersistence ? 'Initial refresh or settlement was not proven' : 'No active feature requires persistence proof',
        beforeRefresh: null,
        cursor: null,
        refresh: null,
        lifecycle: null,
        settlement: null,
        passed: !verifyPersistence,
    };
    if (verifyPersistence && lifecycle?.status === 'target-complete' && settlement?.status === 'stable') {
        // This is a distinct user-visible action. Capture the state after the
        // command's first refresh, then refresh again without resending tools.
        // The final transition invariant therefore proves persistence rather
        // than merely proving that the command's immediate reapply succeeded.
        persistence.beforeRefresh = await captureRuntimeDiagnostic(tabId, panelId, {
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'first-refresh-persistence-semantic-proof',
        });
        persistence.cursor = (await readQueryLifecycle(tabId)).nextEventId;
        persistence.refresh = await triggerRefresh(tabId);
        persistence.lifecycle = await waitForTargetQueryLifecycle(tabId, persistence.cursor);
        persistence.settlement = persistence.lifecycle?.status === 'target-complete'
            ? await waitForPanelStability(tabId, panelId)
            : null;
        persistence.passed = persistence.lifecycle?.status === 'target-complete'
            && persistence.settlement?.status === 'stable';
        persistence.status = persistence.passed ? 'proven' : 'failed';
        persistence.reason = persistence.passed
            ? 'Active feature state survived a second refresh without another applyPanelTools command'
            : (persistence.lifecycle?.status !== 'target-complete'
                ? `Second refresh lifecycle was not proven: ${persistence.lifecycle?.status || 'unknown'}`
                : `Panel did not settle after second refresh: ${persistence.settlement?.reason || persistence.settlement?.status || 'unknown'}`);
    }
    return { ...result, afterCommandBeforeRefresh, refresh: refreshResult, lifecycle, settlement, persistence, cursor, commandCursor };
}

/**
 * Сброс всех визуальных и трансформационных настроек к исходному состоянию.
 * Всегда вызывается в блоке finally для гарантированного отката.
 */
async function resetAllSettings(tabId, panelId) {
    return applySettingsAndWait(tabId, panelId, {
        // Send an explicit empty map rather than null. It is a structured
        // command to restore every native legend item and cannot be mistaken
        // for an omitted optional property while crossing the MAIN-world
        // message bridge.
        legendVisibility: {},
        visualSettings: {
            removeFill: false,
            thickenLines: false,
            thickenLinesValue: 0.5,
            invertLegend: false,
        },
        transformSettings: {
            invertIdle: false,
            convertMemToUsed: false,
            seriesQueryFilterEnabled: false,
            seriesQueryFilterValue: 0,
            seriesQueryFilterRawValue: null,
            seriesQueryFilterMode: 'max',
            thresholdEnabled: false,
        },
    });
}

/**
 * Запускает последовательность переходов и проверяет инварианты на каждом шаге.
 * В блоке finally гарантированно сбрасывает настройки.
 *
 * @param {number} tabId
 * @param {object} env — тестовое окружение (env.panelId, env.hasLegend, env.hasCPU, …)
 * @param {Array<{label: string, settings: object|function, invariant: function}>} transitions
 * @returns {Promise<{pass: boolean, skip?: boolean, details: string[]}>}
 */
function transitionSkipReason(settings, env) {
    const visual = settings?.visualSettings || {};
    const transform = settings?.transformSettings || {};
    if (visual.invertLegend && !env.hasLegend) return 'нет легенды';
    if (transform.invertIdle && !env.hasCPU) return 'нет CPU-панели';
    if (transform.convertMemToUsed && !env.hasRAM) return 'нет RAM-панели';
    if (transform.seriesQueryFilterEnabled && !env.hasSeries) return 'нет серий для фильтра';
    if (settings?.legendVisibility && !env.hasVisibilitySeries) return 'нет двух управляемых серий легенды';
    return '';
}

async function runTransitionTest(tabId, env, transitions) {
    const liveProgress = {
        schema: 'dashbridge-e2e-transition-progress/v1',
        startedAt: Date.now(),
        phase: 'resolve-transitions',
        totalTransitions: transitions.length,
        completedTransitions: 0,
        current: null,
        steps: [],
    };
    env.__dashbridgeTransitionProgress = liveProgress;
    // Resolve generated commands before checking preconditions. This keeps
    // dynamic feature settings (for example duplicate-safe legend keys)
    // subject to the same causal skip contract as static settings.
    const resolvedTransitions = await Promise.all(transitions.map(async step => ({
        ...step,
        settings: typeof step.settings === 'function'
            ? await step.settings(env)
            : step.settings,
    })));
    const skippedReason = resolvedTransitions.map(step => transitionSkipReason(step.settings, env)).find(Boolean);
    if (skippedReason) {
        const capturedAt = Date.now();
        const baseline = await captureRuntimeDiagnostic(tabId, env.panelId, {
            reuseVisualFrom: env.__dashbridgeCapabilitySnapshot || env.__dashbridgeCurrentOuterBefore || null,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'capability-skip-semantic-proof',
        });
        env.__dashbridgeCapabilitySnapshot = baseline;
        return {
            pass: true, skip: true, details: `SKIP: ${skippedReason}`,
            diagnostic: {
                kind: 'transition',
                skipReason: skippedReason,
                transitions: [],
                baseline,
                actionTimeline: [{
                    schema: 'dashbridge-e2e-action-event/v1',
                    sequence: 1,
                    action: 'scenario-skipped',
                    description: 'Сценарий не запускался: проверяемая возможность отсутствует в текущем окружении',
                    startedAt: capturedAt,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - capturedAt,
                    input: { resolvedTransitions, skippedReason },
                    output: { status: 'skip', reason: skippedReason },
                    snapshotRefs: { observed: runtimeSnapshotRef('diagnostic.baseline', baseline) },
                    diffs: [],
                }],
            },
        };
    }

    const panelId = env.panelId;
    const testStartedAt = Date.now();
    let baseline = null;
    const diagnostic = {
        kind: 'transition',
        schema: 'dashbridge-e2e-scenario-diagnostic/v2',
        startedAt: testStartedAt,
        baseline: null,
        opened: null,
        transitions: [],
        actionTimeline: [],
    };
    const appendAction = action => diagnostic.actionTimeline.push({
        schema: 'dashbridge-e2e-action-event/v1',
        sequence: diagnostic.actionTimeline.length + 1,
        relativeStartedMs: Math.max(0, (action.startedAt || Date.now()) - testStartedAt),
        relativeFinishedMs: Math.max(0, (action.finishedAt || Date.now()) - testStartedAt),
        ...action,
    });
    const nativeLegendResetVerified = runtimeDiagnostic => {
        const entries = runtimeDiagnostic?.markers?.visibilityEntries || [];
        const nativeHiddenEntries = entries.filter(entry => entry.nativeHidden === true);
        const commandState = runtimeDiagnostic?.tools || null;
        const staleVisibility = commandState?.legendVisibility
            && Object.entries(commandState.legendVisibility).some(([, visible]) => visible === false);
        return {
            pass: entries.length > 0 && nativeHiddenEntries.length === 0 && !staleVisibility,
            entries: entries.length,
            nativeHidden: nativeHiddenEntries.map(entry => entry.key),
            staleVisibility: !!staleVisibility,
        };
    };
    const details = [];
    let allPassed = true;
    let anySkipped = false;

    // First preserve exactly what was visible when the scenario opened. This
    // is deliberately captured before isolation so a contaminated incoming
    // state can be reconstructed from JSON and screenshots.
    const openedAt = Date.now();
    const openedSnapshot = await captureRuntimeDiagnostic(tabId, panelId, {
        reuseVisualFrom: env.__dashbridgeCurrentOuterBefore || null,
        captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
        captureReason: 'scenario-opened-semantic-bookmark',
    });
    diagnostic.opened = openedSnapshot;

    // Isolate once, then preserve state across the complete user sequence.
    // A preceding matrix scenario already ends with a causal reset + Refresh.
    // Reuse that proof only after confirming the current semantic snapshot is
    // still clean; this removes a duplicate network cycle without weakening
    // the boundary between scenarios.
    const isolationStartedAt = Date.now();
    liveProgress.phase = 'isolation-reset';
    const verifiedBoundary = env.__dashbridgeVerifiedCleanBoundary || null;
    env.__dashbridgeVerifiedCleanBoundary = null;
    const isolationRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
    let isolationReset;
    let isolationSnapshot;
    let isolationRuntimeEvents;
    let isolationNativeReset;
    let isolationResetPassed;
    if (verifiedBoundary?.pass && verifiedBoundary.panelId === panelId) {
        baseline = await captureState(tabId, panelId);
        baseline.diagnostic = openedSnapshot;
        isolationNativeReset = nativeLegendResetVerified(openedSnapshot);
        const cleanInvariant = isolationNativeReset.pass
            ? activeSetInvariant([], null)(verifiedBoundary.state || baseline, baseline, env)
            : { pass: false, reason: 'Нативная видимость легенды изменилась после доказанного reset' };
        isolationResetPassed = isolationNativeReset.pass && cleanInvariant.pass;
        isolationSnapshot = openedSnapshot;
        isolationRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, isolationRuntimeCursor);
        isolationReset = {
            status: isolationResetPassed ? 'reused-verified-reset' : 'reused-reset-drifted',
            acknowledgement: verifiedBoundary.reset?.command?.acknowledgement || null,
            lifecycle: verifiedBoundary.reset?.lifecycle || null,
            settlement: verifiedBoundary.reset?.settlement || null,
            afterCommandBeforeRefresh: null,
            reusedFromTestId: verifiedBoundary.testId || null,
            cleanInvariant,
        };
    }
    if (!verifiedBoundary?.pass || verifiedBoundary.panelId !== panelId || !isolationResetPassed) {
        isolationReset = await resetAllSettings(tabId, panelId);
        isolationSnapshot = await captureRuntimeDiagnostic(tabId, panelId, {
            captureMode: DIAGNOSTIC_CAPTURE_MODES.PANEL,
            captureReason: 'canonical-isolated-baseline',
        });
        isolationRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, isolationRuntimeCursor);
        isolationNativeReset = nativeLegendResetVerified(isolationSnapshot);
        isolationResetPassed = isolationReset.status === 'applied'
            && isolationReset.lifecycle?.status === 'target-complete'
            && isolationReset.settlement?.status === 'stable'
            && isolationNativeReset.pass;
        baseline = await captureState(tabId, panelId);
    }
    diagnostic.baseline = isolationSnapshot;
    baseline.diagnostic = diagnostic.baseline;
    diagnostic.isolation = {
        status: isolationReset.status,
        lifecycle: isolationReset.lifecycle || null,
        settlement: isolationReset.settlement || null,
        acknowledgement: isolationReset.acknowledgement || null,
        queue: isolationReset.acknowledgement?.queue || null,
        refresh: isolationReset.refresh || null,
        commandCursor: isolationReset.commandCursor ?? null,
        refreshCursor: isolationReset.cursor ?? null,
        nativeLegend: isolationNativeReset,
        reusedVerifiedReset: isolationReset.status === 'reused-verified-reset',
        reusedFromTestId: isolationReset.reusedFromTestId || null,
        cleanInvariant: isolationReset.cleanInvariant || null,
        afterCommandBeforeRefresh: isolationReset.afterCommandBeforeRefresh || null,
        passed: isolationResetPassed,
    };
    const isolationFinishedAt = Date.now();
    liveProgress.phase = 'transitions';
    liveProgress.isolationDurationMs = isolationFinishedAt - isolationStartedAt;
    appendAction({
        action: 'isolate-scenario-baseline',
        description: isolationReset.status === 'reused-verified-reset'
            ? 'Текущее состояние сверено с доказанным финальным reset предыдущего сценария без дублирующего Refresh'
            : 'Зафиксировано входное состояние страницы, затем все функции явно сброшены и график обновлён',
        startedAt: openedAt,
        finishedAt: isolationFinishedAt,
        durationMs: isolationFinishedAt - openedAt,
        input: {
            panelId,
            intent: 'restore-all-features-to-native-baseline',
            resolvedTransitions,
        },
        output: {
            status: isolationReset.status,
            passed: isolationResetPassed,
            acknowledgement: isolationReset.acknowledgement || null,
            lifecycle: isolationReset.lifecycle || null,
            settlement: isolationReset.settlement || null,
            nativeLegend: isolationNativeReset,
            runtimeEvents: isolationRuntimeEvents,
        },
        snapshotRefs: {
            pageOpened: runtimeSnapshotRef('diagnostic.opened', openedSnapshot),
            afterCommandBeforeRefresh: runtimeSnapshotRef('diagnostic.isolation.afterCommandBeforeRefresh', isolationReset.afterCommandBeforeRefresh),
            afterIsolationReset: runtimeSnapshotRef('diagnostic.baseline', isolationSnapshot),
        },
        diffs: [
            {
                phase: 'page-opened-to-after-reset-command-before-refresh',
                ...buildRuntimeDiagnosticDiff(openedSnapshot, isolationReset.afterCommandBeforeRefresh || isolationSnapshot),
            },
            {
                phase: 'after-reset-command-to-isolated-baseline-after-refresh',
                ...buildRuntimeDiagnosticDiff(isolationReset.afterCommandBeforeRefresh || openedSnapshot, isolationSnapshot),
            },
            {
                phase: 'page-opened-to-isolated-baseline',
                ...buildRuntimeDiagnosticDiff(openedSnapshot, isolationSnapshot),
            },
        ],
    });

    let reusableStableSnapshot = isolationSnapshot;
    let previousActiveIds = [];
    try {
        for (let i = 0; i < resolvedTransitions.length; i++) {
            const {
                label, settings: resolvedSettings, invariant, activeIds = [],
                verifyPersistence = activeIds.length > 0,
            } = resolvedTransitions[i];
            const changedIds = [...new Set([...previousActiveIds, ...activeIds])]
                .filter(id => previousActiveIds.includes(id) !== activeIds.includes(id));
            const actionStartedAt = Date.now();
            liveProgress.phase = 'transition';
            liveProgress.current = {
                index: i + 1,
                label,
                activeIds: [...activeIds],
                startedAt: actionStartedAt,
            };
            const actionRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
            const before = await captureRuntimeDiagnostic(tabId, panelId, {
                reuseVisualFrom: reusableStableSnapshot,
                captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
                captureReason: 'transition-before-semantic-proof',
            });
            const command = isolationResetPassed
                ? await applySettingsAndWait(tabId, panelId, resolvedSettings, { verifyPersistence })
                : {
                    status: 'isolation-reset-failed',
                    lifecycle: isolationReset.lifecycle || null,
                    reset: isolationReset,
                };
            const afterState = await captureState(tabId, panelId);
            let after = await captureRuntimeDiagnostic(tabId, panelId, {
                reuseVisualFrom: activeIds.length ? reusableStableSnapshot : baseline,
                captureMode: diagnosticCaptureModeForTransition(resolvedSettings, activeIds, changedIds),
                captureReason: 'settled-user-visible-transition-state',
            });
            previousActiveIds = [...activeIds];
            reusableStableSnapshot = after;
            const actionRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, actionRuntimeCursor);
            // Invariants normally compare compact canvas/DOM state. Attach the
            // richer renderer-series snapshot for response-transform checks.
            afterState.diagnostic = after;
            const lifecycle = command.lifecycle;
            const visualPersistenceFeatures = ['removeFill', 'thickenLines', 'invertLegend', 'seriesVisibility'];
            const intentionalEmpty = after?.dataStatus?.intentionalEmpty === true;
            // A source filter may intentionally remove every series. The
            // visibility intent is then proven by tools+transport invariants;
            // requiring a renderer repaint would demand a legend that must not
            // exist until the filter is disabled and full data returns.
            const requiresVisualReapply = !intentionalEmpty
                && activeIds.some(id => visualPersistenceFeatures.includes(id));
            const reapplyBefore = Number(command.persistence?.beforeRefresh?.visualReapplyDiagnostic?.completed) || 0;
            const reapplyAfter = Number(after?.visualReapplyDiagnostic?.completed) || 0;
            const reapplyErrorsBefore = Number(command.persistence?.beforeRefresh?.visualReapplyDiagnostic?.errors) || 0;
            const reapplyErrorsAfter = Number(after?.visualReapplyDiagnostic?.errors) || 0;
            const visualReapplyProof = {
                required: requiresVisualReapply,
                deferredByIntentionalEmpty: intentionalEmpty,
                completedBeforeSecondRefresh: reapplyBefore,
                completedAfterSecondRefresh: reapplyAfter,
                completedDelta: reapplyAfter - reapplyBefore,
                errorsBeforeSecondRefresh: reapplyErrorsBefore,
                errorsAfterSecondRefresh: reapplyErrorsAfter,
                errorDelta: reapplyErrorsAfter - reapplyErrorsBefore,
                passed: !requiresVisualReapply || (reapplyAfter > reapplyBefore && reapplyErrorsAfter === reapplyErrorsBefore),
            };
            if (command.persistence?.required) {
                command.persistence.visualReapply = visualReapplyProof;
                if (!visualReapplyProof.passed) {
                    command.persistence.passed = false;
                    command.persistence.status = 'failed';
                    command.persistence.reason = 'After the second graph refresh no successful causal visual-style reapply was recorded';
                }
            }
            const persistencePassed = command.persistence?.required !== true || command.persistence?.passed === true;
            const lifecyclePassed = command.status === 'applied'
                && lifecycle?.status === 'target-complete'
                && command.settlement?.status === 'stable'
                && persistencePassed;
            const checkResult = lifecyclePassed
                ? invariant(baseline, afterState, env)
                : {
                    pass: false,
                    reason: command.status !== 'applied'
                        ? `команда не подтверждена: ${command.status || 'unknown'}`
                        : (lifecycle?.status !== 'target-complete'
                            ? `обновление целевой панели не доказано: ${lifecycle?.status || 'unknown'}`
                            : (command.settlement?.status !== 'stable'
                                ? `панель не стабилизировалась: ${command.settlement?.reason || command.settlement?.status || 'unknown'}`
                                : `функция не пережила повторный refresh: ${command.persistence?.reason || 'unknown'}`)),
                    debug: JSON.stringify({ lifecycle: lifecycle || null, settlement: command.settlement || null, persistence: command.persistence || null }),
                };
            const stepPassed = checkResult.pass;
            const stepSkipped = !!(checkResult.skip || checkResult.reason?.startsWith('SKIP:'));

            if (!stepPassed && !stepSkipped) {
                after = await captureRuntimeDiagnostic(tabId, panelId, {
                    captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                    captureReason: 'automatic-forensic-transition-failure',
                });
                afterState.diagnostic = after;
                reusableStableSnapshot = after;
            }

            if (stepSkipped) anySkipped = true;
            else allPassed = allPassed && stepPassed;

            diagnostic.transitions.push({
                schema: 'dashbridge-e2e-transition-evidence/v1',
                index: i + 1,
                label,
                settings: resolvedSettings,
                activeIds,
                changedIds,
                visualEvidenceRequirement: after.visualCapture?.requestedMode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC
                    ? 'forensic'
                    : (after.visualCapture?.requestedMode === DIAGNOSTIC_CAPTURE_MODES.PANEL ? 'panel' : 'canvas'),
                command,
                before,
                after,
                lifecycle,
                settlement: command.settlement || null,
                persistence: command.persistence || null,
                visualReapplyProof,
                isolationReset: {
                    status: i === 0 ? isolationReset.status : 'not-repeated',
                    lifecycle: i === 0 ? (isolationReset.lifecycle || null) : null,
                    nativeLegend: i === 0 ? isolationNativeReset : null,
                    passed: isolationResetPassed,
                    reason: i === 0
                        ? 'Чистый baseline установлен до последовательности'
                        : 'Состояние предыдущего шага сохранено для последовательного перехода',
                },
                invariant: {
                    pass: stepPassed,
                    skip: stepSkipped,
                    reason: checkResult.reason || '',
                    debug: checkResult.debug || '',
                },
                verdict: {
                    outcome: stepSkipped ? 'skip' : (stepPassed ? 'pass' : 'fail'),
                    commandApplied: command.status === 'applied',
                    targetLifecyclePassed: lifecycle?.status === 'target-complete',
                    panelSettled: command.settlement?.status === 'stable',
                    persistenceRequired: command.persistence?.required === true,
                    persistencePassed,
                    semanticInvariantPassed: !!checkResult.pass,
                    reason: checkResult.reason || '',
                },
            });
            const afterFirstRefresh = command.persistence?.beforeRefresh || null;
            const actionFinishedAt = Date.now();
            liveProgress.steps.push({
                index: i + 1,
                label,
                activeIds: [...activeIds],
                durationMs: actionFinishedAt - actionStartedAt,
                commandStatus: command.status || null,
                lifecycleStatus: command.lifecycle?.status || null,
                settlementStatus: command.settlement?.status || null,
                persistenceStatus: command.persistence?.status || null,
                invariantPassed: !!stepPassed,
            });
            liveProgress.completedTransitions = i + 1;
            liveProgress.current = null;
            appendAction({
                action: 'apply-transition',
                transitionIndex: i + 1,
                description: `Шаг ${i + 1}: ${label}`,
                startedAt: actionStartedAt,
                finishedAt: actionFinishedAt,
                durationMs: actionFinishedAt - actionStartedAt,
                input: {
                    panelId,
                    label,
                    settings: resolvedSettings,
                    activeIds,
                    persistenceRefreshRequired: activeIds.length > 0,
                    expected: 'command acknowledgement, target query completion, stable panel, semantic invariant',
                },
                output: {
                    status: command.status,
                    acknowledgement: command.acknowledgement || null,
                    commandDiagnostic: command.commandDiagnostic || null,
                    lifecycle: command.lifecycle || null,
                    settlement: command.settlement || null,
                    persistence: command.persistence || null,
                    visualReapplyProof,
                    invariant: {
                        pass: stepPassed,
                        skip: stepSkipped,
                        reason: checkResult.reason || '',
                        debug: checkResult.debug || '',
                    },
                    runtimeEvents: actionRuntimeEvents,
                },
                checkpoints: [
                    { stage: 'before-captured', at: before.at || null },
                    { stage: 'command-acknowledged', at: command.acknowledgement?.completedAt || null },
                    { stage: 'after-command-before-refresh-captured', at: command.afterCommandBeforeRefresh?.at || null },
                    { stage: 'first-target-query-complete', at: command.lifecycle?.target?.at || null },
                    { stage: 'first-panel-settled', at: command.settlement?.finishedAt || null },
                    { stage: 'after-first-refresh-captured', at: afterFirstRefresh?.at || null },
                    { stage: 'second-target-query-complete', at: command.persistence?.lifecycle?.target?.at || null },
                    { stage: 'second-panel-settled', at: command.persistence?.settlement?.finishedAt || null },
                    { stage: 'final-state-captured', at: after.at || null },
                ],
                snapshotRefs: {
                    before: runtimeSnapshotRef(`diagnostic.transitions[${i}].before`, before),
                    afterCommandBeforeRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].command.afterCommandBeforeRefresh`, command.afterCommandBeforeRefresh),
                    afterFirstRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].persistence.beforeRefresh`, afterFirstRefresh),
                    afterSecondRefresh: runtimeSnapshotRef(`diagnostic.transitions[${i}].after`, after),
                },
                diffs: [
                    {
                        phase: 'before-to-after-command-before-refresh',
                        ...buildRuntimeDiagnosticDiff(before, command.afterCommandBeforeRefresh || afterFirstRefresh || after),
                    },
                    {
                        phase: 'after-command-before-refresh-to-after-first-refresh',
                        ...buildRuntimeDiagnosticDiff(command.afterCommandBeforeRefresh || before, afterFirstRefresh || after),
                    },
                    {
                        phase: 'before-to-after-first-refresh',
                        ...buildRuntimeDiagnosticDiff(before, afterFirstRefresh || after),
                    },
                    ...(afterFirstRefresh ? [{
                        phase: 'after-first-refresh-to-after-second-refresh',
                        ...buildRuntimeDiagnosticDiff(afterFirstRefresh, after),
                    }] : []),
                    {
                        phase: 'complete-action-before-to-after',
                        ...buildRuntimeDiagnosticDiff(before, after),
                    },
                ],
            });
            details.push(`${i + 1}. ${label}: ${stepPassed ? '✓' : '✗'} ${checkResult.reason || ''}`);
            // Structured lifecycle evidence already lives in diagnostic.transitions.
            // Do not duplicate its full JSON inside the human-readable details.
            // A hard causal failure invalidates all following states. Do not
            // fabricate further evidence after the selected query was absent.
            if (!stepPassed && !stepSkipped) break;
        }
    } finally {
        const resetStartedAt = Date.now();
        liveProgress.phase = 'final-reset';
        liveProgress.current = { startedAt: resetStartedAt };
        const resetRuntimeCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId;
        const beforeReset = await captureRuntimeDiagnostic(tabId, panelId, {
            reuseVisualFrom: reusableStableSnapshot,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
            captureReason: 'before-reset-semantic-proof',
        });
        const reset = await resetAllSettings(tabId, panelId);
        const afterState = await captureState(tabId, panelId);
        let after = await captureRuntimeDiagnostic(tabId, panelId, {
            reuseVisualFrom: baseline,
            captureMode: DIAGNOSTIC_CAPTURE_MODES.PANEL,
            captureReason: 'restored-baseline-proof',
        });
        const resetRuntimeEvents = await readRuntimeDiagnosticEvents(tabId, resetRuntimeCursor);
        afterState.diagnostic = after;
        const resetLifecyclePassed = reset.status === 'applied'
            && reset.lifecycle?.status === 'target-complete'
            && reset.settlement?.status === 'stable';
        const resetNativeLegend = nativeLegendResetVerified(after);
        diagnostic.beforeReset = beforeReset;
        // A reset acknowledgement alone is insufficient. Verify every declared
        // feature is semantically OFF, including native Grafana legend state,
        // before allowing the next test to reuse this panel.
        const resetInvariant = resetLifecyclePassed && resetNativeLegend.pass
            ? activeSetInvariant([], null)(baseline, afterState, env)
            : {
                pass: false,
                reason: resetLifecyclePassed
                    ? 'Нативная видимость легенды не восстановлена'
                    : (reset.lifecycle?.status !== 'target-complete'
                        ? `Сброс не доказан: ${reset.lifecycle?.status || reset.status || 'unknown'}`
                        : `Панель не стабилизировалась после сброса: ${reset.settlement?.reason || reset.settlement?.status || 'unknown'}`),
                debug: JSON.stringify({ lifecycle: reset.lifecycle || null, settlement: reset.settlement || null, nativeLegend: resetNativeLegend }),
            };
        const resetPassed = resetLifecyclePassed && resetNativeLegend.pass && resetInvariant.pass;
        if (!resetPassed) {
            after = await captureRuntimeDiagnostic(tabId, panelId, {
                captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                captureReason: 'automatic-forensic-reset-failure',
            });
            afterState.diagnostic = after;
        }
        diagnostic.reset = {
            schema: 'dashbridge-e2e-transition-evidence/v1',
            command: reset,
            after,
            lifecycle: reset.lifecycle,
            settlement: reset.settlement || null,
            nativeLegend: resetNativeLegend,
            invariant: resetInvariant,
            pass: resetPassed,
            verdict: {
                outcome: resetPassed ? 'pass' : 'fail',
                commandApplied: reset.status === 'applied',
                targetLifecyclePassed: reset.lifecycle?.status === 'target-complete',
                panelSettled: reset.settlement?.status === 'stable',
                semanticInvariantPassed: !!resetInvariant.pass,
                reason: resetPassed ? 'Сброс семантически подтвердил исходное состояние всех функций' : resetInvariant.reason,
            },
        };
        env.__dashbridgeVerifiedCleanBoundary = resetPassed ? {
            pass: true,
            panelId,
            testId: env.__dashbridgeCurrentTestId || null,
            state: afterState,
            snapshot: after,
            reset: diagnostic.reset,
        } : null;
        const resetFinishedAt = Date.now();
        appendAction({
            action: 'restore-after-scenario',
            description: 'После сценария все функции явно выключены, выполнен Refresh и доказан безопасный baseline для следующего теста',
            startedAt: resetStartedAt,
            finishedAt: resetFinishedAt,
            durationMs: resetFinishedAt - resetStartedAt,
            input: { panelId, intent: 'restore-all-features-to-native-baseline' },
            output: {
                status: reset.status,
                pass: resetPassed,
                acknowledgement: reset.acknowledgement || null,
                lifecycle: reset.lifecycle || null,
                settlement: reset.settlement || null,
                nativeLegend: resetNativeLegend,
                invariant: resetInvariant,
                runtimeEvents: resetRuntimeEvents,
            },
            checkpoints: [
                { stage: 'before-reset-captured', at: beforeReset.at || null },
                { stage: 'reset-command-acknowledged', at: reset.acknowledgement?.completedAt || null },
                { stage: 'after-reset-command-before-refresh-captured', at: reset.afterCommandBeforeRefresh?.at || null },
                { stage: 'reset-target-query-complete', at: reset.lifecycle?.target?.at || null },
                { stage: 'reset-panel-settled', at: reset.settlement?.finishedAt || null },
                { stage: 'after-reset-captured', at: after.at || null },
            ],
            snapshotRefs: {
                beforeReset: runtimeSnapshotRef('diagnostic.beforeReset', beforeReset),
                afterResetCommandBeforeRefresh: runtimeSnapshotRef('diagnostic.reset.command.afterCommandBeforeRefresh', reset.afterCommandBeforeRefresh),
                afterReset: runtimeSnapshotRef('diagnostic.reset.after', after),
            },
            diffs: [
                {
                    phase: 'before-reset-to-after-reset-command-before-refresh',
                    ...buildRuntimeDiagnosticDiff(beforeReset, reset.afterCommandBeforeRefresh || after),
                },
                {
                    phase: 'after-reset-command-before-refresh-to-after-reset-refresh',
                    ...buildRuntimeDiagnosticDiff(reset.afterCommandBeforeRefresh || beforeReset, after),
                },
                {
                    phase: 'before-reset-to-restored-baseline',
                    ...buildRuntimeDiagnosticDiff(beforeReset, after),
                },
            ],
        });
        diagnostic.finishedAt = resetFinishedAt;
        diagnostic.durationMs = resetFinishedAt - testStartedAt;
        liveProgress.phase = 'complete';
        liveProgress.current = null;
        liveProgress.finishedAt = resetFinishedAt;
        liveProgress.durationMs = resetFinishedAt - liveProgress.startedAt;
        if (!resetPassed) {
            allPassed = false;
            // A subsequent test would have no trustworthy baseline. The core
            // turns this explicit signal into aborted/not-run results for the
            // rest of this URL instead of spreading a destructive state.
            diagnostic.environmentUnsafe = true;
            details.push(`Сброс: ✗ ${resetInvariant.reason || 'исходное состояние не доказано'}`);
        }
    }

    return {
        pass: allPassed,
        skip: anySkipped && allPassed,
        environmentUnsafe: diagnostic.environmentUnsafe === true,
        details: anySkipped && allPassed ? `SKIP: ${details.join(' | ')}` : details.join(' | '),
        diagnostic,
    };
}

// ─── Строгие инвариантные проверки для каждого переключателя ───────

/**
 * Каждый инвариант принимает (baseline, current, env) и возвращает
 * { pass: boolean, reason?: string, debug?: string }
 */
const matrixInvariants = {
    // Canvas is diagnostic evidence only: Grafana may repaint an identical
    // image after a real response. Style checks therefore inspect the renderer
    // state that production code mutates, and skip only when it is unavailable.
    rendererSeries: current => (current.diagnostic?.series || []).filter(series => series && series.label !== undefined),
    unavailableRenderer: current => !current.diagnostic?.panelFound || !current.diagnostic?.renderer || current.diagnostic.renderer === 'unknown',
    skipUnsupportedRenderer: current => ({
        pass: true,
        skip: true,
        reason: 'SKIP: рендерер графика не предоставляет состояние серий',
        debug: `renderer=${current.diagnostic?.renderer || 'unknown'}`,
    }),
    everyRendererSeries: (current, predicate) => {
        const series = matrixInvariants.rendererSeries(current);
        return series.length > 0 && series.every(predicate);
    },

    // ── removeFill ──────────────────────────────────────────────────
    removeFillOn: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const transparent = value => typeof value === 'string'
            && (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value)
                || /transparent/i.test(value));
        const applied = matrixInvariants.everyRendererSeries(current, series => series.originalFill !== '[undefined]'
            && (series.fill === false || (series.fillDisabled === true && transparent(series.evaluatedFill))));
        const styleStateApplied = current.diagnostic?.visualStyleState?.fillMatchesExpected === true;
        return {
            pass: applied && styleStateApplied,
            reason: applied && styleStateApplied ? 'заливка отключена в состоянии всех серий'
                : 'состояние заливки серий не отключено или потеряно после замены renderer',
            debug: applied && styleStateApplied ? '' : JSON.stringify({
                styleState: current.diagnostic?.visualStyleState || null,
                series: matrixInvariants.rendererSeries(current),
            }),
        };
    },
    removeFillOff: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const transparent = value => typeof value === 'string'
            && (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value)
                || /transparent/i.test(value));
        const restored = matrixInvariants.everyRendererSeries(current, series => {
            if (series.fillDisabled === true || series.fill === false || transparent(series.evaluatedFill)) return false;
            // Grafana can replace uPlot while restoring native visibility or
            // source data. A fresh renderer has no DashBridge baseline fields;
            // that is a clean state, not a failed restore, when its live fill
            // is native and no disabled marker survived.
            if (series.originalFill === '[undefined]') return true;
            return series.fill === series.originalFill
                && series.evaluatedFill === series.evaluatedOriginalFill;
        });
        const styleStateRestored = current.diagnostic?.visualStyleState?.fillMatchesExpected === true;
        return {
            pass: restored && styleStateRestored,
            reason: restored && styleStateRestored ? 'заливка серий восстановлена до исходного значения'
                : 'заливка серий не восстановлена или восстановлена в другом renderer',
            debug: restored && styleStateRestored ? '' : JSON.stringify({
                styleState: current.diagnostic?.visualStyleState || null,
                series: matrixInvariants.rendererSeries(current),
            }),
        };
    },

    // ── thickenLines ────────────────────────────────────────────────
    thickenLinesOn: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const applied = matrixInvariants.everyRendererSeries(current, series => Number.isFinite(series.width)
            && Number.isFinite(series.originalWidth) && series.width > series.originalWidth);
        return {
            pass: applied,
            reason: applied ? 'толщина всех серий увеличена в renderer state' : 'толщина серий не увеличена',
            debug: applied ? '' : JSON.stringify(matrixInvariants.rendererSeries(current)),
        };
    },
    thickenLinesOff: (baseline, current) => {
        if (matrixInvariants.unavailableRenderer(current)) return matrixInvariants.skipUnsupportedRenderer(current);
        const restored = matrixInvariants.everyRendererSeries(current, series => Number.isFinite(series.width)
            && (!Number.isFinite(series.originalWidth) || series.width === series.originalWidth));
        return {
            pass: restored,
            reason: restored ? 'толщина серий восстановлена до исходной' : 'толщина серий не восстановлена',
            debug: restored ? '' : JSON.stringify(matrixInvariants.rendererSeries(current)),
        };
    },

    // ── invertLegend ─────────────────────────────────────────────────
    invertLegendOn: (baseline, current, env) => {
        if (!env.hasLegend) return { pass: true, skip: true, reason: 'SKIP: нет легенды' };
        const before = baseline.diagnostic?.legend?.position;
        const after = current.diagnostic?.legend?.position;
        if (!before || !after || !['right', 'bottom'].includes(before.direction)) {
            return {
                pass: false,
                reason: 'исходное положение легенды не определено однозначно',
                debug: JSON.stringify({ before, after }),
            };
        }
        const expectedDirection = before.direction === 'right' ? 'bottom' : 'right';
        const allEntriesMoved = after.direction === 'bottom'
            ? current.diagnostic?.legend?.entries > 0 && current.diagnostic.legend.bottomEntries === current.diagnostic.legend.entries
            : true;
        const markerMatchesDirection = after.direction === 'bottom'
            ? current.dom.legendBottom === true
            : current.dom.legendBottom === false;
        const applied = after.direction === expectedDirection && allEntriesMoved && markerMatchesDirection;
        return {
            pass: applied,
            reason: applied
                ? `легенда инвертирована: ${before.direction} → ${after.direction}`
                : `ожидалась инверсия ${before.direction} → ${expectedDirection}, получено ${after.direction}`,
            debug: applied ? '' : JSON.stringify({ before, after, expectedDirection, allEntriesMoved, markerMatchesDirection }),
        };
    },
    invertLegendOff: (baseline, current, env) => {
        if (!env.hasLegend) return { pass: true, skip: true, reason: 'SKIP: нет легенды' };
        const before = baseline.diagnostic?.legend?.position;
        const after = current.diagnostic?.legend?.position;
        const restored = !!before
            && before.direction !== 'unknown'
            && after?.direction === before.direction
            && !current.dom.legendBottom
            && !current.diagnostic?.legend?.bottomContainer
            && current.diagnostic?.legend?.bottomEntries === 0;
        return {
            pass: restored,
            reason: restored
                ? `легенда восстановлена: ${after.direction}`
                : `легенда не восстановлена в исходное положение ${before?.direction || 'unknown'}`,
            debug: restored ? '' : JSON.stringify({ before, after, marker: current.dom.legendBottom, legend: current.diagnostic?.legend }),
        };
    },
    removeFillLegendThresholdOff: (baseline, current, env) => {
        const fill = matrixInvariants.removeFillOff(baseline, current);
        const legend = matrixInvariants.invertLegendOff(baseline, current, env);
        const threshold = matrixInvariants.thresholdOff(baseline, current);
        const pass = fill.pass && legend.pass && threshold.pass;
        return {
            pass,
            skip: fill.skip || legend.skip || threshold.skip,
            reason: `заливка: ${fill.reason}; легенда: ${legend.reason}; порог: ${threshold.reason}`,
            debug: pass ? '' : [fill.debug, legend.debug, threshold.debug].filter(Boolean).join(' | '),
        };
    },

    // ── invertIdle (CPU) ─────────────────────────────────────────────
    // These assertions deliberately inspect Grafana's calculated series label,
    // rather than treating a canvas redraw as proof of a data transformation.
    // `applySettingsAndWait()` forces a real query before this snapshot.
    invertIdleOn: (baseline, current, env) => {
        if (!env.hasCPU) return { pass: true, skip: true, reason: 'SKIP: нет CPU-панели' };
        // Grafana 10/Flot can replace its plot object after a transformed
        // response. `getPlot()` may still expose the previous idle series while
        // the live legend already renders the calculated load series. Require
        // both causal network evidence and a user-visible label, accepting the
        // renderer or the keyed legend as equivalent observations.
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.invertIdle === true);
        const transformed = !!transform && labels.some(label => /load\s*\(calc\)/i.test(label));
        return {
            pass: transformed,
            reason: transformed ? 'CPU Idle → Load подтверждён серией load (calc)' : 'CPU Load (calc) не получен после refresh',
            debug: transformed ? '' : JSON.stringify({
                transform: transform || null,
                labels,
            }),
        };
    },
    invertIdleOff: (baseline, current, env) => {
        if (!env.hasCPU) return { pass: true, skip: true, reason: 'SKIP: нет CPU-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const nativeResponse = targetEvent?.stage === 'transform-skipped'
            || (targetEvent?.stage === 'transform' && targetEvent.invertIdle === false);
        const restored = nativeResponse && !labels.some(label => /load\s*\(calc\)/i.test(label));
        return {
            pass: restored,
            reason: restored ? 'CPU восстановлен после refresh без преобразования' : 'CPU всё ещё содержит load (calc)',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null, labels }),
        };
    },

    // ── convertMemToUsed (RAM) ───────────────────────────────────────
    convertMemOn: (baseline, current, env) => {
        if (!env.hasRAM) return { pass: true, skip: true, reason: 'SKIP: нет RAM-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.convertMemToUsed === true
                && event.memoryTransform?.applied === true);
        const transformed = !!transform && labels.some(label => /used\s*%\s*\(calc\)/i.test(label));
        return {
            pass: transformed,
            reason: transformed ? 'RAM → % Used подтверждён серией Used % (calc)' : 'RAM Used % (calc) не получен после refresh',
            debug: transformed ? '' : JSON.stringify({ transform: transform || null, labels }),
        };
    },
    convertMemOff: (baseline, current, env) => {
        if (!env.hasRAM) return { pass: true, skip: true, reason: 'SKIP: нет RAM-панели' };
        const labels = [
            ...(current.diagnostic?.series || []).map(item => String(item.label || '')),
            ...(current.diagnostic?.markers?.visibilityEntries || []).map(item => String(item.label || '')),
        ];
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const nativeResponse = targetEvent?.stage === 'transform-skipped'
            || (targetEvent?.stage === 'transform' && targetEvent.convertMemToUsed === false);
        const restored = nativeResponse && !labels.some(label => /used\s*%\s*\(calc\)/i.test(label));
        return {
            pass: restored,
            reason: restored ? 'RAM восстановлен после refresh без преобразования' : 'RAM всё ещё содержит Used % (calc)',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null, labels }),
        };
    },

    // ── seriesQueryFilterEnabled ─────────────────────────────────────
    seriesFilterOn: (baseline, current, env) => {
        if (!env.hasSeries) return { pass: true, skip: true, reason: 'SKIP: нет серий для фильтра' };
        const transform = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => event.stage === 'transform'
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope)
                && event.sourceFilterEnabled);
        const metrics = transform?.sourceFilter;
        if (!metrics) {
            return {
                pass: false,
                reason: 'фильтр не предоставил семантический отчёт',
                debug: 'В target transform отсутствует sourceFilter с количеством удалённых серий',
            };
        }
        if (metrics.removedSeries > 0) {
            return {
                pass: true,
                reason: `источник отфильтрован: удалено ${metrics.removedSeries} из ${metrics.beforeSeries} серий`,
            };
        }
        return {
            pass: true,
            skip: true,
            reason: 'SKIP: в целевом ответе нет серий, которые можно безопасно убрать',
            debug: JSON.stringify(metrics),
        };
    },
    seriesFilterOff: (baseline, current) => {
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const restoredByTransform = targetEvent?.stage === 'transform'
            && targetEvent.sourceFilterEnabled === false
            && targetEvent.sourceFilter?.enabled === false
            && targetEvent.afterSeries === targetEvent.beforeSeries;
        // With every data transform OFF, the interceptor intentionally avoids
        // decoding or cloning the response. A target-scoped transform-skipped
        // event is therefore direct proof that Grafana received native data.
        const restoredByNativeBypass = targetEvent?.stage === 'transform-skipped'
            && targetEvent.reason === 'visual-only-observed'
            && current.diagnostic?.tools?.seriesQueryFilterEnabled === false;
        const restored = restoredByTransform || restoredByNativeBypass;
        return {
            pass: restored,
            reason: restored
                ? (restoredByNativeBypass
                    ? 'source-фильтр отключён: целевой ответ возвращён Grafana без преобразования'
                    : `source-фильтр отключён: восстановлено ${targetEvent.afterSeries} серий`)
                : 'не доказано отключение source-фильтра в ответе целевой панели',
            debug: restored ? '' : JSON.stringify({ targetEvent: targetEvent || null }),
        };
    },

    // ── pairwise transform reset ─────────────────────────────────────
    // A canvas bitmap is deliberately not used here: returning the same source
    // data may still produce a different raster. The selected response journal
    // proves source filtering is disabled, while the threshold marker proves
    // the visual calculation is removed.
    thresholdAndSeriesFilterOff: (baseline, current) => {
        const targetEvent = [...(current.diagnostic?.interceptor?.events || [])].reverse()
            .find(event => ['transform', 'transform-skipped'].includes(event.stage)
                && ['iframe', 'query-signature', 'legend-fallback'].includes(event.scope));
        const filterDisabled = (targetEvent?.stage === 'transform'
            && targetEvent.sourceFilterEnabled === false
            && targetEvent.sourceFilter?.enabled === false
            && targetEvent.afterSeries === targetEvent.beforeSeries)
            || (targetEvent?.stage === 'transform-skipped'
                && targetEvent.reason === 'visual-only-observed'
                && current.diagnostic?.tools?.seriesQueryFilterEnabled === false);
        const thresholdDisabled = !current.dom.thresholdApplied;
        const restored = filterDisabled && thresholdDisabled;
        return {
            pass: restored,
            reason: restored ? 'порог снят, а ответ выбранной панели восстановлен без source-фильтра' : 'не доказан полный сброс пары порог + source-фильтр',
            debug: restored ? '' : JSON.stringify({
                thresholdApplied: current.dom.thresholdApplied,
                targetEvent: targetEvent || null,
            }),
        };
    },

    // ── thresholdEnabled ────────────────────────────────────────────
    thresholdOn: (baseline, current, env) => {
        const threshold = current.diagnostic?.thresholdDiagnostic || {};
        const status = threshold.status || {};
        const expectedPanel = String(env.panelId || '');
        const panelMatches = !expectedPanel || String(threshold.panelId || '') === expectedPanel;
        const deferredForIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.thresholdEnabled === true
            && threshold.enabled === true
            && threshold.panelFound === true
            && panelMatches
            && status.enabled === true
            && status.exceeded === false
            && current.dom.thresholdApplied === false;
        const semanticApplied = current.dom.thresholdApplied
            && threshold.enabled === true
            && threshold.panelFound === true
            && panelMatches
            && ['uplot', 'flot'].includes(status.engine)
            && Number.isFinite(Number(status.rawThreshold))
            && Number.isFinite(Number(status.threshold));
        return {
            pass: semanticApplied || deferredForIntentionalEmpty,
            reason: semanticApplied
                ? `порог вычислен для ${status.seriesName || 'серии'} (${status.engine})`
                : (deferredForIntentionalEmpty
                    ? 'порог сохранён в filtered_empty без ложной линии и ложного превышения'
                    : 'не доказано вычисление порога для выбранной панели'),
            debug: semanticApplied || deferredForIntentionalEmpty ? '' : JSON.stringify({
                thresholdApplied: current.dom.thresholdApplied,
                expectedPanel,
                threshold,
            }),
        };
    },
    thresholdOff: (baseline, current) => {
        const threshold = current.diagnostic?.thresholdDiagnostic || {};
        const baselineWasInactive = baseline.dom.thresholdApplied === false
            && baseline.diagnostic?.tools?.thresholdEnabled === false;
        const currentIsInactive = !current.dom.thresholdApplied
            && current.diagnostic?.tools?.thresholdEnabled === false;
        const explicitRemoval = threshold.enabled === false && threshold.status?.enabled === false;
        const removed = currentIsInactive && (explicitRemoval || baselineWasInactive);
        return {
            pass: removed,
            reason: removed
                ? (explicitRemoval
                    ? 'порог семантически отключён и маркер снят'
                    : 'порог остался выключен относительно чистого baseline')
                : 'не доказано отключение порога',
            debug: removed ? '' : JSON.stringify({
                baselineThresholdApplied: baseline.dom.thresholdApplied,
                baselineThresholdEnabled: baseline.diagnostic?.tools?.thresholdEnabled,
                thresholdApplied: current.dom.thresholdApplied,
                thresholdEnabled: current.diagnostic?.tools?.thresholdEnabled,
                threshold,
            }),
        };
    },

    // ── seriesVisibility ─────────────────────────────────────────────
    seriesVisibilityOn: (baseline, current, env) => {
        if (!env.hasVisibilitySeries) return { pass: true, skip: true, reason: 'SKIP: нет двух управляемых серий легенды' };
        const markers = current.diagnostic?.markers || {};
        const target = env.visibilityTarget;
        const targetEntry = findEquivalentVisibilityEntry(markers.visibilityEntries || [], target, current);
        const targetHidden = !!targetEntry && (targetEntry.hidden || targetEntry.dimmed || targetEntry.nativeHidden || targetEntry.visuallyHidden);
        const deferredForIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.legendVisibility?.[target?.key] === false
            && !targetEntry;
        return {
            pass: targetHidden || deferredForIntentionalEmpty,
            reason: targetHidden
                ? `серия ${target?.key} скрыта через легенду`
                : (deferredForIntentionalEmpty
                    ? `видимость серии ${target?.key} сохранена и будет применена после выхода из filtered_empty`
                    : `не доказано скрытие выбранной серии ${target?.key || ''}`),
            debug: targetHidden || deferredForIntentionalEmpty ? '' : JSON.stringify({ target, targetEntry, visibilityEntries: markers.visibilityEntries || [] }),
        };
    },
    seriesVisibilityOff: (baseline, current, env) => {
        if (!env.hasVisibilitySeries) return { pass: true, skip: true, reason: 'SKIP: нет двух управляемых серий легенды' };
        const markers = current.diagnostic?.markers || {};
        const target = env.visibilityTarget;
        const targetEntry = findEquivalentVisibilityEntry(markers.visibilityEntries || [], target, current);
        const targetStillHidden = !!targetEntry && (targetEntry.hidden || targetEntry.dimmed || targetEntry.nativeHidden || targetEntry.visuallyHidden);
        const clearedDuringIntentionalEmpty = current.diagnostic?.dataStatus?.intentionalEmpty === true
            && current.diagnostic?.tools?.legendVisibility?.[target?.key] !== false
            && !targetEntry;
        const restored = (!!targetEntry && !targetStillHidden) || clearedDuringIntentionalEmpty;
        return {
            pass: restored,
            reason: restored
                ? (clearedDuringIntentionalEmpty
                    ? `отложенное скрытие серии ${target?.key} снято в состоянии filtered_empty`
                    : `видимость серии ${target?.key} восстановлена`)
                : `после отключения видимость серии ${target?.key || ''} не восстановлена`,
            debug: restored ? '' : JSON.stringify({ target, targetEntry, visibilityEntries: markers.visibilityEntries || [] }),
        };
    },

    // ── canvasChanged (универсальный) ────────────────────────────────
    canvasChanged: (baseline, current) => {
        const changed = baseline.canvas !== current.canvas;
        return {
            pass: changed,
            reason: changed ? 'canvas изменился' : 'canvas не изменился',
            debug: changed ? '' : 'Ожидалось изменение canvas после применения настроек',
        };
    },
    canvasReverted: (baseline, current) => {
        const reverted = baseline.canvas === current.canvas;
        return {
            pass: reverted,
            reason: reverted ? 'canvas вернулся к базе' : 'canvas не соответствует базе',
            debug: reverted ? '' : 'Ожидалось восстановление canvas после сброса настроек',
        };
    },
};

// ─── Генераторы матричных переходов ────────────────────────────────

// ─── Декларативная причинная E2E-матрица ─────────────────────────────

const mergeMatrixSettings = (...settings) => settings.reduce((result, value) => {
    if (!value) return result;
    for (const [key, item] of Object.entries(value)) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            result[key] = { ...(result[key] || {}), ...item };
        } else {
            result[key] = item;
        }
    }
    return result;
}, {});

function combineInvariantResults(results) {
    const relevant = results.filter(Boolean);
    const failed = relevant.filter(result => !result.pass && !result.skip);
    const skipped = relevant.filter(result => result.skip);
    return {
        pass: failed.length === 0,
        skip: failed.length === 0 && skipped.length > 0,
        reason: relevant.map(result => result.reason).filter(Boolean).join('; '),
        debug: failed.map(result => result.debug).filter(Boolean).join(' | '),
    };
}

const visibilitySettings = env => {
    const target = env.visibilityTarget;
    return target ? { legendVisibility: { [target.key]: false } } : { legendVisibility: {} };
};

function findEquivalentVisibilityEntry(entries, target, current) {
    const exact = entries.find(entry => entry.key === target?.key);
    if (exact || !target?.key) return exact;
    const runtimeTools = current.diagnostic?.tools || {};
    if (runtimeTools.invertIdle === true) {
        const idleKeyword = String(runtimeTools.idleKeyword || 'idle');
        const escapedIdle = idleKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const calculatedKey = target.key.replace(new RegExp(escapedIdle, 'gi'), 'load (calc)');
        const calculatedEntry = entries.find(entry => entry.key === calculatedKey);
        if (calculatedEntry) return calculatedEntry;
    }
    if (runtimeTools.convertMemToUsed !== true) return null;
    const sourceLabel = String(target.label || target.key.split('\u0000')[0]);
    const totalKeyword = String(runtimeTools.totalKeyword || 'total');
    const availableKeyword = String(runtimeTools.availKeyword || 'available');
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sourceServer = sourceLabel
        .replace(new RegExp(escape(totalKeyword), 'gi'), '')
        .replace(new RegExp(escape(availableKeyword), 'gi'), '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    return entries.find(entry => {
        const calculatedServer = String(entry.label || '')
            .replace(/used\s*%\s*\(calc\)/gi, '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        return calculatedServer === sourceServer && entry.occurrence === target.occurrence;
    });
}

const E2E_FEATURE_REGISTRY = [
    {
        id: 'removeFill', name: 'Заливка графика', description: 'Убирает цветную заливку под линиями и проверяет её точное восстановление.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'applyLocalSeriesStyles',
        on: { visualSettings: { removeFill: true } }, off: { visualSettings: { removeFill: false } },
        invariant: matrixInvariants.removeFillOn, inactive: matrixInvariants.removeFillOff,
    },
    {
        id: 'thickenLines', name: 'Толщина линий', description: 'Утолщает все линии графика и проверяет возврат исходной толщины.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'applyLocalSeriesStyles',
        on: { visualSettings: { thickenLines: true, thickenLinesValue: 3 } }, off: { visualSettings: { thickenLines: false, thickenLinesValue: 3 } },
        invariant: matrixInvariants.thickenLinesOn, inactive: matrixInvariants.thickenLinesOff,
    },
    {
        id: 'invertLegend', name: 'Положение легенды', description: 'Перемещает легенду справа вниз или снизу вправо и проверяет восстановление.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'applyPopupLegendAndVisuals',
        on: { visualSettings: { invertLegend: true } }, off: { visualSettings: { invertLegend: false } },
        invariant: matrixInvariants.invertLegendOn, inactive: matrixInvariants.invertLegendOff,
    },
    {
        id: 'seriesVisibility', name: 'Видимость отдельных серий', description: 'Скрывает выбранную строку легенды, сохраняет остальные серии и затем восстанавливает её.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'applySeriesVisibility',
        on: visibilitySettings, off: { legendVisibility: {} }, invariant: matrixInvariants.seriesVisibilityOn, inactive: matrixInvariants.seriesVisibilityOff,
    },
    {
        id: 'invertIdle', name: 'CPU Idle → Load', description: 'Преобразует CPU Idle в вычисленную загрузку и проверяет исходные данные после выключения.',
        sourceFile: 'js/content/grafana-panel-tools.js', sourceSymbol: 'transformCpuData',
        on: { transformSettings: { invertIdle: true } }, off: { transformSettings: { invertIdle: false } },
        invariant: matrixInvariants.invertIdleOn, inactive: matrixInvariants.invertIdleOff,
    },
    {
        id: 'convertMemToUsed', name: 'RAM → % Used', description: 'Пересчитывает память в процент использования и проверяет возврат исходных серий.',
        sourceFile: 'js/content/grafana-panel-tools.js', sourceSymbol: 'transformMemData',
        on: { transformSettings: { convertMemToUsed: true } }, off: { transformSettings: { convertMemToUsed: false } },
        invariant: matrixInvariants.convertMemOn, inactive: matrixInvariants.convertMemOff,
    },
    {
        id: 'seriesQueryFilter', name: 'Фильтр отображаемых серий', description: 'Фильтрует данные до renderer, включая допустимый пустой результат, и проверяет возврат полного ответа.',
        sourceFile: 'js/content/grafana-panel-tools.js', sourceSymbol: 'filterSeriesByThreshold',
        on: { transformSettings: { seriesQueryFilterEnabled: true, seriesQueryFilterValue: Number.MAX_SAFE_INTEGER, seriesQueryFilterRawValue: Number.MAX_SAFE_INTEGER, seriesQueryFilterMode: 'max' } },
        off: { transformSettings: { seriesQueryFilterEnabled: false } }, invariant: matrixInvariants.seriesFilterOn, inactive: matrixInvariants.seriesFilterOff,
    },
    {
        id: 'thresholdEnabled', name: 'Порог на графике', description: 'Добавляет пороговую линию, проверяет расчёт для выбранной панели и безопасное снятие.',
        sourceFile: 'js/content/grafana-visual-engine.js', sourceSymbol: 'setThreshold',
        on: { transformSettings: { thresholdEnabled: true } }, off: { transformSettings: { thresholdEnabled: false } },
        invariant: matrixInvariants.thresholdOn, inactive: matrixInvariants.thresholdOff,
    },
];
const E2E_FEATURES_BY_ID = Object.fromEntries(E2E_FEATURE_REGISTRY.map(feature => [feature.id, feature]));

function featureSettings(activeIds, env) {
    return mergeMatrixSettings(...E2E_FEATURE_REGISTRY.map(feature => {
        const source = activeIds.includes(feature.id) ? feature.on : feature.off;
        return typeof source === 'function' ? source(env) : source;
    }));
}

function activeSetInvariant(activeIds, changedId = null) {
    return (baseline, current, env) => {
        const active = activeIds.map(id => E2E_FEATURES_BY_ID[id]?.invariant(baseline, current, env));
        // The all-OFF state and final reset must prove restoration of every
        // feature, not merely the last one that happened to change.
        const inactiveIds = activeIds.length === 0
            ? E2E_FEATURE_REGISTRY.map(feature => feature.id)
            : (changedId && !activeIds.includes(changedId) ? [changedId] : []);
        const inactive = inactiveIds.map(id => E2E_FEATURES_BY_ID[id]?.inactive(baseline, current, env));
        // Unsupported inactive features (for example CPU on a non-CPU panel)
        // must not turn an otherwise valid visual OFF/reset transition into SKIP.
        // Capability checks already skip a scenario when such a feature is active.
        return combineInvariantResults([...active, ...inactive.filter(result => !result?.skip)]);
    };
}

function makeMatrixTransitions(states) {
    let previous = [];
    const persistenceProvenFor = new Set();
    return states.map(activeIds => {
        const changedId = [...previous, ...activeIds].find(id => previous.includes(id) !== activeIds.includes(id)) || null;
        const persistenceKey = [...activeIds].sort().join('|');
        const verifyPersistence = activeIds.length > 0 && !persistenceProvenFor.has(persistenceKey);
        if (verifyPersistence) persistenceProvenFor.add(persistenceKey);
        previous = activeIds;
        return {
            label: activeIds.length ? `активны: ${activeIds.join(', ')}` : 'все функции выключены',
            activeIds: [...activeIds],
            verifyPersistence,
            settings: env => featureSettings(activeIds, env),
            invariant: activeSetInvariant(activeIds, changedId),
        };
    });
}

const humanFeatureList = featureIds => featureIds
    .map(featureId => E2E_FEATURES_BY_ID[featureId]?.name || featureId)
    .join(' + ');

function describeMatrixScenario(id, featureIds, states) {
    const uniqueFeatureIds = [...new Set(featureIds)];
    const featureNames = humanFeatureList(uniqueFeatureIds);
    if (/^HP/.test(id)) {
        return {
            name: `${featureNames}: совместная работа`,
            description: `Проверяет обе функции вместе и по очереди выключает каждую, не нарушая оставшуюся активную функцию. Затем повторно включает комбинацию и выполняет полный сброс.`,
        };
    }
    if (/^HR/.test(id)) {
        return {
            name: `${featureNames}: рискованная последовательность`,
            description: `Последовательно наращивает комбинацию «${featureNames}», по одному удаляет активные компоненты, собирает комбинацию заново и доказывает чистый финальный reset.`,
        };
    }
    const suffix = id.split('_')[1];
    if (suffix === '1') return {
        name: `${featureNames}: включение`,
        description: `Включает функцию «${featureNames}», обновляет выбранный график и повторным Refresh доказывает, что настройка сохранилась без повторной команды.`,
    };
    if (suffix === '2') return {
        name: `${featureNames}: включение и выключение`,
        description: `Включает функцию «${featureNames}», затем выключает её и проверяет возврат исходного состояния Grafana.`,
    };
    return {
        name: `${featureNames}: повторные ON/OFF`,
        description: `Повторяет включение и выключение функции «${featureNames}», чтобы обнаружить накопление обработчиков, потерю состояния и неидемпотентный reset.`,
    };
}

function matrixTest(id, technicalName, states, runModes = ['full'], featureIds = []) {
    // Each transition performs one graph Refresh. The first occurrence of
    // every distinct active set performs a second Refresh to prove persistence
    // without resending the command. Repeated identical active sets still run
    // their command/Refresh/invariant, but reuse that exact persistence proof.
    // Isolation and final cleanup contribute one refresh each.
    const persistenceSets = new Set();
    const refreshCount = states.reduce((count, activeIds) => {
        const persistenceKey = [...activeIds].sort().join('|');
        const needsPersistence = activeIds.length > 0 && !persistenceSets.has(persistenceKey);
        if (needsPersistence) persistenceSets.add(persistenceKey);
        return count + 1 + (needsPersistence ? 1 : 0);
    }, 2);
    const metadata = describeMatrixScenario(id, featureIds, states);
    return {
        id, category: 'H', name: metadata.name, technicalName, description: metadata.description,
        featureIds: [...new Set(featureIds)], tags: [/^HR/.test(id) ? 'risk' : (/^HP/.test(id) ? 'pair' : 'lifecycle')], runModes,
        steps: states.map((activeIds, index) => `${index + 1}. ${activeIds.length ? `Активны: ${humanFeatureList(activeIds)}` : 'Все функции выключены'}`),
        expectedRefreshCount: refreshCount,
        timeoutBudgetModel: 'max(30s, expectedRefreshCount * 10s + 30s)',
        // This is only the outer emergency ceiling; successful scenarios end
        // immediately. Live Flot evidence shows threshold/layout refreshes can
        // legitimately take 9–23 seconds per transition while every inner
        // command, target-query and settlement watchdog remains healthy.
        timeoutMs: Math.max(30_000, refreshCount * 10_000 + 30_000),
        async run(tabId, env) {
            return runTransitionTest(tabId, env, makeMatrixTransitions(states));
        }
    };
}

// Each lifecycle explicitly repeats both commands. Repeated ON/OFF calls are not
// cosmetic: Grafana may replace renderer objects between applications, so the
// current active-set invariant must hold after every acknowledgement and refresh.
function generateLifecycleMatrixTests() {
    return E2E_FEATURE_REGISTRY.flatMap((feature, index) => {
        const id = `H${index + 1}`;
        return [
            matrixTest(`${id}_1`, `${feature.id} OFF→ON`, [[feature.id]], ['fast', 'full'], [feature.id]),
            matrixTest(`${id}_2`, `${feature.id} ON→OFF`, [[feature.id], []], ['full'], [feature.id]),
            matrixTest(
                `${id}_3`,
                `${feature.id} OFF→ON→ON→OFF→OFF→ON (идемпотентность)`,
                [[feature.id], [feature.id], [], [], [feature.id]],
                ['full'],
                [feature.id]
            ),
        ];
    });
}

// Deterministic pair coverage. Every vector is traversed in both directions:
//   00 → 10 → 11 → 01 → 11 → 00
//   00 → 01 → 11 → 10 → 11 → 00
// The partial-OFF states are mandatory: they catch a feature restoring or
// destroying renderer state while its neighbour remains active.
const E2E_PAIRWISE_VECTORS = [
    ['removeFill', 'thickenLines'], ['removeFill', 'seriesVisibility'],
    ['thickenLines', 'invertLegend'], ['seriesVisibility', 'invertLegend'],
    ['seriesVisibility', 'thresholdEnabled'], ['seriesVisibility', 'seriesQueryFilter'],
    ['invertIdle', 'invertLegend'], ['convertMemToUsed', 'seriesVisibility'],
    ['seriesQueryFilter', 'thresholdEnabled'], ['removeFill', 'thresholdEnabled'],
];

function pairwiseStates(first, second, reverse = false) {
    const [left, right] = reverse ? [second, first] : [first, second];
    return [[], [left], [left, right], [right], [left, right], []];
}

function generatePairwiseMatrixTests() {
    return E2E_PAIRWISE_VECTORS.flatMap(([first, second], index) => [
        matrixTest(
            `HP${index + 1}_1`,
            `${first} + ${second}: снять ${first}, сохранив ${second}`,
            pairwiseStates(first, second),
            ['full'],
            [first, second]
        ),
        matrixTest(
            `HP${index + 1}_2`,
            `${first} + ${second}: снять ${second}, сохранив ${first}`,
            pairwiseStates(first, second, true),
            ['full'],
            [first, second]
        ),
    ]);
}

// These chains cover shared renderer routes and data/visual interactions that
// are more failure-prone than arbitrary triples. Each chain contains a partial
// removal and a repeat activation; every command already waits for a target
// refresh in runTransitionTest().
const E2E_HIGH_RISK_SEQUENCES = [
    ['invertLegend', 'thickenLines', 'invertLegend', 'thickenLines'],
    ['removeFill', 'thickenLines', 'seriesVisibility', 'invertLegend'],
    ['seriesVisibility', 'thresholdEnabled', 'seriesQueryFilter'],
    ['removeFill', 'invertLegend', 'thresholdEnabled'],
    ['invertIdle', 'seriesVisibility', 'invertLegend'],
];

function highRiskStates(features) {
    const unique = [...new Set(features)];
    const states = unique.map((_, position) => unique.slice(0, position + 1));
    // Remove every feature once while keeping the rest active, then rebuild the
    // complete set. This exposes stale baseline caches and destructive cleanup.
    unique.forEach(feature => {
        states.push(unique.filter(id => id !== feature), unique);
    });
    states.push([]);
    return states;
}

function generateHighRiskMatrixTests() {
    return E2E_HIGH_RISK_SEQUENCES.map((features, index) => matrixTest(
        `HR${index + 1}`,
        `рискованная цепочка: ${features.join(' → ')}`,
        highRiskStates(features),
        index === 0 ? ['fast', 'full'] : ['full'],
        features
    ));
}

const suiteH = [
    ...generateLifecycleMatrixTests(),
    ...generatePairwiseMatrixTests(),
    ...generateHighRiskMatrixTests(),
];

// --- Категория A: Обнаружение окружения ---

const suiteA = [
    {
        id: 'A1',
        category: 'A',
        name: 'Grafana Runtime Detection',
        async run(tabId, env) {
            const version = env.probe?.grafanaVersion;
            if (!version) return { pass: false, details: 'grafanaBootData.settings.buildInfo.version не найден' };
            return { pass: true, details: `v${version}` };
        },
    },
    {
        id: 'A2',
        category: 'A',
        name: 'Route Type Detection',
        async run(tabId, env) {
            const rt = env.probe?.routeType;
            if (!rt) return { pass: false, details: 'routeType не определён' };
            return { pass: true, details: rt.toUpperCase() };
        },
    },
    {
        id: 'A3',
        category: 'A',
        name: 'Engine Detection',
        async run(tabId, env) {
            const engine = env.probe?.engine;
            if (!engine || engine === 'none') return { pass: false, details: 'canvas не найден — движок не определён' };
            return { pass: true, details: engine === 'flot' ? 'Flot (canvas.flot-base)' : 'uPlot (canvas)' };
        },
    },
    {
        id: 'A4',
        category: 'A',
        name: 'Panel Count',
        async run(tabId, env) {
            const count = env.probe?.allPanelCount ?? 0;
            if (count < 1) return { pass: false, details: 'Панели не найдены в DOM' };
            const vis = env.probe?.visiblePanelCount ?? 0;
            return { pass: true, details: `Всего в DOM: ${count}, видимых: ${vis}` };
        },
    },
    {
        id: 'A5',
        category: 'A',
        name: 'Content Script Injection',
        async run(tabId, env) {
            const ok = env.probe?.contentScript === true;
            return {
                pass: ok,
                details: ok ? 'data-dashbridge-icon-url присутствует' : 'Маркер content script не найден на <html>',
            };
        },
    },
    {
        id: 'A6',
        category: 'A',
        name: 'MAIN World Runtime: panelToolsState',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.panelToolsState === true;
            return {
                pass: ok,
                details: ok ? 'window.__dashbridgePanelToolsState загружен' : 'window.__dashbridgePanelToolsState не найден',
            };
        },
    },
    {
        id: 'A7',
        category: 'A',
        name: 'MAIN World Runtime: VisualEngine',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.visualEngine === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaVisualEngine загружен' : 'window.DashBridgeGrafanaVisualEngine не найден',
            };
        },
    },
    {
        id: 'A8',
        category: 'A',
        name: 'MAIN World Runtime: PanelState',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.panelState === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaPanelState загружен' : 'window.DashBridgeGrafanaPanelState не найден',
            };
        },
    },
    {
        id: 'A9',
        category: 'A',
        name: 'MAIN World Runtime: GrafanaDom',
        async run(tabId, env) {
            const ok = env.probe?.runtimes?.grafanaDom === true;
            return {
                pass: ok,
                details: ok ? 'window.DashBridgeGrafanaDom загружен' : 'window.DashBridgeGrafanaDom не найден',
            };
        },
    },
];

// --- Категория F: Storage и Background ---

const suiteF = [
    {
        id: 'F1',
        category: 'F',
        name: 'chrome.storage.local read/write',
        async run(_tabId, _env) {
            const key = '__dashbridge_test_probe_' + Date.now();
            const value = 'ok_' + Math.random();
            try {
                await chrome.storage.local.set({ [key]: value });
                const result = await chrome.storage.local.get(key);
                await chrome.storage.local.remove(key);
                const pass = result[key] === value;
                return { pass, details: pass ? 'read/write успешно' : `Записано: ${value}, прочитано: ${result[key]}` };
            } catch (e) {
                return { pass: false, details: `Ошибка: ${e.message}` };
            }
        },
    },
    {
        id: 'F2',
        category: 'F',
        name: 'chrome.storage.sync read',
        async run(_tabId, _env) {
            try {
                await chrome.storage.sync.get(null);
                return { pass: true, details: 'chrome.storage.sync доступен' };
            } catch (e) {
                return { pass: false, details: `Ошибка: ${e.message}` };
            }
        },
    },
];

// ─── Человекочитаемый каталог тестов ──────────────────────────────────
const STATIC_TEST_METADATA = {
    F1: ['Локальное хранилище: запись и чтение', 'Записывает уникальное тестовое значение в chrome.storage.local, читает его и удаляет без изменения пользовательских данных.'],
    F2: ['Синхронизируемое хранилище: доступность', 'Проверяет, что chrome.storage.sync доступно расширению для чтения настроек.'],
    A1: ['Версия Grafana', 'Определяет фактическую версию Grafana из runtime страницы.'],
    A2: ['Тип страницы Grafana', 'Проверяет распознавание обычного дашборда, View или одиночной панели.'],
    A3: ['Движок графика: uPlot или Flot', 'Находит фактически работающий renderer, от которого зависят дальнейшие проверки.'],
    A4: ['Панели дашборда', 'Проверяет, что панели Grafana найдены в DOM и хотя бы одна доступна для тестирования.'],
    A5: ['Загрузка DashBridge в Grafana', 'Проверяет маркер isolated content script на открытой странице Grafana.'],
    A6: ['Контроллер настроек панели', 'Проверяет загрузку MAIN-world владельца команд, фильтров и lifecycle панели.'],
    A7: ['Движок оформления графика', 'Проверяет загрузку MAIN-world движка заливки, линий, легенды, видимости и порога.'],
    A8: ['Состояние выбранной панели', 'Проверяет загрузку владельца сохранения и восстановления состояния панели.'],
    A9: ['Поиск панели в DOM Grafana', 'Проверяет загрузку общего адаптера поиска панели и её renderer-узлов.'],
};

const STATIC_TEST_SOURCES = {
    A6: ['js/content/grafana-panel-tools.js', 'window.__dashbridgePanelToolsState'],
    A7: ['js/content/grafana-visual-engine.js', 'window.DashBridgeGrafanaVisualEngine'],
    A8: ['js/content/grafana-panel-state.js', 'window.DashBridgeGrafanaPanelState'],
    A9: ['js/content/grafana-dom.js', 'window.DashBridgeGrafanaDom'],
};

const DASHBRIDGE_TEST_SUITE = [...suiteF, ...suiteA, ...suiteH].map(test => {
    const metadata = STATIC_TEST_METADATA[test.id];
    return metadata ? { ...test, name: metadata[0], technicalName: test.name, description: metadata[1], tags: ['environment'] } : test;
});

function getTestFeatureReference(testOrId) {
    const test = typeof testOrId === 'object'
        ? testOrId
        : DASHBRIDGE_TEST_SUITE.find(item => item.id === String(testOrId || ''));
    if (!test) return null;
    const features = (test.featureIds || []).map(id => E2E_FEATURES_BY_ID[id]).filter(Boolean);
    const staticSource = STATIC_TEST_SOURCES[test.id] || [];
    return {
        label: test.name,
        description: test.description || 'Выполняет причинную проверку DashBridge в живой Grafana.',
        steps: Array.isArray(test.steps) ? test.steps : [],
        sourceFile: features[0]?.sourceFile || staticSource[0] || '',
        sourceSymbol: features[0]?.sourceSymbol || staticSource[1] || '',
        technicalName: test.technicalName || '',
    };
}
