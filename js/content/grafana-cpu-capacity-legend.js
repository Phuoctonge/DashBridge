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
        const clearNativeSortIndicators = (panelRoot, except = null) => {
            panelRoot?.querySelectorAll?.('table thead th, table thead [role="columnheader"]').forEach(header => {
                if (header === except || header.classList?.contains('dashbridge-vcpu-legend-header')) return;
                header.removeAttribute('aria-sort');
                header.querySelectorAll?.('svg').forEach(icon => { icon.style.visibility = 'hidden'; });
            });
        };
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
            // Enrichment must not turn a failed or missing snapshot into a healthy report.
            if (!['no_threshold', 'ok', 'warning', 'critical'].includes(snapshot.state)) return attached;
            const coefficient = Number(sla.coefficient);
            if (!Number.isFinite(coefficient) || coefficient <= 0) {
                return { ...attached, state: 'configuration_error', error: 'Некорректный коэффициент фильтра Load Average по vCPU.' };
            }
            if (!attached.series.length) {
                return snapshot.filteredEmpty === true && snapshot.dataStatus === 'filtered_empty'
                    ? attached : { ...attached, state: 'no_data' };
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
            if (window.name !== 'dashbridge-iframe') return;
            if (document.getElementById('dashbridge-vcpu-legend-style')) return;
            const style = document.createElement('style');
            style.id = 'dashbridge-vcpu-legend-style';
            style.textContent = `
                .dashbridge-vcpu-legend-cell {
                    box-sizing:border-box !important;
                    width:max-content !important;
                    min-width:48px !important;
                    max-width:100% !important;
                    flex:0 0 auto !important;
                    padding-left:6px !important;
                    padding-right:6px !important;
                    text-align:right !important;
                    white-space:nowrap !important;
                }
                .dashbridge-vcpu-legend-header { color:inherit; font-weight:inherit; }
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
            cell.style.setProperty('width', '48px', 'important');
            cell.style.setProperty('min-width', '48px', 'important');
            cell.style.setProperty('max-width', '48px', 'important');
            cell.style.setProperty('flex', '0 0 48px', 'important');
            cell.title = header
                ? 'Количество виртуальных CPU'
                : (text === '-' ? 'Количество vCPU не определено' : `${text} vCPU`);
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
                header.querySelector?.('[data-dashbridge-vcpu-sort-icon]')?.remove();
                if (direction && typeof document !== 'undefined') {
                    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    icon.dataset.dashbridgeVcpuSortIcon = '1';
                    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('width', '12');
                    icon.setAttribute('height', '12'); icon.setAttribute('viewBox', '0 0 24 24');
                    icon.setAttribute('focusable', 'false'); icon.style.marginLeft = '2px';
                    icon.style.verticalAlign = 'middle';
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', direction === 'asc'
                        ? 'M17,13.41,12.71,9.17a1,1,0,0,0-1.42,0L7.05,13.41a1,1,0,0,0,0,1.42,1,1,0,0,0,1.41,0L12,11.29l3.54,3.54a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29A1,1,0,0,0,17,13.41Z'
                        : 'M17,9.17a1,1,0,0,0-1.41,0L12,12.71,8.46,9.17a1,1,0,0,0-1.41,0,1,1,0,0,0,0,1.42l4.24,4.24a1,1,0,0,0,1.42,0L17,10.59A1,1,0,0,0,17,9.17Z');
                    icon.appendChild(path); header.appendChild(icon);
                }
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
            if (!state.cpuCapacityFilterEnabled || state.legendColumns?.vcpu === false) {
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
                    : '-';
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
                        clearNativeSortIndicators(panelRoot, headerCell);
                        sortRows(panelRoot, { restoreOriginal: sortDirection === null });
                    };
                }
            }
            for (const table of tables) {
                const rowsInTable = Array.from(table.querySelectorAll('tr'));
                const columnCount = Math.max(0, ...rowsInTable.map(row => row.children.length));
                if (columnCount < 2) continue;
                table.classList.add('dashbridge-vcpu-table');
                const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => Math.max(0,
                    ...rowsInTable.map(row => row.children[columnIndex]?.getBoundingClientRect?.().width || 0)));
                const template = `minmax(0,1fr) 48px${columnCount > 2
                    ? ` ${columnWidths.slice(2).map(width => `${Math.ceil(width)}px`).join(' ')}` : ''}`;
                rowsInTable.forEach(row => {
                    row.style.setProperty('display', 'grid', 'important');
                    row.style.setProperty('grid-template-columns', template, 'important');
                    row.style.setProperty('width', '100%', 'important');
                    row.children[0]?.style.setProperty('min-width', '0', 'important');
                });
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
            if (!state.cpuCapacityFilterEnabled || state.legendColumns?.vcpu === false) {
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
                        vcpuHeader.removeAttribute('aria-sort');
                        vcpuHeader.querySelector('[data-dashbridge-vcpu-sort-icon]')?.remove();
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


