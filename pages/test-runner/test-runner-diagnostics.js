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
        // caller opts in. Extension-page commands do this in runGrafanaCommand(); the
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
