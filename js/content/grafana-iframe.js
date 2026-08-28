// Этот скрипт работает внутри iframe Графаны и "жестко" вырезает шапку
if (window.name === 'dashbridge-iframe') {
    const extensionOrigin = new URL(chrome.runtime.getURL("")).origin;
    // Tell the parent that this window has reached the Grafana document. This
    // is safer than relying on iframe `load`, which can belong to about:blank.
    window.parent.postMessage({ action: 'dashbridgeIframeReady' }, extensionOrigin);
    let panelRenderedReported = false;
    const reportPanelRendered = () => {
        if (panelRenderedReported) return true;
        const surface = document.querySelector(
            'canvas, table, [role="table"], [role="grid"], [data-testid="panel content"], .panel-content'
        );
        const rect = surface?.getBoundingClientRect();
        if (!rect || rect.width < 20 || rect.height < 20) return false;
        panelRenderedReported = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.parent.postMessage({ action: 'dashbridgePanelRendered' }, extensionOrigin);
        }));
        return true;
    };
    // Grafana mounts the panel header asynchronously, often after the iframe
    // `load` event.  Keep watching until its real title appears so a paused
    // card can retain the same caption instead of falling back to a default.
    let panelTitleReported = false;
    const findPanelTitle = () => {
        const selectors = [
            '[data-testid="panel title"]',
            '.panel-title-text',
            '.panel-title',
            '[data-testid*="Panel header"] h2',
            '[data-testid*="Panel header"] h1',
            '[data-testid*="Panel header"] h6',
            'h6[title]',
            'h2[title]',
            'h2',
            'h1'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const title = element?.getAttribute?.('title') || element?.textContent?.trim();
            if (title) return title;
        }
        const headerTestId = document.querySelector('[data-testid*="Panel header"]')?.getAttribute('data-testid') || '';
        return headerTestId.replace(/^.*Panel header\s*/i, '').trim();
    };
    const isGrafanaStartupFailureTitle = title => /^If you're seeing this Grafana has failed to load its application files\.?$/i.test(title);
    const reportPanelTitle = () => {
        if (panelTitleReported) return true;
        const title = findPanelTitle();
        // Grafana's bootstrap markup can briefly expose this text before the
        // React panel header arrives. It is not a panel title and must not be
        // persisted into the paused card.
        if (!title || isGrafanaStartupFailureTitle(title)) return false;
        panelTitleReported = true;
        window.parent.postMessage({ action: 'dashbridgePanelTitle', title }, extensionOrigin);
        return true;
    };
    const readinessStartedAt = Date.now();
    let readinessTimer = null;
    let readinessDisposed = false;
    const inspectReadiness = () => {
        if (readinessDisposed) return;
        clearTimeout(readinessTimer);
        readinessTimer = null;
        const elapsed = Date.now() - readinessStartedAt;
        reportPanelRendered();
        if (elapsed < 15_000) reportPanelTitle();
        if (panelRenderedReported && (panelTitleReported || elapsed >= 15_000)) return;
        const delay = elapsed < 3_000 ? 100 : (elapsed < 15_000 ? 400 : 1_500);
        readinessTimer = setTimeout(inspectReadiness, delay);
    };
    inspectReadiness();
    window.addEventListener('load', inspectReadiness, { once: true });
    window.addEventListener('dashbridgePanelDataSettled', inspectReadiness);
    window.addEventListener('pagehide', () => {
        readinessDisposed = true;
        clearTimeout(readinessTimer);
        window.removeEventListener('dashbridgePanelDataSettled', inspectReadiness);
    }, { once: true });
    const style = document.createElement('style');
    // Скрываем все возможные варианты шапок (Home), навигации и боковых панелей в Grafana 9, 10 и 11
    style.textContent = `
        /* Скрытие новых шапок Grafana 10+ */
        [data-testid="page-header"],
        [data-testid="data-testid Nav toolbar"],
        [aria-label="Page header"],
        [aria-label="Breadcrumbs"],
        [aria-label="Breadcrumb"],
        header,
        nav,
        .page-toolbar,
        .navbar,
        .sidemenu,
        .page-header-canvas {
            display: none !important;
        }
        
        /* Скрытие отступов, которые оставляет шапка */
        .main-view, .css-1quylay {
            padding-top: 0 !important;
            margin-top: 0 !important;
        }
        .page-container {
            padding-top: 0 !important;
            margin-top: 0 !important;
        }
        /* Растягиваем дашборд на весь экран */
        .react-grid-layout {
            margin-top: 0 !important;
        }
        /* Убиваем любые плавающие заголовки */
        div[class*="pageHeader"] {
            display: none !important;
        }

        /*
         * Grafana d-solo creates the panel inside a zero-sized layout wrapper:
         * .panel-solo > div[style="… height: 0px; width: 0px …"].  Its child
         * is then painted at the real panel size and makes the whole iframe
         * document scroll.  Give that wrapper the iframe viewport instead.
         * Grafana can consequently keep a long legend in its own scroller,
         * without shifting or clipping the chart in DashBridge.
         */
        html, body, .panel-solo {
            height: 100% !important;
            min-height: 0 !important;
        }
        /*
         * Hover UI in some Grafana panels temporarily overflows the document.
         * Prefer Chromium's overlay scrollbar so it does not resize the graph
         * or reserve an always-visible gutter at the right edge.
         */
        html, body {
            overflow-x: hidden !important;
            overflow-y: overlay !important;
        }
        .panel-solo {
            overflow: hidden !important;
        }
        .panel-solo > div[style*="height: 0px"][style*="width: 0px"] {
            height: 100% !important;
            width: 100% !important;
            overflow: hidden !important;
        }
        .panel-solo > div[style*="height: 0px"][style*="width: 0px"] > [data-testid*="Panel header"] {
            max-height: 100% !important;
        }
    `;

    // Вставляем стили как можно раньше
    document.documentElement.appendChild(style);

    // Вспомогательная функция: вставляем style если его ещё нет в DOM
    function ensureStyleInDOM() {
        const target = document.head || document.body || document.documentElement;
        if (target && !target.contains(style)) {
            target.appendChild(style);
        }
    }

    // BUG-011: guard на случай если DOMContentLoaded уже произошёл
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureStyleInDOM, { once: true });
    } else {
        ensureStyleInDOM();
    }

    // Слушатель команд от родительского дашборда для бесшовного обновления времени
    window.addEventListener('message', (event) => {
        if (event.origin !== extensionOrigin) return;
        if (event.source !== window.parent) return;
        if (event.data?.action === 'getDashbridgePanelTitle' && typeof event.data.requestId === 'string') {
            window.parent.postMessage({
                action: 'dashbridgePanelTitleResponse',
                requestId: event.data.requestId,
                title: findPanelTitle()
            }, extensionOrigin);
            return;
        }
        if (event.data && event.data.type === 'DASHBRIDGE_TIME_UPDATE') {
            try {
                const url = new URL(window.location.href);
                let changed = false;

                if (event.data.from && url.searchParams.get('from') !== event.data.from) {
                    url.searchParams.set('from', event.data.from);
                    changed = true;
                }
                if (event.data.to && url.searchParams.get('to') !== event.data.to) {
                    url.searchParams.set('to', event.data.to);
                    changed = true;
                }

                if (event.data.refresh) {
                    if (url.searchParams.get('refresh') !== event.data.refresh) {
                        url.searchParams.set('refresh', event.data.refresh);
                        changed = true;
                    }
                } else if (url.searchParams.get('refresh') !== '1y') {
                    // Grafana 10.1 rejects `refresh=off` and never finishes
                    // initializing. Keep a valid, effectively disabled value.
                    url.searchParams.set('refresh', '1y');
                    changed = true;
                }

                // Если URL изменился, пытаемся обновить его через History API без моргания
                if (changed) {
                    window.history.replaceState(null, '', url.toString());
                    // Симулируем событие изменения URL, чтобы React/Grafana роутер его подхватил
                    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

                    // Если Графана вдруг не отреагировала на popstate (бывает на некоторых версиях),
                    // мы можем сделать жесткий релоад, но сначала дадим шанс SPA отработать.
                    // setTimeout(() => { ... }, 1000);
                }
            } catch (err) {
                console.error("Ошибка при обновлении времени Grafana:", err);
            }
        }
    });

    function getGraphArea() {
        return document.querySelector('.u-over') ||
            document.querySelector('.flot-overlay') ||
            document.querySelector('.flot-base') ||
            document.querySelector('canvas');
    }

    // DashBridge puts the shared absolute range in every d-solo URL.  Using
    // it keeps crosshair lines aligned by time without touching Grafana APIs.
    function getDashboardTimeRange() {
        try {
            const url = new URL(window.location.href);
            const from = parseGrafanaAbsoluteTime(url.searchParams.get('from'));
            const to = parseGrafanaAbsoluteTime(url.searchParams.get('to'));
            return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
        } catch {
            return null;
        }
    }

    function timestampAtPercent(percentX) {
        const range = getDashboardTimeRange();
        return range ? range.from + (range.to - range.from) * percentX : null;
    }

    function percentAtTimestamp(timestamp, fallbackPercent) {
        const range = Number.isFinite(timestamp) && getDashboardTimeRange();
        if (!range) return fallbackPercent;
        return Math.min(1, Math.max(0, (timestamp - range.from) / (range.to - range.from)));
    }

    let crosshairMode = 'line';
    let crosshairThickness = 1;
    let crosshairLine = null;
    let outgoingCrosshairFrame = null;
    let pendingCrosshair = null;

    function getCrosshairLine() {
        if (!crosshairLine && document.body) {
            crosshairLine = document.createElement('div');
            crosshairLine.style.cssText = `display: none; position: fixed; top: 0; bottom: 0; width: 1px; border-left: ${crosshairThickness}px dashed #e02f44; z-index: 999999; pointer-events: none; opacity: 0.8;`;
            document.body.appendChild(crosshairLine);
        }
        return crosshairLine;
    }

    function broadcastCrosshair(percentX) {
        pendingCrosshair = { percentX, timestamp: timestampAtPercent(percentX) };
        if (outgoingCrosshairFrame) return;
        outgoingCrosshairFrame = requestAnimationFrame(() => {
            outgoingCrosshairFrame = null;
            const crosshair = pendingCrosshair;
            pendingCrosshair = null;
            window.parent.postMessage({ action: 'broadcastCrosshair', ...crosshair }, extensionOrigin);
        });
    }

    function broadcastCrosshairHide() {
        if (outgoingCrosshairFrame) {
            cancelAnimationFrame(outgoingCrosshairFrame);
            outgoingCrosshairFrame = null;
        }
        pendingCrosshair = null;
        window.parent.postMessage({ action: 'broadcastCrosshairHide' }, extensionOrigin);
    }

    document.addEventListener('mousemove', event => {
        if (!event.isTrusted || crosshairMode !== 'line') return;
        const graphArea = getGraphArea();
        const rect = graphArea?.getBoundingClientRect();
        if (rect && event.clientX >= rect.left && event.clientX <= rect.right) {
            broadcastCrosshair((event.clientX - rect.left) / rect.width);
        } else {
            broadcastCrosshairHide();
        }
    });

    document.addEventListener('mouseleave', event => {
        if (event.isTrusted) broadcastCrosshairHide();
    });
    window.addEventListener('blur', broadcastCrosshairHide);

    window.addEventListener('message', event => {
        if (event.origin !== extensionOrigin) return;
        if (event.source !== window.parent) return;
        if (event.data?.action === 'setCrosshairMode') {
            crosshairMode = event.data.mode === 'line' ? 'line' : 'off';
            if (event.data.thickness) {
                crosshairThickness = event.data.thickness;
                if (crosshairLine) crosshairLine.style.borderLeftWidth = `${crosshairThickness}px`;
            }
            if (crosshairMode === 'off' && crosshairLine) crosshairLine.style.display = 'none';
            return;
        }
        if (event.data?.action === 'dashbridgeCaptureLayoutChanged') {
            window.dispatchEvent(new Event('resize'));
            requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
            return;
        }
        if (event.data?.action === 'setCrosshairThickness') {
            if (event.data.thickness) {
                crosshairThickness = event.data.thickness;
                if (crosshairLine) crosshairLine.style.borderLeftWidth = `${crosshairThickness}px`;
            }
            return;
        }
        if (event.data?.action === 'syncCrosshair') {
            if (crosshairMode !== 'line') return;
            const graphArea = getGraphArea();
            const rect = graphArea?.getBoundingClientRect();
            if (!rect) return;
            const line = getCrosshairLine();
            if (!line) return;
            const percentX = percentAtTimestamp(event.data.timestamp, event.data.percentX);
            line.style.left = `${rect.left + rect.width * percentX}px`;
            line.style.top = `${rect.top}px`;
            line.style.height = `${rect.height}px`;
            line.style.display = 'block';
            return;
        }
        if (event.data?.action === 'hideCrosshair' && crosshairLine) {
            crosshairLine.style.display = 'none';
        }
    });
}
