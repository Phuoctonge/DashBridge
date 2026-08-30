// Test Runner MAIN-world environment probe.
// Выполняется в MAIN world Grafana через chrome.scripting.executeScript.
// Возвращает снэпшот окружения: версию, движок, рантаймы, первую видимую панель.
// НЕ импортирует ничего — работает как самодостаточная функция-аргумент.

function dashbridgeRunProbe() {
    const isFlot = document.querySelectorAll('canvas.flot-base').length > 0;
    const hasCanvas = document.querySelectorAll('canvas').length > 0;
    const engine = isFlot ? 'flot' : (hasCanvas ? 'uplot' : 'none');

    const routePath = location.pathname;
    const routeSearch = new URLSearchParams(location.search);
    const viewPanelParam = routeSearch.get('viewPanel');   // numeric ID or panel-N, depending on Grafana route
    const viewPanelId = viewPanelParam
        ? (String(viewPanelParam).startsWith('panel-') ? String(viewPanelParam) : `panel-${viewPanelParam}`)
        : null;
    const routeType = routePath.includes('/d-solo/')
        ? 'solo'
        : viewPanelParam
            ? 'zoomed'
            : window.parent !== window
                ? 'iframe'
                : 'full';

    // Используем рантайм DashBridgeGrafanaDom если доступен, иначе fallback
    const dom = window.DashBridgeGrafanaDom;
    let visiblePanels = [];
    let firstPanelId = null;
    let firstPanelKey = null;

    // Вспомогательная: пробует получить ключ у элемента и у его дочерних [data-viz-panel-key].
    // В Grafana v12 .react-grid-item содержит внутри <div data-viz-panel-key="panel-N">.
    const resolveKey = (panel) => {
        if (!dom) return null;
        const direct = dom.panelKey(panel);
        if (direct) return direct;
        const inner = panel.querySelector('[data-viz-panel-key^="panel-"]');
        if (inner) return dom.panelKey(inner) || inner.dataset.vizPanelKey || null;
        const byPanelId = panel.querySelector('[data-panelid], [data-panel-id]');
        if (byPanelId) return dom.panelKey(byPanelId);
        return null;
    };

    if (dom && typeof dom.visiblePanels === 'function') {
        visiblePanels = dom.visiblePanels();
        // Ищем первую панель у которой есть разрешаемый ключ.
        // .react-grid-item в v12 содержит вложенный [data-viz-panel-key].
        for (const panel of visiblePanels) {
            const key = resolveKey(panel);
            if (key) {
                firstPanelKey = key;
                firstPanelId = key;
                break;
            }
        }
        // Если visiblePanels не дали ключа — прямой поиск по атрибуту
        if (!firstPanelId) {
            const byAttr = [...document.querySelectorAll('[data-viz-panel-key^="panel-"]')]
                .find(el => el.offsetHeight > 50);
            if (byAttr) {
                firstPanelId = byAttr.dataset.vizPanelKey;
                firstPanelKey = firstPanelId;
            }
        }
        // Последний резерв — findPanel()
        if (!firstPanelId && typeof dom.findPanel === 'function') {
            const found = dom.findPanel({});
            if (found) {
                const key = resolveKey(found);
                firstPanelKey = key || null;
                firstPanelId = key || null;
            }
        }
    } else {
        // Fallback для случая когда DashBridgeGrafanaDom не загружен
        const sel = '[data-viz-panel-key^="panel-"], [data-panelid], [data-panel-id]';
        visiblePanels = [...document.querySelectorAll(sel)].filter(p => p.offsetHeight > 100);
        if (visiblePanels.length > 0) {
            const first = visiblePanels[0];
            const raw = first.dataset?.vizPanelKey
                || first.dataset?.panelid
                || first.getAttribute('data-panel-id')
                || first.getAttribute('data-panelid');
            if (raw) {
                firstPanelId = String(raw).startsWith('panel-') ? String(raw) : `panel-${raw}`;
                firstPanelKey = firstPanelId;
            }
        }
    }

    // Панели в DOM (без учёта виртуализации) — для v10 Flot все 90 будут здесь
    // В режиме viewPanel добавляем селекторы fullscreen-враппера
    const allPanelCount = document.querySelectorAll(
        '.react-grid-item, [data-panelid], [data-viz-panel-key^="panel-"],' +
        '[class*="panel-in-canvas"], [data-testid*="panel-content"], [class*="PanelChrome"]'
    ).length;

    // Ищем «лучшую» панель для тестов B/C/D: с canvas И легендой (≥2 серии).
    // stat/gauge/text панели не имеют ни заливки ни серий — apply() на них бесполезен.
    // В v10 легенда (.graph-legend-series) может лежать СНАРУЖИ [data-panelid] —
    // внутри .panel-container или .panel-wrapper рядом с canvas.
    const legendItemsSel = [
        '.graph-legend-series',
        '[class*="LegendRow"]',
        '[class*="legend-item" i]',
        '.u-legend tr',
        '.u-legend-row',
        '.u-off',                       // uPlot скрытые серии тоже считаем
        '[class*="legend"] [role="button"]',
    ].join(', ');

    let firstGraphPanelId = null;
    let legendCount = 0;
    let legendSelector = 'none';

    // Все кандидаты: elements с data-viz-panel-key или data-panelid, видимые
    const allKeyed = [...document.querySelectorAll('[data-viz-panel-key^="panel-"], [data-panelid], [data-panel-id]')]
        .filter(el => el.offsetHeight > 50);

    // Вспомогательная: получить легенду для элемента, учитывая что в v10
    // .graph-legend-series может быть в родительском .panel-container
    const getLegendItems = (el) => {
        // 1. Внутри самого элемента
        let items = [...el.querySelectorAll(legendItemsSel)];
        if (items.length >= 2) return items;
        // 2. В родительском контейнере (v10: .panel-container содержит и canvas и легенду)
        const container = el.closest('.panel-container, .panel-wrapper, [class*="panel-wrapper"]')
            || el.parentElement;
        if (container) {
            items = [...container.querySelectorAll(legendItemsSel)];
            if (items.length >= 2) return items;
        }
        // 3. Глобальный поиск — для v10 где легенда рядом с панелью
        if (dom && typeof dom.legendItems === 'function') {
            const fromDom = dom.legendItems(el);
            if (fromDom.length >= 2) return fromDom;
        }
        return items;
    };

    for (const el of allKeyed) {
        const hasCanvas = el.querySelector('canvas') !== null;
        if (!hasCanvas) continue;
        const legendItems = getLegendItems(el);
        if (legendItems.length >= 2) {
            const raw = el.dataset?.vizPanelKey || el.dataset?.panelid || el.getAttribute('data-panel-id');
            if (raw) {
                firstGraphPanelId = String(raw).startsWith('panel-') ? String(raw) : `panel-${raw}`;
                legendCount = legendItems.length;
                const cls = legendItems[0].className || '';
                legendSelector = cls.includes('LegendRow') ? 'LegendRow'
                    : cls.includes('graph-legend') ? 'graph-legend-series'
                        : cls.includes('u-legend') ? 'u-legend-tr'
                            : 'other';
                break;
            }
        }
    }

    // Если не нашли панель с canvas+легендой≥2 — берём любую с canvas+хоть 1 легендой
    if (!firstGraphPanelId) {
        for (const el of allKeyed) {
            if (!el.querySelector('canvas')) continue;
            const items = getLegendItems(el);
            if (items.length > 0) {
                const raw = el.dataset?.vizPanelKey || el.dataset?.panelid || el.getAttribute('data-panel-id');
                if (raw) {
                    firstGraphPanelId = String(raw).startsWith('panel-') ? String(raw) : `panel-${raw}`;
                    legendCount = items.length;
                    break;
                }
            }
        }
    }

    // Последний резерв — любая панель с canvas
    if (!firstGraphPanelId) {
        for (const el of allKeyed) {
            if (el.querySelector('canvas')) {
                const raw = el.dataset?.vizPanelKey || el.dataset?.panelid || el.getAttribute('data-panel-id');
                if (raw) {
                    firstGraphPanelId = String(raw).startsWith('panel-') ? String(raw) : `panel-${raw}`;
                    break;
                }
            }
        }
    }

    // viewPanel режим: если DOM не дал panelId — строим из URL параметра.
    // При ?viewPanel=5 Grafana рендерит одну панель но враппер может не иметь data-атрибутов.
    if (!firstGraphPanelId && viewPanelId) {
        firstGraphPanelId = viewPanelId;
        legendCount = legendCount || 0;
        // Пробуем взять canvas snapshot напрямую (без panelId-враппера)
    }
    // Также если firstPanelId не определён — используем viewPanelParam
    if (!firstPanelId && viewPanelId) {
        firstPanelId = viewPanelId;
        firstPanelKey = firstPanelId;
    }

    // Уточняем legendCount через dom.legendItems если probe нашёл панель но не легенду
    if (legendCount === 0 && firstGraphPanelId && dom && typeof dom.legendItems === 'function') {
        const graphEl = document.querySelector(
            `[data-viz-panel-key="${firstGraphPanelId}"], [data-panelid="${firstGraphPanelId.replace('panel-', '')}"]`
        );
        if (graphEl) {
            const items = dom.legendItems(graphEl);
            if (items.length > 0) {
                legendCount = items.length;
                const cls = items[0].className || '';
                legendSelector = cls.includes('LegendRow') ? 'LegendRow'
                    : cls.includes('graph-legend') ? 'graph-legend-series'
                        : cls.includes('u-legend') ? 'u-legend-tr'
                            : 'other';
            }
        }
    }

    // canvas snapshot первой graph-панели для baseline сравнения
    let canvasDataUrl = null;
    if (firstGraphPanelId) {
        const graphEl = document.querySelector(`[data-viz-panel-key="${firstGraphPanelId}"], [data-panelid="${firstGraphPanelId.replace('panel-', '')}"]`);
        const canvas = graphEl?.querySelector('canvas') || document.querySelector('canvas');
        if (canvas) {
            try { canvasDataUrl = canvas.toDataURL(); } catch (_) { canvasDataUrl = null; }
        }
    } else if (visiblePanels.length > 0) {
        const canvas = visiblePanels[0].querySelector('canvas') || document.querySelector('canvas');
        if (canvas) {
            try { canvasDataUrl = canvas.toDataURL(); } catch (_) { canvasDataUrl = null; }
        }
    }

    return {
        ok: true,
        grafanaVersion: window.grafanaBootData?.settings?.buildInfo?.version || null,
        engine,
        isFlot,
        routeType,
        viewPanelId,  // normalized from ?viewPanel=N or ?viewPanel=panel-N
        allPanelCount,
        visiblePanelCount: visiblePanels.length,
        firstPanelId,
        firstPanelKey,
        firstGraphPanelId,   // панель с canvas+легендой — для B/C/D тестов
        legendCount,
        legendSelector,
        canvasDataUrl,
        runtimes: {
            grafanaDom: typeof window.DashBridgeGrafanaDom !== 'undefined',
            visualEngine: typeof window.DashBridgeGrafanaVisualEngine !== 'undefined',
            panelState: typeof window.DashBridgeGrafanaPanelState !== 'undefined',
            panelToolsState: typeof window.__dashbridgePanelToolsState !== 'undefined',
        },
        contentScript: document.documentElement.hasAttribute('data-dashbridge-icon-url'),
    };
}
