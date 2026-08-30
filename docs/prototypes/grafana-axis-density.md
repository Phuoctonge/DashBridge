# DashBridge — прототип управления плотностью осей Grafana/uPlot

Статус: справочный прототип. Этот файл никуда не подключён и не влияет
на текущее расширение.

Что регулируется:

- X — временные подписи и соответствующие вертикальные линии сетки.
- Y — подписи значений (ms, s, %, bytes и т. п.) и горизонтальные линии.
- Чем МЕНЬШЕ значение spacePx, тем БОЛЬШЕ меток будет показано.
- Режим auto возвращает штатный алгоритм Grafana/uPlot.

Пример возможного состояния настройки:

    axisDensity: {
        enabled: true,
        x: { mode: 'dense', spacePx: null },
        y: { mode: 'normal', spacePx: null }
    }

Предлагаемые пресеты (их ещё нужно подобрать на реальных графиках):

    auto   — штатная плотность Grafana;
    sparse — X: 150 px, Y: 70 px;
    normal — X: 95 px,  Y: 45 px;
    dense  — X: 55 px,  Y: 28 px.

Возможный MAIN-world код
------------------------

```js
(() => {
    'use strict';

    const CONTROLLER_KEY = '__dashbridgeAxisDensityController';
    const ORIGINAL_SPACE_KEY = '__dashbridgeOriginalAxisSpace';

    const PRESETS = Object.freeze({
        auto:   Object.freeze({ x: null, y: null }),
        sparse: Object.freeze({ x: 150,  y: 70 }),
        normal: Object.freeze({ x: 95,   y: 45 }),
        dense:  Object.freeze({ x: 55,   y: 28 }),
    });

    const normalizeMode = value => Object.prototype.hasOwnProperty.call(PRESETS, value)
        ? value
        : 'auto';

    const normalizeSpace = (axis, setting = {}) => {
        const custom = Number(setting.spacePx);
        if (Number.isFinite(custom)) {
            // Защита от нечитаемой сетки и экстремального числа подписей.
            return Math.max(axis === 'x' ? 35 : 20, Math.min(300, custom));
        }
        return PRESETS[normalizeMode(setting.mode)][axis];
    };

    const findPanelRoot = panelId => {
        if (!panelId) return document;
        const escaped = CSS.escape(String(panelId).replace(/^panel-/, ''));
        return document.querySelector(`[data-viz-panel-key="panel-${escaped}"]`)
            ?.closest('.react-grid-item, .panel-container')
            || document.querySelector(`[data-panelid="${escaped}"]`)
            || document;
    };

    const findUPlot = root => {
        // В production лучше использовать уже существующий resolver DashBridge.
        const shared = window.DashBridgeGrafanaVisualEngine?.findUPlot?.(root);
        if (shared?.axes && typeof shared.redraw === 'function') return shared;

        const candidates = [root, ...root.querySelectorAll('.uplot, .u-wrap, canvas')];
        for (const candidate of candidates) {
            for (const key of Object.getOwnPropertyNames(candidate || {})) {
                let value;
                try { value = candidate[key]; } catch (_) { continue; }
                if (value?.axes && typeof value.redraw === 'function'
                    && typeof value.setSize === 'function') return value;
            }
        }
        return null;
    };

    const rememberOriginalSpace = axis => {
        if (!axis || Object.prototype.hasOwnProperty.call(axis, ORIGINAL_SPACE_KEY)) return;
        axis[ORIGINAL_SPACE_KEY] = axis.space;
    };

    const setAxisSpace = (axis, requestedSpace) => {
        if (!axis) return;
        rememberOriginalSpace(axis);
        axis.space = requestedSpace === null
            ? axis[ORIGINAL_SPACE_KEY]
            : requestedSpace;
    };

    const forgetOriginalSpace = axis => {
        if (!axis || !Object.prototype.hasOwnProperty.call(axis, ORIGINAL_SPACE_KEY)) return;
        delete axis[ORIGINAL_SPACE_KEY];
    };

    const applyToUPlot = (uplot, settings) => {
        if (!uplot?.axes?.length) return { applied: false, reason: 'uplot-not-found' };

        const enabled = settings?.enabled !== false;
        const xSpace = enabled ? normalizeSpace('x', settings?.x) : null;
        const ySpace = enabled ? normalizeSpace('y', settings?.y) : null;

        // В uPlot ось 0 обычно является временной X. Остальные оси относятся
        // к шкалам Y. Если панель имеет несколько Y-шкал, настройка применяется
        // к каждой из них одинаково.
        setAxisSpace(uplot.axes[0], xSpace);
        uplot.axes.slice(1).forEach(axis => setAxisSpace(axis, ySpace));

        // setSize заставляет uPlot заново вычислить splits/ticks для текущего
        // размера. Один redraw после него достаточен.
        const width = Math.max(1, Math.round(uplot.width || uplot.bbox?.width || 1));
        const height = Math.max(1, Math.round(uplot.height || uplot.bbox?.height || 1));
        uplot.setSize({ width, height });
        uplot.redraw(true, true);

        return {
            applied: true,
            xSpace,
            ySpace,
            axisCount: uplot.axes.length,
            size: { width, height },
        };
    };

    const restoreUPlot = uplot => {
        if (!uplot?.axes?.length) return false;
        uplot.axes.forEach(axis => {
            if (!Object.prototype.hasOwnProperty.call(axis, ORIGINAL_SPACE_KEY)) return;
            axis.space = axis[ORIGINAL_SPACE_KEY];
            forgetOriginalSpace(axis);
        });
        uplot.redraw(true, true);
        return true;
    };

    const stopController = root => {
        const controller = root?.[CONTROLLER_KEY];
        if (!controller) return;
        controller.stopped = true;
        controller.observer?.disconnect();
        controller.resizeObserver?.disconnect();
        if (controller.rafId) cancelAnimationFrame(controller.rafId);
        restoreUPlot(controller.lastUPlot || findUPlot(root));
        delete root[CONTROLLER_KEY];
    };

    const installController = ({ panelId = null, settings = {} } = {}) => {
        const root = findPanelRoot(panelId);
        stopController(root);

        const controller = {
            stopped: false,
            rafId: 0,
            settings: structuredClone(settings),
            lastUPlot: null,
            lastResult: null,
        };

        const apply = () => {
            controller.rafId = 0;
            if (controller.stopped) return;
            const uplot = findUPlot(root);
            if (!uplot) {
                controller.lastResult = { applied: false, reason: 'uplot-not-found' };
                return;
            }
            controller.lastUPlot = uplot;
            controller.lastResult = applyToUPlot(uplot, controller.settings);
        };

        const schedule = () => {
            if (controller.stopped || controller.rafId) return;
            // Два кадра позволяют React/Grafana сначала завершить layout.
            controller.rafId = requestAnimationFrame(() => {
                controller.rafId = requestAnimationFrame(apply);
            });
        };

        controller.observer = new MutationObserver(schedule);
        controller.observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['width', 'height', 'class', 'style'],
        });

        controller.resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(schedule)
            : null;
        controller.resizeObserver?.observe(root);

        controller.update = nextSettings => {
            controller.settings = structuredClone(nextSettings || {});
            schedule();
        };
        controller.stop = () => stopController(root);
        root[CONTROLLER_KEY] = controller;
        schedule();
        return controller;
    };

    // Предлагаемый публичный интерфейс прототипа.
    window.DashBridgeAxisDensityPrototype = {
        presets: PRESETS,
        install: installController,
        stop(panelId = null) {
            stopController(findPanelRoot(panelId));
        },
    };
})();
```

Примеры использования из DevTools
---------------------------------

1. Больше временных меток X, штатная ось Y:

```js
window.__axisTest = DashBridgeAxisDensityPrototype.install({
    panelId: 'panel-138',
    settings: {
        enabled: true,
        x: { mode: 'dense' },
        y: { mode: 'auto' },
    },
});
```

2. Собственные расстояния между метками:

```js
window.__axisTest.update({
    enabled: true,
    x: { mode: 'auto', spacePx: 70 },
    y: { mode: 'auto', spacePx: 35 },
});
```

3. Вернуть штатное поведение:

```js
window.__axisTest.stop();
```

Что потребуется проверить перед production-интеграцией
------------------------------------------------------

1. Действительно ли используемая версия uPlot перечитывает axis.space после
   создания экземпляра. Если нет, понадобится Grafana/uPlot hook на этапе
   формирования opts до конструктора.
2. Панели с двумя Y-осями и разными единицами.
3. Узкие панели: подписи X не должны накладываться друг на друга.
4. Переход legend bottom/right, изменение размера окна и полноэкранный режим.
5. Первый и второй Refresh графика.
6. Real-time обновления и замена экземпляра uPlot новым React-renderer'ом.
7. Reset должен вернуть исходные функции/числа axis.space без потери настроек
   Grafana.
8. В автоотчётность желательно добавить фактические значения:
   xAxis.space, yAxis.space, число рассчитанных splits и размеры bbox.

Предлагаемый UI, если функция понадобится
-----------------------------------------

    Плотность осей
      Временная ось X: [Авто | Редко | Обычно | Часто | Вручную]
      Ось значений Y:  [Авто | Редко | Обычно | Часто | Вручную]

Ручное значение лучше показывать как «минимальное расстояние между метками,
px», а не как точное количество меток: Grafana всё равно округляет интервалы
до удобных временных и числовых шагов.
