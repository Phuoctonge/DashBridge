(function initGrafanaLegendVisibilityAdapters(root) {
    'use strict';
    if (root.DashBridgeGrafanaLegendVisibilityAdapters) return;

    function create({ debugLog, getSeriesConfigState, findUPlotForThreshold } = {}) {
        if (typeof debugLog !== 'function' || typeof getSeriesConfigState !== 'function'
            || typeof findUPlotForThreshold !== 'function') {
            throw new TypeError('Grafana legend visibility adapter dependencies are incomplete');
        }
        const flotVisibilityControllers = new WeakMap();
        const uPlotFastVisibilityControllers = new WeakMap();
        let uPlotTooltipControllerSequence = 0;
    
        const getFlotPlot = root => {
            const $ = window.jQuery || window.$;
            if (!$ || !root) return null;
            const host = $(root).find('.graph-panel__chart, .flot-base, canvas').toArray()
                .find(element => !!$(element).data('plot'));
            return host ? $(host).data('plot') : null;
        };
    
        const getFlotRowLabel = row => {
            const label = row?.querySelector?.(
                '.graph-tooltip-series-name, [class*="LegendLabel"], button, .graph-legend-alias, [class*="legend-label" i]'
            );
            return (label?.textContent || '').trim().replace(/:\s*$/, '');
        };
    
        const installFlotVisibilityController = ({ root, seriesConfig, mode }) => {
            let controller = flotVisibilityControllers.get(root);
            if (!controller) {
                controller = {
                    root,
                    seriesConfig: {},
                    mode: 'fast_click_toggle',
                    plot: null,
                    originalSetData: null,
                    lastFullData: null,
                    bindQueued: false,
                    needsApply: true,
                    observer: null,
                    previousStyles: new Map()
                };
                flotVisibilityControllers.set(root, controller);
            }
    
            controller.seriesConfig = { ...seriesConfig };
            controller.mode = mode || 'fast_click_toggle';
            controller.needsApply = true;
    
            const isSelected = label => getSeriesConfigState(controller.seriesConfig, label) !== false;
            const filterData = data => Array.isArray(data)
                ? data.filter(series => isSelected(series?.label || ''))
                : data;
    
            const rememberStyle = row => {
                if (!controller.previousStyles.has(row)) {
                    controller.previousStyles.set(row, {
                        display: row.style.display,
                        opacity: row.style.opacity
                    });
                }
            };
    
            const syncLegend = () => {
                controller.root.querySelectorAll(
                    '.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"]'
                ).forEach(row => {
                    const label = getFlotRowLabel(row);
                    if (!label || !(label in controller.seriesConfig)) return;
                    const selected = isSelected(label);
                    rememberStyle(row);
                    row.style.opacity = selected ? '1' : '0.35';
                    row.style.display = controller.mode === 'fast_complete_hide' && !selected ? 'none' : '';
                });
            };
    
            const syncTooltipNode = node => {
                if (!(node instanceof Element)) return;
                const rows = new Set();
                const addRow = candidate => {
                    const row = candidate?.closest?.('.graph-tooltip-list-item');
                    if (row) rows.add(row);
                };
                addRow(node);
                node.querySelectorAll?.('.graph-tooltip-list-item').forEach(row => rows.add(row));
                rows.forEach(row => {
                    const label = getFlotRowLabel(row);
                    if (label in controller.seriesConfig) {
                        rememberStyle(row);
                        row.style.display = isSelected(label) ? '' : 'none';
                    }
                });
            };
    
            const bindCurrentPlot = () => {
                controller.bindQueued = false;
                const plot = getFlotPlot(controller.root);
                if (!plot?.getData || !plot?.setData) return;
    
                if (plot !== controller.plot) {
                    controller.plot = plot;
                    const originalSetData = plot.setData;
                    controller.originalSetData = originalSetData;
                    controller.lastFullData = plot.getData();
                    controller.needsApply = true;
    
                    plot.setData = function (data, ...args) {
                        if (Array.isArray(data)) controller.lastFullData = data;
                        return originalSetData.call(this, filterData(data), ...args);
                    };
                }
    
                if (controller.needsApply && Array.isArray(controller.lastFullData)) {
                    plot.setData(controller.lastFullData);
                    plot.setupGrid?.();
                    plot.draw?.();
                    controller.needsApply = false;
                }
                syncLegend();
            };
    
            if (!controller.observer) {
                controller.observer = new MutationObserver(mutations => {
                    for (const mutation of mutations) {
                        mutation.addedNodes.forEach(syncTooltipNode);
                    }
                    if (!controller.bindQueued) {
                        controller.bindQueued = true;
                        queueMicrotask(bindCurrentPlot);
                    }
                });
                controller.observer.observe(document.body, { childList: true, subtree: true });
            }
    
            bindCurrentPlot();
            return controller.plot ? 'flot' : null;
        };
    
        const resetSeriesVisibility = ({ root = document } = {}) => {
            const controller = flotVisibilityControllers.get(root);
            let changed = false;
            if (controller) {
                changed = true;
                controller.observer?.disconnect();
                if (controller.plot && controller.originalSetData) {
                    controller.plot.setData = controller.originalSetData;
                    if (Array.isArray(controller.lastFullData)) {
                        controller.originalSetData.call(controller.plot, controller.lastFullData);
                        controller.plot.setupGrid?.();
                        controller.plot.draw?.();
                    }
                }
                controller.previousStyles.forEach((style, row) => {
                    row.style.display = style.display;
                    row.style.opacity = style.opacity;
                });
                flotVisibilityControllers.delete(root);
            }
            const uPlotController = uPlotFastVisibilityControllers.get(root);
            if (uPlotController) {
                changed = true;
                uPlotController.observer?.disconnect();
                uPlotController.unbindPlot?.();
                uPlotController.tooltipHookRestore?.();
                if (uPlotController.applyFrame) {
                    cancelAnimationFrame(uPlotController.applyFrame);
                    uPlotController.applyFrame = 0;
                }
                if (uPlotController.tooltipFrame) {
                    cancelAnimationFrame(uPlotController.tooltipFrame);
                    uPlotController.tooltipFrame = 0;
                }
                if (uPlotController.uplot?.batch && uPlotController.uplot?.setSeries) {
                    uPlotController.uplot.batch(() => {
                        uPlotController.uplot.series.slice(1).forEach((series, offset) => {
                            const index = offset + 1;
                            const hasOriginalStroke = uPlotController.originalSeriesStrokes?.has(index);
                            const originalStroke = uPlotController.originalSeriesStrokes?.get(index);
                            if (series.show === false || hasOriginalStroke) {
                                uPlotController.uplot.setSeries(index, {
                                    show: true,
                                    ...(hasOriginalStroke ? { stroke: originalStroke } : {})
                                });
                            }
                        });
                    });
                }
                root.querySelectorAll?.('.dashbridge-uplot-fast-hidden, .dashbridge-uplot-fast-dimmed')
                    .forEach(row => row.classList.remove('dashbridge-uplot-fast-hidden', 'dashbridge-uplot-fast-dimmed'));
                document.querySelectorAll?.(`.${uPlotController.tooltipHiddenClass}`)
                    .forEach(row => row.classList.remove('dashbridge-uplot-fast-tooltip-hidden', uPlotController.tooltipHiddenClass));
                uPlotFastVisibilityControllers.delete(root);
            }
            return changed;
        };
    
        // BUG-E fix: внешний лимит обхода fiber увеличен с 16 до 32 для совместимости с Grafana 11+.
        const getUPlotLegendRuntime = root => {
            const buttons = Array.from(root?.querySelectorAll?.('button') || [])
                .filter(button => String(button.className || '').includes('LegendLabel'));
    
            for (const button of buttons) {
                const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
                let fiber = fiberKey && button[fiberKey];
    
                for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
                    const props = fiber.memoizedProps;
                    if (!props?.item || typeof props.onLabelClick !== 'function') continue;
    
                    for (let parent = fiber; parent && depth < 48; parent = parent.return) {
                        const parentProps = parent.memoizedProps;
                        if (Array.isArray(parentProps?.items) && typeof parentProps.onLabelClick === 'function') {
                            return { items: parentProps.items, onLabelClick: parentProps.onLabelClick };
                        }
                    }
                }
            }
            return null;
        };
    
        const applyUPlotNativeLegendVisibility = async ({ root, seriesConfig }) => {
            const isWantedVisible = item => getSeriesConfigState(seriesConfig, item.label) !== false;
            const isVisible = item => item?.disabled !== true;
            const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
            const findRuntime = () => getUPlotLegendRuntime(root);
            const findItem = label => findRuntime()?.items.find(item => item?.label === label);
    
            const waitForVisibility = async (label, visible) => {
                for (let frame = 0; frame < 60; frame += 1) {
                    if (isVisible(findItem(label)) === visible) return true;
                    await nextFrame();
                }
                return false;
            };
    
            const invoke = (label, ctrlKey) => {
                const runtime = findRuntime();
                const item = runtime?.items.find(candidate => candidate?.label === label);
                if (!item || typeof runtime?.onLabelClick !== 'function') return false;
                runtime.onLabelClick(item, {
                    type: 'click',
                    ctrlKey,
                    metaKey: false,
                    shiftKey: false,
                    currentTarget: null,
                    target: null,
                    nativeEvent: { ctrlKey, metaKey: false, shiftKey: false },
                    preventDefault() { },
                    stopPropagation() { }
                });
                return true;
            };
    
            const runtime = findRuntime();
            if (!runtime?.items?.length) return null;
    
            const items = runtime.items.filter(item => typeof item?.label === 'string' && item.label);
            const selected = items.filter(isWantedVisible);
            const mismatched = items.filter(item => isVisible(item) !== isWantedVisible(item));
            if (!mismatched.length) return 'uplot-native';
    
            // BUG-J fix: solo-путь (Ctrl-клик) применяем только если хотим показать ровно 1 серию
            // и при этом хотя бы одна из остальных сейчас видима (есть что скрывать одним кликом).
            const soloItem = selected.length === 1 ? selected[0] : null;
            const soloWitness = soloItem && items.find(item =>
                item !== soloItem && isVisible(item)
            );
    
            try {
                if (soloItem && soloWitness) {
                    if (!invoke(soloItem.label, false)
                        || !await waitForVisibility(soloWitness.label, false)) {
                        return null;
                    }
    
                    for (const item of selected.slice(1)) {
                        if (!invoke(item.label, true)
                            || !await waitForVisibility(item.label, true)) {
                            return null;
                        }
                    }
                } else {
                    for (const item of mismatched) {
                        const desired = isWantedVisible(item);
                        if (!invoke(item.label, true)
                            || !await waitForVisibility(item.label, desired)) {
                            return null;
                        }
                    }
                }
                return 'uplot-native';
            } catch (error) {
                console.warn('[DashBridge] Native uPlot legend visibility failed', error);
                return null;
            }
        };
    
        // BUG-E fix: увеличена глубина обхода React fiber с 16 до 32 для совместимости с Grafana 11+,
        // где дополнительные обёртки (StrictMode, Context, ErrorBoundary) увеличивают глубину дерева.
        const getUPlotLegendItem = button => {
            const fiberKey = Object.keys(button || {}).find(key => key.startsWith('__reactFiber$'));
            let fiber = fiberKey && button[fiberKey];
            for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
                const props = fiber.memoizedProps;
                if (props?.item && typeof props.onLabelClick === 'function') return props.item;
            }
            return null;
        };
    
        const applyUPlotFastCompleteHide = ({ root, seriesConfig, mode = 'fast_complete_hide' }) => {
            const uplot = findUPlotForThreshold(root);
            const runtime = getUPlotLegendRuntime(root);
            if (!uplot?.batch || !uplot?.setSeries || !runtime?.items?.length) return null;
    
            let controller = uPlotFastVisibilityControllers.get(root);
            if (!controller) {
                controller = {
                    root,
                    seriesConfig: {},
                    uplot: null,
                    originalSetData: null,
                    observer: null,
                    unbindPlot: null,
                    tooltipHookRestore: null,
                    tooltipFrame: 0,
                    hiddenSeries: new Set(),
                    hiddenLabels: new Set(),
                    tooltipHiddenClass: `dashbridge-uplot-tooltip-${++uPlotTooltipControllerSequence}`,
                    originalSeriesStrokes: new Map(),
                    runtime: null,
                    refreshRuntime: true,
                    applyFrame: 0
                };
                uPlotFastVisibilityControllers.set(root, controller);
            }
            controller.seriesConfig = { ...seriesConfig };
            controller.mode = mode;
            controller.runtime = runtime;
            controller.refreshRuntime = false;
    
            const isVisible = item => getSeriesConfigState(controller.seriesConfig, item.label) !== false;
            // Grafana exposes a frame-local field index. uPlot flattens the
            // frames by placing their time field at each frame boundary, so the
            // matching uPlot index is the sum of frame and field positions.
            const getSeriesIndex = item => {
                const fieldIndex = item?.fieldIndex;
                if (!fieldIndex || typeof fieldIndex !== 'object'
                    || !Number.isInteger(fieldIndex.frameIndex)
                    || !Number.isInteger(fieldIndex.fieldIndex)) return null;
                return fieldIndex.frameIndex + fieldIndex.fieldIndex;
            };
    
            const syncLegendRows = (node, currentRuntime = null) => {
                currentRuntime ||= getUPlotLegendRuntime(root);
                const isGrafanaInControl = currentRuntime?.items?.some(item => item.disabled === true);
    
                const buttons = [];
                if (node instanceof Element && node.matches('button')) buttons.push(node);
                node?.querySelectorAll?.('button').forEach(button => buttons.push(button));
                buttons.filter(button => String(button.className || '').includes('LegendLabel')).forEach(button => {
                    const item = getUPlotLegendItem(button);
                    const row = button.closest('tr, [class*="LegendRow"]');
                    if (!item || !row) return;
    
                    let hidden;
                    if (isGrafanaInControl) {
                        hidden = item.disabled === true;
                    } else {
                        hidden = !isVisible(item);
                    }
    
                    row.classList.toggle('dashbridge-uplot-fast-hidden', controller.mode === 'fast_complete_hide' && hidden);
                    row.classList.toggle('dashbridge-uplot-fast-dimmed', controller.mode === 'fast_click_toggle' && hidden);
                });
            };
    
            // BUG-I fix: ищем тултипы от document.body, а не от root панели —
            // Grafana рендерит оверлеи в Portal за пределами панели. Но используем
            // body вместо document чтобы исключить <head> и снизить число узлов.
            const getTooltipOverlays = () => Array.from((document.body || document).querySelectorAll('div')).filter(element => {
                const style = getComputedStyle(element);
                const text = (element.innerText || '').trim();
                return style.position === 'fixed'
                    && Number(style.zIndex || 0) >= 1000
                    && /^\d{4}-\d{2}-\d{2}\s/.test(text);
            });
    
            const syncTooltipRows = () => {
                document.querySelectorAll(`.${controller.tooltipHiddenClass}`).forEach(row => {
                    row.classList.remove('dashbridge-uplot-fast-tooltip-hidden', controller.tooltipHiddenClass);
                });
                if (!controller.hiddenLabels.size) return;
                getTooltipOverlays().forEach(overlay => {
                    overlay.querySelectorAll('div').forEach(label => {
                        const seriesName = (label.innerText || '').trim();
                        if (!controller.hiddenLabels.has(seriesName)) return;
                        label.parentElement?.classList.add(
                            'dashbridge-uplot-fast-tooltip-hidden', controller.tooltipHiddenClass
                        );
                    });
                });
            };
    
            const scheduleTooltipRows = () => {
                if (controller.tooltipFrame) return;
                controller.tooltipFrame = requestAnimationFrame(() => {
                    controller.tooltipFrame = 0;
                    syncTooltipRows();
                });
            };
    
            const installTooltipRowFilter = plot => {
                controller.tooltipHookRestore?.();
                controller.tooltipHookRestore = null;
                const hooks = plot.hooks?.setLegend || plot.opts?.hooks?.setLegend;
                if (!Array.isArray(hooks) || !hooks.length) return;
                const originals = hooks.slice();
                hooks.forEach((hook, index) => {
                    hooks[index] = function (u, ...args) {
                        const result = hook.call(this, u, ...args);
                        scheduleTooltipRows();
                        return result;
                    };
                });
                controller.tooltipHookRestore = () => hooks.splice(0, hooks.length, ...originals);
            };
    
            const scheduleApply = (refreshRuntime = false) => {
                controller.refreshRuntime ||= refreshRuntime;
                if (controller.applyFrame) return;
                controller.applyFrame = requestAnimationFrame(() => {
                    controller.applyFrame = 0;
                    applyToPlot();
                });
            };
    
            const applyToPlot = () => {
                const currentPlot = findUPlotForThreshold(root);
                const currentRuntime = controller.refreshRuntime || !controller.runtime
                    ? getUPlotLegendRuntime(root)
                    : controller.runtime;
                if (!currentPlot?.batch || !currentRuntime?.items?.length) return;
                controller.runtime = currentRuntime;
                controller.refreshRuntime = false;
    
                if (currentPlot !== controller.uplot) {
                    controller.unbindPlot?.();
                    controller.tooltipHookRestore?.();
                    controller.tooltipHookRestore = null;
                    controller.uplot = currentPlot;
                    controller.originalSeriesStrokes.clear();
                    controller.originalSetData = currentPlot.setData;
                    currentPlot.setData = function (data, ...args) {
                        const result = controller.originalSetData.call(this, data, ...args);
                        scheduleApply();
                        return result;
                    };
                    controller.unbindPlot = () => {
                        if (currentPlot.setData === controller.originalSetData || !controller.originalSetData) return;
                        currentPlot.setData = controller.originalSetData;
                    };
                }
    
                const isGrafanaInControl = currentRuntime.items.some(item => item.disabled === true);
    
                syncLegendRows(root, currentRuntime);
    
                controller.hiddenSeries = new Set(currentRuntime.items
                    .filter(item => {
                        if (isGrafanaInControl) return item.disabled === true;
                        return !isVisible(item);
                    })
                    .map(getSeriesIndex)
                    .filter(Number.isInteger));
                controller.hiddenLabels = new Set(currentRuntime.items
                    .filter(item => isGrafanaInControl ? item.disabled === true : !isVisible(item))
                    .map(item => item.label));
                if (!controller.tooltipHookRestore) installTooltipRowFilter(currentPlot);
                currentPlot.batch(() => currentRuntime.items.forEach(item => {
                    const index = getSeriesIndex(item);
                    if (!Number.isInteger(index) || index <= 0 || index >= currentPlot.series.length) return;
    
                    let wanted;
                    if (isGrafanaInControl) {
                        wanted = item.disabled !== true;
                    } else {
                        wanted = isVisible(item);
                    }
    
                    if (currentPlot.series[index]?.show !== wanted) {
                        if (!controller.originalSeriesStrokes.has(index)) {
                            controller.originalSeriesStrokes.set(index, currentPlot.series[index]?.stroke);
                        }
                        currentPlot.setSeries(index, { show: wanted, stroke: item.color });
                    } else if (item.color && currentPlot.series[index]?.stroke !== item.color) {
                        if (!controller.originalSeriesStrokes.has(index)) {
                            controller.originalSeriesStrokes.set(index, currentPlot.series[index]?.stroke);
                        }
                        currentPlot.setSeries(index, { stroke: item.color });
                    }
                }));
            };
    
            if (!document.getElementById('dashbridge-uplot-fast-visibility-style')) {
                const style = document.createElement('style');
                style.id = 'dashbridge-uplot-fast-visibility-style';
                style.textContent = '.dashbridge-uplot-fast-hidden,.dashbridge-uplot-fast-tooltip-hidden{display:none!important;}.dashbridge-uplot-fast-dimmed{opacity:.35!important;}';
                document.head.appendChild(style);
            }
    
            if (!controller.observer) {
                controller.observer = new MutationObserver(mutations => {
                    let chartWasReplaced = false;
                    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
                        if (!(node instanceof Element)) return;
                        const hasCanvas = node.matches('canvas') || !!node.querySelector('canvas');
                        const hasLegendRow = String(node.className || '').includes('LegendLabel')
                            || !!node.querySelector('[class*="LegendLabel"]');
                        if (hasLegendRow) {
                            controller.refreshRuntime = true;
                            syncLegendRows(node);
                        }
                        chartWasReplaced ||= hasCanvas;
                    }));
                    if (chartWasReplaced) scheduleApply(true);
                });
                controller.observer.observe(root, { childList: true, subtree: true });
            }
    
            syncLegendRows(root);
            applyToPlot();
            return 'uplot-fast-complete-hide';
        };
    

        const resetFlotSeriesVisibility = ({ root = document } = {}) => {
            const controller = flotVisibilityControllers.get(root);
            if (!controller) return false;
            controller.observer?.disconnect();
            if (controller.plot && controller.originalSetData) {
                controller.plot.setData = controller.originalSetData;
                if (Array.isArray(controller.lastFullData)) {
                    controller.originalSetData.call(controller.plot, controller.lastFullData);
                    controller.plot.setupGrid?.();
                    controller.plot.draw?.();
                }
            }
            controller.previousStyles.forEach((style, row) => {
                row.style.display = style.display;
                row.style.opacity = style.opacity;
            });
            flotVisibilityControllers.delete(root);
            return true;
        };
        return Object.freeze({
            applyUPlotFastCompleteHide, applyUPlotNativeLegendVisibility,
            getFlotPlot, getFlotRowLabel, getUPlotLegendRuntime,
            installFlotVisibilityController, resetFlotSeriesVisibility, resetSeriesVisibility
        });
    }

    root.DashBridgeGrafanaLegendVisibilityAdapters = Object.freeze({ create });
})(window);
