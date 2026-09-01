(function initGrafanaCpuCapacityLegend(root) {
    'use strict';

    const create = ({ tools, visualMetadata, getLegendLabel, syncThresholdHighlightState }) => {
        if (!tools || !visualMetadata || typeof getLegendLabel !== 'function'
            || typeof syncThresholdHighlightState !== 'function') {
            throw new Error('DashBridge Grafana vCPU legend dependencies are unavailable');
        }

        let activeRoot = null;
        let sortDirection = null;
        const controllers = new WeakMap();
        const originalOrders = new WeakMap();

        const normalizeName = value => String(value || '').trim().toLowerCase();
        const matchEntry = label => {
            const normalizedLabel = normalizeName(label);
            let best = null;
            let bestScore = -1;
            for (const entry of visualMetadata.seriesCpuCapacityEntries) {
                for (const name of entry.sourceNames || []) {
                    const candidate = normalizeName(name);
                    if (candidate === 'value' || candidate.length < 4) continue;
                    const exact = candidate === normalizedLabel;
                    if (!exact && !normalizedLabel.includes(candidate) && !candidate.includes(normalizedLabel)) continue;
                    const score = (exact ? 100000 : 0) + candidate.length;
                    if (score > bestScore) {
                        best = entry;
                        bestScore = score;
                    }
                }
            }
            return best;
        };

        const attachToReportSnapshot = (snapshot, sla = {}) => {
            if (!snapshot || !Array.isArray(snapshot.series)) return snapshot;
            const attached = {
                ...snapshot,
                series: snapshot.series.map(series => {
                    const entry = matchEntry(series?.name);
                    const cpuCapacity = Number(entry?.value);
                    return Number.isFinite(cpuCapacity) && cpuCapacity > 0
                        ? { ...series, cpuCapacity }
                        : series;
                })
            };
            if (sla.source !== 'cpu_capacity') return attached;
            const coefficient = Number(sla.coefficient);
            if (!Number.isFinite(coefficient) || coefficient <= 0) {
                return { ...attached, state: 'configuration_error', error: 'Некорректный коэффициент фильтра Load Average по vCPU.' };
            }
            let unknownCapacity = false;
            const series = attached.series.map(item => {
                const cpuCapacity = Number(item?.cpuCapacity);
                if (!Number.isFinite(cpuCapacity) || cpuCapacity <= 0) {
                    unknownCapacity = true;
                    return { ...item, exceeded: false, level: 'unknown' };
                }
                const threshold = cpuCapacity * coefficient;
                const exceeded = Number(item?.value) > threshold;
                return { ...item, threshold, cpuCapacityThreshold: threshold,
                    exceeded, level: exceeded ? 'critical' : 'normal' };
            });
            const hasCritical = series.some(item => item.level === 'critical');
            return {
                ...attached,
                source: 'cpu_capacity',
                cpuCapacityCoefficient: coefficient,
                threshold: null,
                criticalThreshold: null,
                warningThreshold: null,
                state: hasCritical ? 'critical' : (unknownCapacity ? 'no_data' : 'ok'),
                series
            };
        };

        const ensureStyle = () => {
            if (document.getElementById('dashbridge-vcpu-legend-style')) return;
            const style = document.createElement('style');
            style.id = 'dashbridge-vcpu-legend-style';
            style.textContent = `
                .dashbridge-vcpu-legend-cell {
                    box-sizing:border-box !important;
                    width:48px !important;
                    min-width:48px !important;
                    max-width:48px !important;
                    padding-left:6px !important;
                    padding-right:6px !important;
                    text-align:right !important;
                    white-space:nowrap !important;
                }
                .dashbridge-vcpu-legend-header { color:inherit; font-weight:inherit; }
                .dashbridge-vcpu-legend-header[data-dashbridge-sort="asc"]::after { content:' ▲'; font-size:.72em; }
                .dashbridge-vcpu-legend-header[data-dashbridge-sort="desc"]::after { content:' ▼'; font-size:.72em; }
            `;
            document.documentElement.appendChild(style);
        };

        const removeColumn = panelRoot => panelRoot?.querySelectorAll?.('.dashbridge-vcpu-legend-cell')
            .forEach(element => element.remove());

        const insertCell = (row, anchor, text, header = false) => {
            let cell = row.querySelector?.(':scope > .dashbridge-vcpu-legend-cell');
            if (!cell) {
                const tableCell = anchor?.closest?.('td,th');
                const nativeValueCell = tableCell?.nextElementSibling;
                const tagName = nativeValueCell?.tagName?.toLowerCase()
                    || (row.tagName === 'TR' ? (header ? 'th' : 'td') : 'span');
                cell = document.createElement(tagName);
                const nativeClasses = typeof nativeValueCell?.className === 'string'
                    ? nativeValueCell.className.trim()
                    : '';
                cell.className = [
                    nativeClasses,
                    'dashbridge-vcpu-legend-cell',
                    header ? 'dashbridge-vcpu-legend-header' : ''
                ].filter(Boolean).join(' ');
                if (tableCell?.parentElement === row) tableCell.after(cell);
                else row.appendChild(cell);
            }
            if (cell.textContent !== text) cell.textContent = text;
            cell.title = header
                ? 'Количество виртуальных CPU'
                : (text === '—' ? 'Количество vCPU не определено' : `${text} vCPU`);
            return cell;
        };

        const sortRows = (panelRoot, { restoreOriginal = false } = {}) => {
            const direction = sortDirection;
            panelRoot?.querySelectorAll?.('.dashbridge-vcpu-legend-header').forEach(header => {
                if (direction) header.dataset.dashbridgeSort = direction;
                else delete header.dataset.dashbridgeSort;
                header.setAttribute('aria-sort', direction === 'asc'
                    ? 'ascending'
                    : direction === 'desc' ? 'descending' : 'none');
            });
            if (!direction && !restoreOriginal) return 0;
            const groups = new Map();
            panelRoot?.querySelectorAll?.('.dashbridge-vcpu-legend-cell:not(.dashbridge-vcpu-legend-header)')
                .forEach(cell => {
                    const row = cell.closest?.('tr') || cell.parentElement;
                    const parent = row?.parentElement;
                    if (!row || !parent) return;
                    if (!groups.has(parent)) groups.set(parent, []);
                    if (!groups.get(parent).includes(row)) groups.get(parent).push(row);
                });
            let moved = 0;
            for (const [parent, rows] of groups) {
                const originalOrderState = originalOrders.get(parent);
                const sorted = rows.map((row, index) => {
                    const cell = row.querySelector?.('.dashbridge-vcpu-legend-cell:not(.dashbridge-vcpu-legend-header)');
                    const rawValue = cell?.dataset?.dashbridgeVcpuValue;
                    const value = rawValue !== '' && rawValue !== undefined ? Number(rawValue) : null;
                    const originalOrder = originalOrderState?.orders?.get(row);
                    return {
                        row,
                        index,
                        originalOrder: Number.isFinite(originalOrder) ? originalOrder : index,
                        value: Number.isFinite(value) ? value : null
                    };
                }).sort((left, right) => {
                    if (!direction) return left.originalOrder - right.originalOrder;
                    if (left.value === null && right.value === null) return left.index - right.index;
                    if (left.value === null) return 1;
                    if (right.value === null) return -1;
                    const difference = direction === 'asc'
                        ? left.value - right.value
                        : right.value - left.value;
                    return difference || left.index - right.index;
                });
                if (sorted.every((entry, index) => entry.row === rows[index])) continue;
                sorted.forEach(entry => parent.appendChild(entry.row));
                moved += sorted.length;
            }
            return moved;
        };

        const renderColumn = (panelRoot, state = tools) => {
            if (!state.cpuCapacityFilterEnabled) {
                removeColumn(panelRoot);
                return 0;
            }
            ensureStyle();
            const rows = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(panelRoot) || []);
            const decoratedRows = [];
            let changes = 0;
            for (const row of rows) {
                const labelElement = getLegendLabel(row);
                const label = (labelElement?.textContent || '').trim();
                const header = !!row.closest?.('thead')
                    || /^(?:name|series|имя|серия)$/i.test(label);
                if (!label || header) continue;
                const entry = matchEntry(label);
                const value = Number(entry?.value);
                const text = Number.isFinite(value)
                    ? (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100))
                    : '—';
                const existingCell = row.querySelector?.(':scope > .dashbridge-vcpu-legend-cell');
                const previousText = existingCell?.textContent;
                const cell = insertCell(row, labelElement, text);
                if (!existingCell || previousText !== text) changes += 1;
                cell.dataset.dashbridgeVcpuValue = Number.isFinite(value) ? String(value) : '';
                const parent = row.parentElement;
                if (parent) {
                    let originalOrderState = originalOrders.get(parent);
                    if (!originalOrderState) {
                        originalOrderState = { orders: new WeakMap(), next: 0 };
                        originalOrders.set(parent, originalOrderState);
                    }
                    if (!originalOrderState.orders.has(row)) {
                        originalOrderState.orders.set(row, originalOrderState.next++);
                    }
                    row.dataset.dashbridgeVcpuOriginalOrder = String(originalOrderState.orders.get(row));
                }
                decoratedRows.push(row);
            }
            const tables = [...new Set(decoratedRows.map(row => row.closest?.('table')).filter(Boolean))];
            for (const table of tables) {
                const headerRow = table.querySelector('thead tr') || Array.from(table.querySelectorAll('tr'))
                    .find(row => /^(?:name|series|имя|серия)$/i.test((row.querySelector('th,td')?.textContent || '').trim()));
                const headerAnchor = headerRow?.querySelector('th,td');
                if (headerRow && headerAnchor) {
                    const existingHeader = headerRow.querySelector?.(':scope > .dashbridge-vcpu-legend-header');
                    const headerCell = insertCell(headerRow, headerAnchor, 'vCPU', true);
                    if (!existingHeader) changes += 1;
                    headerCell.onclick = event => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.stopImmediatePropagation?.();
                        sortDirection = sortDirection === null
                            ? 'desc'
                            : sortDirection === 'desc' ? 'asc' : null;
                        sortRows(panelRoot, { restoreOriginal: sortDirection === null });
                    };
                }
            }
            changes += sortRows(panelRoot);
            return changes;
        };

        const stopController = panelRoot => {
            const controller = panelRoot && controllers.get(panelRoot);
            controller?.observer?.disconnect?.();
            if (controller?.nativeSortListener) {
                panelRoot?.removeEventListener?.('click', controller.nativeSortListener, true);
            }
            if (controller?.frame) cancelAnimationFrame(controller.frame);
            if (panelRoot) controllers.delete(panelRoot);
            removeColumn(panelRoot);
        };

        const sync = (panelRoot, state = tools) => {
            if (activeRoot && activeRoot !== panelRoot) stopController(activeRoot);
            if (!state.cpuCapacityFilterEnabled) {
                stopController(panelRoot);
                activeRoot = null;
                sortDirection = null;
                return 0;
            }
            let controller = controllers.get(panelRoot);
            if (!controller) {
                controller = { observer: null, frame: 0, state, nativeSortListener: null };
                controller.schedule = () => {
                    if (controller.frame) return;
                    controller.frame = requestAnimationFrame(() => {
                        controller.frame = 0;
                        // This observer only restores the vCPU column after a
                        // Grafana remount. Running the complete response
                        // presentation here re-arms Flot on our own mutation
                        // and creates an endless high-CPU render loop.
                        const changes = renderColumn(panelRoot, controller.state);
                        controller.observer?.takeRecords?.();
                        if (changes > 0) {
                            window.DashBridgeGrafanaVisualEngine?.reflowChart?.({ root: panelRoot });
                            syncThresholdHighlightState(panelRoot, controller.state);
                        }
                    });
                };
                controller.observer = new MutationObserver(controller.schedule);
                controller.observer.observe(panelRoot === document ? document.documentElement : panelRoot, {
                    childList: true,
                    subtree: true
                });
                controller.nativeSortListener = event => {
                    const header = event.target?.closest?.('th,[role="columnheader"]');
                    if (!header || header.classList?.contains('dashbridge-vcpu-legend-header')) return;
                    if (!header.closest?.('table')?.querySelector?.('.dashbridge-vcpu-legend-header')) return;
                    sortDirection = null;
                    panelRoot.querySelectorAll?.('.dashbridge-vcpu-legend-header').forEach(vcpuHeader => {
                        delete vcpuHeader.dataset.dashbridgeSort;
                        vcpuHeader.setAttribute('aria-sort', 'none');
                    });
                };
                panelRoot.addEventListener?.('click', controller.nativeSortListener, true);
                controllers.set(panelRoot, controller);
            }
            controller.state = state;
            activeRoot = panelRoot;
            return renderColumn(panelRoot, state);
        };

        const stop = () => {
            if (activeRoot) stopController(activeRoot);
            activeRoot = null;
            sortDirection = null;
        };

        return Object.freeze({ attachToReportSnapshot, sync, stop });
    };

    root.DashBridgeGrafanaCpuCapacityLegend = Object.freeze({ create });
})(globalThis);
